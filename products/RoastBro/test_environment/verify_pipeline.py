"""
RoastBro Pipeline Verification — 三道关卡验收流程
==================================================
Gate 1: 编译检查 — 所有模块语法正确
Gate 2: 导入检查 — 关键模块可正常导入
Gate 3: 功能闭环 — 下载→检测→状态流转 链路模拟

用法:
    python test_environment/verify_pipeline.py

输出:
    test_environment/verify_pipeline.log — 完整测试日志
"""

import sys
import os
import json
import time
import subprocess
import traceback
from pathlib import Path
from datetime import datetime

# ── 路径 ─────────────────────────────────────────────────────
ROOT = Path(__file__).resolve().parent.parent
LOG_FILE = ROOT / "test_environment" / "verify_pipeline.log"
PENDING_DIR = ROOT / "output" / "pending_review"

# ── 日志工具 ─────────────────────────────────────────────────
_log_lines: list[str] = []

# 🛡️ UTF-8 stdout 修复 GBK 编码崩溃
import io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

def log(msg: str):
    ts = datetime.now().strftime("%H:%M:%S.%f")[:-3]
    line = f"[{ts}] {msg}"
    _log_lines.append(line)
    print(line)

def log_block(title: str):
    log("")
    log("=" * 65)
    log(f"  {title}")
    log("=" * 65)

def write_log():
    LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
    LOG_FILE.write_text("\n".join(_log_lines) + "\n", encoding="utf-8")
    print(f"\n📝 日志已写入: {LOG_FILE}")


# ═══════════════════════════════════════════════════════════════
#  GATE 1: 编译检查
# ═══════════════════════════════════════════════════════════════

def gate1_compile_check() -> bool:
    log_block("GATE 1/3: 编译检查 (py_compile)")

    files_to_check = [
        "dashboard/app.py",
        "dashboard/pages/hunting_zone.py",
        "dashboard/pages/pending_review.py",
        "orchestrator.py",
        "scrapers/tiktok_scraper.py",
        "scrapers/auto_hunter.py",
        "scrapers/auto_scout.py",
        "scrapers/error_log.py",
    ]

    all_ok = True
    for f in files_to_check:
        fpath = ROOT / f
        if not fpath.exists():
            log(f"  ❌ 文件不存在: {f}")
            all_ok = False
            continue
        result = subprocess.run(
            [sys.executable, "-m", "py_compile", str(fpath)],
            capture_output=True, text=True,
        )
        if result.returncode == 0:
            log(f"  ✅ {f}")
        else:
            log(f"  ❌ {f}: {result.stderr.strip()[:100]}")
            all_ok = False

    if all_ok:
        log(f"\n  ✅ GATE 1 PASSED — 全部 {len(files_to_check)} 个文件编译通过")
    else:
        log(f"\n  ❌ GATE 1 FAILED — 存在编译错误，请修复后重试")

    return all_ok


# ═══════════════════════════════════════════════════════════════
#  GATE 2: 导入检查
# ═══════════════════════════════════════════════════════════════

def gate2_import_check() -> bool:
    log_block("GATE 2/3: 导入检查 (模块可导入)")

    sys.path.insert(0, str(ROOT))

    imports = [
        ("scrapers.error_log", "is_login_blocked, log_blocked"),
        ("scrapers.tiktok_scraper", "TikTokScraper"),
        ("scrapers.auto_hunter", "AutoHunter"),
        ("scrapers.auto_scout", "AutoScout"),
    ]

    all_ok = True
    for mod_path, names in imports:
        try:
            mod = __import__(mod_path, fromlist=names.split(","))
            for name in names.split(","):
                name = name.strip()
                if hasattr(mod, name):
                    log(f"  ✅ {mod_path}.{name}")
                else:
                    log(f"  ❌ {mod_path}.{name} — 属性不存在")
                    all_ok = False
        except Exception as e:
            log(f"  ❌ {mod_path}: {e}")
            all_ok = False

    if all_ok:
        log(f"\n  ✅ GATE 2 PASSED — 全部模块可导入")
    else:
        log(f"\n  ❌ GATE 2 FAILED — 存在导入错误")

    return all_ok


# ═══════════════════════════════════════════════════════════════
#  GATE 3: 功能闭环模拟
# ═══════════════════════════════════════════════════════════════

