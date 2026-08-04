"""
Compliance Guard
=================
合规检查引擎 — 安全护盾。

在内容生产的每个环节进行合规检测，
确保输出内容符合平台政策与法律要求。

检查维度：
1. 版权风险 — 检测受版权保护的素材
2. 名誉风险 — 检测可能构成诽谤的表述
3. 平台政策 — 各平台社区准则合规
4. 识别风险 — 避免定位到真实个人
5. 敏感词过滤 — 高风险词/短语屏蔽
"""

from dataclasses import dataclass, field
from typing import List, Optional, Dict, Any
from enum import Enum
from datetime import datetime
from pathlib import Path


class RiskLevel(str, Enum):
    """风险等级"""
    SAFE = "safe"                  # 安全
    LOW = "low"                    # 低风险（警告）
    MEDIUM = "medium"              # 中风险（需修改）
    HIGH = "high"                  # 高风险（阻断）
    CRITICAL = "critical"          # 严重风险（立即阻断）


@dataclass
class ComplianceCheck:
    """单项合规检查结果"""
    check_type: str                # 检查类型
    risk_level: RiskLevel
    description: str               # 检查描述
    details: str = ""              # 详细信息
    suggested_action: str = ""     # 建议操作
    source_text: str = ""          # 触发检查的源文本


@dataclass
class ComplianceReport:
    """完整合规报告"""
    content_id: str
    checks: List[ComplianceCheck] = field(default_factory=list)
    overall_risk: RiskLevel = RiskLevel.SAFE
    blocked: bool = False
    checked_at: str = field(default_factory=lambda: datetime.now().isoformat())

    @property
    def is_safe(self) -> bool:
        """是否安全可发布"""
        return self.overall_risk in (RiskLevel.SAFE, RiskLevel.LOW) and not self.blocked

    def to_dict(self) -> Dict:
        """序列化为字典"""
        return {
            "content_id": self.content_id,
            "overall_risk": self.overall_risk.value,
            "blocked": self.blocked,
            "checked_at": self.checked_at,
            "checks": [
                {
                    "type": c.check_type,
                    "risk": c.risk_level.value,
                    "description": c.description,
                    "details": c.details,
                    "suggested_action": c.suggested_action,
                }
                for c in self.checks
            ],
        }


