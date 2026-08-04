#!/usr/bin/env python3
"""Phase 3 首片试产 — 跨目录调度总线验证。

测试流程:
  1. 验证 GIT008 主控台 (port 8000) 在线
  2. 验证 OpenMontage Backlot (port 7890) 在线
  3. 测试 API 调度: 根目录 → git008_main_panel → OpenMontage Backlot
  4. 测试引擎发现: Linly-Talker runtime 可达性
"""

import json
import os
import sys
import urllib.request
import urllib.error
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent
PASS = 0
FAIL = 0


def check(label: str, ok: bool, detail: str = "") -> None:
    global PASS, FAIL
    if ok:
        PASS += 1
        print(f"  [PASS] {label}")
    else:
        FAIL += 1
        print(f"  [FAIL] {label} — {detail}")


def http_get(url: str, timeout: int = 5) -> tuple[int, str]:
    try:
        r = urllib.request.urlopen(url, timeout=timeout)
        return r.status, r.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", errors="replace")
    except Exception as e:
        return 0, str(e)


def http_post(url: str, data: dict, timeout: int = 10) -> tuple[int, str]:
    try:
        payload = json.dumps(data).encode()
        req = urllib.request.Request(url, data=payload, headers={"Content-Type": "application/json"})
        r = urllib.request.urlopen(req, timeout=timeout)
        return r.status, r.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", errors="replace")
    except Exception as e:
        return 0, str(e)


def main() -> int:
    global PASS, FAIL
    print("=" * 60)
    print("  Phase 3 — GIT008 跨目录调度总线首片试产")
    print("=" * 60)

    # ── 1. 基础设施检查 ─────────────────────────────────
    print("\n--- 1. 基础设施在线检查 ---")

    # 1a. GIT008 主控台
    status, body = http_get("http://127.0.0.1:8000/")
    check("GIT008 主控台 (port 8000) 可达", status == 200, f"HTTP {status}")

    # 1b. GIT008 状态 API
    status, body = http_get("http://127.0.0.1:8000/api/status")
    check("GIT008 /api/status 响应", status == 200, f"HTTP {status}")
    if status == 200:
        data = json.loads(body)
        print(f"    资产数: {data['asset_count']}, 引擎: {'就绪' if data['engine_ready'] else '离线'}"
              f", Backlot: {'运行中' if data['backlot_alive'] else '离线'}")

    # 1c. OpenMontage Backlot
    status, body = http_get("http://127.0.0.1:7890/api/health")
    check("OpenMontage Backlot (port 7890) 可达", status == 200, f"HTTP {status}")
    if status == 200:
        print(f"    Health: {body[:100]}")

    # 1d. CEO 引擎状态
    status, body = http_get("http://127.0.0.1:7890/api/ceo/status")
    check("CEO 引擎状态 API 响应", status == 200, f"HTTP {status}")
    if status == 200:
        data = json.loads(body)
        check("Linly-Talker 引擎已安装", data.get("engine_installed", False))
        print(f"    引擎路径: {data.get('engine_path', 'N/A')}")
        print(f"    入口脚本: {data.get('entry_points', [])}")

    # ── 2. 中央资产库检查 ───────────────────────────────
    print("\n--- 2. 中央资产库检查 ---")

    ceo_assets = REPO_ROOT / "assets" / "ceo"
    ceo_clones = REPO_ROOT / "assets" / "ceo_clones"

    check("assets/ceo/ 目录存在", ceo_assets.is_dir())
    check("assets/ceo_clones/ 目录存在", ceo_clones.is_dir())

    # ── 3. 桥接工具注册检查 ─────────────────────────────
    print("\n--- 3. OpenMontage 工具注册检查 ---")

    # Check via Backlot's API that the tool is registered
    try:
        import subprocess
        result = subprocess.run(
            [sys.executable, "-c", """
import sys; sys.path.insert(0, 'OpenMontage')
from tools.tool_registry import registry
registry.discover()
avatars = registry.get_by_capability('avatar')
for t in avatars:
    print(f"{t.name} | provider={t.provider} | status={t.get_status().value}")
"""],
            cwd=str(REPO_ROOT),
            capture_output=True, text=True, timeout=15,
        )
        output = result.stdout.strip()
        if "linly_talker_avatar" in output:
            check("LinlyTalkerAvatar 已在注册表中", True)
            for line in output.split("\n"):
                print(f"    {line}")
        else:
            check("LinlyTalkerAvatar 注册", False, f"未找到: {output}")
    except Exception as e:
        check("工具注册检查", False, str(e))

    # ── 4. API 调度测试 ─────────────────────────────────
    print("\n--- 4. API 跨目录调度测试 ---")

    # 4a. 测试 GIT008 → OpenMontage 状态传播
    status, body = http_get("http://127.0.0.1:8000/api/status")
    if status == 200:
        data = json.loads(body)
        check("GIT008 检测到 Backlot 在线", data.get("backlot_alive", False))
        check("GIT008 检测到渲染引擎", data.get("engine_ready", False))

    # 4b. 测试 Backlot CEO 面板可达
    status, body = http_get("http://127.0.0.1:7890/ceo")
    check("CEO 口播工厂面板可达", status == 200 and "CEO 口播工厂" in body, f"HTTP {status}")

    # 4c. 测试 POST (模拟文案下发)
    status, body = http_post("http://127.0.0.1:7890/api/ceo/publish", {
        "name": "test-ceo",
        "text": "GIT008 跨目录调度总线测试通过，OpenMontage 渲染子服务正常响应。",
        "voice_type": "EdgeTTS",
        "mode": "talk",
    })
    if status == 200:
        data = json.loads(body)
        check("CEO publish API 正常响应", True)
        print(f"    状态: {data.get('status')}")
        print(f"    消息: {data.get('message', '')[:100]}")
    else:
        check("CEO publish API 响应", False, f"HTTP {status}")

    # ── 5. 文件结构验证 ─────────────────────────────────
    print("\n--- 5. 文件结构完整性验证 ---")

    key_files = [
        "README.md",
        "git008_main_panel.py",
        "OpenMontage/PROJECT_CONTEXT.md",
        "OpenMontage/AGENT_GUIDE.md",
        "OpenMontage/tools/avatar/linly_talker_provider.py",
        "OpenMontage/backlot/app.py",
        "OpenMontage/backlot/server.py",
        "OpenMontage/backlot/ui/ceo.html",
        "OpenMontage/backlot/ui/index.html",
    ]
    for f in key_files:
        check(f"存在: {f}", (REPO_ROOT / f).is_file())

    # ── 结果 ────────────────────────────────────────────
    print(f"\n{'=' * 60}")
    total = PASS + FAIL
    print(f"  结果: {PASS}/{total} 通过")
    if FAIL == 0:
        print("  ✅ Phase 3 首片试产全部通过 — GIT008 跨目录调度总线正常")
    else:
        print(f"  ⚠️  存在 {FAIL} 个失败项")
    print(f"{'=' * 60}")

    return 0 if FAIL == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
