"""script_generator — 脚本 / 对话稿生成模块。

负责：
- 根据情绪向量 + 知识库引用生成对话式回复
- 支持多语言输出（中 / 英 / 日 / 韩）
- 输出结构化脚本供前端渲染
"""


class ScriptGenerator:
    """InnerSage 对话脚本生成器。"""

    def __init__(self, locale: str = "zh"):
        self.locale = locale

    def generate_reply(self, insight: dict, tone: str = "calm") -> str:
        """根据灵性洞见生成最终回复文本。"""
        raise NotImplementedError("由 ZOO 实现")

    def set_locale(self, locale: str):
        """切换输出语言。"""
        self.locale = locale
