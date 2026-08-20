// utils/auth.js - 口令登录绑定管理
// 口令与微信号（openid）绑定：输入正确口令即完成绑定；demo 口令本地持久化，后端就绪后服务端校验
// 真实流程：wx.login() 取 code → POST /auth/login（后端换 openid）→ 输入口令 → POST /auth/bind

const BIND_KEY = 'tesla_bound';
const OPENID_KEY = 'tesla_openid';
const OWNER_KEY = 'tesla_owner_openid';
const MEMBERS_KEY = 'tesla_members';
const PASSPHRASE_KEY = 'tesla_passphrase';

// demo 默认口令（后端就绪后由服务端配置/校验，此值仅供 demo 首次使用）
const DEFAULT_PASSPHRASE = 'demo-2026';

// 模拟 wx.login 获取 openid（demo 环境，无真实后端时使用）
function mockGetOpenid() {
  return new Promise((resolve) => {
    setTimeout(() => {
      const stored = wx.getStorageSync(OPENID_KEY);
      if (stored) {
        resolve(stored);
      } else {
        const fake = 'demo_' + Math.random().toString(36).slice(2, 10);
        wx.setStorageSync(OPENID_KEY, fake);
        resolve(fake);
      }
    }, 300);
  });
}

// 真实环境：wx.login 换 openid（需要后端 /auth/login 支持，useMock=false 时启用）
// 说明：真实 code2session 下 openid 由微信按 AppID+用户决定，天然稳定，无需本地缓存防漂移。
// 每次都调 /auth/login 可同时刷新 openid 与业务 Token，避免 Token 丢失/过期导致 401。
function realGetOpenid() {
  return new Promise((resolve, reject) => {
    // 清理 demo/dev 模拟身份的本地残留
    const cached = wx.getStorageSync(OPENID_KEY);
    if (cached && (String(cached).startsWith('demo_') || String(cached).startsWith('dev_'))) {
      wx.removeStorageSync(OPENID_KEY);
      wx.removeStorageSync(BIND_KEY);
      wx.removeStorageSync('tesla_api_token');
    }
    wx.login({
      success: (res) => {
        if (!res.code) {
          reject(new Error('登录失败（wx.login 无 code）'));
          return;
        }
        wx.request({
          url: getApp().globalData.baseUrl + '/auth/login',
          method: 'POST',
          data: { code: res.code },
          success: (r) => {
            if (r.data && r.data.code === 0 && r.data.data && r.data.data.openid) {
              wx.setStorageSync(OPENID_KEY, r.data.data.openid);
              // 登录下发业务 Token（供后续请求 X-API-Token 头）
              if (r.data.data.token) {
                wx.setStorageSync('tesla_api_token', r.data.data.token);
              }
              resolve(r.data.data.openid);
            } else {
              reject(new Error('登录校验失败'));
            }
          },
          fail: () => reject(new Error('网络异常'))
        });
      },
      fail: () => reject(new Error('wx.login 失败'))
    });
  });
}

// 获取 openid：demo 走模拟，真实环境走 wx.login
function ensureOpenid() {
  const app = getApp();
  if (app && app.globalData.useMock === false) {
    return realGetOpenid();
  }
  return mockGetOpenid();
}

// 是否已绑定
function isBound() {
  return wx.getStorageSync(BIND_KEY) === true;
}

// 当前用户是否为车主（第一个绑定的人自动成为车主）
function isOwner() {
  const openid = getOpenid();
  if (!openid) return false;
  return wx.getStorageSync(OWNER_KEY) === openid;
}

// 获取当前 openid（同步，可能为空）
function getOpenid() {
  return wx.getStorageSync(OPENID_KEY) || '';
}

// 业务请求前确保 openid/token 已就绪（避免 onLaunch 异步登录未完成时请求空 token）
// token 存在 且 openid 非模拟身份（demo_/dev_）时直接放行（零开销）；
// 否则触发登录（模块级 Promise 去重并发请求），先清理模拟身份再换真实 openid。
let authReadyPromise = null;
function ensureAuthReady() {
  const token = wx.getStorageSync('tesla_api_token');
  const openid = wx.getStorageSync(OPENID_KEY) || '';
  const isFake = openid.startsWith('demo_') || openid.startsWith('dev_');
  if (token && !isFake) return Promise.resolve();
  if (!authReadyPromise) {
    authReadyPromise = ensureOpenid().finally(() => {
      authReadyPromise = null;
    });
  }
  return authReadyPromise;
}

