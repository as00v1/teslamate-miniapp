// app.js - 全局逻辑
const auth = require('./utils/auth');
const config = require('./config');

App({
  globalData: {
    // 接口域名与 mock 开关统一从 config.js 读取（config.js 不入库，见 config.example.js）
    baseUrl: config.baseUrl,
    useMock: config.useMock,
    vehicle: {
      name: 'Model Y',
      nickname: '我的爱车',
      capacity: 60,       // kWh 电池容量
      efficiency: 0.156,  // kWh/km 能耗系数
      odo: 48213          // km 总里程（示例值）
    }
  },

  onLaunch() {
    // 启动时获取 openid：mock 环境本地模拟；真实环境 wx.login → 后端 code 换 openid
    auth.ensureOpenid().then(() => {
      console.log('[auth] openid 就绪');
    }).catch((e) => {
      console.warn('[auth] openid 获取失败', e);
    });
  }
});
