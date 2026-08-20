// pages/data/data.js - 数据页：4 tab 统计图表（无明细）
const { request } = require('../../utils/request');
const fmt = require('../../utils/format');
const auth = require('../../utils/auth');

// 时间范围选项
const RANGES = [
  { key: 'month', label: '本月' },
  { key: '30d', label: '近30天' },
  { key: '90d', label: '近90天' },
  { key: 'year', label: '本年' },
  { key: 'all', label: '全部' }
];

Page({
  data: {
    bound: true,
    activeTab: 'overview',
    range: 'month',
    rangeLabel: '本月',
    // ① 总览
    core: [],
    trendBars: [],
    chargeDonut: { homePct: 0, fastPct: 0 },
    // ② 行驶
    driveStats: [],
    weeklyBars: [],
    hourlyBars: [],
    // ③ 充电
    chargeStats: [],
    locationBars: [],
    powerBars: [],
    rangeBars: [],
    // ④ 花费
    costStats: [],
    monthlyBars: [],
    loading: true
  },

  onLoad() {
    this.checkBound();
  },

  onShow() {
    this.checkBound();
  },

  checkBound() {
    const bound = auth.isBound();
    if (bound) {
      this.setData({ bound });
      if (!this.data.core.length || this.data.core[0].value === '?') {
        this.refresh();
      }
    } else {
      // 未绑定：展示模块骨架（指标 ?，图表矮柱占位），tabs/范围可切换，交互跳绑定
      this.setData({
        bound: false,
        core: this.skeletonMetrics(['累计里程', '平均能耗', '累计充电量', '充电总费用', '每公里成本', '相比油车节省']),
        driveStats: this.skeletonMetrics(['行驶次数', '平均单程', '最长单程', '平均时长', '最高时速', '平均外温']),
        chargeStats: this.skeletonMetrics(['充电次数', '累计充电量', '平均单次充入', '平均充电功率', '超充占比', '预估满电续航']),
        costStats: this.skeletonMetrics(['充电总费用', '月均花费', '每公里成本', '单位电价', '等效油费', '相比油车节省']),
        trendBars: this.skeletonBars(15),
        weeklyBars: this.skeletonBars(7),
        hourlyBars: this.skeletonBars(12),
        locationBars: this.skeletonBars(5),
        powerBars: this.skeletonBars(5),
        rangeBars: this.skeletonBars(12),
        monthlyBars: this.skeletonBars(12),
        chargeDonut: { homePct: 0, fastPct: 0 },
        loading: false
      });
    }
    // 清缓存后从后端恢复绑定状态（openid 不变，后端仍有绑定记录）
    auth.syncBindState().then((b) => {
      if (b !== this.data.bound) {
        this.setData({ bound: b });
        if (b && (!this.data.core.length || this.data.core[0].value === '?')) this.refresh();
      }
    });
  },

  // 未绑定骨架：指标值 ? / 图表矮柱占位
  skeletonMetrics(labels) {
    return labels.map(label => ({ label, value: '?' }));
  },

  skeletonBars(n) {
    return Array.from({ length: n }, (_, i) => ({ label: '—', valueText: '?', heightPct: 6 }));
  },

  goBind() {
    wx.navigateTo({ url: '/pages/bind/bind' });
  },

  onPullDownRefresh() {
    if (!auth.isBound()) {
      wx.stopPullDownRefresh();
      return;
    }
    this.refresh().then(() => wx.stopPullDownRefresh());
  },

  switchTab(e) {
    const tab = e.currentTarget.dataset.tab;
    if (tab === this.data.activeTab) return;
    this.setData({ activeTab: tab });
  },

  // 右上角切换时间范围
  switchRange() {
    if (!this.data.bound) {
      this.goBind();
      return;
    }
    const itemList = RANGES.map(r => r.label);
    wx.showActionSheet({
      itemList,
      success: (res) => {
        const r = RANGES[res.tapIndex];
        if (!r || r.key === this.data.range) return;
        this.setData({ range: r.key, rangeLabel: r.label });
        this.refresh();
      }
    });
  },

  // 生成柱状图（percent 模式）
  bars(items) {
    if (!items || !items.length) return [];
    const max = Math.max(...items.map(i => i.value), 1);
    return items.map(i => ({
      label: i.label,
      valueText: i.value,
      heightPct: Math.max(4, Math.round((i.value / max) * 100))
    }));
  },

  refresh() {
    this.setData({ loading: true });
    const range = this.data.range;
    const rl = this.data.rangeLabel;
    return Promise.all([
      request(`/summary?range=${range}`),
      request(`/drives/trend?range=${range}`),
      request('/charges/trend')
    ]).then(([s, dTrend, cTrend]) => {
      const isMonth = range === 'month';
      // ① 总览（标签跟随时间范围）
      const core = [
        { label: rl + '里程', value: fmt.km(s.total_distance) },
        { label: '平均能耗', value: s.avg_efficiency + ' kWh/100km', accent: true },
        { label: rl + '充电量', value: fmt.kwh(s.total_charging_energy) },
        { label: rl + '电费', value: fmt.money(s.total_cost), accent: true },
        { label: '每公里成本', value: fmt.money(s.cost_per_km) + '/km' },
        { label: '相比油车节省', value: fmt.money(s.gas_save), accent: true }
      ];
      // ② 行驶
      const driveStats = [
        { label: '行驶次数', value: s.total_drives + ' 次' },
        { label: '平均单程', value: fmt.km(s.avg_distance) },
        { label: '最长单程', value: fmt.km(s.max_distance) },
        { label: '平均时长', value: s.avg_duration + ' 分钟' },
        { label: '最高时速', value: s.max_speed + ' km/h' },
        { label: '平均外温', value: s.avg_outside_temp + '°C' }
      ];
      // ③ 充电（真实接口无 avg_charge_power / est_range_full，降级显示 --）
      const chargeStats = [
        { label: '充电次数', value: s.total_charges + ' 次' },
        { label: rl + '充电量', value: fmt.kwh(s.total_charging_energy) },
        { label: '平均单次充入', value: fmt.kwh(s.avg_charge_energy) },
        { label: '平均充电功率', value: s.avg_charge_power ? s.avg_charge_power + ' kW' : '--' },
        { label: '超充占比', value: s.fast_charge_ratio + '%' },
        { label: '预估满电续航', value: s.est_range_full ? s.est_range_full + ' km' : '--', accent: true }
      ];
      // ④ 花费（本月显示本月花费，其他范围显示折算月均）
      const costStats = [
        { label: rl + '电费', value: fmt.money(s.total_cost), accent: true },
        { label: isMonth ? '本月花费' : '月均花费', value: fmt.money(isMonth ? s.total_cost : s.monthly_cost) },
        { label: '每公里成本', value: fmt.money(s.cost_per_km) + '/km' },
        { label: '单位电价', value: s.unit_price + ' 元/kWh' },
        { label: '等效油费', value: fmt.money(s.total_distance * 0.08 * 7.5) },
        { label: '相比油车节省', value: fmt.money(s.gas_save), accent: true }
      ];

      // 趋势图：取 /drives/trend 的 daily（按所选范围聚合）；mock 取 summary.trend
      let trendBars = [];
      if (dTrend && dTrend.daily && dTrend.daily.length) {
        trendBars = this.bars(dTrend.daily.map(t => ({ label: t.label, value: t.value })));
      } else if (s.trend && s.trend.length) {
        trendBars = this.bars(s.trend.map(t => ({ label: t.date, value: t.distance })));
      }
      // 充电构成环形图：真实接口只有 cost，按费用占比计算
      let homePct = 50, fastPct = 50;
      if (s.charge_split) {
        const homeCost = (s.charge_split.home && s.charge_split.home.cost) || 0;
        const fastCost = (s.charge_split.fast && s.charge_split.fast.cost) || 0;
        const total = homeCost + fastCost;
        if (total > 0) {
          homePct = Math.round(homeCost / total * 100);
          fastPct = 100 - homePct;
        } else {
          homePct = 100; fastPct = 0;
        }
      } else if (s.charge_split && s.charge_split.home_pct !== undefined) {
        homePct = s.charge_split.home_pct;
        fastPct = s.charge_split.fast_pct;
      }
      this.setData({
        core,
        driveStats,
        chargeStats,
        costStats,
        trendBars,
        chargeDonut: { homePct, fastPct },
        weeklyBars: this.bars(dTrend.weekly || []),
        hourlyBars: this.bars(dTrend.hourly || []),
        locationBars: this.bars(cTrend.locations || []),
        powerBars: this.bars(cTrend.power || []),
        rangeBars: this.bars(cTrend.range || []),
        monthlyBars: this.bars(cTrend.monthly || []),
        loading: false
      });
    }).catch(() => {
      this.setData({ loading: false });
    });
  }
});
