# -*- coding: utf-8 -*-
"""应用配置：全部从环境变量读取，不落代码"""
import os

# 鉴权
TESLA_API_TOKEN = os.environ.get("TESLA_API_TOKEN", "")          # 业务 API 固定 Token（小程序端 X-API-Token）
PASSPHRASE = os.environ.get("TESLA_PASSPHRASE", "")               # 口令登录（车主分享给家人）

# 微信小程序
WX_APPID = os.environ.get("WX_APPID", "")
WX_SECRET = os.environ.get("WX_SECRET", "")

# tesla_app 库（读写）
APP_DB_HOST = os.environ.get("APP_DB_HOST", "database")
APP_DB_PORT = int(os.environ.get("APP_DB_PORT", "5432"))
APP_DB_NAME = os.environ.get("APP_DB_NAME", "tesla_app")
APP_DB_USER = os.environ.get("APP_DB_USER", "tesla_app")
APP_DB_PASS = os.environ.get("APP_DB_PASS", "")

# teslamate 库（只读）
TM_DB_HOST = os.environ.get("TM_DB_HOST", "database")
TM_DB_PORT = int(os.environ.get("TM_DB_PORT", "5432"))
TM_DB_NAME = os.environ.get("TM_DB_NAME", "teslamate")
TM_DB_USER = os.environ.get("TM_DB_USER", "tesla_readonly")
TM_DB_PASS = os.environ.get("TM_DB_PASS", "")
