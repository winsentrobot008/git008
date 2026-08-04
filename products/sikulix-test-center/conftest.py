"""
Pytest 全局配置与插件

提供：
1. driver 和 config 的 pytest fixture
2. 测试失败自动截图 Hook
3. Allure 报告集成（可选）
"""

import os
import time
from typing import Iterator

import pytest
from loguru import logger

from core.driver import Driver
from core.config import Config


# ============================================================
#  Fixtures
# ============================================================


@pytest.fixture(scope="session")
def config() -> Config:
    """
    全局配置 fixture（session 级别）

    可通过环境变量覆盖配置项：
    - TC_SIMILARITY: 图像匹配相似度
    - TC_TIMEOUT:    默认超时时间
    - TC_PROJECT_ROOT: 项目根目录
    """
    cfg = Config(
        similarity=float(os.getenv("TC_SIMILARITY", Config.DEFAULT_SIMILARITY)),
        timeout=float(os.getenv("TC_TIMEOUT", Config.DEFAULT_TIMEOUT)),
    )
    logger.info(f"测试配置: {cfg}")
    return cfg


@pytest.fixture(scope="function")
def driver(config: Config) -> Iterator[Driver]:
    """
    Driver fixture（function 级别，每个测试用例独立）

    自动完成初始化和清理：
    - setup:  创建 Driver 实例
    - teardown: 无特殊清理，保持状态（屏幕自动化不残留资源）
    """
    _driver = Driver(config)
    logger.debug("Driver 初始化完成")
    yield _driver
    logger.debug("Driver 清理完成")


# ============================================================
#  测试失败自动截图 Hook
# ============================================================


@pytest.hookimpl(tryfirst=True, hookwrapper=True)
def pytest_runtest_makereport(item: pytest.Item, call: pytest.CallInfo) -> None:
    """
    测试用例执行完毕后，若失败则自动截图保存现场。

    截图文件名格式:
        FAIL_<test_module>.<test_name>_<timestamp>.png
    """
    outcome = yield
    report = outcome.get_result()

    # 仅在测试调用阶段（call）且失败时触发
    if report.when == "call" and report.failed:
        # 尝试从 fixture 缓存中获取 driver 实例
        driver_instance = None
        try:
            if hasattr(item, "funcargs") and "driver" in item.funcargs:
                driver_instance = item.funcargs["driver"]
        except Exception:
            pass

        if driver_instance is None:
            # 兜底：使用默认配置创建一个临时 driver 用于截图
            try:
                driver_instance = Driver()
            except Exception as e:
                logger.error(f"无法创建 Driver 用于失败截图: {e}")
                return

        # 生成截图文件名
        module_name = getattr(item.module, "__name__", "unknown")
        test_name = item.nodeid.replace("::", ".").replace("/", ".")
        timestamp = time.strftime("%Y%m%d_%H%M%S")
        filename = f"FAIL_{module_name}.{test_name}_{timestamp}.png"

        try:
            screenshot_path = driver_instance.screenshot(filename)
            logger.warning(f"测试失败截图已保存: {screenshot_path}")

            # 挂载到 Allure 报告（如已安装 allure-pytest）
            _attach_to_allure(report, screenshot_path)

        except Exception as e:
            logger.error(f"测试失败截图保存失败: {e}")


def _attach_to_allure(report: pytest.TestReport, screenshot_path: str) -> None:
    """
    将截图附加到 Allure 报告中

    需要安装 allure-pytest:
        pip install allure-pytest
    """
    try:
        import allure

        if os.path.exists(screenshot_path):
            with open(screenshot_path, "rb") as f:
                allure.attach(
                    f.read(),
                    name=f"失败现场截图",
                    attachment_type=allure.attachment_type.PNG,
                )
            logger.debug("截图已挂载到 Allure 报告")
    except ImportError:
        # 未安装 allure-pytest，静默跳过
        pass
    except Exception as e:
        logger.warning(f"挂载截图到 Allure 失败: {e}")


# ============================================================
#  Pytest 命令行选项
# ============================================================


def pytest_addoption(parser: pytest.Parser) -> None:
    """添加自定义命令行选项"""
    parser.addoption(
        "--tc-similarity",
        type=float,
        default=None,
        help="图像匹配相似度阈值 (0.0 ~ 1.0)，覆盖环境变量 TC_SIMILARITY",
    )
    parser.addoption(
        "--tc-timeout",
        type=float,
        default=None,
        help="默认超时时间（秒），覆盖环境变量 TC_TIMEOUT",
    )


def pytest_configure(config: pytest.Config) -> None:
    """pytest 配置完成后回调"""
    # 确保截图目录存在
    from core.config import Config as CoreConfig
    default_cfg = CoreConfig()
    os.makedirs(default_cfg.get_screenshot_dir(), exist_ok=True)
    logger.info(f"截图目录已就绪: {default_cfg.get_screenshot_dir()}")
