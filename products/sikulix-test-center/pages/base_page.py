"""
Page Object 基类

所有页面对象的基类，封装 Driver 实例引用以及图像资产路径解析。
"""

from typing import Optional, Tuple, Union

from core.driver import Driver
from core.config import Config


class BasePage:
    """页面对象基类"""

    # 子类覆盖此属性以指定所属应用名（对应 assets/apps/<app_name>/）
    APP_NAME: str = ""

    def __init__(self, driver: Optional[Driver] = None):
        """
        初始化页面对象

        Args:
            driver: Driver 实例，不传则自动创建
        """
        self.driver = driver or Driver()
        self._app_name = self._resolve_app_name()

    def _resolve_app_name(self) -> str:
        """解析应用名称，优先使用类属性，否则从类名推断"""
        if self.APP_NAME:
            return self.APP_NAME
        # 从类名推断：LoginPage -> login, DashboardPage -> dashboard
        name = type(self).__name__
        if name.endswith("Page"):
            name = name[:-4]
        return name.lower()

    # ---- 资产路径解析 ----

    def get_asset_path(self, *relative_path: str) -> str:
        """
        获取当前应用资产文件的完整路径

        自动拼接为: assets/apps/<app_name>/<relative_path>

        Args:
            *relative_path: 相对路径片段（如 ("login", "button.png")）

        Returns:
            资产的完整绝对路径
        """
        return self.driver.config.get_app_asset_path(self._app_name, *relative_path)

    def get_global_asset_path(self, *relative_path: str) -> str:
        """
        获取全局通用资产文件的完整路径

        自动拼接为: assets/global/<relative_path>

        Args:
            *relative_path: 相对路径片段

        Returns:
            资产的完整绝对路径
        """
        return self.driver.config.get_asset_path("global", *relative_path)

    # ---- 高频页面动作封装 ----

    def click_element(
        self,
        image_name: str,
        sub_dir: Optional[str] = None,
        similarity: Optional[float] = None,
        timeout: Optional[float] = None,
    ) -> bool:
        """
        点击当前应用下的指定 UI 元素

        Args:
            image_name: 图像文件名（如 "login_button.png"）
            sub_dir: 可选子目录（如 "header", "form"）
            similarity: 匹配相似度阈值
            timeout: 等待超时

        Returns:
            是否点击成功
        """
        path_parts = []
        if sub_dir:
            path_parts.append(sub_dir)
        path_parts.append(image_name)
        asset_path = self.get_asset_path(*path_parts)
        return self.driver.click(asset_path, similarity, timeout)

    def input_text(
        self,
        text: str,
        image_name: str,
        sub_dir: Optional[str] = None,
        similarity: Optional[float] = None,
        timeout: Optional[float] = None,
    ) -> bool:
        """
        在当前应用的输入框中输入文本

        Args:
            text: 要输入的文本
            image_name: 输入框的图像文件名
            sub_dir: 可选子目录
            similarity: 匹配相似度阈值
            timeout: 等待超时

        Returns:
            是否输入成功
        """
        path_parts = []
        if sub_dir:
            path_parts.append(sub_dir)
        path_parts.append(image_name)
        asset_path = self.get_asset_path(*path_parts)
        return self.driver.type(text, asset_path, similarity, timeout)

    def wait_for_element(
        self,
        image_name: str,
        sub_dir: Optional[str] = None,
        similarity: Optional[float] = None,
        timeout: Optional[float] = None,
    ) -> object:
        """
        等待当前应用的某个 UI 元素出现

        Args:
            image_name: 图像文件名
            sub_dir: 可选子目录
            similarity: 匹配相似度阈值
            timeout: 等待超时

        Returns:
            匹配结果 ((left, top, width, height), confidence)

        Raises:
            TimeoutError: 超时未出现
        """
        path_parts = []
        if sub_dir:
            path_parts.append(sub_dir)
        path_parts.append(image_name)
        asset_path = self.get_asset_path(*path_parts)
        return self.driver.wait(asset_path, similarity, timeout)

    def assert_element_exists(
        self,
        image_name: str,
        sub_dir: Optional[str] = None,
        similarity: Optional[float] = None,
        timeout: Optional[float] = None,
    ) -> object:
        """
        断言当前应用的指定 UI 元素存在

        Args:
            image_name: 图像文件名
            sub_dir: 可选子目录
            similarity: 匹配相似度阈值
            timeout: 等待超时

        Returns:
            匹配结果

        Raises:
            AssertionError: 元素未找到（自动截图）
        """
        path_parts = []
        if sub_dir:
            path_parts.append(sub_dir)
        path_parts.append(image_name)
        asset_path = self.get_asset_path(*path_parts)
        return self.driver.assert_exists(asset_path, similarity, timeout)

    def screenshot(self, filename: Optional[str] = None) -> str:
        """
        截取当前屏幕

        Args:
            filename: 截图文件名

        Returns:
            截图文件完整路径
        """
        prefix = f"{self._app_name}_"
        if filename is None:
            import time
            filename = f"{prefix}{time.strftime('%Y%m%d_%H%M%S')}.png"
        elif not filename.startswith(prefix):
            filename = prefix + filename
        return self.driver.screenshot(filename)
