"""
Roast Script Engine
====================
反讽吐槽脚本生成引擎 — RoastBro 的核心创作模块。

风格蒸馏：
1. 谷阿莫风格 — 快速叙事节奏（X秒钟看完Y）+ 网络梗吐槽
   - 特征：加速旁白、剪刀手式剪辑、无聊吐槽
   - 句式："就这样...""所以我说...""简单来说..."

2. Captainpig 风格 — 暴力逻辑拆解 + 冷嘲热讽
   - 特征：逻辑链拆解、反问句、冷嘲热讽
   - 句式："你要不要看看你在说什么？""不是... 你...？"

3. 混合风格 — 自动适配槽点类型切换风格
"""

from dataclasses import dataclass, field
from typing import List, Optional, Dict, Any
from datetime import datetime
from enum import Enum


class StyleType(str, Enum):
    """脚本风格类型"""
    GU_AMO = "gu_amo"              # 谷阿莫风格
    CAPTAINPIG = "captainpig"      # Captainpig 风格
    HYBRID = "hybrid"              # 混合风格
    CUSTOM = "custom"              # 自定义风格


@dataclass
class ScriptSegment:
    """脚本段落"""
    order: int                     # 段落序号
    content: str                   # 剧本内容
    style: StyleType               # 使用风格
    start_time: float = 0.0        # 对应视频开始时间（秒）
    end_time: float = 0.0          # 对应视频结束时间（秒）
    tone: str = "sarcastic"        # 语调：sarcastic / mocking / deadpan / furious
    emotion: str = "neutral"       # 情绪标签
    roast_point_ref: str = ""      # 关联的槽点引用
    visual_instruction: str = ""   # 画面操作指令（如："画面加速2x"）
    safe: bool = True              # 是否通过安全过滤


@dataclass
class RoastScript:
    """完整反讽脚本"""
    title: str                     # 脚本标题
    video_source: str              # 源视频路径/URL
    style: StyleType               # 主风格
    segments: List[ScriptSegment] = field(default_factory=list)
    total_duration: float = 0.0    # 脚本总时长（秒）
    total_word_count: int = 0      # 总字数
    safe_verified: bool = False    # 是否通过安全合规检查
    generated_at: str = field(default_factory=lambda: datetime.now().isoformat())
    metadata: Dict[str, Any] = field(default_factory=dict)

    @property
    def full_text(self) -> str:
        """获取完整剧本文本"""
        return "\n\n".join(seg.content for seg in self.segments)

    def to_dict(self) -> Dict:
        """序列化为字典"""
        return {
            "title": self.title,
            "video_source": self.video_source,
            "style": self.style.value,
            "total_duration": self.total_duration,
            "total_word_count": self.total_word_count,
            "safe_verified": self.safe_verified,
            "generated_at": self.generated_at,
            "segments": [
                {
                    "order": s.order,
                    "content": s.content,
                    "style": s.style.value,
                    "start_time": s.start_time,
                    "end_time": s.end_time,
                    "tone": s.tone,
                    "emotion": s.emotion,
                    "roast_point_ref": s.roast_point_ref,
                    "visual_instruction": s.visual_instruction,
                    "safe": s.safe,
                }
                for s in self.segments
            ],
        }