// 已绑定成员列表
function getMembers() {
  const raw = wx.getStorageSync(MEMBERS_KEY);
  try {
    return raw && Array.isArray(raw) ? raw : [];
  } catch (e) {
    return [];
  }
}

// 口令登录：输入正确口令完成绑定（口令与微信号一一对应）
// demo 模式本地校验；真实模式（useMock=false）调后端 POST /auth/bind
function loginWithPassphrase(passphrase) {
  const app = getApp();
  if (app && app.globalData.useMock === false) {
    return realBind(passphrase);
  }
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      // 当前生效口令：demo 本地存储（首次为默认值，后端就绪后服务端校验）
      const current = wx.getStorageSync(PASSPHRASE_KEY) || DEFAULT_PASSPHRASE;
      if (String(passphrase).trim() !== current) {
        reject(new Error('口令错误，请重新输入'));
        return;
      }
      const openid = getOpenid();
      if (!openid) {
        reject(new Error('登录状态异常，请重试'));
        return;
      }
      wx.setStorageSync(BIND_KEY, true);
      // 第一个绑定的人自动成为车主
      const owner = wx.getStorageSync(OWNER_KEY);
      if (!owner) {
        wx.setStorageSync(OWNER_KEY, openid);
      }
      // 加入成员列表（去重）
      const members = getMembers();
      const exists = members.some(m => m.openid === openid);
      if (!exists) {
        members.push({
          openid,
          nickname: openid === wx.getStorageSync(OWNER_KEY) ? '车主' : '成员',
          bound_at: new Date().toISOString(),
          is_owner: openid === wx.getStorageSync(OWNER_KEY)
        });
        wx.setStorageSync(MEMBERS_KEY, members);
      }
      resolve({ success: true, isOwner: isOwner() });
    }, 500);
  });
}

// 真实绑定：POST /auth/bind（服务端校验口令，返回 role + members）
function realBind(passphrase) {
  return new Promise((resolve, reject) => {
    const openid = getOpenid();
    if (!openid) {
      reject(new Error('登录状态异常，请重试'));
      return;
    }
    wx.request({
      url: getApp().globalData.baseUrl + '/auth/bind',
      method: 'POST',
      header: { 'Content-Type': 'application/json', 'X-Openid': openid },
      data: { passphrase: String(passphrase).trim() },
      success: (r) => {
        if (r.data && r.data.code === 0) {
          const data = r.data.data;
          wx.setStorageSync(BIND_KEY, true);
          if (data.role === 'owner') {
            wx.setStorageSync(OWNER_KEY, openid);
          }
          // 同步成员列表（服务端为准）
          if (data.members && Array.isArray(data.members)) {
            wx.setStorageSync(MEMBERS_KEY, data.members.map(m => ({
              openid: m.openid,
              nickname: m.role === 'owner' ? '车主' : '成员',
              bound_at: m.bound_at,
              is_owner: m.role === 'owner'
            })));
          }
          resolve({ success: true, isOwner: isOwner() });
        } else if (r.statusCode === 401) {
          reject(new Error((r.data && r.data.message) || '口令错误，请重新输入'));
        } else {
          reject(new Error((r.data && r.data.message) || '绑定失败，请重试'));
        }
      },
      fail: () => reject(new Error('网络异常，请重试'))
    });
  });
}

