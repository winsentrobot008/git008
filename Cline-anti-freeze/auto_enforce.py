#!/usr/bin/env python3
"""
auto_enforce.py — Cline-anti-freeze 自启动执法器 (v1.0)
=========================================================
职责：
  1. 在任何 VSC 窗口启动并载入环境时，自动在后台拉起 governance_ui.py
  2. 向用户弹出通知窗口，显示治理控制台入口 URL
  3. 确保 WebSocket 服务器与 Streamlit 控制台同时就绪
  4. 防止重复启动（通过 PID 文件锁）

启动方式：
  python Cline-anti-freeze/auto_enforce.py
  或通过 VSC task / terminal profile 在窗口启动时自动触发
"""

import os
import sys
import json
import time
import socket
import signal
import atexit
import platform
import subprocess
import threading
from pathlib import Path
from datetime import datetime

# ============================================================
# Paths
# ============================================================
THIS_DIR = Path(__file__).resolve().parent
ROOT_DIR = THIS_DIR.parent
PID_FILE = THIS_DIR / ".governance_ui.pid"
LOCK_FILE = THIS_DIR / ".governance_ui.lock"
PORT_FILE = THIS_DIR / ".governance_ui_port.json"

DEFAULT_UI_PORT = 8501
DEFAULT_WS_PORT = 8769


# ============================================================
# PID / Lock Management
# ============================================================
def is_already_running() -> bool:
    """Check if governance_ui is already running via PID file."""
    if not PID_FILE.exists():
        return False
    try:
        pid = int(PID_FILE.read_text(encoding="utf-8").strip())
    except (ValueError, OSError):
        return False

    # Check if process still alive
    if platform.system() == "Windows":
        try:
            result = subprocess.run(
                ["tasklist", "/FI", f"PID eq {pid}", "/FO", "CSV", "/NH"],
                capture_output=True, text=True, timeout=5,
            )
            return "python" in result.stdout.lower() and str(pid) in result.stdout
        except Exception:
            # Fallback: try to signal
            try:
                os.kill(pid, 0)
                return True
            except OSError:
                return False
    else:
        try:
            os.kill(pid, 0)
            return True
        except OSError:
            return False


def write_pid():
    """Write current process PID (the subprocess PID)."""
    PID_FILE.write_text(str(os.getpid()), encoding="utf-8")


