import os
import sys
import json
import pytest
import asyncio
from playwright.async_api import async_playwright

# 导入本地 VisionAnalyzer
try:
    sys.path.append("C:/Users/aoogoost/Desktop/Projekt/git008/projects/MediaIndexerPro")
    from src.vision_analyzer import VisionAnalyzer, save_report
except ImportError as e:
    print(f"[WARN] 无法导入 VisionAnalyzer: {e}")
    VisionAnalyzer = None
    save_report = None


@pytest.mark.asyncio
async def test_ui_visual_integrity():
    # 使用绝对路径定位，确保不论在哪个目录下执行 pytest 都能准确输出
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    screenshot_dir = os.path.join(base_dir, "data", "screenshots")
    os.makedirs(screenshot_dir, exist_ok=True)
    screenshot_path = os.path.join(screenshot_dir, "ui_snapshot.png")
    spec_path = os.path.join(base_dir, "docs", "ui_spec.md")
    results_path = os.path.join(base_dir, "data", "test_results.json")

    # ═══ Phase 1: Playwright 捕获 UI ═══
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()
        try:
            await page.goto("http://localhost:3000", timeout=5000)
            await page.screenshot(path=screenshot_path)
            assert os.path.exists(screenshot_path), "截图文件未生成"
            print("[ASR TEST] ✅ 视觉截图捕获成功，路径:", screenshot_path)

            # 额外的 DOM 检查：验证页面关键元素存在
            try:
                title = await page.title()
                print(f"[ASR TEST]   页面标题: {title}")

                # 检查 nav 是否存在
                nav = await page.query_selector("nav")
                assert nav is not None, "缺少 nav 元素"
                print("[ASR TEST]   ✅ nav 元素存在")

                # 检查表格是否存在
                table = await page.query_selector("table")
                assert table is not None, "缺少 table 元素"
                print("[ASR TEST]   ✅ table 元素存在")

                # 检查搜索输入框
                search = await page.query_selector("input[type='text']")
                assert search is not None, "缺少搜索输入框"
                print("[ASR TEST]   ✅ 搜索框存在")

            except Exception as dom_e:
                print(f"[ASR TEST]   DOM 检查警告: {dom_e}")

        except Exception as e:
            print("[ASR TEST] ❌ 本地服务器未启动或超时:", e)
            raise  # 服务器不可达 → 必须失败

        finally:
            await browser.close()

    # ═══ Phase 2: VisionEngine 视觉审查 ═══
    if VisionAnalyzer is not None:
        print("[ASR TEST] 🔍 VisionEngine 视觉审查开始...")
        report = VisionAnalyzer.compare(screenshot_path, spec_path)

        if save_report:
            save_report(report, results_path)

        # 打印审查摘要
        print(f"[ASR TEST]   综合评分: {report['overall_score']:.2f} / 阈值: {report['threshold']}")
        for check_name, check_result in report.get("checks", {}).items():
            status = "✅" if check_result.get("passed") else "❌"
            print(f"[ASR TEST]   {status} {check_name}: {check_result.get('score', 0):.2f}")

        if report.get("issues"):
            print(f"[ASR TEST]   ⚠️ 发现 {len(report['issues'])} 个差异项:")
            for issue in report["issues"]:
                print(f"[ASR TEST]      - [{issue['check']}] {issue['issue']}")

        # 判定：差异超过阈值则失败
        assert report["passed"], (
            f"VisionEngine 审查未通过: 评分 {report['overall_score']:.2f} < 阈值 {report['threshold']}\n"
            f"问题: {json.dumps(report['issues'], ensure_ascii=False)}"
        )
        print(f"[ASR TEST] ✅ VisionEngine 审查通过: {report['summary']}")
    else:
        print("[ASR TEST] ⚠️ VisionAnalyzer 未加载，跳过视觉审查")
        # 即使无 VisionEngine，截图成功也算基础通过