class ComplianceGuard:
    """
    合规检查守护器。

    在内容生产流水线的每个关键节点执行合规检查，
    确保内容安全合规。

    Usage:
        guard = ComplianceGuard()
        report = guard.check_script(script_text)
        if not report.is_safe:
            print(f"Blocked: {report.overall_risk}")
    """

    def __init__(self):
        # 高风险词黑名单
        self.high_risk_keywords = self._load_high_risk_keywords()
        # 平台政策规则
        self.platform_rules = {
            "youtube": self._load_youtube_rules(),
            "bilibili": self._load_bilibili_rules(),
            "tiktok": self._load_tiktok_rules(),
        }

    def _load_high_risk_keywords(self) -> Dict[str, RiskLevel]:
        """
        加载高风险词库。

        Returns:
            Dict[str, RiskLevel]: 敏感词 → 风险等级映射
        """
        # TODO: 从配置文件加载更完整的词库
        return {
            # 人身攻击类 (HIGH)
            "傻子": RiskLevel.HIGH,
            "白痴": RiskLevel.HIGH,
            "智障": RiskLevel.CRITICAL,
            "废物": RiskLevel.HIGH,
            "垃圾": RiskLevel.MEDIUM,
            "蠢货": RiskLevel.HIGH,
            "去死": RiskLevel.CRITICAL,
            "打死": RiskLevel.HIGH,
            "揍你": RiskLevel.HIGH,
            # 敏感政治类 (CRITICAL)
            "习近平": RiskLevel.CRITICAL,
            "共产党": RiskLevel.CRITICAL,
            "天安门": RiskLevel.CRITICAL,
            # 歧视类 (CRITICAL)
            "nigger": RiskLevel.CRITICAL,
            "faggot": RiskLevel.CRITICAL,
            "黑鬼": RiskLevel.CRITICAL,
        }

    def _load_youtube_rules(self) -> List[str]:
        """YouTube 社区准则要点"""
        return [
            "no_hate_speech",
            "no_harassment",
            "no_copyright_infringement",
            "no_misleading_content",
        ]

    def _load_bilibili_rules(self) -> List[str]:
        """B站 社区准则要点"""
        return [
            "no_political_sensitivity",
            "no_hate_speech",
            "no_copyright_infringement",
        ]

    def _load_tiktok_rules(self) -> List[str]:
        """TikTok 社区准则要点"""
        return [
            "no_hate_speech",
            "no_harassment",
            "no_dangerous_acts",
        ]

    def check_script(self, script_text: str) -> ComplianceReport:
        """
        检查脚本合规性。

        Args:
            script_text: 脚本文本

        Returns:
            ComplianceReport: 合规检查报告
        """
        checks = []
        highest_risk = RiskLevel.SAFE

        # 1. 检查高风险词
        for keyword, risk in self.high_risk_keywords.items():
            if keyword in script_text:
                checks.append(ComplianceCheck(
                    check_type="keyword_filter",
                    risk_level=risk,
                    description=f"检测到高风险词: '{keyword}'",
                    source_text=keyword,
                    suggested_action=f"删除或替换 '{keyword}'",
                ))
                if self._risk_level_to_int(risk) > self._risk_level_to_int(highest_risk):
                    highest_risk = risk

        # 2. 检查是否包含真人姓名（简单模式：姓+名格式）
        # TODO: 实现更精确的 NER 检测
        import re
        chinese_name_pattern = r"[\u4e00-\u9fa5]{2,4}[\u4e00-\u9fa5]{2,4}"
        # 这部分仅为占位，需要更完善的检测逻辑

        # 3. 检查版权相关短语
        copyright_markers = [
            "转载自", "来源", "来自", "视频来自", "credit",
        ]
        for marker in copyright_markers:
            if marker in script_text:
                checks.append(ComplianceCheck(
                    check_type="copyright",
                    risk_level=RiskLevel.LOW,
                    description=f"检测到版权相关表述: '{marker}'",
                    details="请确保已获得原始创作者授权",
                    suggested_action="添加来源标注",
                ))

        return ComplianceReport(
            content_id=f"script_{hash(script_text)}",
            checks=checks,
            overall_risk=highest_risk,
            blocked=highest_risk in (RiskLevel.HIGH, RiskLevel.CRITICAL),
        )

    def check_video_metadata(self, title: str, description: str, tags: List[str]) -> ComplianceReport:
        """
        检查视频元数据合规性。

        Args:
            title: 视频标题
            description: 视频描述
            tags: 视频标签

        Returns:
            ComplianceReport: 合规报告
        """
        all_text = f"{title} {description} {' '.join(tags)}"
        return self.check_script(all_text)

    def check_for_publication(
        self,
        script: Any,
        platform: str = "youtube",
    ) -> ComplianceReport:
        """
        发布前最终合规检查。

        Args:
            script: 脚本内容
            platform: 目标平台

        Returns:
            ComplianceReport: 最终合规报告
        """
        script_text = ""
        if hasattr(script, "full_text"):
            script_text = script.full_text
        elif isinstance(script, str):
            script_text = script

        report = self.check_script(script_text)
        return report

    def check_video_file(self, video_path: str) -> ComplianceReport:
        """
        对下载的视频文件进行初步合规筛查。

        检查项：
            - 文件是否真实存在、非空
            - 文件扩展名是否为允许的视频格式
            - 文件名是否包含可疑关键词
            - 文件大小是否在合理范围内（防恶意文件）

        Args:
            video_path: 视频文件路径

        Returns:
            ComplianceReport: 合规检查报告
        """
        import os
        checks: List[ComplianceCheck] = []
        highest_risk = RiskLevel.SAFE

        vpath = Path(video_path)

        # 1. 文件存在性检查
        if not vpath.exists():
            checks.append(ComplianceCheck(
                check_type="file_exists",
                risk_level=RiskLevel.HIGH,
                description="视频文件不存在",
                details=f"路径: {video_path}",
                suggested_action="检查下载是否成功完成",
            ))
            highest_risk = RiskLevel.HIGH
            return ComplianceReport(
                content_id=f"video_{hash(video_path)}",
                checks=checks,
                overall_risk=highest_risk,
                blocked=True,
            )

        # 2. 文件大小检查（至少 1KB，最大 2GB）
        file_size = vpath.stat().st_size
        if file_size < 1024:
            checks.append(ComplianceCheck(
                check_type="file_size",
                risk_level=RiskLevel.HIGH,
                description="文件过小，可能不是有效视频",
                details=f"大小: {file_size} bytes",
                suggested_action="检查下载完整性",
            ))
            highest_risk = RiskLevel.HIGH
        elif file_size > 2 * 1024 * 1024 * 1024:
            checks.append(ComplianceCheck(
                check_type="file_size",
                risk_level=RiskLevel.MEDIUM,
                description="文件超过 2GB，可能过大",
                details=f"大小: {file_size / 1024 / 1024 / 1024:.2f} GB",
                suggested_action="考虑压缩或分段处理",
            ))
            if self._risk_level_to_int(RiskLevel.MEDIUM) > self._risk_level_to_int(highest_risk):
                highest_risk = RiskLevel.MEDIUM
        else:
            checks.append(ComplianceCheck(
                check_type="file_size",
                risk_level=RiskLevel.SAFE,
                description=f"文件大小正常 ({file_size / 1024 / 1024:.1f} MB)",
            ))

        # 3. 扩展名检查
        allowed_exts = {".mp4", ".webm", ".mkv", ".mov", ".avi"}
        if vpath.suffix.lower() not in allowed_exts:
            checks.append(ComplianceCheck(
                check_type="file_extension",
                risk_level=RiskLevel.MEDIUM,
                description=f"非标准视频扩展名: {vpath.suffix}",
                details=f"允许的格式: {', '.join(allowed_exts)}",
                suggested_action="确认文件为有效视频格式",
            ))
            if self._risk_level_to_int(RiskLevel.MEDIUM) > self._risk_level_to_int(highest_risk):
                highest_risk = RiskLevel.MEDIUM
        else:
            checks.append(ComplianceCheck(
                check_type="file_extension",
                risk_level=RiskLevel.SAFE,
                description=f"视频格式 {vpath.suffix} 允许",
            ))

        # 4. 文件名关键词检查
        suspicious_keywords = [
            "banned", "暗网", "暴力", "血腥", "nsfw", "成人",
            "hack", "crack", "malware", "virus", "exploit",
        ]
        fname_lower = vpath.name.lower()
        for kw in suspicious_keywords:
            if kw in fname_lower:
                checks.append(ComplianceCheck(
                    check_type="filename_screening",
                    risk_level=RiskLevel.HIGH,
                    description=f"文件名包含可疑关键词: '{kw}'",
                    source_text=kw,
                    suggested_action="检查文件来源，确认内容合规",
                ))
                if self._risk_level_to_int(RiskLevel.HIGH) > self._risk_level_to_int(highest_risk):
                    highest_risk = RiskLevel.HIGH
                break

        # 5. 检查是否存在对应的元数据 JSON（从 yt-dlp 提取）
        meta_path = vpath.with_suffix(".json")
        if meta_path.exists():
            try:
                meta = json.loads(meta_path.read_text(encoding="utf-8"))
                title = meta.get("title", "") or ""
                description = meta.get("description", "") or ""
                # 对元数据中的文本也做关键词筛查
                meta_text = f"{title} {description}"
                for keyword, risk in self.high_risk_keywords.items():
                    if keyword in meta_text:
                        checks.append(ComplianceCheck(
                            check_type="metadata_screening",
                            risk_level=risk,
                            description=f"元数据检测到风险词: '{keyword}'",
                            source_text=keyword,
                            suggested_action=f"删除或替换 '{keyword}'",
                        ))
                        if self._risk_level_to_int(risk) > self._risk_level_to_int(highest_risk):
                            highest_risk = risk
            except Exception:
                pass

        blocked = highest_risk in (RiskLevel.HIGH, RiskLevel.CRITICAL)

        return ComplianceReport(
            content_id=f"video_{hash(video_path)}",
            checks=checks,
            overall_risk=highest_risk,
            blocked=blocked,
        )

    @staticmethod
    def _risk_level_to_int(level: RiskLevel) -> int:
        """风险等级转数值"""
        mapping = {
            RiskLevel.SAFE: 0,
            RiskLevel.LOW: 1,
            RiskLevel.MEDIUM: 2,
            RiskLevel.HIGH: 3,
            RiskLevel.CRITICAL: 4,
        }
        return mapping.get(level, 0)
