"""bb-browser 适配器（MCP/CLI 双通道）。

bb-browser（BadBoy Browser）：「Your browser is the API」——通过本机真实 Chrome 的
登录态（Cookie/Session）执行站点 adapter，输出结构化 JSON（全部命令支持 --json）。

通道优先级（逐级回退）：
  1. CLI 直连  bb-browser <cmd> --json
  2. daemon    bb-browser daemon start（auto_start_daemon=True 时自动拉起）后重试
  3. OpenClaw  bb-browser <cmd> --openclaw（复用 OpenClaw 浏览器实例）
  4. 本地模板  fetchers 层回退（本模块返回 fallback="local-template" 语义）

适配器不引入任何外部 HTTP 客户端：全部通过 subprocess 调用 bb-browser CLI，
与现有 Python/TypeScript 脚本解耦；输出解析同时支持单对象 JSON 与 NDJSON。
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import time
from pathlib import Path
from typing import Any, Sequence

from services.common.logging import get_logger
from services.common.results import CommandResult, fail_result, ok_result
from services.config import BbBrowserSettings

logger = get_logger("crawler.bb_browser")

_NPM_GLOBAL_CANDIDATES = (
    Path(os.environ.get("APPDATA", "")) / "npm" / "bb-browser.cmd",
    Path(os.environ.get("APPDATA", "")) / "npm" / "bb-browser",
)


def discover_bin(configured: str | None = None) -> str | None:
    """发现 bb-browser 可执行文件：显式配置 > PATH > npm 全局 shim。"""
    if configured and Path(configured).exists():
        return str(Path(configured).resolve())
    if configured:
        found = shutil.which(configured)
        if found:
            return found
    found = shutil.which("bb-browser")
    if found:
        return found
    for candidate in _NPM_GLOBAL_CANDIDATES:
        if candidate.exists():
            return str(candidate)
    return None


def parse_bb_output(raw: str | None) -> Any:
    """解析 bb-browser 输出：单 JSON / 嵌套 result / NDJSON / 尾部 JSON 块。

    优先保序（NDJSON 行保留为列表），保证低 Token 投影后仍是结构化数据。
    """
    if not raw or not raw.strip():
        return None
    text = raw.strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    # NDJSON：逐行尝试
    rows: list[Any] = []
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            rows.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    if rows:
        # 单行 JSON（含日志前缀包裹）直接返回对象；多行保留 NDJSON 列表
        return rows[0] if len(rows) == 1 else rows

    # 日志前缀包裹的 JSON：截取最后一个 {...} / [...] 块
    for pattern in (r"\{.*\}", r"\[.*\]"):
        match = re.search(pattern, text, flags=re.DOTALL)
        if match:
            try:
                return json.loads(match.group(0))
            except json.JSONDecodeError:
                continue
    return None


class BbBrowserClient:
    """bb-browser CLI 适配器。线程安全不保证，单线程流水线使用即可。"""

    def __init__(self, settings: BbBrowserSettings | None = None) -> None:
        self.settings = settings or BbBrowserSettings()
        self.bin = discover_bin(self.settings.bin)
        self._daemon_checked = False

    # ------------------------------------------------------------------
    # 基础能力
    # ------------------------------------------------------------------
    @property
    def available(self) -> bool:
        return self.bin is not None

    def version(self) -> CommandResult:
        return self._run(["--version"], json_mode=False)

    def daemon_status(self) -> CommandResult:
        result = self._run(["daemon", "status", "--json"], json_mode=True)
        if not result.ok:
            return result
        data = result.data
        # daemon status 以 running 字段为权威判定（即使 CLI 退出码为 0）
        if isinstance(data, dict):
            if data.get("running") is False:
                return fail_result(
                    "daemon 未运行",
                    fallback="local-template",
                    raw=result.raw,
                )
            status = data.get("status")
            if status and str(status).lower() not in {"running", "ok", "active", "started"}:
                return fail_result(
                    f"daemon 状态异常: {status}",
                    fallback="local-template",
                    raw=result.raw,
                )
        return result

    def ensure_daemon(self) -> CommandResult:
        """确保 daemon 运行（未运行且允许时自动拉起，最多轮询 5 次）。"""
        if not self.available:
            return fail_result("bb-browser 未安装", fallback="local-template")
        status = self.daemon_status()
        if status.ok:
            return ok_result(status.data, raw=status.raw)
        if not self.settings.auto_start_daemon:
            return fail_result(
                f"daemon 未运行且 auto_start_daemon=False：{status.error}",
                fallback="local-template",
            )
        start = self._run(["daemon", "start"], json_mode=True)
        if not start.ok:
            return fail_result(
                f"daemon 启动失败：{start.error}",
                fallback="local-template",
                raw=start.raw,
            )
        for _ in range(5):
            time.sleep(1.0)
            status = self.daemon_status()
            if status.ok:
                return ok_result(status.data, raw=status.raw)
        return fail_result("daemon 启动后状态未就绪", fallback="local-template")

    def site_list(self) -> CommandResult:
        """列出可用站点 adapter（社区库 103+ 命令）。"""
        return self._run(["site", "list", "--json"], json_mode=True)

    # ------------------------------------------------------------------
    # 站点 adapter（结构化数据主力通道）
    # ------------------------------------------------------------------
    def run_site(
        self,
        adapter: str,
        args: Sequence[str] = (),
        *,
        jq: str | None = None,
        limit: int | None = None,
    ) -> CommandResult:
        """执行站点 adapter，如 twitter/search、zhihu/hot、bilibili/popular。

        jq 投影用于控制输出字段（低 Token）；limit 通过 --limit 收敛条数。
        """
        cmd: list[str] = ["site", adapter, *[str(a) for a in args]]
        if jq:
            cmd += ["--jq", jq]
        if limit:
            cmd += ["--limit", str(limit)]
        result = self._run(cmd, json_mode=True)
        if result.ok:
            return result
        if self.settings.openclaw_fallback:
            openclaw = self._run([*cmd, "--openclaw"], json_mode=True)
            if openclaw.ok:
                return ok_result(openclaw.data, raw=openclaw.raw)
        return fail_result(
            f"site {adapter} 失败：{result.error}",
            fallback="local-template",
            raw=result.raw,
        )

    # ------------------------------------------------------------------
    # 浏览器操作（open/get/eval，供复杂 DOM 兜底）
    # ------------------------------------------------------------------
    def open(self, url: str, *, tab: bool = False) -> CommandResult:
        cmd = ["open", url]
        if tab:
            cmd.append("--tab")
        return self._run(cmd, json_mode=True)

    def get_text(self, ref: str | None = None, tab: str | None = None) -> CommandResult:
        cmd = ["get", "text"]
        if ref:
            cmd.append(ref)
        return self._run(cmd, json_mode=True, tab=tab)

    def eval_js(self, js: str, tab: str | None = None) -> CommandResult:
        return self._run(["eval", js], json_mode=True, tab=tab)

    def fetch_authenticated(self, url: str) -> CommandResult:
        """带登录态的同源 fetch（adapter 内部等价物，页内 cookie 自动携带）。"""
        return self._run(["fetch", url, "--json"], json_mode=True)

    def health(self) -> dict[str, Any]:
        """聚合健康状态：版本 / daemon / 可用 adapter 数量 / 浏览器可达性。"""
        report: dict[str, Any] = {
            "available": self.available,
            "bin": self.bin,
            "version": None,
            "daemon": {"ok": False, "detail": None},
            "browser_reachable": False,
            "adapter_count": 0,
        }
        if not self.available:
            return report
        version = self.version()
        report["version"] = version.data if version.ok else version.error
        daemon = self.ensure_daemon()
        report["daemon"] = {
            "ok": daemon.ok,
            "detail": daemon.data if daemon.ok else daemon.error,
        }
        if daemon.ok:
            # browser status 反映 CDP 侧 Chrome 响应状态
            browser = self._run(["status", "--json"], json_mode=True)
            browser_data = browser.data if browser.ok else None
            report["browser_reachable"] = browser.ok and not (
                isinstance(browser_data, dict) and browser_data.get("running") is False
            )
            report["browser_detail"] = browser_data if browser.ok else browser.error
        sites = self.site_list()
        if sites.ok:
            data = sites.data
            if isinstance(data, list):
                report["adapter_count"] = len(data)
            elif isinstance(data, dict):
                report["adapter_count"] = len(data)
        return report

    # ------------------------------------------------------------------
    # 内部执行
    # ------------------------------------------------------------------
    def _run(
        self,
        args: Sequence[str],
        *,
        json_mode: bool = True,
        tab: str | None = None,
        timeout: int | None = None,
    ) -> CommandResult:
        started = time.time()
        if not self.available:
            return fail_result("bb-browser 未安装或不在 PATH", fallback="local-template")
        full: list[str] = [str(a) for a in args]
        if json_mode and "--json" not in full:
            full.append("--json")
        if tab and "--tab" not in full:
            full += ["--tab", tab]

        cmd: list[str]
        if self.bin.lower().endswith((".cmd", ".bat")):  # npm Windows shim
            comspec = os.environ.get("COMSPEC") or "cmd.exe"
            cmd = [comspec, "/c", self.bin, *full]
        else:
            cmd = [self.bin, *full]

        try:
            proc = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=timeout or self.settings.timeout,
                check=False,
            )
        except (OSError, subprocess.TimeoutExpired) as exc:
            elapsed = int((time.time() - started) * 1000)
            return fail_result(
                f"{type(exc).__name__}: {exc}",
                fallback="local-template",
                duration_ms=elapsed,
            )
        elapsed = int((time.time() - started) * 1000)
        raw = (proc.stdout or "").strip() + (("\n" + proc.stderr.strip()) if proc.stderr and proc.stderr.strip() else "")
        if proc.returncode != 0:
            return fail_result(
                f"exit={proc.returncode}",
                fallback="local-template",
                raw=raw[:4000],
                duration_ms=elapsed,
            )
        data = parse_bb_output(proc.stdout)
        if json_mode and data is None:
            return fail_result(
                "输出非 JSON（daemon/CDP 未就绪？）",
                fallback="local-template",
                raw=raw[:4000],
                duration_ms=elapsed,
            )
        return ok_result(data, raw=raw[:4000], duration_ms=elapsed) if json_mode else CommandResult(
            ok=True, data=raw, raw=raw[:4000], duration_ms=elapsed
        )


def normalize_site_rows(rows: Any) -> list[dict[str, Any]]:
    """把 bb-browser site 输出归一化为条目列表（dict 优先，字符串退化处理）。"""
    if rows is None:
        return []
    if isinstance(rows, dict):
        for key in ("items", "results", "data", "list", "tweets", "videos"):
            if isinstance(rows.get(key), list):
                return normalize_site_rows(rows[key])
        return [rows]
    if isinstance(rows, list):
        items: list[dict[str, Any]] = []
        for row in rows:
            if isinstance(row, dict):
                items.append(row)
            elif isinstance(row, str):
                items.append({"text": row})
        return items
    return []


__all__ = ["BbBrowserClient", "discover_bin", "parse_bb_output", "normalize_site_rows"]
