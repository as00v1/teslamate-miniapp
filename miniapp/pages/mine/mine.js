// pages/mine/mine.js - 我的页：设置
const { request } = require('../../utils/request');
const fmt = require('../../utils/format');
const auth = require('../../utils/auth');

// 未绑定骨架：数据 ?，布局完整展示
function skeletonVehicle() {
  return {
    name: '?',
    nickname: '未绑定',
    capacityText: '?',
    efficiencyText: '?',
    odoText: '?'
  };
}

Page({
  data: {
    bound: false,
    isOwner: false,
    openid: '',
    members: [],
    vehicle: skeletonVehicle(),
    lastUpdateText: '—',
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
    const bound = auth.isBound();
    this.setData({
      bound,
      isOwner: auth.isOwner(),
      openid: auth.getOpenid(),
      members: auth.getMembers()
    });
    if (!bound) {
      // 未绑定：布局完整展示，数据 ? 骨架
      this.setData({ vehicle: skeletonVehicle(), lastUpdateText: '—' });
    }
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
    if (!this.data.bound) {
      this.goBind();
      return;
    }
    wx.navigateTo({ url: '/pages/users/users' });
  },

  // 未绑定点击设置区/信息卡 → 跳绑定
  onSettingTap() {
    if (!this.data.bound) {
      this.goBind();
    }
  },

  onCardTap() {
    if (!this.data.bound) {
      this.goBind();
    }
  },

  onPushChange(e) {
    if (!this.data.bound) { this.goBind(); return; }
    this.setData({ pushEnabled: e.detail.value });
    if (e.detail.value) {
      wx.showToast({ title: '行程推送·二期开放', icon: 'none' });
    }
  },

  onStatusChange(e) {
    if (!this.data.bound) { this.goBind(); return; }
    this.setData({ statusEnabled: e.detail.value });
    if (e.detail.value) {
      wx.showToast({ title: '实时状态·二期开放', icon: 'none' });
    }
  },

  onLockWarnChange(e) {
    if (!this.data.bound) { this.goBind(); return; }
    this.setData({ lockWarnEnabled: e.detail.value });
  }
});
