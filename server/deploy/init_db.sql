-- ============================================
-- TeslaMate Miniapp 数据库初始化（在 PG 主库执行）
-- 用法：docker exec -i teslamate-database-1 psql -U teslamate -d postgres < init_db.sql
-- 环境变量由部署脚本注入：APP_DB_PASS / TM_DB_PASS / PASSPHRASE
-- ============================================

-- 1. tesla_app 库（读写账号）
CREATE DATABASE tesla_app;
CREATE ROLE tesla_app LOGIN PASSWORD :'app_db_pass';
GRANT ALL PRIVILEGES ON DATABASE tesla_app TO tesla_app;

-- 2. teslamate 库只读账号
CREATE ROLE tesla_readonly LOGIN PASSWORD :'tm_db_pass';
GRANT CONNECT ON DATABASE teslamate TO tesla_readonly;
GRANT USAGE ON SCHEMA public TO tesla_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO tesla_readonly;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO tesla_readonly;

-- 3. tesla_app 库内建表
\connect tesla_app
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

-- 4. 初始口令（部署时注入，可后续通过车主接口修改）
INSERT INTO app_settings (key, value) VALUES ('passphrase', :'passphrase')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
