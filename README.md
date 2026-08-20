# 特斯拉个人小程序（teslamate-miniapp）

> 个人特斯拉车辆数据微信小程序：对接 TeslaMate 数据，微信内随时查看行程、充电、花费与车辆状态。
> 当前版本：**v0.2.1-demo**（前端 Demo，数据为本地 mock，后端接口开发中）

## ✨ 功能一览

| Tab | 页面 | 内容 |
|---|---|---|
| 车辆 | `pages/index` | 车辆状态卡、电量环（conic-gradient）、6 个控制按钮（模拟） |
| 行程 | `pages/drives` | 4 统计卡 + 最近行程列表 |
| 数据 | `pages/data` | 4 页签：总览 / 行驶 / 充电 / 花费（对齐 Grafana 仪表盘分区），近 30 天趋势柱、充电构成环形图 |
| 我的 | `pages/mine` | 设置开关（useMock 切换）、车辆信息 |

## 🏗️ 整体架构

```
微信小程序（原生，4 tab）
   │  HTTPS + X-API-Token 请求头
   ▼
api.example.com（nginx TLS 反代，示例域名）
   ▼
FastAPI 容器（ECS 服务器，与 nginx/TeslaMate 同机）
   │  psycopg 连接池 + 60s 缓存 + Token 校验
   ▼
PostgreSQL 只读账号（TeslaMate 数据库）
```

- **数据源**：直连 TeslaMate PostgreSQL 只读账号（弃 GraphQL，直接 SQL 取数）
- **鉴权**：`X-API-Token` 固定密钥（服务端从环境变量 `TESLA_API_TOKEN` 读取，不落盘）
- **接口**：8 个 GET（`/summary` `/drives` `/drives/trend` `/charges` `/charges/trend` `/charges/summary` `/vehicle` `/health`）+ 二期 `/vehicle/status` `/command`
- **缓存**：接口层 60s TTL 缓存，减轻 PG 压力
- **复用经验**：Grafana 面板验证过的口径——东八区双 `AT TIME ZONE` 转换、能耗/每公里成本计算式、低饱和配色

## 🚀 快速开始（前端 Demo）

1. 安装[微信开发者工具](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html)（稳定版即可）
2. 「导入项目」→ 目录选 `miniapp/`
3. AppID 用**自己的小程序 AppID**（个人主体，在微信公众平台注册后填入 `miniapp/project.config.json`；仓库默认 `touristappid` 游客测试号可直接编译）
4. 编译运行，4 个 tab 即可预览（mock 数据，无需真机与后端）

> ⚠️ 不要误选「小游戏」类型导入（工具缓存会按 game 编译报错）；小游戏测试号不能用于小程序。

## 📂 目录结构

```
teslamate-miniapp/
├── architecture-design.md   # 完整架构设计文档
├── miniapp/                 # 微信小程序源码（导入目录）
│   ├── app.js / app.json / app.wxss
│   ├── config.example.js    # 配置模板（复制为 config.js 填入你的域名，后者被 gitignore）
│   ├── pages/               # index / drives / data / mine / users / bind
│   ├── components/          # bind-guard / stat-card / empty-state
│   ├── ec-canvas/           # echarts 组件（本地化备用，图表当前用 WXSS 实现）
│   ├── utils/               # request.js / auth.js / format.js / mock.js
│   └── project.config.json  # AppID 配置（默认游客测试号，发布时改自己的）
├── server/                  # FastAPI 后端
│   ├── app/                 # config.py（环境变量）/ auth.py / routers/
│   ├── deploy/              # docker-compose.yml / deploy.sh / nginx-api.conf（占位模板）
│   └── .env.example         # 环境变量模板
└── .gitignore
```

## 🔌 mock 与真实接口切换

配置集中在 `miniapp/config.js`（复制自 `miniapp/config.example.js`，**config.js 已被 .gitignore 排除**）：

| 配置项 | 值 | 说明 |
|---|---|---|
| `baseUrl` | `https://api.your-domain.com/api/v1` | 你的后端域名（真实域名只在本地 config.js，不入库） |
| `useMock` | `true` | 走 `utils/mock.js` 假数据，模拟 400ms 延迟，可离线预览 |
| `useMock` | `false` | 走 `request.js` 真实 HTTPS（`/auth/login` 换 openid + Token 自动注入） |

## 🔒 安全说明（开源脱敏）

- **配置与代码分离**：域名/密钥/口令全部走本地配置文件（`miniapp/config.js`、`server/.env`），仓库只提交占位模板（`config.example.js`、`.env.example`）
- **代码零明文密钥**：DB 密码、API Token、AppSecret 均为环境变量读取（`os.environ[...]`），无硬编码
- **已入 gitignore**：`config.js`、`.env`、`*.pem`、`*.key`、凭证/备份文件、开发者工具私有配置
- **扫描基线**：提交前 `grep` 域名/AppID/口令/密钥/IP，命中即拦截（见下方「开源前检查清单」）

## ⚠️ 开源前检查清单

1. `miniapp/config.js` 确认未被跟踪（`git check-ignore miniapp/config.js` 应输出路径）
2. 全仓扫描：`git grep -E "your-domain|touristappid|wx[0-9a-f]{16}"` 应无命中（无真实域名/AppID）
3. `project.private.config.json`（含个人 AppID）确认被 ignore
4. 证书/密钥/备份/凭证文件确认被 ignore
5. **git 历史**：若早期 commit 曾含敏感信息，需重建仓库或 force push 覆盖（见「开源安全」一节）

## 📦 版本历史

| 版本 | 说明 |
|---|---|
| v0.2.1 | UI 打磨：tabBar PNG 图标、电量环、SVG 控制按钮、数据页 4 tab 重构 |
| v0.2.0 | 模块重构：车辆/行程/数据/我的 4 tab，新增数据分区与图表 |
| v0.1.0 | 首个 Demo：总览/行程/充电/我的 + echarts 趋势图 + mock 数据 |

## 🗺️ Roadmap

- [ ] P0：PG 只读账号 + FastAPI 容器 + nginx 反代（`api.example.com`）
- [ ] P1：小程序切真实接口（useMock=false），Token 设置页
- [ ] P2：车辆实时状态（`/vehicle/status` 轮询）
- [ ] P3：远程控制（Fleet/Owner API，需官方权限）

## 📝 参考

- [architecture-design.md](architecture-design.md) —— 架构设计全文
- [miniapp/README.md](miniapp/README.md) —— 前端 Demo 运行细节
- TeslaMate v2.2 + Grafana 定制仪表盘（TeslaMate 项目交付物）
