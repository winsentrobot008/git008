from .base import BaseAgent

class StrategistAgent(BaseAgent):
    name = "军师"

    def analyze(self, raw_data):
        # 这里可调用大模型做真实打分，暂时返回固定分
        return {"score": 0.8, "recommendation": "建议进入数字市场"}
