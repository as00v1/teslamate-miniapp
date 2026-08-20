# 个人特斯拉小程序 — 架构设计文档

> 版本：v1.0 ｜ 日期：2026-08-17 ｜ 状态：待评审
> 数据源：TeslaMate（已迁至阿里云 ECS）

---

## 1. 项目定位

个人车主自用小程序：把 TeslaMate 沉淀的行驶/充电/能耗数据搬到微信里，随时翻看。单用户、只读、低频拉取，无登录体系、无支付、无社交 —— 个人主体「工具」类目即可过审。

**与 Grafana 仪表盘的关系**：Grafana 是大屏分析，小程序是随身速查，数据同源（同一 PG），不重复建设。

## 2. 整体架构

```
┌─────────────────────────────────────────────┐
│  微信小程序（个人主体 · 工具类目）              │
│  总览 / 行程 / 充电 / 我的（4 tab）           │
│  原生 WXML + echarts-for-weixin             │
└──────────────────┬──────────────────────────┘
                   │ HTTPS + X-API-Token
┌──────────────────▼──────────────────────────┐
│  nginx（ECS 服务器 :443）                    │
│  api.example.com  →  反代 /api/v1           │
│  Let's Encrypt TLS · 不暴露 4000 端口        │
└──────────────────┬──────────────────────────┘
                   │ HTTP :8081（内网）
┌──────────────────▼──────────────────────────┐
│  FastAPI 容器（新增）                        │
│  Token 鉴权 → SQL 聚合 → 60s 内存缓存        │
│  psycopg 连接池（只读账号）                  │
└──────────────────┬──────────────────────────┘
                   │ SQL SELECT（只读）
┌──────────────────▼──────────────────────────┐
│  PostgreSQL（teslamate 库）                  │
│  drives / charging_processes / charges      │
│  / geofences / cars / settings              │
└─────────────────────────────────────────────┘
```

**部署形态**：全部在 ECS 一台 Docker 里。新增 `teslamate-api` 容器 + `api.example.com` 反代，与现有 nginx、TeslaMate 栈并存。

## 3. 关键设计决策

| # | 决策 | 理由 |
|---|------|------|
| 1 | 直连 PG 只读账号，**不用** TeslaMate GraphQL | schema 已完全掌握，SQL 可直接复用 Grafana 面板逻辑，避免二次封装与 token 维护 |
| 2 | 后端用 **FastAPI**（Python） | 与既有 build_dashboard.py 工具链同语言，psycopg 成熟，开发快 |
| 3 | 小程序端**原生开发**，不用 uni-app | 单平台、个人工具类、包体小；原生无框架损耗、审核更稳 |
| 4 | 鉴权用**固定 Token**（X-API-Token） | 单用户自用，无需微信登录/OpenID 链路；Token 存服务器端，小程序端存 storage |
| 5 | **60s 内存缓存** | 数据低频变化，避免每开一次小程序就打一次 PG（16 万条 charges 表聚合有成本） |
| 6 | PG 建**独立只读账号**（GRANT SELECT） | 物理隔离写权限，即使 API 被攻破也无法篡改数据 |

## 4. 数据模型与查询（复用 Grafana 已验证逻辑）

### 4.1 核心表（已确认 schema）

| 表 | 关键字段 | 说明 |
|---|---|---|
| drives | distance, duration_min, outside_temp_avg, speed_max, start_date, start_ideal_range_km | 行程 |
| charging_processes | charge_energy_added, charge_energy_used, cost, start_battery_level, end_battery_level, geofence_id, start_date | 充电过程 |
| charges | charger_power, fast_charger_present, date | 充电明细（160050 条） |
| geofences | name, id | 家/公司等位置标签 |
| cars | id, eficiency, capacity, name | 车辆 |

### 4.2 时区坑（务必沿用）

`start_date`/`date` 是 timestamp without time zone（存 UTC 数值）。取东八区小时/日期必须双转换：

```sql
-- 按天聚合（东八区）
date_trunc('day', start_date AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Shanghai')
-- 取小时
EXTRACT(HOUR FROM (start_date AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Shanghai')
```

