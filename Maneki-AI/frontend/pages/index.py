"""
Maneki-AI Factory Home — 工厂首页

极简交互界面：
  1. 用户输入商业目标
  2. 点击"启动工厂 🚀"
  3. POST 到后端 /api/router
  4. 获取 task_id 后跳转到 /task_detail?task_id=xxx

依赖: FastAPI (Jinja2Templates) 或独立 HTML 页面
此文件可作为 FastAPI 模板渲染的页面，也可作为独立 HTML 页面直接使用。
"""

import os
import json
import uuid
from datetime import datetime, timezone

# ── HTML 模板 ─────────────────────────────────────────────────────────────

FACTORY_HOME_HTML = """<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Maneki-AI Factory Console</title>
    <link rel="stylesheet" href="/static/styles/theme.css">
    <style>
        /* ── 工厂首页专属样式 ── */
        .factory-home {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            padding: var(--spacing-lg);
        }

        .factory-card {
            background: var(--color-bg-secondary);
            border: 1px solid var(--color-border);
            border-radius: var(--radius-lg);
            padding: var(--spacing-2xl);
            max-width: 640px;
            width: 100%;
            text-align: center;
            box-shadow: var(--shadow-glow-blue);
        }

        .factory-logo {
            font-size: 64px;
            line-height: 1;
            margin-bottom: var(--spacing-md);
        }

        .factory-title {
            font-size: 28px;
            font-weight: 700;
            color: var(--color-accent-blue);
            margin-bottom: var(--spacing-sm);
            letter-spacing: 1px;
        }

        .factory-subtitle {
            font-size: 14px;
            color: var(--color-text-secondary);
            margin-bottom: var(--spacing-xl);
            font-family: var(--font-sans);
        }

        .factory-subtitle span {
            color: var(--color-accent-green);
        }

        .factory-input-group {
            margin-bottom: var(--spacing-lg);
            text-align: left;
        }

        .factory-input-group label {
            display: block;
            font-size: 13px;
            color: var(--color-text-secondary);
            margin-bottom: var(--spacing-sm);
            font-family: var(--font-sans);
        }

        .factory-input {
            width: 100%;
            padding: 16px 20px;
            font-size: 18px;
            font-family: var(--font-mono);
            background: var(--color-bg-primary);
            color: var(--color-text-primary);
            border: 1px solid var(--color-border);
            border-radius: var(--radius-md);
            outline: none;
            transition: border-color 0.2s ease, box-shadow 0.2s ease;
            resize: vertical;
            min-height: 80px;
            line-height: 1.5;
        }

        .factory-input:focus {
            border-color: var(--color-border-focus);
            box-shadow: 0 0 0 3px rgba(88, 166, 255, 0.15);
        }

        .factory-input::placeholder {
            color: var(--color-text-muted);
            font-size: 16px;
        }

        .factory-btn {
            width: 100%;
            padding: 18px 24px;
            font-size: 20px;
            font-weight: 700;
            font-family: var(--font-sans);
            color: var(--color-btn-primary-text);
            background: var(--color-btn-primary);
            border: none;
            border-radius: var(--radius-md);
            cursor: pointer;
            transition: background 0.2s ease, transform 0.1s ease, box-shadow 0.2s ease;
            letter-spacing: 1px;
        }

        .factory-btn:hover {
            background: var(--color-btn-primary-hover);
            box-shadow: var(--shadow-glow-green);
        }

        .factory-btn:active {
            transform: scale(0.98);
        }

        .factory-btn:disabled {
            opacity: 0.6;
            cursor: not-allowed;
            transform: none;
            box-shadow: none;
        }

        .factory-status {
            margin-top: var(--spacing-lg);
            padding: var(--spacing-md);
            border-radius: var(--radius-md);
            font-size: 14px;
            font-family: var(--font-mono);
            display: none;
            text-align: center;
        }

        .factory-status.loading {
            display: block;
            color: var(--color-accent-blue);
            border: 1px solid var(--color-border);
            background: var(--color-bg-tertiary);
        }

        .factory-status.success {
            display: block;
            color: var(--color-accent-green);
            border: 1px solid var(--color-accent-green);
            background: rgba(63, 185, 80, 0.1);
        }

        .factory-status.error {
            display: block;
            color: var(--color-accent-red);
            border: 1px solid var(--color-accent-red);
            background: rgba(248, 81, 73, 0.1);
        }

        .factory-footer {
            margin-top: var(--spacing-xl);
            font-size: 12px;
            color: var(--color-text-muted);
            font-family: var(--font-sans);
        }

        .factory-footer a {
            color: var(--color-text-muted);
        }
        .factory-footer a:hover {
            color: var(--color-accent-blue);
        }

        /* ── 打字动画 ── */
        @keyframes blink {
            0%, 100% { opacity: 1; }
            50% { opacity: 0; }
        }
        .cursor-blink::after {
            content: "▌";
            color: var(--color-accent-blue);
            animation: blink 1s step-end infinite;
            margin-left: 2px;
        }

        /* ── 响应式 ── */
        @media (max-width: 480px) {
            .factory-card {
                padding: var(--spacing-lg);
            }
            .factory-title {
                font-size: 22px;
            }
            .factory-input {
                font-size: 16px;
                padding: 14px 16px;
            }
            .factory-btn {
                font-size: 18px;
                padding: 16px 20px;
            }
        }
    </style>
</head>
<body>
    <div class="factory-home">
        <div class="factory-card">
            <div class="factory-logo">🏭</div>
            <h1 class="factory-title">Maneki-AI Factory Console</h1>
            <p class="factory-subtitle">
                > 输入你的商业目标，AI 工厂将自动拆解、执行并交付成果。
                <br><span>极简交互 · 极限执行</span>
            </p>

            <div class="factory-input-group">
                <label for="goalInput">📋 请输入你的商业目标</label>
                <textarea
                    id="goalInput"
                    class="factory-input"
                    rows="3"
                    placeholder="例如：帮我设计一个 AI 视频出海的推广方案..."
                ></textarea>
            </div>

            <button id="launchBtn" class="factory-btn" onclick="launchFactory()">
                启动工厂 🚀
            </button>

            <div id="statusBox" class="factory-status">
                <span id="statusText"></span>
            </div>

            <div class="factory-footer">
                <a href="https://github.com/winsentrobot008/Maneki-AI" target="_blank">Maneki-AI v0.3.0</a>
                &nbsp;·&nbsp; AI Factory OS
            </div>
        </div>
    </div>

    <script>
        /**
         * 启动工厂 — 将商业目标 POST 到后端 /api/router
         * 成功后跳转到 /task_detail?task_id=xxx
         */
        async function launchFactory() {
            const goalInput = document.getElementById('goalInput');
            const launchBtn = document.getElementById('launchBtn');
            const statusBox = document.getElementById('statusBox');
            const statusText = document.getElementById('statusText');

            const goal = goalInput.value.trim();

            // ── 验证输入 ──
            if (!goal) {
                statusBox.className = 'factory-status error';
                statusText.textContent = '⚠️ 请输入你的商业目标';
                goalInput.focus();
                return;
            }

            // ── 加载状态 ──
            launchBtn.disabled = true;
            launchBtn.textContent = '⏳ 工厂启动中...';
            statusBox.className = 'factory-status loading';
            statusText.textContent = '> 正在向 AI 工厂下达生产指令...';

            try {
                // ── 调用后端 API ──
                const response = await fetch('/api/router', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ goal: goal })
                });

                const result = await response.json();

                if (result.status === 'success') {
                    const taskId = result.task_id;
                    statusBox.className = 'factory-status success';
                    statusText.textContent = '✅ ' + result.message;

                    // ── 短暂延迟后跳转 ──
                    setTimeout(() => {
                        window.location.href = '/task_detail?task_id=' + taskId;
                    }, 800);
                } else {
                    statusBox.className = 'factory-status error';
                    statusText.textContent = '❌ ' + (result.message || '未知错误');
                    launchBtn.disabled = false;
                    launchBtn.textContent = '启动工厂 🚀';
                }
            } catch (error) {
                statusBox.className = 'factory-status error';
                statusText.textContent = '❌ 网络错误: ' + error.message;
                launchBtn.disabled = false;
                launchBtn.textContent = '启动工厂 🚀';
            }
        }

        // ── Enter 键快捷提交 ──
        document.addEventListener('DOMContentLoaded', function() {
            const goalInput = document.getElementById('goalInput');
            goalInput.addEventListener('keydown', function(e) {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    launchFactory();
                }
            });
            goalInput.focus();
        });
    </script>
</body>
</html>
"""


# ── FastAPI 路由注册 ──────────────────────────────────────────────────────

def register_factory_home(app, templates_dir: str = None):
    """
    将工厂首页注册到 FastAPI 应用。

    用法:
        from frontend.pages.index import register_factory_home
        register_factory_home(app)
    """
    from fastapi.responses import HTMLResponse

    @app.get("/factory", response_class=HTMLResponse)
    async def factory_home():
        return FACTORY_HOME_HTML

    print("[factory_home] 工厂首页已注册: GET /factory")
    return app


# ── 独立运行测试 ──────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    from fastapi import FastAPI
    from fastapi.staticfiles import StaticFiles

    test_app = FastAPI(title="Maneki-AI Factory (Standalone)")

    # 挂载静态文件
    static_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "styles")
    if os.path.exists(static_dir):
        test_app.mount("/static", StaticFiles(directory=os.path.dirname(static_dir)), name="static")

    # 注册工厂首页
    register_factory_home(test_app)

    print("🏭 Maneki-AI Factory Console (Standalone Mode)")
    print("   → http://localhost:8080/factory")
    uvicorn.run(test_app, host="0.0.0.0", port=8080)
