"""Agent 模块基本单元测试（占位）。"""

import unittest


class TestEmotionAgent(unittest.TestCase):
    """EmotionAgent 桩测试。"""

    def setUp(self):
        self.agent_path = "agents.emotion_agent"

    def test_import(self):
        """验证模块可导入。"""
        try:
            from agents.emotion_agent import EmotionAgent
            self.assertTrue(True)
        except ImportError:
            self.fail("EmotionAgent 导入失败")

    def test_analyze_raises(self):
        """确认 analyse 方法抛出 NotImplementedError。"""
        from agents.emotion_agent import EmotionAgent
        agent = EmotionAgent()
        with self.assertRaises(NotImplementedError):
            agent.analyze("hello")


class TestMysticAgent(unittest.TestCase):
    """MysticAgent 桩测试。"""

    def test_import(self):
        try:
            from agents.mystic_agent import MysticAgent
            self.assertTrue(True)
        except ImportError:
            self.fail("MysticAgent 导入失败")


class TestGrowthAgent(unittest.TestCase):
    """GrowthAgent 桩测试。"""

    def test_import(self):
        try:
            from agents.growth_agent import GrowthAgent
            self.assertTrue(True)
        except ImportError:
            self.fail("GrowthAgent 导入失败")


if __name__ == "__main__":
    unittest.main()