## 5. API 规范（REST，统一前缀 /api/v1）

### 5.1 统一约定

- 请求头：`X-API-Token: <token>`（缺失/错误 → 401）
- 响应：`Content-Type: application/json`
- 成功：`{"code": 0, "data": {...}}`
- 失败：`{"code": 4001, "message": "..."}`
- 分页：`?offset=0&limit=20`（默认 limit 20，最大 50）

### 5.2 接口清单

| 方法 | 路径 | 说明 | 关键返回字段 |
|---|---|---|---|
| GET | /api/v1/summary | 总览统计 | total_distance, total_energy, total_cost, total_drives, total_charges, total_charging_energy, car_name |
| GET | /api/v1/drives | 行程分页列表 | id, start_date, distance, duration_min, speed_max, outside_temp_avg, energy_used |
| GET | /api/v1/drives/trend | 近 30 天每日里程趋势 | date[], distance[], drives[] |
| GET | /api/v1/charges | 充电过程分页列表 | id, start_date, energy_added, energy_used, cost, start_level, end_level, geofence_name |
| GET | /api/v1/charges/trend | 充电费用趋势（按月） | month[], cost[], energy[] |
| GET | /api/v1/charges/summary | 充电统计 | home_charges, fast_charges, home_cost, fast_cost |
| GET | /api/v1/vehicle | 车辆信息 | name, capacity, efficiency, odo? |
| GET | /api/v1/health | 健康检查 | status: ok |

> 注：drives/charges 列表的 time 字段按东八区格式化输出（ISO 字符串），前端直接展示，不在小程序端做时区运算。

## 6. 小程序页面设计

### 6.1 导航（tabBar 4 项）

```
首页(总览)  行程记录  充电记录  我的
```

### 6.2 页面明细

**① 首页 · 总览（index）**
- 顶部车辆卡片：车名 + 昵称 + 总里程
- 统计卡片行：总里程 / 总能耗 / 累计充电费用 / 行程次数
- 近 30 天里程柱状图（echarts）
- 充电构成占比（家充 vs 超充，barchart）

**② 行程记录（drives）**
- 列表：日期(东八区) + 里程 + 时长 + 均速 + 空调外温
- 下拉刷新 + 触底加载更多（分页 offset/limit）
- 点击行 → 详情（可选二期：单次行程起终点地图）

**③ 充电记录（charges）**
- 统计头：家充/超充次数与费用
- 月度费用柱状图
- 列表：日期 + 充入电量 + 费用 + 起始/结束 SOC + 充电地点(geofence)

**④ 我的（mine）**
- 车辆信息（车型、电池容量、效率）
- 数据更新时间（最后一条 drives/charges 时间）
- 关于（版本号、免责声明）

### 6.3 交互约定

- 进页面 onLoad/onShow 拉一次，下拉刷新手动刷新；不做轮询
- 空态/错误态统一组件（骨架屏 + 重试按钮）
- 金额用 `¥` 千分位；里程用 `km`；能耗 `kWh`

## 7. 安全清单

| 项 | 措施 |
|---|---|
| 传输 | 全站 HTTPS（Let's Encrypt），nginx 强制跳转 |
| 鉴权 | X-API-Token 固定密钥，服务器环境变量注入，不写死在代码/镜像 |
| 数据库 | 独立只读账号，仅 SELECT，禁止写权限；不暴露 5432 公网 |
| 网络 | TeslaMate 4000/3000 不开放公网；仅 api.example.com 443 对外 |
| 限流 | nginx limit_req（如 10r/s）防刷 |
| 敏感信息 | Token/数据库口令一律走环境变量（同现有 SSH_PASS 规范） |
| 小程序端 | Token 存 wx.storage；不上传任何用户授权信息（无需 wx.login） |

## 8. 开发路线

