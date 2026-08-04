"""
RoastBro — Content Brain Module
=================================
第二大脑记忆与知识桥接模块。

通过 brain_api.py 提供的统一接口，
将 second-brain/ 的知识管理能力挂载到 RoastBro 内容工厂体系中。

使用方式：
    from brain.brain_api import ContentBrain
    brain = ContentBrain()
    brain.save_memory("roast_style", "谷阿莫风格笔记...")
    results = brain.search("反讽 吐槽 风格")
    topics = brain.get_topics()
"""

from .brain_api import ContentBrain

__all__ = ["ContentBrain"]
