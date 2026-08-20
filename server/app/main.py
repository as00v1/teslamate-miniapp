# -*- coding: utf-8 -*-
"""FastAPI 主入口"""
import logging
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware

from . import config
from .db import init_pools, close_pools
from .routers import auth_router, data_router

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("tesla-api")

app = FastAPI(title="TeslaMate Miniapp API", docs_url=None, redoc_url=None)

# CORS：小程序请求不走浏览器 CORS，但为调试留白名单（不设 *）
app.add_middleware(
    CORSMiddleware,
    allow_origins=[],  # 小程序原生请求无 Origin 限制；如需 H5 调试再放开
    allow_methods=["GET", "POST", "DELETE"],
    allow_headers=["*"],
)

app.include_router(auth_router.router)
app.include_router(data_router.router)


@app.middleware("http")
async def token_guard(request: Request, call_next):
    """全局 Token 校验：除 health 与登录/绑定（绑定前无 Token）外，一律要求正确 X-API-Token。

    放行白名单：/api/v1/health、/api/v1/auth/login、/api/v1/auth/bind
    其余 /api/v1/ 路径（含 /auth/me、/auth/members、业务接口）必须带 Token。
    这是最后一道闸（业务路由内的 require_bound 只校验 openid 绑定，
    不校验 Token；两者叠加构成完整防线）。
    """
    path = request.url.path
    if path.startswith("/api/v1/") and path not in (
        "/api/v1/health",
        "/api/v1/auth/login",
        "/api/v1/auth/bind",
    ):
        token = request.headers.get("X-API-Token", "")
        if not config.TESLA_API_TOKEN:
            return JSONResponse({"code": 500, "data": {}, "message": "服务端未配置 Token"}, status_code=500)
        import hmac
        if not hmac.compare_digest(token, config.TESLA_API_TOKEN):
            return JSONResponse({"code": 401, "data": {}, "message": "unauthorized"}, status_code=401)
    return await call_next(request)


@app.on_event("startup")
async def startup():
    init_pools()
    logger.info("tesla-api started, token_configured=%s passphrase_configured=%s",
                bool(config.TESLA_API_TOKEN), bool(config.PASSPHRASE))


@app.on_event("shutdown")
async def shutdown():
    close_pools()


@app.get("/api/v1/health")
async def health():
    return {"code": 0, "data": {"status": "ok"}, "message": "ok"}


@app.exception_handler(Exception)
async def unhandled_exception(request: Request, exc: Exception):
    """统一异常兜底：不泄露内部细节，仅记日志"""
    logger.error("Unhandled: %s %s -> %s", request.method, request.url.path, exc)
    return JSONResponse(
        {"code": 500, "data": {}, "message": "服务器内部错误"},
        status_code=500,
    )