// 车主：移除指定成员（不能移除车主自己）
// 真实模式（useMock=false）：调后端 DELETE /auth/members/{openid}
function removeMember(targetOpenid) {
  const app = getApp();
  if (app && app.globalData.useMock === false) {
    return new Promise((resolve, reject) => {
      const openid = getOpenid();
      if (!openid) {
        reject(new Error('登录状态异常'));
        return;
      }
      if (targetOpenid === openid) {
        reject(new Error('不能移除自己'));
        return;
      }
      wx.request({
        url: getApp().globalData.baseUrl + '/auth/members/' + encodeURIComponent(targetOpenid),
        method: 'DELETE',
        header: { 'Content-Type': 'application/json', 'X-Openid': openid, 'X-API-Token': wx.getStorageSync('tesla_api_token') },
        success: (r) => {
          if (r.data && r.data.code === 0) {
            // 同步本地成员列表
            const members = getMembers();
            wx.setStorageSync(MEMBERS_KEY, members.filter(m => m.openid !== targetOpenid));
            resolve({ success: true });
          } else if (r.statusCode === 403) {
            reject(new Error('仅车主可移除成员'));
          } else {
            reject(new Error((r.data && r.data.message) || '移除失败'));
          }
        },
        fail: () => reject(new Error('网络异常，请重试'))
      });
    });
  }
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      if (!isOwner()) {
        reject(new Error('仅车主可移除成员'));
        return;
      }
      if (targetOpenid === getOpenid()) {
        reject(new Error('不能移除自己'));
        return;
      }
      const members = getMembers();
      const remain = members.filter(m => m.openid !== targetOpenid);
      if (remain.length === members.length) {
        reject(new Error('成员不存在'));
        return;
      }
      wx.setStorageSync(MEMBERS_KEY, remain);
      resolve({ success: true });
    }, 400);
  });
}

// 获取成员列表：真实模式调后端 GET /auth/members（以服务端为准），mock 模式读本地
function fetchMembers() {
  const app = getApp();
  if (app && app.globalData.useMock === false) {
    return new Promise((resolve, reject) => {
      const openid = getOpenid();
      if (!openid) {
        reject(new Error('登录状态异常'));
        return;
      }
      wx.request({
        url: getApp().globalData.baseUrl + '/auth/members',
        method: 'GET',
        header: { 'X-Openid': openid, 'X-API-Token': wx.getStorageSync('tesla_api_token') },
        success: (r) => {
          if (r.data && r.data.code === 0 && r.data.data && r.data.data.members) {
            const members = r.data.data.members.map(m => ({
              openid: m.openid,
              nickname: m.role === 'owner' ? '车主' : '成员',
              bound_at: m.bound_at,
              is_owner: m.role === 'owner'
            }));
            wx.setStorageSync(MEMBERS_KEY, members);
            resolve(members);
          } else {
            reject(new Error((r.data && r.data.message) || '获取成员失败'));
          }
        },
        fail: () => reject(new Error('网络异常，请重试'))
      });
    });
  }
  return Promise.resolve(getMembers());
}

// 从后端同步绑定状态到本地：清缓存后 openid 由 wx.login 恢复（同一微信不变），
// 后端 auth_bindings 仍有绑定记录 → 本地 BIND_KEY/OWNER_KEY 恢复，无需重新输入口令。
// 用 wx.request 直连（不经过 request.js，避免与 ensureAuthReady 循环依赖）。
let syncPromise = null;
function syncBindState() {
  if (syncPromise) return syncPromise;
  syncPromise = new Promise((resolve) => {
    const app = getApp();
    const gd = app && app.globalData;
    if (!gd || gd.useMock !== false) {
      resolve(isBound());
      return;
    }
    ensureAuthReady()
      .then(() => {
        const openid = getOpenid();
        const token = wx.getStorageSync('tesla_api_token');
        if (!openid || !token) {
          resolve(isBound());
          return;
        }
        wx.request({
          url: gd.baseUrl + '/auth/me',
          method: 'GET',
          header: { 'X-API-Token': token, 'X-Openid': openid },
          timeout: 8000,
          success: (r) => {
            if (r.data && r.data.code === 0 && r.data.data) {
              const d = r.data.data;
              if (d.bound) {
                wx.setStorageSync(BIND_KEY, true);
                if (d.role === 'owner') {
                  wx.setStorageSync(OWNER_KEY, openid);
                }
                resolve(true);
              } else {
                wx.removeStorageSync(BIND_KEY);
                resolve(false);
              }
            } else {
              resolve(isBound());
            }
          },
          fail: () => resolve(isBound())
        });
      })
      .catch(() => resolve(isBound()));
  }).finally(() => { syncPromise = null; });
  return syncPromise;
}

// 解绑（测试用）
function unbind() {
  wx.removeStorageSync(BIND_KEY);
}

module.exports = {
  isBound,
  isOwner,
  getOpenid,
  loginWithPassphrase,
  unbind,
  removeMember,
  fetchMembers,
  getMembers,
  ensureOpenid,
  ensureAuthReady,
  syncBindState,
  mockGetOpenid,
  DEFAULT_PASSPHRASE
};
