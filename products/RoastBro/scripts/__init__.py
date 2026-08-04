"""
RoastBro — RoastScript Engine
==============================
反讽吐槽脚本生成引擎。

模块职责：
1. 谷阿莫风格蒸馏 — 快速叙事 + 吐槽式总结
2. Captainpig 风格蒸馏 — 暴力逻辑拆解 + 讽刺
3. 反讽句式生成
4. 安全边界过滤（不吐槽真人）
5. 多风格切换与混合

输出：
    - 完整反讽脚本（安全 + 高节奏）
"""

from .roast_script_engine import RoastScriptEngine, RoastScript, ScriptSegment, StyleType

__all__ = ["RoastScriptEngine", "RoastScript", "ScriptSegment", "StyleType"]
