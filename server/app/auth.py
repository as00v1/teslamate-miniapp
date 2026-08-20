# -*- coding: utf-8 -*-
"""鉴权：Token 校验 + 口令绑定状态校验 + 车主权限"""
from fastapi import Header, HTTPException, Depends
from .db import app_pool
from . import config


async def verify_token(x_api_token: str = Header(...)):
    """业务 API 固定 Token 校验"""
    if not config.TESLA_API_TOKEN:
        raise HTTPException(status_code=500, detail="服务端未配置 Token")
    if x_api_token != config.TESLA_API_TOKEN:
        raise HTTPException(status_code=401, detail="unauthorized")
    return x_api_token


def get_openid_role(x_openid: str = Header("", alias="X-Openid")):
    """从 header 取 openid（登录接口返回给前端，前端后续请求携带）"""
    return x_openid


async def require_bound(x_openid: str = Depends(get_openid_role)):
    """业务数据接口：openid 必须在 auth_bindings 白名单中"""
    if not x_openid:
        raise HTTPException(status_code=401, detail="未登录")
    with app_pool.connection() as conn:
        cur = conn.cursor()
        cur.execute(
            "SELECT role FROM auth_bindings WHERE openid = %s",
            (x_openid,),
        )
        row = cur.fetchone()
    if not row:
        raise HTTPException(status_code=401, detail="未绑定，请先口令登录")
    return {"openid": x_openid, "role": row[0]}


async def require_owner(user=Depends(require_bound)):
    """车主专属接口：role 必须为 owner"""
    if user["role"] != "owner":
        raise HTTPException(status_code=403, detail="仅车主可操作")
    return user
