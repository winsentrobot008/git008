"""persona_voice — 人格音色与口吻适配模块。

负责：
- 根据 config/persona.yaml 定义的心性宪法调整输出口吻
- 维护多个"声线"配置（慈祥、冷静、鼓舞、幽默）
- 输出口吻标签供 ScriptGenerator 使用
"""


class PersonaVoice:
    """人格音色适配器。"""

    def __init__(self, persona_path: str = "../config/persona.yaml"):
        self.persona_path = persona_path

    def load_persona(self) -> dict:
        """加载心性宪法配置。"""
        raise NotImplementedError("由 ZOO 实现")

    def apply_tone(self, text: str, tone: str = "calm") -> str:
        """对文本进行口吻后处理。"""
        raise NotImplementedError("由 ZOO 实现")
