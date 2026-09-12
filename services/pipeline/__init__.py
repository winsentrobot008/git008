"""Fetch → Process → Publish 工厂流水线编排（后台无人值守渲染闭环）。"""

from services.pipeline.factory_pipeline import PipelineReport, run_pipeline

__all__ = ["PipelineReport", "run_pipeline"]
