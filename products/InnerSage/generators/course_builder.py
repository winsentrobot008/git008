"""course_builder — 结构化课程 / 冥想引导生成模块。

负责：
- 将知识库主题编排为渐进式课程
- 生成带时间轴的冥想引导脚本
- 输出课程 JSON / Markdown 供前端消费
"""


class CourseBuilder:
    """内圣课程构建器。"""

    def __init__(self):
        self.courses = {}

    def build_course(self, topic: str, levels: int = 3) -> dict:
        """为一个主题构建 n 级课程结构。"""
        raise NotImplementedError("由 ZOO 实现")

    def export(self, course_id: str, fmt: str = "json") -> str:
        """导出课程为指定格式。"""
        raise NotImplementedError("由 ZOO 实现")
