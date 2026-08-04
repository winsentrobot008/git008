"""
Environment Check — 环境检测模块 (ASCII-safe)
===================================================
检测 Python/Streamlit/依赖/端口/wiki 状态。
All output uses ASCII-safe markers for GBK compatibility.
"""

import sys
import json
import subprocess
import socket
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
REPORT_FILE = ROOT / "env_report.json"

OK = "[OK]"
FAIL = "[FAIL]"
WARN = "[WARN]"


def check_python() -> dict:
    return {
        "installed": True,
        "version": sys.version.split()[0],
        "executable": sys.executable,
    }


def check_streamlit() -> dict:
    try:
        import streamlit
        return {"installed": True, "version": streamlit.__version__}
    except ImportError:
        return {"installed": False, "version": ""}


def check_dependencies() -> dict:
    req_file = ROOT / "requirements.txt"
    if not req_file.exists():
        return {"installed": False, "missing": ["requirements.txt not found"]}

    installed = {}
    missing = []
    for line in req_file.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        pkg = line.split(">=")[0].split("==")[0].strip()
        try:
            __import__(pkg.replace("-", "_"))
            installed[pkg] = True
        except ImportError:
            missing.append(pkg)
    return {"installed": len(missing) == 0, "missing": missing, "total": len(installed) + len(missing)}


def check_port(port: int = 8501) -> dict:
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.settimeout(2)
            result = sock.connect_ex(("127.0.0.1", port))
            return {"available": result != 0, "port": port, "in_use": result == 0}
    except Exception:
        return {"available": False, "port": port, "error": str(Exception())}


def check_wiki() -> dict:
    wiki_dir = ROOT / "second-brain" / "wiki"
    try:
        wiki_dir.mkdir(parents=True, exist_ok=True)
        test_file = wiki_dir / ".write_test"
        test_file.write_text("ok", encoding="utf-8")
        test_file.unlink()
        return {"writable": True, "path": str(wiki_dir)}
    except Exception:
        return {"writable": False, "path": str(wiki_dir)}


def run_all() -> dict:
    report = {
        "python": check_python(),
        "streamlit": check_streamlit(),
        "dependencies": check_dependencies(),
        "port_8501": check_port(8501),
        "wiki": check_wiki(),
    }
    report["all_ok"] = (
        report["streamlit"]["installed"]
        and report["dependencies"]["installed"]
        and report["wiki"]["writable"]
    )
    REPORT_FILE.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    return report


if __name__ == "__main__":
    report = run_all()
    status = f"{OK} ALL OK" if report["all_ok"] else f"{WARN} ISSUES FOUND"
    print(f"[EnvCheck] {status}")
    for key, val in report.items():
        if isinstance(val, dict):
            ok = val.get("installed") or val.get("available") or val.get("writable")
            icon = OK if ok else FAIL
            print(f"  {icon} {key}: {val}")
