#!/usr/bin/env python3
"""GIT008 根工厂总控：OpenRouter 免费模型任务分发 → 素材抓取 → 桌面闭环。

流程：
  1. 读取 config/config.toml（[llm] provider=openrouter / wire_api=chat_completions）
     与 config/models.json（google/gemini-2.0-flash-exp:free、
     deepseek/deepseek-r1:free 两个免费档模型）；
  2. 由 OpenRouter 免费模型做任务分发与决策（JSON 输出，低 Token）；
     LLM 不可用 / --offline 时回退规则分发（fetch/render/gui 关键词识别）；
  3. 优先走 factory_core.web_browser（bb-browser 登录态抓取素材）；
     任务涉及本地应用渲染 / 复杂桌面操作时，自动切入
     factory_core.computer_use（Computer Use）闭环执行。

用法：
  python master_pipeline.py --task "抓取知乎热榜文案并生成一条 CalorieAI 视频"
  python master_pipeline.py --task "用剪映打开草稿并导出" --gui-script actions.json
  python master_pipeline.py --offline --task "生成一条离线演示视频"
  python master_pipeline.py --list-models            # 界面下拉菜单可识别的模型列表
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from factory_core.computer_use import ComputerUse  # noqa: E402
from factory_core.llm import (  # noqa: E402
    LLMConfigError,
    OpenRouterClient,
    list_models_menu,
    load_llm_config,
    resolve_model,
)
from factory_core.web_browser import WebBrowser  # noqa: E402
from services.config import load_config  # noqa: E402
from services.pipeline.factory_pipeline import run_pipeline  # noqa: E402

DISPATCH_SYSTEM = (
    "你是 GIT008 根工厂任务调度器。根据用户任务选择唯一动作：\n"
    '- "fetch"：联网抓取素材/文案/热点（WebBrowser / bb-browser，登录态）；\n'
    '- "render"：调用 008-video-factory（Edge-TTS + FFmpeg）渲染视频；\n'
    '- "gui"：本地桌面应用操作（剪辑/渲染器/上传发布等复杂桌面动作，Computer Use）。\n'
    "只输出 JSON：{\"action\": \"fetch|render|gui\", \"reason\": \"一句话\", "
    '"params": {...}}。params 允许字段：'
    "fetch: adapter/query/max_items；render: product/target/resolution/background；"
    "gui: description。"
)

ALLOWED_ACTIONS = {"fetch", "render", "gui"}

DESKTOP_KEYWORDS = (
    "剪辑", "渲染器", "剪映", "capcut", "pr", "premiere", "obs", "桌面",
    "软件", "打开", "截图", "上传", "发布", "导出", "编辑器", "窗口",
)
RENDER_KEYWORDS = (
    "视频", "生成", "渲染", "合成", "短片", "广告片", "字幕", "旁白", "混音",
)


def rule_based_dispatch(task: str) -> dict[str, Any]:
    """LLM 不可用时的规则回退：桌面关键词 > 渲染关键词 > 抓取。"""
    lower = task.lower()
    if any(k in lower for k in DESKTOP_KEYWORDS):
        return {
            "action": "gui",
            "reason": "规则回退：任务含桌面应用关键词",
            "params": {"description": task},
        }
    if any(k in lower for k in RENDER_KEYWORDS):
        return {
            "action": "render",
            "reason": "规则回退：任务含视频渲染关键词",
            "params": {},
        }
    return {
        "action": "fetch",
        "reason": "规则回退：默认优先抓取素材",
        "params": {"max_items": 8},
    }


def llm_dispatch(client: OpenRouterClient, task: str, *, offline: bool) -> dict[str, Any] | None:
    """OpenRouter 免费模型分发；失败返回 None 由调用方回退规则。"""
    if offline or not client.is_configured():
        return None
    try:
        decision = client.chat_structured(
            f"用户任务：{task}",
            system=DISPATCH_SYSTEM,
            max_tokens=256,
        )
    except LLMConfigError as exc:
        print(f"[master] ⚠️ LLM 分发失败（{exc}），回退规则分发", file=sys.stderr)
        return None
    action = decision.get("action")
    if action not in ALLOWED_ACTIONS:
        print(f"[master] ⚠️ LLM 返回非法动作 {action!r}，回退规则分发", file=sys.stderr)
        return None
    decision["params"] = decision.get("params") or {}
    return decision


def _fetch_material(browser: WebBrowser, params: dict[str, Any], offline: bool) -> dict[str, Any]:
    manifest = browser.fetch_viral(
        max_items=int(params.get("max_items", 8)),
        offline=offline,
    )
    print(
        f"[master] fetch source={manifest.get('source')} items={len(manifest.get('items', []))} "
        f"fallback={manifest.get('fallback')}",
        file=sys.stderr,
    )
    return manifest


def _render_video(manifest: dict[str, Any], params: dict[str, Any], offline: bool) -> dict[str, Any]:
    report = run_pipeline(
        product=params.get("product"),
        target=params.get("target"),
        resolution=params.get("resolution", "1080x1920"),
        background=params.get("background", "ui"),
        offline=offline,
        fetch_fn=lambda **_kwargs: manifest,  # 复用已抓取清单，不重复抓取
        gui_script=None,
    )
    return report.to_dict()


def _gui_actions(computer_use: ComputerUse, params: dict[str, Any], gui_script: list[dict] | None) -> list[dict]:
    script = gui_script or params.get("actions") or [
        {"action": "activate_window", "args": {"title": params.get("description", "")[:80] or "未命名"}},
        {"action": "screenshot", "args": {"path": str(Path("runtime_data/gui/master_pipeline.png"))}},
    ]
    results = computer_use.execute_script(script)
    print(
        f"[master] gui actions={len(script)} "
        f"ok={sum(1 for r in results if r.get('ok'))}/{len(script)}",
        file=sys.stderr,
    )
    return results


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="master_pipeline",
        description="GIT008 根工厂总控（OpenRouter 分发 + bb-browser 抓取 + Computer Use 桌面闭环）",
    )
    parser.add_argument("--task", help="用户任务描述（自然语言）")
    parser.add_argument("--model", help="模型 id（默认 config/default_model，仅允许 :free）")
    parser.add_argument("--offline", action="store_true", help="跳过 LLM 与联网抓取（规则分发 + 离线模板）")
    parser.add_argument("--dry-run", action="store_true", help="Computer Use 只记录不注入输入")
    parser.add_argument("--gui-script", help="桌面动作 JSON 文件（gui 动作时使用）")
    parser.add_argument("--list-models", action="store_true", help="输出界面下拉菜单模型列表")
    args = parser.parse_args(argv)

    llm_cfg = load_llm_config()

    if args.list_models:
        print(json.dumps(
            {
                "provider": llm_cfg.provider,
                "wire_api": llm_cfg.wire_api,
                "models": list_models_menu(),
            },
            ensure_ascii=False,
            indent=2,
        ))
        return 0

    if not args.task:
        parser.error("--task 必填（或使用 --list-models）")

    try:
        model = resolve_model(args.model)
    except LLMConfigError as exc:
        print(f"[master] ❌ {exc}", file=sys.stderr)
        return 2

    client = OpenRouterClient(llm_cfg, model=model)
    print(
        f"[master] llm provider={llm_cfg.provider} wire_api={llm_cfg.wire_api} "
        f"model={client.model} key={'已配置' if client.is_configured() else '未配置'}",
        file=sys.stderr,
    )

    # 1) 任务分发：LLM 优先，规则兜底
    decision = llm_dispatch(client, args.task, offline=args.offline)
    dispatch_source = "openrouter"
    if decision is None:
        decision = rule_based_dispatch(args.task)
        dispatch_source = "rules"
    action = decision["action"]
    print(
        f"[master] dispatch source={dispatch_source} action={action} reason={decision.get('reason')}",
        file=sys.stderr,
    )

    # 2) 执行闭环
    browser = WebBrowser()
    steps: list[dict[str, Any]] = []
    ok = True
    artifact: str | None = None

    if action in ("fetch", "render"):
        manifest = _fetch_material(browser, decision.get("params", {}), args.offline)
        steps.append({"step": "fetch", "ok": bool(manifest.get("items")) or bool(manifest.get("fallback")),
                      "source": manifest.get("source"), "fallback": manifest.get("fallback")})
        if action == "fetch":
            steps[-1]["manifest"] = manifest
        else:
            report = _render_video(manifest, decision.get("params", {}), args.offline)
            steps.append({"step": "render", "ok": report.get("ok"), "report": report})
            ok = ok and bool(report.get("ok"))
            if report.get("artifacts"):
                artifact = report["artifacts"][-1]

    elif action == "gui":
        settings = load_config().computer_use
        if args.dry_run:
            settings.dry_run = True
        computer_use = ComputerUse(settings=settings)
        gui_script = None
        if args.gui_script:
            gui_script = json.loads(Path(args.gui_script).read_text(encoding="utf-8"))
        results = _gui_actions(computer_use, decision.get("params", {}), gui_script)
        steps.append({"step": "gui", "ok": all(r.get("ok") for r in results), "results": results})
        ok = ok and all(r.get("ok") for r in results)

    report = {
        "ok": ok,
        "provider": llm_cfg.provider,
        "wire_api": llm_cfg.wire_api,
        "model": client.model,
        "dispatch": {"source": dispatch_source, "action": action, "reason": decision.get("reason")},
        "steps": steps,
        "artifact": artifact,
        "fallback_used": any(s.get("fallback") for s in steps) or dispatch_source == "rules",
    }
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
