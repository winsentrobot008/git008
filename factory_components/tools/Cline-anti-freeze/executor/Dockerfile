# Hugging Face Spaces 根目录 Dockerfile
# 实际代码位于 ClawAI/ 子目录，通过 COPY 指令将其内容设置到容器工作目录
# 这样 HF Space 能检测到 Dockerfile，同时所有路径保持正确

FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PORT=7860 \
    HOME=/home/user

RUN useradd -m -u 1000 user

WORKDIR $HOME/app

# 先复制依赖文件并安装（利用缓存加速）
COPY --chown=user:user ClawAI/requirements.txt .
RUN pip install --no-cache-dir --upgrade -r requirements.txt

# 复制 ClawAI/ 子目录下的所有代码到工作目录
COPY --chown=user:user ClawAI/ .

USER user

EXPOSE 7860

# 启动 FastAPI 后端
CMD ["uvicorn", "livebench.api.server:app", "--host", "0.0.0.0", "--port", "7860"]