"""distill_pipeline — 蒸馏流水线编排。

工作流：
  1. VideoIngest.from_youtube() / from_local()
  2. TranscriptParser.parse()
  3. KnowledgeExtractor.extract()
  4. TopicCluster.fit()
  5. SageWikiBuilder.build()

运行方式：
    python -m pipelines.distill_pipeline --source <url|path>
"""


class DistillPipeline:
    """内容蒸馏流水线。"""

    def __init__(self, config_path: str = "../config/sources.yaml"):
        self.config_path = config_path

    def run(self, source: str = None) -> dict:
        """执行完整蒸馏流程，返回处理摘要。"""
        raise NotImplementedError("由 ZOO 实现")

    def dry_run(self, source: str = None) -> list:
        """预检模式：列出将要执行的步骤而不实际运行。"""
        raise NotImplementedError("由 ZOO 实现")


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="InnerSage 蒸馏流水线")
    parser.add_argument("--source", type=str, help="视频 URL 或本地路径")
    args = parser.parse_args()

    pipeline = DistillPipeline()
    result = pipeline.run(args.source)
    print(result)
