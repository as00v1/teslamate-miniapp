#!/bin/bash
# ============================================
# TeslaMate Miniapp 后端部署脚本（在 ECS 上执行）
# 用法：bash deploy.sh（幂等，可重复执行）
# 环境变量（部署前 export）：
#   APP_DB_PASS TM_DB_PASS TESLA_API_TOKEN TESLA_PASSPHRASE WX_APPID WX_SECRET APP_DB_USER TM_DB_USER
# ============================================
set -e

cd /data/app/tesla-api

echo "==> [1/6] 初始化数据库（幂等）"
# 库/角色：先查存在再创建
EXIST_DB=$(docker exec teslamate-database-1 psql -U teslamate -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='tesla_app'")
if [ "$EXIST_DB" != "1" ]; then
  docker exec teslamate-database-1 psql -U teslamate -d postgres -c "CREATE DATABASE tesla_app"
fi
EXIST_APP_ROLE=$(docker exec teslamate-database-1 psql -U teslamate -d postgres -tAc "SELECT 1 FROM pg_roles WHERE rolname='tesla_app'")
if [ "$EXIST_APP_ROLE" != "1" ]; then
  docker exec teslamate-database-1 psql -U teslamate -d postgres -v p="$APP_DB_PASS" -c "CREATE ROLE tesla_app LOGIN PASSWORD :'p'"
  docker exec teslamate-database-1 psql -U teslamate -d postgres -c "GRANT ALL PRIVILEGES ON DATABASE tesla_app TO tesla_app"
fi
EXIST_RO_ROLE=$(docker exec teslamate-database-1 psql -U teslamate -d postgres -tAc "SELECT 1 FROM pg_roles WHERE rolname='tesla_readonly'")
if [ "$EXIST_RO_ROLE" != "1" ]; then
  docker exec teslamate-database-1 psql -U teslamate -d postgres -v p="$TM_DB_PASS" -c "CREATE ROLE tesla_readonly LOGIN PASSWORD :'p'"
fi
# 只读授权（幂等）—— 注意必须在 teslamate 库内执行（表都在该库 public schema）
docker exec teslamate-database-1 psql -U teslamate -d postgres -c "GRANT CONNECT ON DATABASE teslamate TO tesla_readonly" 2>/dev/null || true
docker exec teslamate-database-1 psql -U teslamate -d teslamate -c "GRANT USAGE ON SCHEMA public TO tesla_readonly" 2>/dev/null || true
docker exec teslamate-database-1 psql -U teslamate -d teslamate -c "GRANT SELECT ON ALL TABLES IN SCHEMA public TO tesla_readonly" 2>/dev/null || true
docker exec teslamate-database-1 psql -U teslamate -d teslamate -c "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO tesla_readonly" 2>/dev/null || true

# 表（IF NOT EXISTS 幂等）
docker exec -i teslamate-database-1 psql -U teslamate -d tesla_app -v passphrase="$TESLA_PASSPHRASE" <<'SQL'
CREATE TABLE IF NOT EXISTS auth_bindings (
  openid    TEXT PRIMARY KEY,
  role      TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner','member')),
  bound_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_auth_role ON auth_bindings(role);
CREATE TABLE IF NOT EXISTS app_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO app_settings (key, value) VALUES ('passphrase', :'passphrase')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
SQL
# 授权给应用账号（表由 teslamate 超管创建，owner 非 tesla_app，必须显式 GRANT）
docker exec -i teslamate-database-1 psql -U teslamate -d tesla_app -c "GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO tesla_app" 2>/dev/null || true
docker exec -i teslamate-database-1 psql -U teslamate -d tesla_app -c "GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO tesla_app" 2>/dev/null || true
docker exec -i teslamate-database-1 psql -U teslamate -d tesla_app -c "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO tesla_app" 2>/dev/null || true
echo "    数据库 OK"

echo "==> [2/6] 构建镜像"
docker compose -f deploy/docker-compose.yml --project-directory . build

echo "==> [3/6] 启动容器"
docker compose -f deploy/docker-compose.yml --project-directory . up -d

echo "==> [4/6] 等待健康检查"
for i in $(seq 1 20); do
  if curl -sf http://127.0.0.1:8081/api/v1/health >/dev/null 2>&1; then
    echo "    容器健康 (${i}s)"
    break
  fi
  sleep 1
done

echo "==> [5/6] 配置 nginx 反代"
# 部署时按需改为你的真实文件名（如 api-your-domain-com.conf）
cp /data/app/tesla-api/deploy/nginx-api.conf /data/app/nginx/conf/conf.d/api-api.conf
docker exec nginx nginx -t && docker exec nginx nginx -s reload
echo "    nginx OK"

echo "==> [6/6] 端到端验证"
echo "--- health ---"
curl -s http://127.0.0.1:8081/api/v1/health; echo
echo "--- 未绑定访问 summary（应 401）---"
curl -s -H "X-API-Token: $TESLA_API_TOKEN" -H "X-Openid: test_not_bound" http://127.0.0.1:8081/api/v1/summary; echo
echo "--- 口令绑定（错误口令应 401）---"
curl -s -X POST -H "Content-Type: application/json" -H "X-Openid: test_owner" \
  -d '{"passphrase":"wrong-pass"}' http://127.0.0.1:8081/api/v1/auth/bind; echo
echo "--- 口令绑定（正确口令 → owner）---"
curl -s -X POST -H "Content-Type: application/json" -H "X-Openid: test_owner" \
  -d "{\"passphrase\":\"$TESLA_PASSPHRASE\"}" http://127.0.0.1:8081/api/v1/auth/bind; echo
echo "--- 绑定后 summary ---"
curl -s -H "X-API-Token: $TESLA_API_TOKEN" -H "X-Openid: test_owner" http://127.0.0.1:8081/api/v1/summary; echo
echo "==> 部署完成"
