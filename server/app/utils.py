# -*- coding: utf-8 -*-
"""工具：内存缓存 + 统一响应"""
import time
import json
import functools
from fastapi.responses import JSONResponse
from fastapi.encoders import jsonable_encoder

_cache = {}


def cached(ttl=60):
    """简单内存缓存装饰器（60s 默认）。

    注意：必须用 functools.wraps 保留原始签名 —— FastAPI 通过
    inspect.signature 解析依赖参数，若暴露 *args/**kwargs 会被当成
    query 参数导致 422。缓存 key = 函数名 + 可哈希的 kwargs（如 range 等
    query 参数），避免不同参数的请求互相覆盖缓存；user 依赖是 dict 不可哈希，
    从 key 中排除（家庭共享缓存可接受）。
    """
    def deco(fn):
        @functools.wraps(fn)
        def wrap(*args, **kwargs):
            hashable = tuple(sorted(
                (k, v) for k, v in kwargs.items()
                if isinstance(v, (str, int, float, bool, type(None)))
            ))
            key = (fn.__name__,) + hashable
            now = time.time()
            hit = _cache.get(key)
            if hit and now - hit[0] < ttl:
                return hit[1]
            val = fn(*args, **kwargs)
            _cache[key] = (now, val)
            return val
        return wrap
    return deco


def ok(data=None):
    """统一成功响应（jsonable_encoder 处理 Decimal/date 等不可序列化类型）"""
    return JSONResponse({
        "code": 0,
        "data": jsonable_encoder(data) if data is not None else {},
        "message": "ok",
    })


def err(code, message, status=400):
    """统一错误响应"""
    return JSONResponse({"code": code, "data": {}, "message": message}, status_code=status)


def jsonable(obj):
    """处理 Decimal/date 等不可 JSON 序列化类型"""
    import decimal
    import datetime
    if isinstance(obj, decimal.Decimal):
        return float(obj)
    if isinstance(obj, (datetime.date, datetime.datetime)):
        return obj.isoformat()
    if isinstance(obj, (list, tuple)):
        return [jsonable(x) for x in obj]
    if isinstance(obj, dict):
        return {k: jsonable(v) for k, v in obj.items()}
    return obj
