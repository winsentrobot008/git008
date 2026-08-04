"""knowledge_extractor — 知识抽取模块。

负责：
- 从清洗后的转录文本中提取关键概念、名言、案例
- 利用 LLM 进行摘要、分类与实体识别
- 输出结构化知识片段供 topic_cluster 聚类
"""


class KnowledgeExtractor:
    """知识抽取器。"""

    def __init__(self, llm_client: str = "openai"):
        self.llm_client = llm_client

    def extract(self, segments: list) -> list:
        """从文本段落中抽取知识片段列表。"""
        raise NotImplementedError("由 ZOO 实现")

    def summarize(self, segments: list, max_length: int = 300) -> str:
        """生成段落摘要。"""
        raise NotImplementedError("由 ZOO 实现")
