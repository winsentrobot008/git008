"""
Creator Distillation — 成功博主技能蒸馏引擎
==============================================
分析高热度视频特征，提取技能向量并存入 second-brain 知识库。
"""

from dataclasses import dataclass, field
from pathlib import Path
from typing import List, Optional, Dict, Any
from datetime import datetime
import json, re


ROOT = Path(__file__).resolve().parent.parent.parent
SECOND_BRAIN_WIKI = ROOT.parent / "second-brain" / "wiki"
CREATOR_PATTERNS_FILE = SECOND_BRAIN_WIKI / "creator_patterns.md"


@dataclass
class SkillVector:
    """技能向量"""
    structure: float = 0.0       # 结构完整度 (0-1)
    emotion: float = 0.0         # 情绪曲线 (0-1)
    pacing: float = 0.0          # 节奏把控 (0-1)
    creator: str = "unknown"
    platform: str = ""

    @property
    def overall(self) -> float:
        return round((self.structure + self.emotion + self.pacing) / 3, 2)


class CreatorDistillation:
    """
    博主技能蒸馏器。

    用法:
        distiller = CreatorDistillation(analyzer)
        vector = distiller.extract_patterns("video.mp4")
        distiller.save_to_second_brain(vector)
    """

    def __init__(self, analyzer=None):
        self.analyzer = analyzer

    def extract_patterns(self, video_path: str) -> SkillVector:
        """
        从视频中提取技能模式。

        使用 analyzer 分析视频的结构、情绪、节奏，
        返回标准化技能向量。

        Args:
            video_path: 视频文件路径

        Returns:
            SkillVector: 技能向量 (structure/emotion/pacing)
        """
        vector = SkillVector()

        if self.analyzer is None:
            return vector

        try:
            # 从 analyzer 获取各维度数据
            structure = getattr(self.analyzer, 'get_structure', None)
            emotion = getattr(self.analyzer, 'get_emotion_curve', None)
            pacing = getattr(self.analyzer, 'get_pacing', None)

            if structure:
                vector.structure = min(1.0, max(0.0, float(structure(video_path))))
            if emotion:
                vector.emotion = min(1.0, max(0.0, float(emotion(video_path))))
            if pacing:
                vector.pacing = min(1.0, max(0.0, float(pacing(video_path))))
        except Exception:
            pass

        # Fallback: extract from video filename
        stem = Path(video_path).stem.lower()
        if "funny" in stem or "搞笑" in stem:
            vector.emotion = max(vector.emotion, 0.6)
        if "tutorial" in stem or "教程" in stem:
            vector.structure = max(vector.structure, 0.7)

        return vector

    def save_to_second_brain(self, skill_vector: SkillVector) -> bool:
        """
        将技能向量写入 second-brain/wiki/creator_patterns.md。

        Args:
            skill_vector: 技能向量

        Returns:
            bool: 是否成功
        """
        md = self._format_md(skill_vector)

        try:
            CREATOR_PATTERNS_FILE.parent.mkdir(parents=True, exist_ok=True)

            if CREATOR_PATTERNS_FILE.exists():
                content = CREATOR_PATTERNS_FILE.read_text(encoding="utf-8")
                if f"## {skill_vector.creator}" in content:
                    # Update existing entry
                    lines = content.split("\n")
                    out, skip = [], False
                    for line in lines:
                        if line.startswith(f"## {skill_vector.creator}"):
                            skip = True
                            out.append(md)
                            continue
                        if skip and line.startswith("## "):
                            skip = False
                            out.append(line)
                            continue
                        if not skip:
                            out.append(line)
                    CREATOR_PATTERNS_FILE.write_text("\n".join(out), encoding="utf-8")
                else:
                    with open(CREATOR_PATTERNS_FILE, "a", encoding="utf-8") as f:
                        f.write("\n" + md)
            else:
                header = (
                    "# 创作者技能模式库\n\n"
                    "> 由 creator_distillation 自动维护\n"
                    f"> 最后更新: {datetime.now().isoformat()}\n\n"
                )
                CREATOR_PATTERNS_FILE.write_text(header + md, encoding="utf-8")
            return True
        except Exception:
            return False

    def load_patterns(self) -> List[SkillVector]:
        """从 second-brain 加载历史技能模式。"""
        # ... (full implementation available in original)
        return []

    @staticmethod
    def _format_md(v: SkillVector) -> str:
        return (
            f"## {v.creator}\n\n"
            f"- **Platform**: {v.platform}\n"
            f"- **Analyzed**: {datetime.now().isoformat()}\n\n"
            "### Skill Scores\n\n"
            f"| Dimension | Score |\n|-----------|-------|\n"
            f"| Structure | {v.structure:.2f} |\n"
            f"| Emotion   | {v.emotion:.2f} |\n"
            f"| Pacing    | {v.pacing:.2f} |\n"
            f"| **Overall** | **{v.overall:.2f}** |\n\n---\n"
        )
