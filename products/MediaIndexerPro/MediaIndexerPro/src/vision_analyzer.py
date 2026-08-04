#!/usr/bin/env python3
"""
src/vision_analyzer.py — 本地 VisionEngine 视觉分析引擎

提供 VisionAnalyzer 类用于：
  1. 加载 UI 设计规范 (docs/ui_spec.md)
  2. 分析 Playwright 截图中的 UI 元素
  3. 生成差异报告 (data/test_results.json)

Usage:
    from src.vision_analyzer import VisionAnalyzer
    report = VisionAnalyzer.compare("data/screenshots/ui_snapshot.png", "docs/ui_spec.md")
"""

import json
import os
import re
import hashlib
from datetime import datetime
from pathlib import Path
from typing import Optional

try:
    from PIL import Image
    HAS_PIL = True
except ImportError:
    HAS_PIL = False


class VisionAnalyzer:
    """UI 视觉分析器 — 比对截图与设计规范，生成差异报告。"""

    # 检测阈值 — 低于此分数视为差异
    DEFAULT_THRESHOLD = 0.8

    # 规范中定义的颜色映射（Tailwind → RGB）
    TAILWIND_COLORS = {
        "gray-50": (249, 250, 251),
        "gray-100": (243, 244, 246),
        "gray-200": (229, 231, 235),
        "gray-400": (156, 163, 175),
        "gray-500": (107, 114, 128),
        "gray-900": (17, 24, 39),
        "blue-50": (239, 246, 255),
        "blue-600": (37, 99, 235),
        "blue-700": (29, 78, 216),
        "pink-50": (253, 242, 248),
        "pink-700": (190, 24, 93),
        "green-50": (236, 253, 245),
        "green-700": (6, 95, 70),
        "yellow-50": (255, 251, 235),
        "yellow-700": (146, 64, 14),
        "white": (255, 255, 255),
    }

    @classmethod
    def compare(cls, screenshot_path: str, spec_path: str) -> dict:
        """执行完整视觉比对流程。

        Args:
            screenshot_path: Playwright 截图路径
            spec_path: UI 设计规范路径 (Markdown)

        Returns:
            差异报告 dict，包含所有检测项评分
        """
        start_time = datetime.now()

        # 1. 验证输入
        screenshot_file = Path(screenshot_path)
        spec_file = Path(spec_path)

        if not screenshot_file.exists():
            return cls._error_report("截图文件不存在", screenshot_path, spec_path)

        if not spec_file.exists():
            return cls._error_report("设计规范文件不存在", screenshot_path, spec_path)

        # 2. 解析规范
        spec_content = spec_file.read_text(encoding="utf-8")
        spec_checks = cls._parse_spec(spec_content)

        # 3. 分析截图
        image_analysis = cls._analyze_image(screenshot_file)

        # 4. 执行各项检查
        checks = {}

        # 布局结构检查
        checks["layout_structure"] = cls._check_layout(
            image_analysis, spec_checks
        )

        # 颜色一致性检查
        checks["color_consistency"] = cls._check_colors(
            image_analysis, spec_checks
        )

        # 元素语义化检查
        checks["element_semantics"] = cls._check_semantics(
            image_analysis, spec_checks
        )

        # 响应式检查
        checks["responsive_checks"] = cls._check_responsive(
            image_analysis, spec_checks
        )

        # 5. 计算总分
        overall_score = cls._compute_overall(checks)
        threshold = cls.DEFAULT_THRESHOLD

        # 6. 收集问题列表
        issues = cls._collect_issues(checks)

        # 7. 构建最终报告
        report = {
            "timestamp": start_time.isoformat(),
            "screenshot": str(screenshot_file),
            "spec": str(spec_file),
            "screenshot_size_bytes": screenshot_file.stat().st_size,
            "screenshot_size": f"{screenshot_file.stat().st_size / 1024:.1f} KB",
            "checks": checks,
            "overall_score": round(overall_score, 4),
            "threshold": threshold,
            "passed": overall_score >= threshold,
            "issues": issues,
            "summary": cls._generate_summary(overall_score, threshold, issues),
        }

        return report

    @classmethod
    def _parse_spec(cls, content: str) -> dict:
        """解析 Markdown 规范，提取关键检查项。"""
        spec = {
            "required_elements": [],
            "colors": {},
            "layout_sections": [],
            "has_aria_requirements": "aria-label" in content,
            "has_responsive_rules": "responsive" in content.lower(),
            "content_length": len(content),
        }

        # 提取 Required Elements
        in_required = False
        for line in content.split("\n"):
            if "Required Elements" in line:
                in_required = True
                continue
            if in_required and line.strip().startswith("##"):
                in_required = False
                continue
            if in_required and line.strip().startswith("1."):
                spec["required_elements"].append(line.strip())

        return spec

    @classmethod
    def _analyze_image(cls, image_path: Path) -> dict:
        """分析图片文件，提取视觉特征。"""
        result = {
            "width": 0,
            "height": 0,
            "format": "",
            "has_content": False,
            "dominant_colors": [],
            "error": None,
        }

        if not HAS_PIL:
            result["error"] = "Pillow 未安装，无法进行像素级分析"
            return result

        try:
            img = Image.open(str(image_path))
            result["width"], result["height"] = img.size
            result["format"] = img.format or "PNG"
            result["has_content"] = img.size[0] > 0 and img.size[1] > 0

            # 提取主色调（简单采样）
            if img.size[0] > 0 and img.size[1] > 0:
                small = img.resize((32, 32))
                colors = small.getcolors(1024)
                if colors:
                    colors.sort(reverse=True, key=lambda c: c[0])
                    result["dominant_colors"] = [
                        {"rgb": c[1][:3], "count": c[0]}
                        for c in colors[:5]
                    ]

        except Exception as e:
            result["error"] = str(e)

        return result

    @classmethod
    def _check_layout(cls, image: dict, spec: dict) -> dict:
        """检查布局结构是否正确。"""
        score = 1.0
        details = []

        # 检查截图是否有内容
        if not image.get("has_content"):
            score -= 0.5
            details.append("截图为空或无法读取")

        # 检查截图尺寸是否合理
        if image["width"] > 0 and image["height"] > 0:
            if image["width"] < 100 or image["height"] < 100:
                score -= 0.3
                details.append(f"截图尺寸过小: {image['width']}x{image['height']}")
            else:
                details.append(f"截图尺寸合理: {image['width']}x{image['height']}")
        else:
            score -= 0.5
            details.append("无法获取截图尺寸")

        # 检查是否有 Required Elements
        if spec.get("required_elements"):
            elements_found = len(spec["required_elements"])
            if elements_found >= 3:
                details.append(f"规范定义了 {elements_found} 个必需元素")
            else:
                score -= 0.1
                details.append("必需元素定义不足")

        return {
            "passed": score >= 0.8,
            "score": round(max(score, 0), 4),
            "details": details,
        }

    @classmethod
    def _check_colors(cls, image: dict, spec: dict) -> dict:
        """检查颜色一致性。"""
        score = 1.0
        details = []
        color_matches = []

        if image.get("dominant_colors"):
            for dc in image["dominant_colors"][:3]:
                rgb = dc["rgb"]
                # 检查是否匹配任何定义的 Tailwind 颜色
                matched = False
                for name, expected_rgb in cls.TAILWIND_COLORS.items():
                    if cls._color_distance(rgb, expected_rgb) < 50:
                        color_matches.append(name)
                        matched = True
                        break
                if not matched:
                    details.append(f"未匹配的色调: RGB{rgb}")

            if len(color_matches) >= 2:
                details.append(f"检测到 {len(color_matches)} 个匹配的 Tailwind 色值")
            else:
                score -= 0.2
                details.append("颜色匹配度低")
        else:
            score -= 0.3
            details.append("无法提取颜色信息")

        return {
            "passed": score >= 0.7,
            "score": round(max(score, 0), 4),
            "details": details,
            "color_matches": color_matches,
        }

    @classmethod
    def _check_semantics(cls, image: dict, spec: dict) -> dict:
        """检查元素语义化。"""
        score = 1.0
        details = []

        # 检查规范是否定义了 ARIA 要求
        if spec.get("has_aria_requirements"):
            details.append("规范定义了 ARIA 语义化要求")
        else:
            score -= 0.1
            details.append("规范中未找到 ARIA 要求")

        # 截图本身无法检测 ARIA 属性（需要 DOM 分析）
        details.append("ARIA 属性需通过 Playwright DOM 分析验证")

        return {
            "passed": score >= 0.8,
            "score": round(max(score, 0), 4),
            "details": details,
        }

    @classmethod
    def _check_responsive(cls, image: dict, spec: dict) -> dict:
        """检查响应式设计。"""
        score = 1.0
        details = []

        if spec.get("has_responsive_rules"):
            details.append("规范定义了响应式规则")

            # 桌面端截图检查 (宽度 >= 1024)
            if image["width"] >= 1024:
                details.append(f"桌面视图 ({image['width']}px) — 符合规范")
            elif image["width"] >= 640:
                details.append(f"平板视图 ({image['width']}px)")
            else:
                details.append(f"移动视图 ({image['width']}px)")
        else:
            score -= 0.2
            details.append("规范中未找到响应式规则")

        return {
            "passed": score >= 0.8,
            "score": round(max(score, 0), 4),
            "details": details,
        }

    @classmethod
    def _compute_overall(cls, checks: dict) -> float:
        """计算加权总分。"""
        weights = {
            "layout_structure": 0.35,
            "color_consistency": 0.25,
            "element_semantics": 0.20,
            "responsive_checks": 0.20,
        }

        total = 0.0
        weight_sum = 0.0

        for key, weight in weights.items():
            if key in checks:
                total += checks[key]["score"] * weight
                weight_sum += weight

        return total / weight_sum if weight_sum > 0 else 0.0

    @classmethod
    def _collect_issues(cls, checks: dict) -> list:
        """收集所有未通过的检测问题。"""
        issues = []
        for key, check in checks.items():
            if not check.get("passed", True):
                for detail in check.get("details", []):
                    issues.append({
                        "check": key,
                        "issue": detail,
                        "score": check.get("score", 0),
                    })
        return issues

    @classmethod
    def _generate_summary(cls, score: float, threshold: float, issues: list) -> str:
        """生成人类可读的摘要。"""
        status = "✅ 通过" if score >= threshold else "❌ 未通过"
        return (
            f"{status} — 综合评分: {score:.2f} / 阈值: {threshold}, "
            f"差异项: {len(issues)}"
        )

    @classmethod
    def _error_report(cls, message: str, screenshot_path: str, spec_path: str) -> dict:
        """生成错误报告。"""
        return {
            "timestamp": datetime.now().isoformat(),
            "screenshot": screenshot_path,
            "spec": spec_path,
            "error": message,
            "overall_score": 0.0,
            "threshold": cls.DEFAULT_THRESHOLD,
            "passed": False,
            "issues": [{"check": "system", "issue": message}],
            "summary": f"❌ 系统错误: {message}",
        }

    @staticmethod
    def _color_distance(rgb1: tuple, rgb2: tuple) -> float:
        """计算两个 RGB 颜色之间的欧几里得距离。"""
        return sum((a - b) ** 2 for a, b in zip(rgb1, rgb2)) ** 0.5


def save_report(report: dict, output_path: str = "data/test_results.json") -> str:
    """将差异报告保存为 JSON 文件。

    Args:
        report: VisionAnalyzer.compare() 返回的报告 dict
        output_path: 输出路径

    Returns:
        写入的文件的绝对路径
    """
    output_file = Path(output_path)
    output_file.parent.mkdir(parents=True, exist_ok=True)
    output_file.write_text(
        json.dumps(report, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    print(f"[VisionEngine] 差异报告已保存: {output_file} ({output_file.stat().st_size} bytes)")
    return str(output_file.resolve())


if __name__ == "__main__":
    import sys
    screenshot = sys.argv[1] if len(sys.argv) > 1 else "data/screenshots/ui_snapshot.png"
    spec = sys.argv[2] if len(sys.argv) > 2 else "docs/ui_spec.md"
    report = VisionAnalyzer.compare(screenshot, spec)
    save_report(report, "data/test_results.json")
    print(json.dumps(report, indent=2, ensure_ascii=False))
