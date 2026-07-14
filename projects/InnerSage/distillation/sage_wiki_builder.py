"""sage_wiki_builder — 内圣知识库构建模块。

负责：
- 将聚类后的主题写入 knowledge_base/wiki/ 下的 Markdown 文件
- 维护索引（topic → file mapping）
- 支持增量更新与冲突合并
"""


class SageWikiBuilder:
    """内圣知识库构建器。"""

    def __init__(self, wiki_dir: str = "../knowledge_base/wiki"):
        self.wiki_dir = wiki_dir

    def build(self, clusters: dict) -> list:
        """将聚类结果写入知识库文件，返回创建的文件路径列表。"""
        raise NotImplementedError("由 ZOO 实现")

    def update_index(self) -> dict:
        """重建 / 刷新知识库索引。"""
        raise NotImplementedError("由 ZOO 实现")
