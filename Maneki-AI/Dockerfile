# Maneki-AI Factory — HuggingFace Spaces Dockerfile
# 基于 CLAWWORK 的部署理念改造，适配 HuggingFace Spaces
FROM python:3.11-slim

# HuggingFace Spaces 规范
ENV PYTHONUNBUFFERED=1 \
    PORT=7860 \
    HOME=/home/user

# 创建非 root 用户 (HuggingFace 安全规范，UID 1000)
RUN useradd -m -u 1000 user

# 工作目录
WORKDIR $HOME/app

# 先复制依赖并安装（利用 Docker 缓存）
COPY --chown=user:user requirements.txt .
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

# 复制全部项目代码
COPY --chown=user:user . .

# 创建必要的目录
RUN mkdir -p task_queue/pending task_queue/processing task_queue/completed logs

# 切换到非 root 用户
USER user

# 暴露 HuggingFace Spaces 默认端口
EXPOSE 7860

# 启动 FastAPI 后端
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "7860"]