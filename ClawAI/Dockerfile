# 使用官方轻量级 Python 镜像
FROM python:3.11-slim

# 设置环境变量，确保 Python 输出直接打印到控制台，并设置 HF 专用的端口
ENV PYTHONUNBUFFERED=1 \
    PORT=7860 \
    HOME=/home/user

# 创建一个非 root 用户（Hugging Face 安全规范强制要求，UID 必须为 1000）
RUN useradd -m -u 1000 user

# 设置工作目录
WORKDIR $HOME/app

# 先复制依赖文件并安装（利用 Docker 缓存加速后续构建）
COPY --chown=user:user requirements.txt .
RUN pip install --no-cache-dir --upgrade -r requirements.txt

# 复制当前目录下的所有后端代码到容器中，并确保所有权属于非 root 用户
COPY --chown=user:user . .

# 确保启动脚本可执行
RUN chmod +x start.sh

# 切换到非 root 用户运行环境
USER user

# 暴露 Hugging Face Spaces 默认探测的 7860 端口
EXPOSE 7860

# 启动双进程：FastAPI 后端 + 后台任务执行器 Worker
# 使用 start.sh 同时启动 server 和 worker，确保 queued 任务被消费
CMD ["./start.sh"]