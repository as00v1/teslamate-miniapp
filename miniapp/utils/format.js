// utils/format.js - 格式化工具
// 与 Grafana 仪表盘约定一致：¥ 千分位、km、kWh

// 千分位 + 最多 maxDigits 位小数（整数不带尾零）
// 不用 toLocaleString —— 部分 iOS JavaScriptCore 对 Intl options 支持不全，
// maximumFractionDigits 不生效导致 double 浮点尾巴（2.162192000003415）直接显示。
function fmtNum(n, maxDigits) {
  const mult = Math.pow(10, maxDigits);
  const r = Math.round(n * mult) / mult;
  const s = Number.isInteger(r) ? String(r) : r.toFixed(maxDigits);
  const parts = s.split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return parts.join('.');
}

// 金额：1234.5 -> ¥1,234.5
function money(v) {
  if (v === null || v === undefined) return '¥0';
  const n = Number(v);
  if (!isFinite(n)) return '¥0';
  return '¥' + fmtNum(n, 1);
}

// 金额带两位小数（固定 2 位）
function money2(v) {
  const n = Number(v || 0);
  if (!isFinite(n)) return '¥0.00';
  const fixed = n.toFixed(2);
  const parts = fixed.split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return '¥' + parts.join('.');
}

// 里程：48213 -> 48,213 km；2.162192000003415 -> 2.2 km
function km(v) {
  const n = Number(v || 0);
  if (!isFinite(n)) return '0 km';
  return fmtNum(n, 1) + ' km';
}

// 能耗
function kwh(v) {
  const n = Number(v || 0);
  if (!isFinite(n)) return '0 kWh';
  return fmtNum(n, 1) + ' kWh';
}

// 百分比
function pct(v) {
  return Number(v || 0) + '%';
}

// 时长：90 -> 1小时30分
function duration(min) {
  const m = Number(min || 0);
  if (m < 60) return m + '分钟';
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest > 0 ? `${h}小时${rest}分` : `${h}小时`;
}

// 安全日期解析：兼容后端多种格式，规避 iOS new Date() 不支持 "yyyy-MM-dd HH:mm" 的问题
// 后端 drives/charges 的 start_date 是已转东八区的无时区字符串 "2026-08-18 18:10"（按本地时间解析）；
// bound_at 等带时区 ISO（2026-08-17T14:19:08.420314+00:00）走原生/拼接解析。
function parseDate(v) {
  if (!v) return null;
  if (v instanceof Date) return v;
  const s = String(v).trim();
  // "2026-08-18 18:10" / "2026-08-18 18:10:05" / "2026-08-18T18:10"（无时区）
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (m) {
    return new Date(
      Number(m[1]), Number(m[2]) - 1, Number(m[3]),
      Number(m[4]), Number(m[5]), Number(m[6] || 0)
    );
  }
  // 带时区 ISO：补全秒后交给原生（iOS 支持 yyyy-MM-ddTHH:mm:ss+HH:mm）
  const t = s.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/);
  if (t) {
    const iso = `${t[1]}T${t[2]}${t[3] || ':00'}${t[5]}`;
    const d = new Date(iso);
    return isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

// 时间 -> "08-17 14:30"
function fmtDateTime(iso) {
  const d = parseDate(iso);
  if (!d) return iso ? String(iso) : '';
  const pad = (n) => (n < 10 ? '0' + n : '' + n);
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// 时间 -> "08-17"
function fmtDate(iso) {
  const d = parseDate(iso);
  if (!d) return iso ? String(iso) : '';
  const pad = (n) => (n < 10 ? '0' + n : '' + n);
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// 时间 -> "2026年8月17日"
function fmtDateCN(iso) {
  const d = parseDate(iso);
  if (!d) return iso ? String(iso) : '';
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

module.exports = { money, money2, km, kwh, pct, duration, fmtDateTime, fmtDate, fmtDateCN };
