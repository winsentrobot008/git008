"""topic_cluster — 主题聚类与话题建模模块。

负责：
- 对抽取的知识片段进行语义聚类（sentence-transformers + faiss / HDBSCAN）
- 生成主题标签与层级结构
- 输出聚类结果供知识库构建
"""


class TopicCluster:
    """话题聚类器。"""

    def __init__(self, embedding_model: str = "paraphrase-multilingual-MiniLM-L12-v2"):
        self.embedding_model = embedding_model

    def fit(self, fragments: list) -> dict:
        """对知识片段进行聚类，返回 {topic: [fragments]} 结构。"""
        raise NotImplementedError("由 ZOO 实现")

    def summarize_topics(self, clusters: dict) -> list:
        """为每个聚类生成可读的主题摘要。"""
        raise NotImplementedError("由 ZOO 实现")