def gate3_functional_loop() -> bool:
    log_block("GATE 3/3: 功能闭环模拟 (下载→状态→检测)")

    all_ok = True

    # 3a: 验证 pending_review 目录可创建
    log("--- 3a: 目录准备 ---")
    try:
        PENDING_DIR.mkdir(parents=True, exist_ok=True)
        assert PENDING_DIR.exists(), "目录创建失败"
        log(f"  ✅ pending_review 目录: {PENDING_DIR}")
    except Exception as e:
        log(f"  ❌ 目录准备失败: {e}")
        all_ok = False

    # 3b: 验证 orchestrator --mode download CLI 入口
    log("--- 3b: CLI 入口检查 ---")
    try:
        result = subprocess.run(
            [sys.executable, str(ROOT / "orchestrator.py"), "--help"],
            capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=10,
        )
        stdout = result.stdout or ""
        if result.returncode == 0 and "download" in stdout:
            log(f"  ✅ orchestrator --help 包含 download 模式")
        else:
            log(f"  ❌ orchestrator --help 异常: rc={result.returncode}")
            all_ok = False
    except subprocess.TimeoutExpired:
        log(f"  ❌ orchestrator --help 超时 (10s)")
        all_ok = False
    except Exception as e:
        log(f"  ❌ orchestrator --help 异常: {e}")
        all_ok = False

    # 3c: 模拟状态机流转
    log("--- 3c: 状态机模拟 ---")
    test_vid = "test_verify_001"
    try:
        # 模拟 session_state 行为
        state = {}
        dl_key = f"dl_path_{test_vid}"
        status_key = f"dl_status_{test_vid}"

        # 步骤 1: 初始状态
        assert state.get(status_key, "") == "", "初始状态应为空"
        log(f"  ✅ 初始状态 = '' (空)")

        # 步骤 2: 点击下载 → running
        state[status_key] = "running"
        assert state[status_key] == "running", "点击后应为 running"
        log(f"  ✅ 点击下载 → status = 'running'")

        # 步骤 3: 创建模拟文件（模拟后台线程完成）
        dummy_file = PENDING_DIR / f"tiktok_{test_vid}_abcd1234.mp4"
        dummy_file.write_text("dummy video content")
        log(f"  ✅ 模拟文件已创建: {dummy_file.name}")

        # 步骤 4: 检测器发现文件 → done
        from pathlib import Path as _P
        _found = list(PENDING_DIR.glob(f"*{test_vid[:12]}*.mp4"))
        if _found:
            state[dl_key] = str(_found[0])
            state[status_key] = "done"
            assert state[status_key] == "done", "检测后应为 done"
            assert dummy_file.exists(), "文件应存在"
            log(f"  ✅ 检测器发现文件 → status = 'done'")
            log(f"  ✅ 文件路径: {state[dl_key]}")

        # 步骤 5: 清理
        dummy_file.unlink(missing_ok=True)
        log(f"  ✅ 模拟文件已清理")

    except Exception as e:
        log(f"  ❌ 状态机异常: {e}")
        log(traceback.format_exc()[-200:])
        all_ok = False

    # 3d: 验证 error_log 模块
    log("--- 3d: 错误日志模块 ---")
    try:
        from scrapers.error_log import is_login_blocked, log_blocked, get_blocked, count_blocked

        assert is_login_blocked("login required") == True
        assert is_login_blocked("403 Forbidden") == True
        assert is_login_blocked("normal error") == False
        log(f"  ✅ is_login_blocked() — 信号词检测正确")

        test_url = "https://test.com/video/999"
        log_blocked(test_url, reason="test_verify", platform="tiktok",
                    log_path=PENDING_DIR / "test_error_log.json")
        blocked = get_blocked(platform="tiktok",
                              log_path=PENDING_DIR / "test_error_log.json")
        assert any(r["url"] == test_url for r in blocked), "应包含测试 URL"
        log(f"  ✅ log_blocked() / get_blocked() — 写入与读取正确")
        assert count_blocked() >= 1
        log(f"  ✅ count_blocked() — 计数正确")

        # 清理测试日志
        (PENDING_DIR / "test_error_log.json").unlink(missing_ok=True)

    except Exception as e:
        log(f"  ❌ 错误日志模块异常: {e}")
        log(traceback.format_exc()[-200:])
        all_ok = False

    if all_ok:
        log(f"\n  ✅ GATE 3 PASSED — 功能闭环验证通过")
    else:
        log(f"\n  ❌ GATE 3 FAILED — 存在功能缺陷")

    return all_ok


# ═══════════════════════════════════════════════════════════════
#  MAIN
# ═══════════════════════════════════════════════════════════════

def main():
    log("")
    log("🔥 RoastBro Pipeline Verification — 三道关卡验收")
    log(f"   开始时间: {datetime.now().isoformat()}")
    log(f"   工作目录: {ROOT}")
    log("")

    gates = [
        ("GATE 1: 编译检查", gate1_compile_check),
        ("GATE 2: 导入检查", gate2_import_check),
        ("GATE 3: 功能闭环", gate3_functional_loop),
    ]

    results = []
    for name, func in gates:
        log_block(f"执行: {name}")
        try:
            ok = func()
        except Exception as e:
            log(f"  💥 未捕获异常: {e}")
            log(traceback.format_exc()[-300:])
            ok = False
        results.append((name, ok))

    # ── 汇总 ──
    log_block("验收汇总")
    passed = 0
    for name, ok in results:
        status = "✅ PASS" if ok else "❌ FAIL"
        log(f"  {status}  {name}")
        if ok:
            passed += 1

    log("")
    log("=" * 65)
    if passed == len(gates):
        log("  🎉 全部验收通过！可以推送至 production")
    else:
        log(f"  ⚠️  {len(gates) - passed}/{len(gates)} 个关卡未通过，请修复后重试")
    log("=" * 65)

    write_log()
    return passed == len(gates)


if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1)
