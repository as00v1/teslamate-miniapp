# 小程序端（miniapp/）

> 微信小程序源码（原生 WXML/WXSS/JS，无第三方框架），对接 TeslaMate 数据的个人车辆工具。

## 📁 目录结构

```
miniapp/
├── app.js / app.json / app.wxss   # 全局（app.js 从 config.js 读配置）
├── config.js                      # 本地配置（复制自 config.example.js，已被 gitignore 排除）
├── config.example.js              # 配置模板（提交）
├── pages/
│   ├── index/   # 车辆：状态卡 + 控制按钮（模拟）
│   ├── drives/  # 行程：旅程/充电双 tab 明细
│   ├── data/    # 数据：4 tab 统计图表（总览/行驶/充电/花费）
│   ├── mine/    # 我的：设置
│   ├── users/   # 用户管理（成员列表/移除/解绑）
│   └── bind/    # 口令登录绑定
├── components/  # bind-guard / stat-card / empty-state
├── ec-canvas/   # echarts-for-weixin（本地化备用，图表当前用纯 WXSS 实现）
└── utils/
    ├── request.js   # 统一请求（mock 开关 + Token/openid 头 + 错误处理）
    ├── auth.js      # openid 获取、口令登录、绑定状态同步（服务端为准）
    ├── mock.js      # 假数据
    └── format.js    # 格式化（千分位/固定小数，兼容 iOS 日期解析）
```

## 🚀 运行

1. 复制 `config.example.js` 为 `config.js`，填入你的后端域名
2. 微信开发者工具「导入项目」→ 目录选 `miniapp/`
3. AppID 用你自己的小程序 AppID（或 `touristappid` 游客测试号直接编译预览）
4. `config.js` 中 `useMock: true` 可离线预览（mock 数据）；接入真实后端后改 `false`

## ⚠️ 已踩过的坑（给后来的开发者）

1. **WXML 禁止直接调 JS 函数**（`{{fmt.km(...)}}` 非法）——所有格式化必须在 JS 层预处理成字符串字段
2. **WXSS 的 calc 百分比宽度必须配 `box-sizing: border-box`**，否则 padding 撑破布局
3. **导入项目勿选「小游戏」类型**——工具缓存会按 game 编译报错；小游戏测试号不能当小程序 AppID
4. **iOS 日期解析**：`new Date("2026-08-18 18:10")` 在 iOS 失效，需手动按本地时间构造
5. **iOS Intl 兼容**：`toLocaleString(maximumFractionDigits)` 在部分 iOS 不截断小数，数字格式化用手动 `Math.round` + 正则千分位
6. **登录态必须服务端为准**：绑定关系存数据库（openid 关联），本地缓存只做加速——清缓存后应通过 `/auth/me` 恢复，而不是要求重新绑定
7. **wx.login 的 code 是一次性的**，不能拿 code 当身份标识；openid 才是微信账号稳定标识

## 📋 接口速览（后端见 `../server/`）

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | /api/v1/auth/login | wx.login code 换 openid + 下发 Token |
| POST | /api/v1/auth/bind | 口令登录（首个绑定者自动 owner） |
| GET | /api/v1/auth/me | 查询当前 openid 绑定状态（清缓存恢复用） |
| GET | /api/v1/auth/members | 成员列表 |
| DELETE | /api/v1/auth/members/{openid} | 车主移除成员 |
| GET | /api/v1/summary | 总览统计（支持 ?range=month\|30d\|90d\|year\|all） |
| GET | /api/v1/drives | 行程分页（含出发地/目的地/花费） |
| GET | /api/v1/drives/trend | 里程趋势（按 range 聚合粒度） |
| GET | /api/v1/charges | 充电分页 |
| GET | /api/v1/charges/trend | 充电趋势 |
| GET | /api/v1/vehicle | 车辆基础信息 |

统一响应：`{"code": 0, "data": {...}, "message": "ok"}`；业务接口需 `X-API-Token` + `X-Openid` 双请求头。
