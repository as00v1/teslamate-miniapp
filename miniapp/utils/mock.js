// utils/mock.js - 本地假数据（demo 阶段，接口就绪后删除本文件依赖）
// 数据形态完全对齐 TeslaMate PG 表字段

// 生成近 30 天每日里程趋势
function genDailyTrend(days = 30) {
  const trend = [];
  const now = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const isWeekend = d.getDay() === 0 || d.getDay() === 6;
    // 周末多开，工作日少开，偶尔不开
    let distance = 0;
    if (Math.random() > 0.18) {
      distance = isWeekend ? 30 + Math.random() * 90 : 8 + Math.random() * 40;
    }
    trend.push({
      date: `${d.getMonth() + 1}/${d.getDate()}`,
      distance: Math.round(distance * 10) / 10,
      drives: distance > 0 ? 1 + Math.floor(Math.random() * 3) : 0
    });
  }
  return trend;
}

// 生成行程列表（倒序，最近在前）
function genDrives(count = 30) {
  const drives = [];
  const now = new Date();
  const geofences = ['', '家', '公司', '商场', '高速'];
  for (let i = 0; i < count; i++) {
    const d = new Date(now);
    d.setHours(d.getHours() - i * 7 - Math.floor(Math.random() * 5));
    const distance = Math.round((5 + Math.random() * 45) * 10) / 10;
    const durationMin = Math.round(distance * (1.2 + Math.random() * 1.8));
    drives.push({
      id: 2000 - i,
      start_date: d.toISOString(),
      distance: distance,
      duration_min: durationMin,
      speed_max: Math.round(70 + Math.random() * 70),
      outside_temp_avg: Math.round((20 + Math.random() * 15 - 5) * 10) / 10,
      energy_used: Math.round(distance * 0.156 * 10) / 10,
      start_address: geofences[Math.floor(Math.random() * geofences.length)],
      end_address: geofences[Math.floor(Math.random() * geofences.length)]
    });
  }
  return drives;
}

// 生成充电记录（倒序）
function genCharges(count = 25) {
  const charges = [];
  const now = new Date();
  for (let i = 0; i < count; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - i * 1.4);
    const fast = Math.random() > 0.55;
    const energy = Math.round((15 + Math.random() * 35) * 10) / 10;
    const startLevel = Math.round(15 + Math.random() * 40);
    const endLevel = Math.min(100, startLevel + Math.round(energy / 0.6));
    charges.push({
      id: 3000 - i,
      start_date: d.toISOString(),
      charge_energy_added: energy,
      charge_energy_used: Math.round(energy * 1.08 * 10) / 10,
      cost: Math.round(energy * (fast ? 1.6 : 0.6) * 10) / 10,
      start_battery_level: startLevel,
      end_battery_level: endLevel,
      fast_charger: fast,
      geofence_name: fast ? '特斯拉超充' : (Math.random() > 0.5 ? '家' : '公司'),
      duration_min: Math.round(energy / 0.75 * 60)
    });
  }
  return charges;
}

// 总览统计（对齐 TeslaMate 首页 4 大分区指标）
function genSummary() {
  const trend = genDailyTrend(30);
  const drives = genDrives(30);
  const charges = genCharges(25);

  const totalDistance = Math.round(trend.reduce((s, d) => s + d.distance, 0) * 10) / 10; // 近30天
  const totalDrives = drives.length + 2102; // 模拟历史总量 2132
  const totalCharges = charges.length + 252; // 277
  const totalChargeEnergy = Math.round((charges.reduce((s, c) => s + c.charge_energy_added, 0) + 6800) * 10) / 10;
  const homeCharges = charges.filter(c => !c.fast_charger);
  const fastCharges = charges.filter(c => c.fast_charger);
  const homeCost = homeCharges.reduce((s, c) => s + c.cost, 0) + 620;
  const fastCost = fastCharges.reduce((s, c) => s + c.cost, 0) + 980;
  const totalCost = Math.round((homeCost + fastCost) * 10) / 10;

  // 平均能耗 kWh/100km（能耗/里程*100）
  const avgEfficiency = totalDistance > 0
    ? Math.round((totalDistance * 0.156 / totalDistance * 100) * 10) / 10
    : 0;
  // 每公里成本 元/km
  const costPerKm = totalDistance > 0 ? Math.round((totalCost / totalDistance) * 1000) / 1000 : 0;
  // 相比油车节省（按 8L/100km × 7.5元/L 估算）
  const gasSave = Math.round(totalDistance * 0.08 * 7.5 - totalCost);

  return {
    // ① 总览核心
    total_distance: totalDistance,           // km
    total_energy: Math.round(totalDistance * 0.156 * 10) / 10, // kWh
    total_cost: totalCost,                   // 元
    avg_efficiency: avgEfficiency,           // kWh/100km
    cost_per_km: costPerKm,                  // 元/km
    gas_save: gasSave,                       // 元
    // ② 行驶统计
    total_drives: totalDrives,
    avg_distance: Math.round((totalDistance / totalDrives) * 10) / 10,
    max_distance: Math.round(82.5 + Math.random() * 40),
    avg_duration: 46,                        // min
    max_speed: Math.round(130 + Math.random() * 40),
    avg_outside_temp: Math.round(21 + Math.random() * 6),
    // ③ 充电统计
    total_charges: totalCharges,
    total_charging_energy: totalChargeEnergy,
    avg_charge_energy: Math.round(totalChargeEnergy / totalCharges * 10) / 10,
    avg_charge_power: Math.round((homeCost / (homeCharges.length + 40) * 10)) / 10 || 7,
    fast_charge_ratio: Math.round((fastCharges.length / (charges.length || 1)) * 100),
    est_range_full: 505,                     // km 预估满电续航
    // ④ 花费成本
    monthly_cost: Math.round(totalCost / 12 * 10) / 10,
    unit_price: Math.round((totalCost / totalChargeEnergy) * 100) / 100, // 元/kWh
    last_update: new Date().toISOString(),
    trend: trend,
    charge_split: {
      home: { count: homeCharges.length, cost: homeCost },
      fast: { count: fastCharges.length, cost: fastCost },
      home_pct: Math.round((homeCharges.length / (charges.length || 1)) * 100),
      fast_pct: Math.round((fastCharges.length / (charges.length || 1)) * 100)
    }
  };
}

