// pages/mine/mine.js - 我的页：设置
const { request } = require('../../utils/request');
const fmt = require('../../utils/format');
const auth = require('../../utils/auth');

Page({
  data: {
    bound: false,
    isOwner: false,
    openid: '',
    members: [],
    vehicle: {
      name: 'Model Y',
      nickname: '我的爱车',
      capacityText: '60 kWh',
      efficiencyText: '0.156 kWh/km',
      odoText: '48,213 km'
    },
    lastUpdateText: '加载中...',
    pushEnabled: false,
    statusEnabled: false,
    lockWarnEnabled: true
  },

  onLoad() {
    this.checkBound();
  },

  onShow() {
    this.checkBound();
    if (this.data.bound) {
      this.loadLastUpdate();
    }
  },

  checkBound() {
    this.setData({
      bound: auth.isBound(),
      isOwner: auth.isOwner(),
      openid: auth.getOpenid(),
      members: auth.getMembers()
    });
    // 清缓存后从后端恢复绑定状态（openid 不变，后端仍有绑定记录）
    auth.syncBindState().then((b) => {
      if (b !== this.data.bound) {
        this.setData({
          bound: b,
          isOwner: auth.isOwner(),
          openid: auth.getOpenid()
        });
        if (b) this.loadLastUpdate();
      }
    });
  },

  loadLastUpdate() {
    request('/summary').then((data) => {
      // 真实接口无 last_update 字段（TeslaMate 快照时间需另查），取不到显示 —
      this.setData({
        lastUpdateText: data.last_update ? fmt.fmtDateTime(data.last_update) : '数据实时'
      });
    }).catch(() => {
      this.setData({ lastUpdateText: '—' });
    });
    // 真实车辆信息（/vehicle 已上线）
    request('/vehicle').then((v) => {
      if (v && v.name) {
        this.setData({
          vehicle: {
            name: v.model || v.name || 'Tesla',
            nickname: v.name || '我的爱车',
            capacityText: v.capacity ? v.capacity + ' kWh' : '—',
            efficiencyText: v.efficiency ? v.efficiency + ' kWh/km' : '—',
            odoText: '见行程统计'
          }
        });
      }
    }).catch(() => {});
  },

  goBind() {
    wx.navigateTo({ url: '/pages/bind/bind' });
  },

  goUsers() {
    wx.navigateTo({ url: '/pages/users/users' });
  },

  onPushChange(e) {
    this.setData({ pushEnabled: e.detail.value });
    if (e.detail.value) {
      wx.showToast({ title: '行程推送·二期开放', icon: 'none' });
    }
  },

  onStatusChange(e) {
    this.setData({ statusEnabled: e.detail.value });
    if (e.detail.value) {
      wx.showToast({ title: '实时状态·二期开放', icon: 'none' });
    }
  },

  onLockWarnChange(e) {
    this.setData({ lockWarnEnabled: e.detail.value });
  }
});
