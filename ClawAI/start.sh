#!/bin/bash
# ============================================
# LiveBench Dual-Process Startup Script
# ============================================
# Starts both the FastAPI server (receives requests)
# and the background task worker (executes queued tasks)
#
# Usage: ./start.sh
# ============================================

set -e

echo "============================================================"
echo "🚀 LiveBench Starting..."
echo "   Server port: ${PORT:-7860}"
echo "   Worker: enabled"
DEEPSEEK_STATUS="❌ MISSING - tasks will not execute!"
if [ -n "$DEEPSEEK_API_KEY" ]; then
  DEEPSEEK_STATUS="✅ configured"
fi
echo "   DeepSeek API: $DEEPSEEK_STATUS"
echo "============================================================"

# Add project root to PYTHONPATH for Docker/Hugging Face environment
export PYTHONPATH="/home/user/app:$PYTHONPATH"

# Function to run the worker
run_worker() {
    echo "[Worker] Starting background task worker..."
    cd /home/user/app
    python -c "
import asyncio
import threading
from livebench.scheduler.worker import run_worker_background

# Start worker in background
t = run_worker_background(server_url='http://localhost:${PORT:-7860}')
print(f'[Worker] Started (thread: {t.name})')

# Keep alive
import time
try:
    while True:
        time.sleep(10)
except KeyboardInterrupt:
    print('[Worker] Shutting down...')
" &
    WORKER_PID=$!
    echo "[Worker] PID: $WORKER_PID"
}

# Start worker in background
run_worker

# Start the FastAPI server (foreground)
echo "[Server] Starting FastAPI..."
exec uvicorn livebench.api.server:app --host 0.0.0.0 --port ${PORT:-7860}