def write_port_config(ui_port: int, ws_port: int):
    """Persist port configuration for other components to discover."""
    PORT_FILE.write_text(
        json.dumps({
            "ui_url": f"http://localhost:{ui_port}",
            "ws_url": f"ws://localhost:{ws_port}",
            "ui_port": ui_port,
            "ws_port": ws_port,
            "started_at": datetime.now().isoformat(),
            "pid": os.getpid(),
        }, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )


def cleanup():
    """Clean up PID and lock files on exit."""
    for f in [PID_FILE, LOCK_FILE, PORT_FILE]:
        try:
            if f.exists():
                f.unlink()
        except OSError:
            pass


# ============================================================
# Port Discovery
# ============================================================
def find_free_port(start: int = 8501, max_attempts: int = 20) -> int:
    """Find a free TCP port."""
    for port in range(start, start + max_attempts):
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(0.5)
        try:
            sock.bind(("127.0.0.1", port))
            sock.close()
            return port
        except OSError:
            sock.close()
            continue
    return start  # fallback


# ============================================================
# Notification (Cross-platform)
# ============================================================
def send_notification(url: str):
    """
    Send a desktop notification / popup with the governance console URL.
    Cross-platform: Windows toast/PowerShell, macOS osascript, Linux notify-send.
    """
    system = platform.system()
    message = f"Cline-anti-freeze 治理控制台已就绪\n入口: {url}"

    print(f"\n{'='*60}")
    print(f"  🏛️  Cline-anti-freeze 治理控制台")
    print(f"  📡 {url}")
    print(f"{'='*60}\n")

    if system == "Windows":
        # Method 1: PowerShell popup
        try:
            ps_script = f'''
            Add-Type -AssemblyName System.Windows.Forms
            $result = [System.Windows.Forms.MessageBox]::Show(
                "Cline-anti-freeze 治理控制台已就绪`n`n入口 URL:`n{url}`n`nWebSocket: ws://localhost:{_discover_ws_port()}`n`n按确定打开控制台",
                "🏛️ Cline 治理中心",
                [System.Windows.Forms.MessageBoxButtons]::OKCancel,
                [System.Windows.Forms.MessageBoxIcon]::Information
            )
            if ($result -eq "OK") {{ Start-Process "{url}" }}
            '''
            subprocess.Popen(
                ["powershell", "-NoProfile", "-Command", ps_script],
                creationflags=subprocess.CREATE_NO_WINDOW if hasattr(subprocess, "CREATE_NO_WINDOW") else 0,
            )
        except Exception:
            pass

        # Method 2: toast notification (Win10+)
        try:
            toast_script = f'''
            [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
            $template = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)
            $textNodes = $template.GetElementsByTagName("text")
            $textNodes.Item(0).AppendChild($template.CreateTextNode("🏛️ Cline 治理控制台已就绪")) | Out-Null
            $textNodes.Item(1).AppendChild($template.CreateTextNode("{url}")) | Out-Null
            $toast = [Windows.UI.Notifications.ToastNotification]::new($template)
            [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("Cline Governance").Show($toast)
            '''
            subprocess.Popen(
                ["powershell", "-NoProfile", "-Command", toast_script],
                creationflags=subprocess.CREATE_NO_WINDOW if hasattr(subprocess, "CREATE_NO_WINDOW") else 0,
            )
        except Exception:
            pass

    elif system == "Darwin":  # macOS
        try:
            subprocess.run([
                "osascript", "-e",
                f'display dialog "Cline-anti-freeze 治理控制台已就绪\\n\\n入口: {url}" '
                f'with title "🏛️ Cline 治理中心" buttons {{"打开控制台", "稍后"}} default button "打开控制台"'
            ], timeout=5)
        except Exception:
            try:
                subprocess.run([
                    "osascript", "-e",
                    f'display notification "治理控制台: {url}" with title "Cline-anti-freeze 治理中心"'
                ], timeout=5)
            except Exception:
                pass

    elif system == "Linux":
        try:
            subprocess.run(["notify-send", "🏛️ Cline 治理控制台", f"入口: {url}", "--urgency=critical"], timeout=5)
        except Exception:
            pass


def _discover_ws_port() -> int:
    """Get the WebSocket port from PORT_FILE if available."""
    if PORT_FILE.exists():
        try:
            cfg = json.loads(PORT_FILE.read_text(encoding="utf-8"))
            return cfg.get("ws_port", DEFAULT_WS_PORT)
        except Exception:
            pass
    return DEFAULT_WS_PORT


# ============================================================
# Main: Launch governance_ui.py
# ============================================================
def launch_governance_ui(ui_port: int = None, ws_port: int = None, headless: bool = False):
    """
    Launch governance_ui.py as a subprocess.
    Returns the subprocess.Popen handle.
    """
    if ui_port is None:
        ui_port = find_free_port(DEFAULT_UI_PORT)
    if ws_port is None:
        ws_port = find_free_port(DEFAULT_WS_PORT, max_attempts=10)

    gov_ui_path = THIS_DIR / "governance_ui.py"

    cmd = [
        sys.executable, str(gov_ui_path),
        "--port", str(ui_port),
        "--ws-port", str(ws_port),
        "--no-browser",
    ]

    print(f"[auto_enforce] 启动治理控制台...")
    print(f"[auto_enforce] UI 端口: {ui_port} | WS 端口: {ws_port}")

    proc = subprocess.Popen(
        cmd,
        cwd=str(ROOT_DIR),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )

    # Save port config
    write_port_config(ui_port, ws_port)

    # Start a thread to read stdout
    def _reader():
        for line in proc.stdout:
            line = line.strip()
            if line:
                print(f"[gov_ui] {line}")

    threading.Thread(target=_reader, daemon=True).start()

    return proc, ui_port, ws_port


def main():
    """Main entry: auto-enforce governance UI boot."""
    import argparse

    parser = argparse.ArgumentParser(
        description="Cline-anti-freeze 自启动执法器 — 自动拉起治理控制台"
    )
    parser.add_argument("--ui-port", type=int, default=None, help="Streamlit UI 端口")
    parser.add_argument("--ws-port", type=int, default=None, help="WebSocket 端口")
    parser.add_argument("--no-notify", action="store_true", help="跳过弹窗通知")
    parser.add_argument("--force", action="store_true", help="强制重启（即使已在运行）")
    args = parser.parse_args()

    # Check if already running
    if is_already_running() and not args.force:
        print("[auto_enforce] 治理控制台已在运行中，跳过启动")

        # Still discover & print the URL
        if PORT_FILE.exists():
            try:
                cfg = json.loads(PORT_FILE.read_text(encoding="utf-8"))
                print(f"[auto_enforce] 现有入口: {cfg.get('ui_url', 'N/A')}")
            except Exception:
                pass
        return

    # Clean up stale files
    for f in [PID_FILE]:
        try:
            if f.exists():
                f.unlink()
        except OSError:
            pass

    ui_port = args.ui_port or find_free_port(DEFAULT_UI_PORT)
    ws_port = args.ws_port or find_free_port(DEFAULT_WS_PORT)

    # Register cleanup
    atexit.register(cleanup)

    # Install dependencies if needed
    _ensure_deps()

    # Launch
    proc, ui_port, ws_port = launch_governance_ui(ui_port, ws_port)
    write_pid()

    # Give it a moment to initialize
    print("[auto_enforce] 等待控制台初始化...")
    time.sleep(3)

    url = f"http://localhost:{ui_port}"

    # Send notification if not suppressed
    if not args.no_notify:
        send_notification(url)

    print(f"[auto_enforce] 🏛️  治理控制台已在后台运行")
    print(f"[auto_enforce] 📡 UI: {url}")
    print(f"[auto_enforce] 🔗 WS: ws://localhost:{ws_port}")
    print(f"[auto_enforce] PID: {proc.pid}")
    print(f"[auto_enforce] 按 Ctrl+C 终止控制台\n")

    # Monitor subprocess
    try:
        while True:
            ret = proc.poll()
            if ret is not None:
                print(f"[auto_enforce] 控制台进程退出 (exitcode={ret})，重新拉起...")
                time.sleep(2)
                proc, ui_port, ws_port = launch_governance_ui(ui_port, ws_port)
                write_pid()
                time.sleep(2)
                if not args.no_notify:
                    send_notification(f"http://localhost:{ui_port}")
                continue
            time.sleep(5)
    except KeyboardInterrupt:
        print("\n[auto_enforce] 收到终止信号，正在关闭控制台...")
        try:
            proc.terminate()
            proc.wait(timeout=10)
        except Exception:
            try:
                proc.kill()
            except Exception:
                pass
        cleanup()
        print("[auto_enforce] 治理控制台已关闭")


def _ensure_deps():
    """Ensure required Python packages are installed."""
    required = {
        "streamlit": "streamlit",
        "websockets": "websockets",
    }
    missing = []
    for module, pkg in required.items():
        try:
            __import__(module)
        except ImportError:
            missing.append(pkg)

    if missing:
        print(f"[auto_enforce] 缺少依赖: {missing}，正在安装...")
        try:
            subprocess.check_call(
                [sys.executable, "-m", "pip", "install", "--quiet"] + missing,
                timeout=120,
            )
            print("[auto_enforce] 依赖安装完成")
        except Exception as e:
            print(f"[auto_enforce] ⚠️ 依赖安装失败: {e}")
            print("[auto_enforce] 请手动安装: pip install streamlit websockets")


# ============================================================
# Quick-launch helpers for VSC integration
# ============================================================
def vsc_startup_hook():
    """
    Called by VSC task or terminal profile on window start.
    Simply imports this module and runs main() in a non-blocking thread.
    """
    t = threading.Thread(target=main, daemon=True, name="auto-enforce")
    t.start()
    return t


if __name__ == "__main__":
    main()