| 阶段 | 内容 | 产出 | 预估 |
|---|---|---|---|
| P0 | PG 建只读账号 + 授权 | SQL 脚本 | 0.5h |
| P0 | FastAPI 容器 + 5 个核心接口 + nginx 反代 + curl 验证 | 可访问的 /api/v1 | 2-3h |
| P1 | 小程序骨架（4 tab + request 封装 + 主题样式） | 可运行 demo | 2h |
| P1 | 总览页（统计 + echarts 趋势） | 页面 | 2h |
| P2 | 行程/充电列表 + 分页加载 | 页面 | 2h |
| P2 | 我的页 + 错误/空态处理 | 页面 | 1h |
| P3 | 真机调试 + 隐私协议 + 提审 | 上线 | 视备案 |

> ⚠️ 备案提醒：小程序需独立完成 ICP 备案（个人主体，7-20 个工作日），**建议与开发并行启动**。个人「工具」类目，简介强调「个人车辆数据统计，仅本人使用」。

## 9. 目录结构（规划）

```
teslamate-miniapp/
├── server/                     # FastAPI 后端
│   ├── app/
│   │   ├── main.py             # 入口 + 路由挂载
│   │   ├── config.py           # 环境变量配置
│   │   ├── db.py               # psycopg 连接池（只读账号）
│   │   ├── auth.py             # Token 校验依赖
│   │   └── routers/
│   │       ├── summary.py
│   │       ├── drives.py
│   │       ├── charges.py
│   │       └── vehicle.py
│   ├── requirements.txt
│   └── Dockerfile
├── miniapp/                    # 微信小程序
│   ├── app.js / app.json / app.wxss
│   ├── project.config.json
│   ├── sitemap.json
│   ├── utils/
│   │   ├── request.js          # 统一请求封装（token/错误处理）
│   │   └── format.js           # 里程/金额/时间格式化
│   ├── pages/
│   │   ├── index/              # 总览
│   │   ├── drives/             # 行程
│   │   ├── charges/            # 充电
│   │   └── mine/               # 我的
│   └── components/
│       ├── stat-card/          # 统计卡片
│       ├── empty-state/        # 空态
│       └── ec-canvas/          # echarts 组件
└── deploy/
    ├── docker-compose.yml      # 新增 teslamate-api 服务
    └── nginx-api.conf          # api.example.com 反代配置
```

## 10. 待确认事项

1. 是否加**单次行程地图详情**（需要特斯拉坐标数据，数据量较大，二期评估）
2. 是否加**实时车辆状态**（需 Tesla API token 轮询，会唤醒车辆，默认不做）
3. Token 由用户自行生成（如 32 位随机串），还是由我生成后写入服务器环境变量？（建议后者）
4. 域名用 `api.example.com` 子域名是否有异议？（证书泛域名已覆盖，无需新证书）

## 11. 附录 A：小程序请求封装规格（utils/request.js）

```javascript
// 统一请求封装：自动带 Token、统一错误处理、超时
const BASE_URL = 'https://api.example.com/api/v1';
const TOKEN_KEY = 'tesla_api_token';

function request(path, options = {}) {
  return new Promise((resolve, reject) => {
    const token = wx.getStorageSync(TOKEN_KEY);
    wx.request({
      url: `${BASE_URL}${path}`,
      method: options.method || 'GET',
      data: options.data || {},
      header: {
        'Content-Type': 'application/json',
        'X-API-Token': token,
      },
      timeout: 8000,
      success: (res) => {
        if (res.statusCode === 200 && res.data.code === 0) {
          resolve(res.data.data);
        } else if (res.statusCode === 401) {
          wx.showToast({ title: 'Token 无效', icon: 'none' });
          reject(new Error('unauthorized'));
        } else {
          const msg = (res.data && res.data.message) || `请求失败(${res.statusCode})`;
          wx.showToast({ title: msg, icon: 'none' });
          reject(new Error(msg));
        }
      },
      fail: (err) => {
        wx.showToast({ title: '网络异常，请重试', icon: 'none' });
        reject(err);
      },
    });
  });
}

module.exports = { request, BASE_URL, TOKEN_KEY };
```

## 12. 附录 B：主题设计

沿用 Grafana 仪表盘的 Tesla 红黑视觉，贴合微信小程序移动端：

