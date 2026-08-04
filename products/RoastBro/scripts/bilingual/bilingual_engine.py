"""
Bilingual Engine — 全球双语内容生产线
========================================
为同一条源视频生成 CN + EN 两套完整内容。

工作流：
    源视频
    ├── CN Pipeline
    │   ├── 中文脚本（谷阿莫/Captainpig）
    │   ├── 中文剪辑
    │   ├── 中文配音（女声）
    │   ├── 中文字幕
    │   ├── 中文 SEO
    │   ├── 国内合规
    │   └── 发布到 B站/抖音/小红书
    │
    └── EN Pipeline
        ├── 英文脚本（MrBeast Reaction/Meme Review）
        ├── 英文剪辑
        ├── 英文配音（commentary）
        ├── 英文字幕
        ├── 英文 SEO
        ├── 全球合规
        └── 发布到 YouTube/Shorts/TikTok
"""

from dataclasses import dataclass, field
from typing import List, Optional, Tuple
from pathlib import Path
from datetime import datetime


ROOT = Path(__file__).resolve().parent.parent.parent


@dataclass
class BilingualContent:
    """双语内容对"""
    video_id: str
    source_title: str

    # CN content
    cn_script: str = ""
    cn_video: str = ""
    cn_audio: str = ""
    cn_subtitle: str = ""
    cn_title: str = ""
    cn_description: str = ""
    cn_tags: List[str] = field(default_factory=list)
    cn_seo_score: float = 0.0
    cn_compliance: str = "pending"

    # EN content
    en_script: str = ""
    en_video: str = ""
    en_audio: str = ""
    en_subtitle: str = ""
    en_title: str = ""
    en_description: str = ""
    en_tags: List[str] = field(default_factory=list)
    en_seo_score: float = 0.0
    en_compliance: str = "pending"

    created_at: str = field(default_factory=lambda: datetime.now().isoformat())


class BilingualEngine:
    """
    双语内容引擎。

    用法:
        engine = BilingualEngine()
        content = engine.generate_bilingual("rb_prod_001", "洗衣机洗菜")
        content.cn_title  # 中文标题
        content.en_title  # 英文标题
    """

    def __init__(self):
        self.output_dir = ROOT / "output"

    def generate_bilingual(self, video_id: str, source_title: str) -> BilingualContent:
        """生成双语内容对"""
        content = BilingualContent(video_id=video_id, source_title=source_title)

        # Generate CN content
        content.cn_script = self._generate_cn_script(video_id, source_title)
        content.cn_title = self._generate_cn_title(source_title)
        content.cn_tags = self._generate_cn_tags(source_title)
        content.cn_description = self._generate_cn_description(content.cn_title)
        content.cn_seo_score = self._score_cn_title(content.cn_title)
        content.cn_subtitle = self._generate_subtitle_path(video_id, "cn")

        # Generate EN content
        content.en_script = self._generate_en_script(video_id, source_title)
        content.en_title = self._generate_en_title(source_title)
        content.en_tags = self._generate_en_tags(source_title)
        content.en_description = self._generate_en_description(content.en_title)
        content.en_seo_score = self._score_en_title(content.en_title)
        content.en_subtitle = self._generate_subtitle_path(video_id, "en")

        return content

    # ── CN Content Generation ───────────────────────────────

    def _generate_cn_title(self, source: str) -> str:
        """生成中文标题"""
        templates = [
            f"吐槽：{source}，看完我直接无语",
            f"{source}？这操作太离谱了！",
            f"不是，{source}，你是认真的吗？",
        ]
        return templates[hash(source) % len(templates)]

    def _generate_cn_tags(self, source: str) -> List[str]:
        """生成中文标签"""
        base = ["吐槽", "搞笑", "沙雕视频", "离谱"]
        source_lower = source.lower()
        if "挑战" in source_lower or "challenge" in source_lower:
            base.extend(["挑战", "翻车现场"])
        if "省钱" in source_lower or "攻略" in source_lower:
            base.extend(["省钱", "避坑"])
        return base[:10]

    def _generate_cn_description(self, title: str) -> str:
        return f"{title}\n\n每天更新吐槽视频，关注不迷路！\n#吐槽 #搞笑 #离谱"

    def _score_cn_title(self, title: str) -> float:
        """中文 SEO 评分"""
        score = 60.0
        if 5 <= len(title) <= 30:
            score += 20
        if any(kw in title for kw in ["吐槽", "离谱", "搞笑"]):
            score += 15
        if "！" in title or "？" in title:
            score += 5
        return min(100, score)

    # ── EN Content Generation ───────────────────────────────

    def _generate_en_title(self, source: str) -> str:
        """生成英文标题"""
        templates = [
            f"Roasting {source}... This is WILD",
            f"{source} — The Most ABSURD Thing I've Seen",
            f"Reacting to {source} (I Can't Believe This)",
        ]
        return templates[hash(source + "en") % len(templates)]

    def _generate_en_tags(self, source: str) -> List[str]:
        """生成英文标签"""
        base = ["roast", "comedy", "funny", "reaction"]
        source_lower = source.lower()
        if "challenge" in source_lower:
            base.extend(["challenge", "fail"])
        if "money" in source_lower or "省钱" in source_lower:
            base.extend(["money", "lifehacks"])
        return base[:10]

    def _generate_en_description(self, title: str) -> str:
        return f"{title}\n\nSubscribe for daily roasts! 🔥\n#roast #comedy #reaction"

    def _score_en_title(self, title: str) -> float:
        """英文 SEO 评分"""
        score = 60.0
        if 20 <= len(title) <= 60:
            score += 20
        if any(kw in title.lower() for kw in ["roast", "wild", "crazy", "absurd"]):
            score += 15
        if "!" in title or "?" in title:
            score += 5
        return min(100, score)

    # ── EN Script Generation ────────────────────────────────

    def _generate_cn_script(self, video_id: str, title: str) -> str:
        """Placeholder — real impl uses RoastScriptEngine"""
        return f"# CN Script for {video_id}\n\n{title}\n\n[Full CN script...]"

    def _generate_en_script(self, video_id: str, title: str) -> str:
        """Generate English commentary script"""
        return (
            f"# EN Script for {video_id}\n\n"
            f"## Title: {title}\n\n"
            f"[00:00] What is this video about?\n"
            f"[00:15] Let me break this down...\n"
            f"[00:30] This is actually insane.\n"
            f"[01:00] But here's the thing...\n"
            f"[01:30] Anyway, subscribe for more roasts!\n"
        )

    @staticmethod
    def _generate_subtitle_path(video_id: str, lang: str) -> str:
        return f"output/subtitles/{video_id}.{lang}.srt"
