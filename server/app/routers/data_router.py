# -*- coding: utf-8 -*-
"""数据接口：summary / drives / charges / vehicle（只读 teslamate 库）"""
from fastapi import APIRouter, Depends, Query
from ..db import tm_pool
from ..auth import require_bound
from ..utils import ok, err, cached, jsonable

router = APIRouter(prefix="/api/v1", tags=["data"])

# 默认车辆 id（TeslaMate car_id=1）
CAR_ID = 1

# 油车对比参数（元/L、L/100km）
GAS_PRICE = 7.5
GAS_CONSUMPTION = 8.0
# 电价（元/kWh，用户设定 2026-08-19）+ 能耗系数（kWh/km）
ELECTRIC_PRICE = 0.44
EFFICIENCY = 0.156

# ── 时间范围过滤（白名单键，SQL 片段为服务端固定字符串，无注入风险）──
# start_date 存储为 UTC 的 timestamp；"本月/本年"按上海时区计算边界
RANGE_KEYS = ("month", "30d", "90d", "year", "all")

def _range_filter_drives(prefix=""):
    """drives 表范围过滤片段；prefix 用于带别名查询（如 'd.'）"""
    p = prefix
    return {
        "month": f"AND {p}start_date >= (date_trunc('month', now() AT TIME ZONE 'Asia/Shanghai') AT TIME ZONE 'Asia/Shanghai')",
        "30d":   f"AND {p}start_date >= now() - interval '30 days'",
        "90d":   f"AND {p}start_date >= now() - interval '90 days'",
        "year":  f"AND {p}start_date >= (date_trunc('year', now() AT TIME ZONE 'Asia/Shanghai') AT TIME ZONE 'Asia/Shanghai')",
        "all":   "",
    }

def _range_filter_charges(prefix=""):
    """charging_processes 表范围过滤片段"""
    p = prefix
    return {
        "month": f"AND {p}start_date >= (date_trunc('month', now() AT TIME ZONE 'Asia/Shanghai') AT TIME ZONE 'Asia/Shanghai')",
        "30d":   f"AND {p}start_date >= now() - interval '30 days'",
        "90d":   f"AND {p}start_date >= now() - interval '90 days'",
        "year":  f"AND {p}start_date >= (date_trunc('year', now() AT TIME ZONE 'Asia/Shanghai') AT TIME ZONE 'Asia/Shanghai')",
        "all":   "",
    }

# 趋势图聚合粒度（白名单键）
TREND_GRAN = {
    "month": ("day", "MM-DD"),
    "30d":   ("day", "MM-DD"),
    "90d":   ("week", "MM-DD"),
    "year":  ("month", "YYYY-MM"),
    "all":   ("month", "YYYY-MM"),
}


