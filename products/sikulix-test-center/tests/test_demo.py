"""
演示测试用例

验证 Driver 的核心功能是否正常：
1. 截图功能
2. 图像查找（可查找系统桌面图标，如回收站/Recycle Bin）
3. 断言功能

运行方式:
    pytest tests/test_demo.py -v --tb=short
"""

import os
import tempfile

import pytest
from loguru import logger

from core.driver import Driver
from core.config import Config


class TestDriverDemo:
    """Driver 功能演示测试"""

    @pytest.fixture(autouse=True)
    def setup_logging(self):
        """每个测试前打印分隔线"""
        logger.info(f"\n{'='*60}")
        logger.info(f"开始测试: {self.__class__.__name__}")
        logger.info(f"{'='*60}")
        yield

    def test_screenshot(self, driver: Driver):
        """
        验证截图功能是否正常

        预期:
        - 截图文件成功生成
        - 文件大小 > 0
        - 文件为 PNG 格式
        """
        # 使用临时文件名，避免污染实际截图目录
        screenshot_path = driver.screenshot("test_screenshot_demo.png")

        try:
            # 验证文件存在
            assert os.path.exists(screenshot_path), f"截图文件不存在: {screenshot_path}"

            # 验证文件大小不为空
            file_size = os.path.getsize(screenshot_path)
            assert file_size > 0, f"截图文件大小为 0: {screenshot_path}"
            logger.info(f"截图文件大小: {file_size} bytes")

            # 验证文件为 PNG 格式
            assert screenshot_path.endswith(".png"), f"截图文件不是 PNG 格式: {screenshot_path}"

            logger.success(f"截图测试通过: {screenshot_path}")
        finally:
            # 清理测试文件
            if os.path.exists(screenshot_path):
                os.remove(screenshot_path)
                logger.info(f"已清理测试截图: {screenshot_path}")

    def test_screenshot_saves_to_reports(self, driver: Driver):
        """
        验证截图默认保存到 reports/screenshots/ 目录
        """
        # 使用默认文件名（不传参）
        screenshot_path = driver.screenshot()

        try:
            # 验证路径包含 reports/screenshots
            assert "reports" in screenshot_path, f"截图路径未包含 reports: {screenshot_path}"
            assert "screenshots" in screenshot_path, f"截图路径未包含 screenshots: {screenshot_path}"
            assert os.path.exists(screenshot_path), f"截图文件不存在: {screenshot_path}"

            logger.success(f"截图保存路径正确: {screenshot_path}")
        finally:
            if os.path.exists(screenshot_path):
                os.remove(screenshot_path)

    def test_find_nonexistent_image(self, driver: Driver):
        """
        验证查找不存在的图像时返回 None（不抛出异常）
        """
        result = driver.find(
            "_this_image_should_not_exist_on_screen_.png",
            timeout=1.0,
        )
        assert result is None, "查找不存在的图像应返回 None"
        logger.success("查找不存在的图像正确返回 None")

    def test_assert_exists_failure(self, driver: Driver):
        """
        验证 assert_exists 在不存在的图像上抛出 AssertionError
        并自动截图保存现场
        """
        with pytest.raises(AssertionError) as exc_info:
            driver.assert_exists(
                "_assert_fail_test_image_not_found_.png",
                timeout=1.0,
            )

        error_msg = str(exc_info.value)
        logger.info(f"断言异常信息: {error_msg}")

        # 验证异常信息包含截图路径
        assert "截图" in error_msg or "screenshot" in error_msg, \
            f"异常信息应包含截图提示: {error_msg}"
        assert ".png" in error_msg, f"异常信息应包含截图文件名: {error_msg}"

        logger.success(f"assert_exists 失败时正确抛出 AssertionError")

    def test_find_with_low_similarity(self, driver: Driver):
        """
        验证使用极高相似度阈值时，普通元素无法匹配
        """
        # 使用 0.99 的极高阈值，大概率找不到任何内容
        result = driver.find(
            "_nonexistent_high_threshold_test_.png",
            similarity=0.99,
            timeout=1.0,
        )
        assert result is None, "极高阈值下应无法匹配"
        logger.success("高相似度阈值测试通过")

    def test_driver_config(self):
        """
        验证 Driver 默认配置正确
        """
        d = Driver()
        assert d.config.similarity == Config.DEFAULT_SIMILARITY
        assert d.config.timeout == Config.DEFAULT_TIMEOUT
        assert d.config.min_wait == Config.DEFAULT_MIN_WAIT
        logger.success(f"Driver 默认配置正确: {d.config}")

    def test_custom_config(self):
        """
        验证自定义配置的 Driver
        """
        custom_cfg = Config(similarity=0.85, timeout=10.0)
        d = Driver(custom_cfg)
        assert d.config.similarity == 0.85
        assert d.config.timeout == 10.0
        logger.success(f"自定义配置 Driver 正确: {d.config}")


class TestPageObjectDemo:
    """Page Object 模式演示"""

    def test_base_page_screenshot(self, driver: Driver):
        """
        演示通过 BasePage 进行截图
        """
        from pages.base_page import BasePage

        page = BasePage(driver)
        path = page.screenshot("demo_page.png")

        try:
            assert os.path.exists(path)
            logger.success(f"BasePage 截图成功: {path}")
        finally:
            if os.path.exists(path):
                os.remove(path)

    def test_base_page_global_asset_path(self, driver: Driver):
        """
        演示 BasePage 的全局资产路径解析
        """
        from pages.base_page import BasePage

        page = BasePage(driver)
        global_path = page.get_global_asset_path("confirm.png")

        # 验证路径包含 assets/global/confirm.png
        assert "assets" in global_path
        assert "global" in global_path
        assert global_path.endswith("confirm.png")
        logger.success(f"全局资产路径解析正确: {global_path}")

    def test_base_page_app_asset_path(self, driver: Driver):
        """
        演示 BasePage 的应用资产路径解析
        """
        from pages.base_page import BasePage

        page = BasePage(driver)
        app_path = page.get_asset_path("login", "button.png")

        # 验证路径包含 assets/apps/base/login/button.png
        assert "apps" in app_path
        assert app_path.endswith("login\\button.png") or app_path.endswith("login/button.png")
        logger.success(f"应用资产路径解析正确: {app_path}")
