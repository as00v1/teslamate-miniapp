# 使用与 ECS 现有容器同源的镜像加速前缀（docker.1ms.run 已验证可用）
FROM docker.1ms.run/library/python:3.13-slim

WORKDIR /app

# 系统依赖（psycopg binary 已含，无需 libpq 编译）
# 国内服务器：apt 换阿里云源加速
RUN sed -i 's|deb.debian.org|mirrors.aliyun.com|g' /etc/apt/sources.list.d/debian.sources \
    && apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
# 国内服务器：pip 换阿里云 PyPI 源加速
RUN pip install --no-cache-dir -r requirements.txt -i https://mirrors.aliyun.com/pypi/simple/

COPY app ./app

EXPOSE 8081

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8081", "--workers", "2"]
