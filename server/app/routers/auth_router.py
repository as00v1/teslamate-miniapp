# -*- coding: utf-8 -*-
"""鉴权路由：登录换 openid / 口令绑定 / 成员管理"""
import time
import hmac
import requests
from fastapi import APIRouter, Depends, HTTPException, Header
from pydantic import BaseModel, Field
from ..db import app_pool
from .. import config
from ..auth import require_owner, require_bound
from ..utils import ok, err

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])


class LoginRequest(BaseModel):
    code: str = Field(min_length=1, max_length=128)


class BindRequest(BaseModel):
    passphrase: str = Field(min_length=1, max_length=64)


class RemoveRequest(BaseModel):
    openid: str = Field(min_length=1, max_length=128)


# 登录限流：简单内存计数（10 次/分钟/IP 粗限）
_login_attempts = {}


def _rate_limit(ip):
    now = time.time()
    key = f"login:{ip}"
    window = _login_attempts.get(key, [])
    window = [t for t in window if now - t < 60]
    if len(window) >= 10:
        return False
    window.append(now)
    _login_attempts[key] = window
    return True


@router.post("/login")
async def login(req: LoginRequest, x_forwarded_for: str = Header("", alias="X-Forwarded-For")):
    """wx.login code 换 openid（code2session）"""
    ip = x_forwarded_for.split(",")[0].strip() or "unknown"
    if not _rate_limit(ip):
        return err(429, "请求过于频繁，请稍后再试", status=429)

    if not config.WX_APPID or not config.WX_SECRET:
        # demo 模式：无 AppSecret 时返回固定开发身份。
        # 注意不能用 code 生成 openid——wx.login 的 code 每次调用都不同，
        # 会导致 openid 每次启动都漂移、绑定反复失效。固定身份便于开发调试。
        openid = "dev_user"
        return ok({"openid": openid, "token": config.TESLA_API_TOKEN})

    # 真实 code2session
    resp = requests.get(
        "https://api.weixin.qq.com/sns/jscode2session",
        params={
            "appid": config.WX_APPID,
            "secret": config.WX_SECRET,
            "js_code": req.code,
            "grant_type": "authorization_code",
        },
        timeout=8,
    )
    data = resp.json()
    if "openid" not in data:
        return err(401, f"登录校验失败: {data.get('errmsg', 'unknown')}", status=401)
    # 登录成功一并下发业务 Token（前端存储后用于 X-API-Token）
    return ok({"openid": data["openid"], "token": config.TESLA_API_TOKEN})


@router.post("/bind")
async def bind(req: BindRequest, x_openid: str = Header("", alias="X-Openid")):
    """口令登录：校验口令，将 openid 写入白名单（首个绑定者自动成为车主）"""
    if not x_openid:
        return err(401, "未登录", status=401)
    # 硬防护：拒绝模拟身份（demo_/dev_ 前缀），强制使用真实 code2session 的 openid
    if x_openid.startswith("demo_") or x_openid.startswith("dev_"):
        return err(403, "身份异常，请重新登录后再绑定", status=403)
    if not config.PASSPHRASE:
        return err(500, "服务端未配置口令", status=500)
    # 常数时间比较，防时序攻击
    if not hmac.compare_digest(req.passphrase, config.PASSPHRASE):
        return err(401, "口令错误，请重新输入", status=401)

    with app_pool.connection() as conn:
        cur = conn.cursor()
        # 是否已有车主
        cur.execute("SELECT 1 FROM auth_bindings WHERE role = 'owner' LIMIT 1")
        has_owner = cur.fetchone() is not None
        role = "member" if has_owner else "owner"
        # upsert（已有记录保留原角色，RETURNING 取实际角色）
        cur.execute(
            """
            INSERT INTO auth_bindings (openid, role, bound_at, last_seen)
            VALUES (%s, %s, now(), now())
            ON CONFLICT (openid) DO UPDATE SET
              role = auth_bindings.role, last_seen = now()
            RETURNING role
            """,
            (x_openid, role),
        )
        actual_role = cur.fetchone()[0]
        conn.commit()
        # 返回成员列表
        cur.execute("SELECT openid, role, bound_at FROM auth_bindings ORDER BY bound_at")
        members = [{"openid": r[0], "role": r[1], "bound_at": r[2].isoformat()} for r in cur.fetchall()]
    return ok({"role": actual_role, "members": members})


@router.get("/me")
async def me(x_openid: str = Header("", alias="X-Openid")):
    """查询当前 openid 的绑定状态（未绑定也返回 200，供前端清缓存后恢复本地状态）"""
    if not x_openid:
        return err(401, "未登录", status=401)
    with app_pool.connection() as conn:
        cur = conn.cursor()
        cur.execute("SELECT role FROM auth_bindings WHERE openid = %s", (x_openid,))
        row = cur.fetchone()
    if row:
        return ok({"bound": True, "role": row[0], "openid": x_openid})
    return ok({"bound": False, "openid": x_openid})


@router.get("/members")
async def members(user=Depends(require_bound)):
    """已绑定成员列表（登录用户可见）"""
    with app_pool.connection() as conn:
        cur = conn.cursor()
        cur.execute("SELECT openid, role, bound_at FROM auth_bindings ORDER BY bound_at")
        rows = cur.fetchall()
    return ok({
        "members": [
            {"openid": r[0], "role": r[1], "bound_at": r[2].isoformat()}
            for r in rows
        ]
    })


@router.delete("/members/{target_openid}")
async def remove_member(target_openid: str, user=Depends(require_owner)):
    """车主移除成员（不能移除自己）"""
    if target_openid == user["openid"]:
        return err(400, "不能移除自己")
    with app_pool.connection() as conn:
        cur = conn.cursor()
        cur.execute("DELETE FROM auth_bindings WHERE openid = %s", (target_openid,))
        conn.commit()
        if cur.rowcount == 0:
            return err(404, "成员不存在", status=404)
    return ok({"removed": target_openid})