@router.get("/summary")
@cached(ttl=60)
def summary(
    rng: str = Query("month", alias="range", pattern="^(month|30d|90d|year|all)$"),
    user=Depends(require_bound),
):
    """总览核心指标（对齐 Grafana 首页计算口径）；range 按上海时区过滤"""
    df_d = _range_filter_drives("d.")
    df_dn = _range_filter_drives()
    cf = _range_filter_charges()
    with tm_pool.connection() as conn:
        cur = conn.cursor()
        # ① 累计里程/次数/平均能耗
        cur.execute(
            f"""
            SELECT COALESCE(sum(distance),0), count(*),
                   COALESCE(sum((start_ideal_range_km - end_ideal_range_km) * c.efficiency),0)
            FROM drives d JOIN cars c ON c.id = d.car_id
            WHERE d.car_id = %s AND d.end_date IS NOT NULL AND d.distance IS NOT NULL
            {df_d[rng]}
            """,
            (CAR_ID,),
        )
        total_distance, total_drives, total_energy_raw = cur.fetchone()
        total_energy = float(total_energy_raw or 0)
        avg_efficiency = (total_energy / total_distance * 100) if total_distance > 0 else 0
        # 平均单程/最长/时长/极速/外温
        cur.execute(
            f"""
            SELECT COALESCE(avg(distance),0), COALESCE(max(distance),0),
                   COALESCE(avg(duration_min),0), COALESCE(max(speed_max),0),
                   COALESCE(avg(outside_temp_avg),0)
            FROM drives WHERE car_id = %s AND end_date IS NOT NULL AND distance IS NOT NULL
            {df_dn[rng]}
            """,
            (CAR_ID,),
        )
        avg_distance, max_distance, avg_duration, max_speed, avg_temp = cur.fetchone()
        # ③ 充电统计
        cur.execute(
            f"""
            SELECT count(*), COALESCE(sum(charge_energy_added),0),
                   COALESCE(sum(cost),0),
                   COUNT(*) FILTER (WHERE geofence_id IN (
                     SELECT id FROM geofences WHERE name ILIKE '%%超充%%' OR name ILIKE '%%supercharger%%'
                   ))
            FROM charging_processes
            WHERE car_id = %s AND duration_min >= 1
            {cf[rng]}
            """,
            (CAR_ID,),
        )
        total_charges, total_charge_energy, total_cost, fast_count = cur.fetchone()
        total_charges = int(total_charges or 0)
        total_charge_energy = float(total_charge_energy or 0)
        total_cost = float(total_cost or 0)
        fast_count = int(fast_count or 0)
        fast_ratio = (fast_count / total_charges * 100) if total_charges else 0
        avg_charge_energy = (total_charge_energy / total_charges) if total_charges else 0
        # 家充/超充费用拆分（按地点名判断超充）
        cur.execute(
            f"""
            SELECT COALESCE(SUM(cost) FILTER (WHERE geofence_id IN (
                      SELECT id FROM geofences WHERE name ILIKE '%%超充%%' OR name ILIKE '%%supercharger%%')),0),
                   COALESCE(SUM(cost) FILTER (WHERE geofence_id IS NULL OR geofence_id NOT IN (
                      SELECT id FROM geofences WHERE name ILIKE '%%超充%%' OR name ILIKE '%%supercharger%%')),0)
            FROM charging_processes WHERE car_id = %s AND duration_min >= 1 AND cost IS NOT NULL
            {cf[rng]}
            """,
            (CAR_ID,),
        )
        fast_cost, home_cost = cur.fetchone()

    total_distance = float(total_distance or 0)
    cost_per_km = (total_cost / total_distance) if total_distance > 0 else 0
    gas_save = total_distance * GAS_CONSUMPTION / 100 * GAS_PRICE - total_cost
    monthly_cost = total_cost / 12

    return ok({
        "total_distance": round(total_distance, 1),
        "total_energy": round(total_energy, 1),
        "total_cost": round(total_cost, 1),
        "avg_efficiency": round(avg_efficiency, 1),
        "cost_per_km": round(cost_per_km, 3),
        "gas_save": round(gas_save, 1),
        "total_drives": total_drives,
        "avg_distance": round(float(avg_distance or 0), 1),
        "max_distance": round(float(max_distance or 0), 1),
        "avg_duration": round(float(avg_duration or 0)),
        "max_speed": round(float(max_speed or 0)),
        "avg_outside_temp": round(float(avg_temp or 0), 1),
        "total_charges": total_charges,
        "total_charging_energy": round(total_charge_energy, 1),
        "avg_charge_energy": round(avg_charge_energy, 1),
        "fast_charge_ratio": round(fast_ratio),
        "monthly_cost": round(monthly_cost, 1),
        "unit_price": round((total_cost / total_charge_energy) if total_charge_energy else 0, 2),
        "charge_split": {
            "home": {"cost": round(float(home_cost or 0), 1)},
            "fast": {"cost": round(float(fast_cost or 0), 1)},
        },
    })


