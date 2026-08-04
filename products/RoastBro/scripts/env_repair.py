"""
Environment Repair — 自动修复模块 (No emoji, ASCII-safe)
========================================================
自动安装 Streamlit、修复依赖、切换端口、创建目录。
All output uses ASCII-only markers to avoid GBK encoding errors.
"""

import sys
import subprocess
import socket
from pathlib import Path

# Force UTF-8 encoding for stdout/stderr to handle unicode safely
try:
    sys.stdout.reconfigure(encoding='utf-8')
except Exception:
    pass
try:
    sys.stderr.reconfigure(encoding='utf-8')
except Exception:
    pass

ROOT = Path(__file__).resolve().parent.parent

OK = "[OK]"
FAIL = "[FAIL]"
WARN = "[WARN]"
INFO = "[INFO]"


def repair_streamlit() -> bool:
    try:
        import streamlit
        print(f"{OK} Streamlit v{streamlit.__version__} already installed")
        return True
    except ImportError:
        print(f"{INFO} Installing streamlit...")
        subprocess.check_call([sys.executable, "-m", "pip", "install", "streamlit"])
        print(f"{OK} Streamlit installed")
        return True


def repair_dependencies() -> bool:
    req_file = ROOT / "requirements.txt"
    if not req_file.exists():
        print(f"{FAIL} requirements.txt not found")
        return False
    print(f"{INFO} Installing dependencies...")
    subprocess.check_call([sys.executable, "-m", "pip", "install", "-r", str(req_file)])
    print(f"{OK} Dependencies installed")
    return True


def check_port(port: int = 8501) -> bool:
    """
    Check if a specific port is available using socket.
    Returns True if the port is available (not in use).
    """
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.settimeout(2)
            result = sock.connect_ex(('localhost', port))
            if result == 0:
                print(f"{OK} Port {port} is in use (service running)")
                return False  # port is in use -> not available
            else:
                print(f"{OK} Port {port} is available")
                return True   # port is available
    except Exception as e:
        print(f"{WARN} Port check error: {e}")
        return True


def find_available_port(start: int = 8501) -> int:
    """Find the first available port starting from `start`."""
    for port in range(start, start + 10):
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
                sock.settimeout(1)
                result = sock.connect_ex(("127.0.0.1", port))
                if result != 0:
                    print(f"{OK} Available port found: {port}")
                    return port
        except Exception:
            return start
    print(f"{WARN} No available port found, returning {start}")
    return start


def repair_wiki() -> bool:
    wiki_dir = ROOT / "second-brain" / "wiki"
    try:
        wiki_dir.mkdir(parents=True, exist_ok=True)
        print(f"{OK} Wiki directory ready: {wiki_dir}")
        return True
    except Exception as e:
        print(f"{FAIL} Cannot create wiki: {e}")
        return False


def repair_all() -> dict:
    print("=" * 50)
    print("  RoastBro Standalone - Auto Repair")
    print("=" * 50)

    streamlit_ok = repair_streamlit()
    deps_ok = repair_dependencies()
    port_available = check_port(8501)
    available_port = find_available_port()
    wiki_ok = repair_wiki()

    results = {
        "streamlit": streamlit_ok,
        "dependencies": deps_ok,
        "port_8501_available": port_available,
        "port_8501": available_port,
        "wiki": wiki_ok,
    }

    print()
    print(f"  Repairs complete.")
    print(f"  Port 8501 available: {port_available}")
    print(f"  Recommended port: {available_port}")
    print()
    return results


if __name__ == "__main__":
    repair_all()