class RoastScriptEngine:
    """
    反讽脚本生成引擎。

    核心功能：
    1. 接收 RoastPoint 槽点列表
    2. 按风格模板生成反讽文案
    3. 支持谷阿莫/Captainpig/混合三种风格
    4. 内置安全边界过滤
    5. 输出结构化脚本（含时间戳、画面指令）

    Usage:
        engine = RoastScriptEngine(style=StyleType.HYBRID)
        script = engine.generate(roast_report, video_info)
        print(script.full_text)
    """

    def __init__(
        self,
        style: StyleType = StyleType.HYBRID,
        language: str = "zh",
        safety_filter: bool = True,
        toxicity_level: int = 5,
    ):
        self.style = style
        self.language = language
        self.safety_filter = safety_filter
        self.toxicity_level = max(1, min(10, toxicity_level))  # clamp 1-10

        # 加载风格模板
        self.style_templates = self._load_style_templates()

    def _load_style_templates(self) -> Dict[StyleType, Dict[str, Any]]:
        """
        加载风格模板配置。

        每种风格包含：
        - opener: 开场模板
        - transition: 转场模板
        - punchline: 包袱模板
        - closer: 结尾模板
        - tone_markers: 语调标记词
        """
        return {
            StyleType.GU_AMO: {
                "opener": [
                    "简单来说，这个视频讲的是{#summary}",
                    "好，今天我们来吐槽一个{#category}的视频",
                    "{#time}秒钟，看懂这个{#category}视频",
                ],
                "transition": [
                    "就这样，{#subject}开始了他的表演",
                    "然后呢，{action}？不是，你认真的？",
                    "看到这里，我已经不知道说什么了",
                ],
                "punchline": [
                    "所以我说啊，{#roast_comment}",
                    "这操作，我给{#score}分，满分100",
                    "不是，{#subject}你要不要看看你拍了个啥",
                ],
                "closer": [
                    "总结：{#summary}",
                    "好，这期就到这里，下期见",
                    "看完这个视频，我只想说：{#final_roast}",
                ],
                "tone_markers": {
                    "speed": "fast",
                    "energy": "medium",
                    "deadpan": True,
                },
            },
            StyleType.CAPTAINPIG: {
                "opener": [
                    "今天我们来拆解一个逻辑鬼才的视频",
                    "来，大家看看这个视频有多离谱",
                    "看完这个视频，我的CPU烧了",
                ],
                "transition": [
                    "不是... 你... 认真的？",
                    "你要不要看看你在说什么？",
                    "好，我们来分析一下这里面的逻辑漏洞",
                    "等等，这里有一个非常关键的问题",
                ],
                "punchline": [
                    "请注意看这里——{roast_detail}，这不尴尬吗？",
                    "来，我给你捋一捋这里的逻辑：{logic_breakdown}",
                    "这个操作我只能用四个字形容：{four_word_roast}",
                ],
                "closer": [
                    "结论：{conclusion}",
                    "以上就是本期全部内容，建议UP主重新做人",
                    "看完记得投币，让更多人看到这个离谱的视频",
                ],
                "tone_markers": {
                    "speed": "varied",
                    "energy": "high",
                    "deadpan": False,
                },
            },
            StyleType.HYBRID: {
                # 混合风格：根据槽点类型自动切换
                "auto_switch": True,
                "gu_amo_threshold": 0.5,    # 简单槽点用谷阿莫
                "captainpig_threshold": 0.7,  # 复杂槽点用Captainpig
            },
        }

    def generate(
        self,
        roast_report: Any,  # RoastScoreReport
        video_info: Optional[Dict[str, Any]] = None,
    ) -> RoastScript:
        """
        根据槽点报告生成完整反讽脚本。

        Args:
            roast_report: RoastScoreReport 槽点评分报告
            video_info: 视频元数据信息

        Returns:
            RoastScript: 完整反讽脚本
        """
        segments = []
        report_data = roast_report.to_dict() if hasattr(roast_report, "to_dict") else roast_report
        roast_points = report_data.get("roast_points", [])

        # 生成开场段落
        opener = self._generate_opener(report_data)
        segments.append(ScriptSegment(
            order=1,
            content=opener,
            style=self.style if self.style != StyleType.HYBRID else StyleType.GU_AMO,
            tone="sarcastic",
            visual_instruction="原速播放前5秒",
        ))

        # 为每个槽点生成吐槽段落
        for i, rp in enumerate(roast_points):
            seg_style = self._select_style_for_roast(rp)
            content = self._generate_roast_segment(rp, seg_style)

            segments.append(ScriptSegment(
                order=i + 2,
                content=content,
                style=seg_style,
                start_time=rp.get("timestamp", 0.0),
                end_time=rp.get("timestamp", 0.0) + 10.0,
                tone=self._select_tone(rp),
                roast_point_ref=rp.get("title", ""),
                visual_instruction=self._generate_visual_instruction(rp),
                safe=self._safety_check(content),
            ))

        # 生成结尾段落
        closer = self._generate_closer(report_data)
        segments.append(ScriptSegment(
            order=len(segments) + 1,
            content=closer,
            style=self.style if self.style != StyleType.HYBRID else StyleType.GU_AMO,
            tone="deadpan",
        ))

        # 安全管理：过滤不安全段落
        if self.safety_filter:
            segments = [s for s in segments if s.safe]

        # 统计信息
        total_words = sum(len(s.content) for s in segments)

        return RoastScript(
            title=self._generate_title(report_data),
            video_source=report_data.get("video_path", ""),
            style=self.style,
            segments=segments,
            total_word_count=total_words,
            safe_verified=all(s.safe for s in segments),
        )

    def _select_style_for_roast(self, roast_point: Dict) -> StyleType:
        """根据槽点类型选择最合适的风格"""
        if self.style == StyleType.HYBRID:
            score = roast_point.get("scores", {}).get("total", 0)
            if score >= 25:
                return StyleType.CAPTAINPIG
            return StyleType.GU_AMO
        return self.style

    def _generate_opener(self, report_data: Dict) -> str:
        """生成开场白 — 毒性加权"""
        templates = self.style_templates.get(
            self.style if self.style != StyleType.HYBRID else StyleType.GU_AMO,
            {}
        ).get("opener", ["今天来吐槽一个视频"])
        template = templates[0]

        opener = template.replace(
            "{#summary}",
            f"一个{'/'.join(report_data.get('category_distribution', {}).keys())}的视频"
        ).replace(
            "{#category}",
            next(iter(report_data.get("category_distribution", {})), "奇葩"),
        ).replace(
            "{#time}",
            "两",
        )

        # 毒性烈度前缀
        if self.toxicity_level >= 8:
            opener = "我直说了，这视频看得我血压拉满。\n" + opener
        elif self.toxicity_level >= 5:
            opener = "兄弟们，准备好开喷了吗？\n" + opener
        elif self.toxicity_level >= 3:
            opener = "来，看看今天又有啥离谱玩意儿。\n" + opener

        return opener

    def _generate_roast_segment(self, roast_point: Dict, style: StyleType) -> str:
        """为单个槽点生成吐槽内容 — 毒性加权"""
        templates = self.style_templates.get(style, {})
        punchlines = templates.get("punchline", ["{roast_comment}"])

        category = roast_point.get("category", "unknown")
        title = roast_point.get("title", "")
        t = self.toxicity_level

        # 毒舌烈度加权措辞映射
        roast_intensifiers = {
            1: "建议可以改进一下",
            2: "这个地方有点问题",
            3: "这个操作不太对劲",
            4: "这操作有点离谱了",
            5: "这个操作太离谱了",
            6: "这操作真的离谱",
            7: "这什么迷惑操作",
            8: "这操作给我看吐了",
            9: "这tm什么阴间操作",
            10: "这尼玛是人类能整出来的活？",
        }
        intensifier = roast_intensifiers.get(t, "这个操作太离谱了")

        return f"【{category}】{title} —— {intensifier}"

    def _generate_closer(self, report_data: Dict) -> str:
        """生成结尾总结"""
        total = report_data.get("total_roast_points", 0)
        return (
            f"好了，本期一共吐槽了 {total} 个槽点。"
            f"觉得不错的话一键三连，我们下期再见。"
        )

    def _generate_title(self, report_data: Dict) -> str:
        """生成视频标题"""
        points = report_data.get("total_roast_points", 0)
        top_cats = list(report_data.get("category_distribution", {}).keys())[:2]
        return f"吐槽：这个视频的{points}个槽点 {'/'.join(top_cats)}"

    def _select_tone(self, roast_point: Dict) -> str:
        """根据评分 + 毒性烈度选择语调"""
        scores = roast_point.get("scores", {})
        total = scores.get("total", 0)
        t = self.toxicity_level

        # 毒性加权：烈度越高，语调阈值越低
        threshold_mod = max(0, 10 - t)  # t=10 → mod=0, t=1 → mod=9
        adjusted = total + (t * 3)  # 毒性越高，等效评分越高

        if adjusted >= 35:
            return "furious"
        elif adjusted >= 20:
            return "mocking"
        elif adjusted >= 10:
            return "sarcastic"
        return "deadpan"

    def _generate_visual_instruction(self, roast_point: Dict) -> str:
        """生成画面操作指令"""
        score = roast_point.get("scores", {}).get("total", 0)
        if score >= 30:
            return "画面加速2x + 加粗字幕 + 贴纸遮挡"
        elif score >= 15:
            return "画面加速1.5x + 字幕标注"
        return "原速 + 字幕标注"

    def _safety_check(self, content: str) -> bool:
        """
        安全边界检查。

        过滤规则：
        - 不直接攻击真人
        - 不涉及政治敏感内容
        - 不含有歧视性言论
        - 不涉及人身攻击
        """
        # TODO: 实现基于合规规则的内容过滤
        # 当前返回 True（通过检查）
        return True

    def export_srt(self, script: RoastScript) -> str:
        """
        将脚本导出为 SRT 字幕格式。

        Args:
            script: RoastScript 对象

        Returns:
            str: SRT 格式字幕内容
        """
        srt_lines = []
        for i, seg in enumerate(script.segments, 1):
            start = self._seconds_to_srt_time(seg.start_time)
            end = self._seconds_to_srt_time(seg.end_time)
            srt_lines.append(f"{i}")
            srt_lines.append(f"{start} --> {end}")
            srt_lines.append(seg.content)
            srt_lines.append("")

        return "\n".join(srt_lines)

    @staticmethod
    def _seconds_to_srt_time(seconds: float) -> str:
        """将秒转换为 SRT 时间格式 HH:MM:SS,mmm"""
        hours = int(seconds // 3600)
        minutes = int((seconds % 3600) // 60)
        secs = int(seconds % 60)
        millis = int((seconds - int(seconds)) * 1000)
        return f"{hours:02d}:{minutes:02d}:{secs:02d},{millis:03d}"
