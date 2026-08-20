// miniapp/config.example.js - 配置模板（提交到仓库）
// 使用方式：复制本文件为 config.js，填入你自己的配置后运行。
// config.js 已被 .gitignore 排除，不会提交泄露。
module.exports = {
  // 后端 API 域名（必须 HTTPS + ICP 备案，并配置为小程序 request 合法域名）
  baseUrl: 'https://api.your-domain.com/api/v1',
  // true = 使用本地 mock 数据（无需后端即可预览界面）；false = 请求真实后端
  useMock: true
};
