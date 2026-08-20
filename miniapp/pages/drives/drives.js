// pages/drives/drives.js - 行程页：旅程/充电明细 tab
const { request } = require('../../utils/request');
const fmt = require('../../utils/format');
const auth = require('../../utils/auth');

const PAGE_SIZE = 10;

Page({
  data: {
    bound: true,
    activeTab: 'drives',
    list: [],
    chargeList: [],
    stats: {
      totalDrives: 0,
      totalDistanceText: '-',
      totalEnergyText: '-',
      avgEfficiencyText: '-'
    },
    offset: 0,
    chargeOffset: 0,
    hasMore: true,
    loading: true,
    loadingMore: false
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
    if (bound && this.data.list.length === 0) {
      this.refresh();
    }
    // 清缓存后从后端恢复绑定状态（openid 不变，后端仍有绑定记录）
    auth.syncBindState().then((b) => {
      if (b !== this.data.bound) {
        this.setData({ bound: b });
        if (b && this.data.list.length === 0) this.refresh();
      }
    });
  },

  onPullDownRefresh() {
    if (!auth.isBound()) {
      wx.stopPullDownRefresh();
      return;
    }
    this.refresh().then(() => wx.stopPullDownRefresh());
  },

  onReachBottom() {
    if (!this.data.bound || !this.data.hasMore || this.data.loadingMore) return;
    this.loadMore();
  },

  switchTab(e) {
    const tab = e.currentTarget.dataset.tab;
    if (tab === this.data.activeTab) return;
    this.setData({ activeTab: tab });
    // 懒加载充电列表
    if (tab === 'charges' && this.data.chargeList.length === 0) {
      this.loadCharges();
    }
  },

  decorateDrive(drive) {
    // 出发地-目的地：后端 JOIN addresses 返回（name 优先，缺侧允许，全缺兜底行程序号）
    const clip = (s) => (s && s.length > 26 ? s.slice(0, 26) + '…' : s);
    const addrParts = [drive.start_address, drive.end_address].filter(Boolean);
    const routeText = addrParts.length
      ? addrParts.map(clip).join(' → ')
      : ('行程 #' + drive.id);
    return {
      id: drive.id,
      dateText: fmt.fmtDateTime(drive.start_date),
      distanceText: fmt.km(drive.distance),
      durationText: fmt.duration(drive.duration_min),
      speedText: drive.speed_max + ' km/h',
      energyText: fmt.kwh(drive.energy_used),
      costText: fmt.money2(drive.cost),   // 行程花费（里程 × 每公里成本估算）
      routeText: routeText
    };
  },

  decorateCharge(c) {
    return {
      id: c.id,
      dateText: fmt.fmtDateTime(c.start_date),
      tagText: c.fast_charger ? '超充' : '家充',
      tagClass: c.fast_charger ? 'tag-fast' : 'tag-home',
      costText: fmt.money2(c.cost),
      energyText: c.charge_energy_added + ' kWh',
      levelText: c.start_battery_level + '% → ' + c.end_battery_level + '%',
      footText: c.geofence_name + ' · 用时 ' + fmt.duration(c.duration_min)
    };
  },

  refresh() {
    this.setData({ loading: true, offset: 0, list: [], chargeList: [] });
    return Promise.all([
      request('/summary?range=all'),
      request(`/drives?offset=0&limit=${PAGE_SIZE}&range=all`)
    ]).then(([summary, res]) => {
      const list = (res.list || []).map(d => this.decorateDrive(d));
      const avgEff = summary.total_distance > 0
        ? (summary.total_energy / summary.total_distance * 100).toFixed(1)
        : '-';
      this.setData({
        list,
        offset: list.length,
        hasMore: list.length >= PAGE_SIZE,
        loading: false,
        stats: {
          totalDrives: summary.total_drives,
          totalDistanceText: fmt.km(summary.total_distance),
          totalEnergyText: fmt.kwh(summary.total_energy),
          avgEfficiencyText: avgEff + ' kWh/100km'
        }
      });
    }).catch(() => {
      this.setData({ loading: false });
    });
  },

  loadCharges() {
    this.setData({ loadingMore: true });
    request(`/charges?offset=${this.data.chargeOffset}&limit=${PAGE_SIZE}&range=all`).then((res) => {
      const more = (res.list || []).map(c => this.decorateCharge(c));
      this.setData({
        chargeList: this.data.chargeList.concat(more),
        chargeOffset: this.data.chargeList.length + more.length,
        hasMore: more.length >= PAGE_SIZE,
        loadingMore: false
      });
    }).catch(() => {
      this.setData({ loadingMore: false });
    });
  },

  loadMore() {
    this.setData({ loadingMore: true });
    if (this.data.activeTab === 'drives') {
      request(`/drives?offset=${this.data.offset}&limit=${PAGE_SIZE}&range=all`).then((res) => {
        const more = (res.list || []).map(d => this.decorateDrive(d));
        const list = this.data.list.concat(more);
        this.setData({
          list,
          offset: list.length,
          hasMore: more.length >= PAGE_SIZE,
          loadingMore: false
        });
      }).catch(() => {
        this.setData({ loadingMore: false });
      });
    } else {
      this.loadCharges();
    }
  }
});