@router.get("/drives")
def drives(
    offset: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=50),
    rng: str = Query("month", alias="range", pattern="^(month|30d|90d|year|all)$"),
    user=Depends(require_bound),
):
    """行程分页列表（东八区时间输出，range 过滤）"""
    df_dn = _range_filter_drives()
    with tm_pool.connection() as conn:
        cur = conn.cursor()
        cur.execute(
            f"SELECT count(*) FROM drives WHERE car_id = %s AND end_date IS NOT NULL {df_dn[rng]}",
            (CAR_ID,),
        )
        total = cur.fetchone()[0]
        cur.execute(
            f"""
            SELECT d.id,
                   TO_CHAR(d.start_date AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM-DD HH24:MI') AS start_date,
                   d.distance, d.duration_min, d.speed_max, d.outside_temp_avg,
                   ROUND(CAST(d.distance * {EFFICIENCY} AS numeric), 1) AS energy_used,
                   ROUND(CAST(d.distance * {EFFICIENCY} * {ELECTRIC_PRICE} AS numeric), 2) AS cost,
                   COALESCE(sa.name, sa.display_name, '') AS start_address,
                   COALESCE(ea.name, ea.display_name, '') AS end_address
            FROM drives d
            LEFT JOIN addresses sa ON sa.id = d.start_address_id
            LEFT JOIN addresses ea ON ea.id = d.end_address_id
            WHERE d.car_id = %s AND d.end_date IS NOT NULL
            {df_dn[rng]}
            ORDER BY d.start_date DESC
            LIMIT %s OFFSET %s
            """,
            (CAR_ID, limit, offset),
        )
        cols = [c[0] for c in cur.description]
        rows = [dict(zip(cols, r)) for r in cur.fetchall()]
    return ok({"list": rows, "total": total, "offset": offset, "limit": limit})


@router.get("/charges")
def charges(
    offset: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=50),
    rng: str = Query("month", alias="range", pattern="^(month|30d|90d|year|all)$"),
    user=Depends(require_bound),
):
    """充电过程分页列表（东八区时间输出，range 过滤）"""
    cf = _range_filter_charges()
    with tm_pool.connection() as conn:
        cur = conn.cursor()
        cur.execute(
            f"SELECT count(*) FROM charging_processes WHERE car_id = %s AND duration_min >= 1 {cf[rng]}",
            (CAR_ID,),
        )
        total = cur.fetchone()[0]
        cur.execute(
            f"""
            SELECT cp.id,
                   TO_CHAR(cp.start_date AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM-DD HH24:MI') AS start_date,
                   cp.charge_energy_added, cp.charge_energy_used, cp.cost,
                   cp.start_battery_level, cp.end_battery_level, cp.duration_min,
                   COALESCE(g.name, '') AS geofence_name,
                   EXISTS(SELECT 1 FROM geofences gg WHERE gg.id = cp.geofence_id
                          AND (gg.name ILIKE '%%超充%%' OR gg.name ILIKE '%%supercharger%%')) AS fast_charger
            FROM charging_processes cp
            LEFT JOIN geofences g ON g.id = cp.geofence_id
            WHERE cp.car_id = %s AND cp.duration_min >= 1
            {cf[rng]}
            ORDER BY cp.start_date DESC
            LIMIT %s OFFSET %s
            """,
            (CAR_ID, limit, offset),
        )
        cols = [c[0] for c in cur.description]
        rows = [dict(zip(cols, r)) for r in cur.fetchall()]
    return ok({"list": rows, "total": total, "offset": offset, "limit": limit})


