// pages/drive-detail/drive-detail.js - 单条行程详情
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
      this.setData({ loading: false, errorText: '缺少行程参数' });
      return;
    }
    this.loadDetail(id);
  },

  loadDetail(id) {
    this.setData({ loading: true, errorText: '' });
    request('/drives/' + id).then((d) => {
      this.setData({ d: this.decorate(d), loading: false });
    }).catch((err) => {
      this.setData({
        loading: false,
        errorText: (err && err.message) || '行程不存在或已删除'
      });
    });
  },

  decorate(d) {
    const num = (v, suffix) => (v === null || v === undefined || v === '') ? '—' : (v + (suffix || ''));
    const clip = (s) => (s && s.length > 26 ? s.slice(0, 26) + '…' : s);
    const addrParts = [d.start_address, d.end_address].filter(Boolean);
    const routeText = addrParts.length
      ? addrParts.map(clip).join(' → ')
      : ('行程 #' + d.id);
    return {
      id: d.id,
      // 后端返回 "YYYY-MM-DD HH:MM"，用 fmt 转成 "MM-DD HH:MM"
      dateText: fmt.fmtDateTime(d.start_date),
      timeRangeText: (d.start_date ? fmt.fmtDateTime(d.start_date).slice(6) : '') +
        ' → ' + (d.end_date ? fmt.fmtDateTime(d.end_date).slice(6) : ''),
      distanceText: fmt.km(d.distance),
      routeText,
      durationText: fmt.duration(d.duration_min),
      speedMaxText: num(d.speed_max, ' km/h'),
      speedAvgText: num(d.speed_avg, ' km/h'),
      energyText: fmt.kwh(d.energy_used),
      costText: fmt.money2(d.cost),
      powerMaxText: num(d.power_max, ' kW'),
      powerMinText: num(d.power_min, ' kW'),
      insideTempText: num(d.inside_temp_avg, '°C'),
      outsideTempText: num(d.outside_temp_avg, '°C'),
      rangeText: (d.start_ideal_range_km !== null && d.end_ideal_range_km !== null)
        ? (d.start_ideal_range_km + ' → ' + d.end_ideal_range_km + ' km') : '—',
      odoText: (d.start_km !== null && d.end_km !== null)
        ? (fmtNum(d.start_km) + ' → ' + fmtNum(d.end_km) + ' km') : '—',
      ascentText: num(d.ascent, ' m'),
      descentText: num(d.descent, ' m')
    };
  }
});

// 千分位（整数值）
function fmtNum(v) {
  const n = Math.round(Number(v || 0));
  return n.toLocaleString('zh-CN');
}