// 生成车辆实时状态（mock）
function genVehicleStatus() {
  const chargeLevel = 60 + Math.floor(Math.random() * 35); // 60-94%
  return {
    state: 'online',                    // online / asleep / offline
    stateText: '在线',
    charge_level: chargeLevel,          // 电量 %
    range_km: Math.round(chargeLevel * 4.5), // 预估续航
    inside_temp: Math.round((24 + Math.random() * 4) * 10) / 10,
    outside_temp: Math.round((28 + Math.random() * 6) * 10) / 10,
    locked: Math.random() > 0.3,
    sentry_mode: Math.random() > 0.5,
    charging: Math.random() > 0.7,
    charger_power: 11.5,                // kW
    location: '家',
    updated_at: new Date().toISOString()
  };
}

// 生成近 12 个月每月花费（元）
function genMonthlyCost() {
  const months = [];
  const now = new Date();
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({
      label: (d.getMonth() + 1) + '月',
      value: Math.round(60 + Math.random() * 120)
    });
  }
  return months;
}

// 生成每周各天行驶里程（周一到周日）
function genWeeklyDist() {
  const days = ['一', '二', '三', '四', '五', '六', '日'];
  return days.map(d => ({
    label: d,
    value: Math.round((d === '六' || d === '日' ? 40 : 18) + Math.random() * 25)
  }));
}

// 生成出发时段分布（0-23 时）
function genHourlyDist() {
  const buckets = [];
  for (let h = 0; h < 24; h++) {
    let base = 1;
    if (h >= 7 && h <= 9) base = 8;      // 早高峰
    else if (h >= 17 && h <= 19) base = 9; // 晚高峰
    else if (h >= 12 && h <= 13) base = 4; // 午间
    else if (h >= 22 || h <= 5) base = 0.5;
    buckets.push({
      label: h + '时',
      value: Math.round(base + Math.random() * 3)
    });
  }
  return buckets;
}

// 生成充电地点分布（家/超充/公司/其他）
function genChargeLocations() {
  return [
    { label: '家', value: Math.round(40 + Math.random() * 20) },
    { label: '超充', value: Math.round(20 + Math.random() * 15) },
    { label: '公司', value: Math.round(10 + Math.random() * 10) },
    { label: '其他', value: Math.round(5 + Math.random() * 8) }
  ];
}

// 生成超充功率分布（按电量区间）
function genPowerDist() {
  const ranges = ['0-20%', '20-40%', '40-60%', '60-80%', '80-100%'];
  const powers = [72, 95, 118, 130, 42]; // kW 中位值，高电量降速
  return ranges.map((label, i) => ({
    label,
    value: Math.round(powers[i] * (0.9 + Math.random() * 0.2))
  }));
}

// 生成电池健康趋势（预估满电续航，近 12 次）
function genRangeTrend() {
  const trend = [];
  const now = new Date();
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now);
    d.setMonth(d.getMonth() - 1);
    d.setDate(1 + Math.floor(Math.random() * 27));
    trend.push({
      label: (d.getMonth() + 1) + '月',
      value: Math.round(490 + Math.random() * 20 - i * 0.5)
    });
  }
  return trend;
}

// 执行控制指令（mock 成功）
function runCommand(command) {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve({ success: true, command });
    }, 600);
  });
}

module.exports = {
  genSummary,
  genDrives,
  genCharges,
  genVehicleStatus,
  genMonthlyCost,
  genWeeklyDist,
  genHourlyDist,
  genChargeLocations,
  genPowerDist,
  genRangeTrend,
  runCommand
};
