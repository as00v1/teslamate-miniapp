// utils/request.js - 统一请求封装
// demo 阶段：useMock=true 时直接返回 mock 数据；接口就绪后切 false 走真实 HTTPS

const mock = require('./mock');
const auth = require('./auth');
const config = require('../config');

// API 域名从 config.js 读取（config.js 不入库，真实域名不暴露）
const BASE_URL = config.baseUrl;
const TOKEN_KEY = 'tesla_api_token';

// mock 数据路由（接口就绪后删除）
function mockFetch(url, options) {
  const method = (options && options.method) || 'GET';
  return new Promise((resolve) => {
    setTimeout(() => {
      if (url.includes('/vehicle/status')) resolve(mock.genVehicleStatus());
      else if (url.includes('/command')) resolve(mock.runCommand((options && options.data && options.data.command) || 'unknown'));
      else if (url.includes('/summary')) resolve(mock.genSummary());
      else if (url.includes('/drives/trend')) resolve({ weekly: mock.genWeeklyDist(), hourly: mock.genHourlyDist() });
      else if (url.includes('/charges/trend')) resolve({ monthly: mock.genMonthlyCost(), locations: mock.genChargeLocations(), power: mock.genPowerDist(), range: mock.genRangeTrend() });
      else if (url.includes('/drives')) resolve({ list: mock.genDrives(30), total: 2132 });
      else if (url.includes('/charges')) resolve({ list: mock.genCharges(25), total: 277 });
      else if (url.includes('/vehicle')) {
        resolve({
          name: 'Model Y', nickname: '我的爱车', capacity: 60,
          efficiency: 0.156, odo: 48213
        });
      } else resolve({});
    }, 400); // 模拟网络延迟，让骨架屏可见
  });
}

function request(path, options = {}) {
  const app = getApp();
  const useMock = app && app.globalData.useMock;

  if (useMock) return mockFetch(path, options);

  // 真实模式：先确保 openid/token 已就绪（onLaunch 登录异步完成前请求会带空 token）
  return auth.ensureAuthReady().then(() => {
    return new Promise((resolve, reject) => {
      const token = wx.getStorageSync(TOKEN_KEY);
      const openid = wx.getStorageSync('tesla_openid') || '';
      wx.request({
        url: `${BASE_URL}${path}`,
        method: options.method || 'GET',
        data: options.data || {},
        header: {
          'Content-Type': 'application/json',
          'X-API-Token': token,
          'X-Openid': openid,
        },
        timeout: 8000,
        success: (res) => {
          // 兼容两种响应：统一格式 {code:0,data:...} 或裸数据（无 code 字段视为成功）
          const body = res.data;
          const isOk = body && (
            (typeof body.code === 'number' && body.code === 0) ||
            (body.code === undefined && body.data !== undefined) ||
            (body.code === undefined && body.data === undefined)
          );
          if (res.statusCode === 200 && isOk) {
            resolve(body.code === 0 ? body.data : body);
          } else if (res.statusCode === 401) {
            // 后端统一格式 message 或 FastAPI detail
            const msg = (res.data && (res.data.message || res.data.detail)) || '未授权';
            wx.showToast({ title: msg.length > 14 ? msg.slice(0, 14) + '…' : msg, icon: 'none' });
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
  });
}

module.exports = { request, BASE_URL, TOKEN_KEY };