@router.get("/drives/trend")
@cached(ttl=120)
def drives_trend(
    rng: str = Query("month", alias="range", pattern="^(month|30d|90d|year|all)$"),
    user=Depends(require_bound),
):
    """里程趋势（daily 按 range 聚合粒度）+ 每周各天分布 + 出发时段（东八区）"""
    df_dn = _range_filter_drives()
    gran, label_fmt = TREND_GRAN[rng]
    with tm_pool.connection() as conn:
        cur = conn.cursor()
        # daily：按 range 粒度聚合（month/30d→按日，90d→按周，year/all→按月）
        cur.execute(
            f"""
            WITH agg AS (
              SELECT date_trunc('{gran}', start_date AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Shanghai') AS ts,
                     SUM(distance) AS dist, COUNT(*) AS cnt
              FROM drives
              WHERE car_id = %s AND end_date IS NOT NULL
                {df_dn[rng]}
              GROUP BY 1
            )
            SELECT TO_CHAR(ts, '{label_fmt}') AS label, COALESCE(ROUND(CAST(dist AS numeric),1),0) AS value, cnt
            FROM agg ORDER BY ts
            """,
            (CAR_ID,),
        )
        daily = [{"label": r[0], "value": float(r[1]), "drives": r[2]} for r in cur.fetchall()]

        # 每周各天（周日=0 转周1-7展示）
        cur.execute(
            """
            SELECT EXTRACT(ISODOW FROM start_date AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Shanghai') AS dow,
                   ROUND(CAST(AVG(distance) AS numeric),1) AS avg_dist
            FROM drives
            WHERE car_id = %s AND end_date IS NOT NULL
            GROUP BY 1 ORDER BY 1
            """,
            (CAR_ID,),
        )
        dow_map = {int(r[0]): float(r[1]) for r in cur.fetchall()}
        weekly = [
            {"label": d, "value": dow_map.get(i, 0)}
            for i, d in enumerate(["一", "二", "三", "四", "五", "六", "日"], start=1)
        ]

        # 出发时段 24h
        cur.execute(
            """
            SELECT EXTRACT(HOUR FROM start_date AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Shanghai') AS h,
                   COUNT(*)
            FROM drives
            WHERE car_id = %s AND end_date IS NOT NULL
            GROUP BY 1 ORDER BY 1
            """,
            (CAR_ID,),
        )
        hour_map = {int(r[0]): r[1] for r in cur.fetchall()}
        hourly = [{"label": f"{h}时", "value": hour_map.get(h, 0)} for h in range(24)]
    return ok({"daily": daily, "weekly": weekly, "hourly": hourly})


@router.get("/charges/trend")
@cached(ttl=120)
def charges_trend(user=Depends(require_bound)):
    """充电：地点分布 / 月度花费 / 满电续航趋势"""
    with tm_pool.connection() as conn:
        cur = conn.cursor()
        # 地点分布（按累计充入电量 Top）
        cur.execute(
            """
            SELECT COALESCE(g.name, '其他') AS label, ROUND(SUM(cp.charge_energy_added),1) AS value
            FROM charging_processes cp LEFT JOIN geofences g ON g.id = cp.geofence_id
            WHERE cp.car_id = %s AND cp.duration_min >= 1
            GROUP BY 1 ORDER BY 2 DESC LIMIT 12
            """,
            (CAR_ID,),
        )
        locations = [{"label": r[0], "value": float(r[1])} for r in cur.fetchall()]

        # 月度花费（近 12 个月）
        cur.execute(
            """
            SELECT TO_CHAR(date_trunc('month', start_date AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Shanghai'), 'MM"月"') AS label,
                   ROUND(COALESCE(SUM(cost),0),1) AS value
            FROM charging_processes
            WHERE car_id = %s AND duration_min >= 1 AND cost IS NOT NULL
              AND start_date >= now() - interval '12 months'
            GROUP BY 1 ORDER BY MIN(start_date)
            """,
            (CAR_ID,),
        )
        monthly = [{"label": r[0], "value": float(r[1])} for r in cur.fetchall()]

        # 满电续航趋势（估算：最近充电按电池容量换算，简化用 avg battery range）
        cur.execute(
            """
            SELECT TO_CHAR(date_trunc('month', start_date AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Shanghai'), 'MM"月"'),
                   ROUND(AVG(end_ideal_range_km),0)
            FROM charging_processes
            WHERE car_id = %s AND duration_min >= 1 AND end_ideal_range_km IS NOT NULL
              AND start_date >= now() - interval '12 months'
            GROUP BY 1 ORDER BY MIN(start_date)
            """,
            (CAR_ID,),
        )
        range_trend = [{"label": r[0], "value": float(r[1])} for r in cur.fetchall()]
    return ok({"locations": locations, "monthly": monthly, "range": range_trend})


@router.get("/vehicle")
def vehicle(user=Depends(require_bound)):
    """车辆基础信息"""
    with tm_pool.connection() as conn:
        cur = conn.cursor()
        cur.execute(
            "SELECT name, model, efficiency FROM cars WHERE id = %s",
            (CAR_ID,),
        )
        row = cur.fetchone()
    if not row:
        return err(404, "未找到车辆", status=404)
    name, model, efficiency = row
    return ok({
        "name": name or model or "Tesla",
        "model": model or "",
        "efficiency": float(efficiency or 0),
    })
