// pages/index/index.js - 首页：车辆状态 + 控制
const { request } = require('../../utils/request');
const fmt = require('../../utils/format');
const auth = require('../../utils/auth');

Page({
  data: {
    bound: true,
    vehicle: {
      name: 'Tesla',
      nickname: '我的爱车'
    },
    status: null,
    statusText: {
      chargeLevel: '-',
      rangeText: '-',
      insideTemp: '-',
      outsideTemp: '-',
      lockText: '—',
      chargingText: '—',
      locationText: '—',
      updatedText: ''
    },
    // 真实模式：实时状态/控制接口未上线（P1/P3），显示降级提示
    statusUnavailable: false,
    controlling: false
  },

  onLoad() {
    this.checkBound();
  },

  onShow() {
    this.checkBound();
  },

  checkBound() {
    const bound = auth.isBound();
    this.setData({ bound });
    if (bound) {
      this.loadStatus();
    }
    // 清缓存后从后端恢复绑定状态（openid 不变，后端仍有绑定记录）
    auth.syncBindState().then((b) => {
      if (b !== this.data.bound) {
        this.setData({ bound: b });
        if (b) this.loadStatus();
      }
    });
  },

  onPullDownRefresh() {
    if (!auth.isBound()) {
      wx.stopPullDownRefresh();
      return;
    }
    this.loadStatus().then(() => wx.stopPullDownRefresh());
  },

  loadStatus() {
    const app = getApp();
    // 真实模式：先取车辆基础信息（/vehicle 已上线），实时状态接口（/vehicle/status）未上线则降级
    return request('/vehicle').then((v) => {
      const patch = {
        vehicle: {
          name: v.model || v.name || 'Tesla',
          nickname: v.name || '我的爱车'
        }
      };
      if (app && app.globalData.useMock === false) {
        // 真实模式：实时状态待接入（P1：特斯拉 Owner/Fleet API）
        patch.status = null;
        patch.statusUnavailable = true;
        patch.statusText = {
          chargeLevel: '-',
          rangeText: '-',
          insideTemp: '-',
          outsideTemp: '-',
          lockText: '—',
          chargingText: '—',
          locationText: '—',
          updatedText: '实时状态待接入（需接特斯拉 API）'
        };
        this.setData(patch);
        return;
      }
      // mock 模式：继续拉取模拟状态
      return request('/vehicle/status').then((s) => {
        patch.status = s;
        patch.statusUnavailable = false;
        patch.statusText = {
          chargeLevel: s.charge_level + '%',
          rangeText: s.range_km + ' km',
          insideTemp: s.inside_temp + '°C',
          outsideTemp: s.outside_temp + '°C',
          lockText: s.locked ? '已上锁' : '未上锁',
          chargingText: s.charging ? '充电中 ' + s.charger_power + 'kW' : '未充电',
          locationText: s.location,
          updatedText: '更新于 ' + fmt.fmtDateTime(s.updated_at)
        };
        this.setData(patch);
      });
    }).catch(() => {
      this.setData({ statusUnavailable: true, status: null });
    });
  },

  // 控制指令（真实模式未上线，提示开发中）
  runCmd(e) {
    const app = getApp();
    const label = e.currentTarget.dataset.label;
    if (this.data.controlling) return;
    if (app && app.globalData.useMock === false) {
      wx.showToast({ title: '控制功能开发中（P3）', icon: 'none' });
      return;
    }
    const command = e.currentTarget.dataset.cmd;
    this.setData({ controlling: true });

    request('/command', {
      method: 'POST',
      data: { command }
    }).then((res) => {
      wx.showToast({ title: label + ' 已执行', icon: 'success' });
      // 锁车指令成功后刷新状态
      if (command === 'lock' || command === 'unlock') {
        this.loadStatus();
      }
    }).catch(() => {
      wx.showToast({ title: '指令失败', icon: 'none' });
    }).finally(() => {
      this.setData({ controlling: false });
    });
  }
});
