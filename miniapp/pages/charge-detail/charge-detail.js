// pages/charge-detail/charge-detail.js - 单次充电详情
const { request } = require('../../utils/request');
const fmt = require('../../utils/format');

Page({
  data: {
    loading: true,
    errorText: '',
    d: null
  },

  onLoad(options) {
    const id = options && options.id;
    if (!id) {
      this.setData({ loading: false, errorText: '缺少充电记录参数' });
      return;
    }
    this.loadDetail(id);
  },

  loadDetail(id) {
    this.setData({ loading: true, errorText: '' });
    request('/charges/' + id).then((d) => {
      this.setData({ d: this.decorate(d), loading: false });
    }).catch((err) => {
      this.setData({
        loading: false,
        errorText: (err && err.message) || '充电记录不存在或已删除'
      });
    });
  },

  decorate(d) {
    const num = (v, suffix) => (v === null || v === undefined || v === '') ? '—' : (v + (suffix || ''));
    const isFast = !!d.fast_charger;
    return {
      id: d.id,
      dateText: fmt.fmtDateTime(d.start_date),
      timeRangeText: (d.start_date ? fmt.fmtDateTime(d.start_date).slice(6) : '') +
        ' → ' + (d.end_date ? fmt.fmtDateTime(d.end_date).slice(6) : ''),
      energyText: fmt.kwh(d.charge_energy_added),
      locationText: d.location || '未知地点',
      tagText: isFast ? '超充' : '家充',
      tagClass: isFast ? 'fast' : 'home',
      costText: fmt.money2(d.cost),
      durationText: fmt.duration(d.duration_min),
      powerAvgText: num(d.power_avg, ' kW'),
      usedText: fmt.kwh(d.charge_energy_used),
      levelStartText: num(d.start_battery_level, '%'),
      levelEndText: num(d.end_battery_level, '%'),
      levelText: (d.start_battery_level !== null && d.end_battery_level !== null)
        ? (d.start_battery_level + '% → ' + d.end_battery_level + '%') : '—',
      rangeText: (d.start_ideal_range_km !== null && d.end_ideal_range_km !== null)
        ? (d.start_ideal_range_km + ' → ' + d.end_ideal_range_km + ' km') : '—',
      tempText: num(d.outside_temp_avg, '°C')
    };
  }
});