| 元素 | 值 | 用途 |
|---|---|---|
| 主色 | `#E82127`（Tesla 红） | 品牌强调、涨势/电量 |
| 背景 | `#FFFFFF` / `#F7F7F7` | 页面底色 |
| 文本 | `#1A1A1A` / `#8A8A8A` | 主/次文字 |
| 卡片 | 白底 + 1px `#EFEFEF` 边框 + 12rpx 圆角 | 统计卡片 |
| 图表 | echarts 主题色同上 | 趋势图 |

> 注意：用户视觉偏好为「低饱和配色 + 强文本对比度」，图表配色避免高饱和蓝/青，Tesla 红仅作点缀。

## 13. 附录 C：FastAPI 关键实现要点

```python
# db.py — 只读连接池
import psycopg_pool
pool = psycopg_pool.ConnectionPool(
    conninfo=f"host={DB_HOST} port=5432 dbname=teslamate user={DB_USER} password={DB_PASS}",
    min_size=1, max_size=4, open=False)
pool.open()

# auth.py — Token 依赖注入
from fastapi import Header, HTTPException
def verify_token(x_api_token: str = Header(...)):
    if x_api_token != os.environ["TESLA_API_TOKEN"]:
        raise HTTPException(status_code=401, detail="unauthorized")

# 缓存装饰器（60s）
import time
_cache = {}
def cached(ttl=60):
    def deco(fn):
        def wrap(*a, **kw):
            key = (fn.__name__, a, tuple(sorted(kw.items())))
            now = time.time()
            if key in _cache and now - _cache[key][0] < ttl:
                return _cache[key][1]
            val = fn(*a, **kw)
            _cache[key] = (now, val)
            return val
        return wrap
    return deco
```

## 14. 附录 D：PG 只读账号 SQL

```sql
-- 在 teslamate 库执行（用 postgres 超级用户）
CREATE ROLE tesla_readonly LOGIN PASSWORD '<强口令>';
GRANT CONNECT ON DATABASE teslamate TO tesla_readonly;
GRANT USAGE ON SCHEMA public TO tesla_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO tesla_readonly;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO tesla_readonly;
```

## 15. 附录 E：安全设计（纵深防御，2026-08-17 定稿）

### 五层防线

| 层 | 管控项 | 要点 |
|---|---|---|
| ① 传输层 | HTTPS/HSTS/TLS1.2+ | 只暴露 443，强制跳转；nginx 安全响应头 |
| ② 网关层 | limit_req 限流 | 登录接口 2r/s（防爆破），业务 10r/s；请求体 1m |
| ③ 应用层 | 参数化查询 | psycopg 全 `%s` 占位，禁字符串拼接；分页 int 强转+上限 |
| ③ 应用层 | 鉴权中间件 | X-API-Token + openid 白名单校验（auth_bindings），未绑定 401 |
| ③ 应用层 | Pydantic 校验 | 类型/长度/范围强校验，非法输入 422 |
| ③ 应用层 | 统一异常 | 不泄露堆栈/内部细节，仅日志 |
| ④ 数据层 | 账号分离 | tesla_app 读写 vs teslamate 只读（GRANT SELECT） |
| ④ 数据层 | 端口隔离 | PG 仅容器内网，不暴露公网 |
| ⑤ 运维层 | 密钥管理 | 全环境变量注入，不进镜像/git；日志脱敏；审计 |

### 关键实现（已落地 P0）

- `app/auth.py`：verify_token / require_bound / require_owner（车主专属接口）
- `app/routers/auth_router.py`：登录限流（10次/分/IP）、口令 hmac.compare_digest 常数时间比较、首绑自动 owner
- `app/routers/data_router.py`：只读池 + 参数化查询 + limit≤50 + 60s 缓存
- nginx：auth 2r/s + api 10r/s 双层限流

### 未绑定隔离

前端 4 页未绑定只显示引导（体验层）；**后端中间件强制**：任何业务 API 无有效 openid 绑定记录一律 401（真实拦截层）。
