# -*- coding: utf-8 -*-
"""数据库连接池：tesla_app 读写 + teslamate 只读"""
import psycopg_pool
from . import config

# tesla_app 库（读写账号）—— 绑定关系/设置
app_pool = psycopg_pool.ConnectionPool(
    conninfo=(
        f"host={config.APP_DB_HOST} port={config.APP_DB_PORT} "
        f"dbname={config.APP_DB_NAME} user={config.APP_DB_USER} password={config.APP_DB_PASS}"
    ),
    min_size=1,
    max_size=4,
    open=False,
)

# teslamate 库（只读账号）—— 车辆数据
tm_pool = psycopg_pool.ConnectionPool(
    conninfo=(
        f"host={config.TM_DB_HOST} port={config.TM_DB_PORT} "
        f"dbname={config.TM_DB_NAME} user={config.TM_DB_USER} password={config.TM_DB_PASS}"
    ),
    min_size=1,
    max_size=4,
    open=False,
)


def init_pools():
    app_pool.open()
    tm_pool.open()


def close_pools():
    app_pool.close()
    tm_pool.close()
