"""
creator_distillation — 成功博主技能蒸馏模块
==============================================
从高热度视频中提取特征，生成技能向量并存入 second-brain 知识库。

用法:
    distiller = CreatorDistillation(analyzer)
    vector = distiller.extract_patterns("video.mp4")
    distiller.save_to_second_brain(vector)
"""

from .creator_distillation import CreatorDistillation, SkillVector

__all__ = ["CreatorDistillation", "SkillVector"]
