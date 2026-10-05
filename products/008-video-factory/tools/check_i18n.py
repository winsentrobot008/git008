"""i18n 完整性门禁（零 Node 版，语义对齐 008ai-landing 的 check-i18n-integrity.mjs）。

校验三件事：
  1. zh / en 字典 key 集合完全一致（对称性）；
  2. 前端源码里 `t("...")` 引用的 key 在两份字典中都存在；
  3. 无空字符串翻译。

    python products/008-video-factory/tools/check_i18n.py
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

PRODUCT_ROOT = Path(__file__).resolve().parents[1]
WEB = PRODUCT_ROOT / "web"
LOCALES = WEB / "locales"
JS_ROOT = WEB / "js"

_T_CALL = re.compile(r"""\bt\(\s*["'`]([a-zA-Z0-9_.]+)["'`]""")
_TEMPLATE = re.compile(r"""\bt\(\s*`([a-zA-Z0-9_.]+)\.\$\{""")

# 运行时动态拼接的 key 前缀（如 inspector.stage.${stage} / check.${name}），单独白名单
DYNAMIC_PREFIXES = ("inspector.stage.", "check.")


def flatten(node, prefix=""):
    out = {}
    for key, value in node.items():
        path = f"{prefix}.{key}" if prefix else key
        if isinstance(value, dict):
            out.update(flatten(value, path))
        else:
            out[path] = value
    return out


def main() -> int:
    problems: list[str] = []
    dicts = {}
    for lang in ("zh", "en"):
        path = LOCALES / f"{lang}.json"
        if not path.exists():
            problems.append(f"缺少字典：{path}")
            continue
        dicts[lang] = flatten(json.loads(path.read_text(encoding="utf-8")))

    if len(dicts) != 2:
        print("\n".join(problems))
        return 1

    zh, en = dicts["zh"], dicts["en"]
    only_zh = sorted(set(zh) - set(en))
    only_en = sorted(set(en) - set(zh))
    if only_zh:
        problems.append(f"仅 zh 存在：{only_zh[:8]}")
    if only_en:
        problems.append(f"仅 en 存在：{only_en[:8]}")

    empty = sorted(k for k, v in {**zh, **en}.items() if not str(v).strip())
    if empty:
        problems.append(f"存在空翻译：{empty[:8]}")

    known = set(zh) | set(en)
    used: dict[str, set[str]] = {}
    for js in JS_ROOT.rglob("*.js"):
        text = js.read_text(encoding="utf-8")
        for match in _T_CALL.finditer(text):
            used.setdefault(match.group(1), set()).add(js.name)
        for match in _TEMPLATE.finditer(text):
            prefix = match.group(1) + "."
            if not any(prefix.startswith(p) for p in DYNAMIC_PREFIXES):
                problems.append(f"{js.name}: 动态 key 前缀未登记：{prefix}")

    missing = sorted(
        key
        for key, files in used.items()
        if key not in known and not any(key.startswith(p.rstrip(".")) for p in DYNAMIC_PREFIXES)
    )
    if missing:
        details = [f"{k} ({','.join(sorted(used[k]))})" for k in missing[:10]]
        problems.append(f"代码引用了字典中不存在的 key：{details}")

    dynamic_keys = sorted(k for k in known if any(k.startswith(p) for p in DYNAMIC_PREFIXES))
    if not problems:
        print(
            f"[i18n] OK — zh/en 各 {len(zh)} 个 key；代码引用 {len(used)} 个；"
            f"动态命名空间 {len(dynamic_keys)} 个"
        )
        return 0

    print("[i18n] FAILED:")
    for problem in problems:
        print(f"  - {problem}")
    return 1


if __name__ == "__main__":
    sys.exit(main())