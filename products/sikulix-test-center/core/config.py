"""
全局配置模块

管理 SikuliX 自动化测试的全局参数，
包括相似度阈值、超时时间、图像搜索策略等。
"""

from typing import Optional
import os


class Config:
    """全局配置类"""

    # 默认配置值
    DEFAULT_SIMILARITY: float = 0.7
    DEFAULT_TIMEOUT: float = 5.0
    DEFAULT_MIN_WAIT: float = 0.5
    ASSETS_BASE_DIR: str = "assets"
    SCREENSHOTS_DIR: str = "reports/screenshots"

    def __init__(
        self,
        similarity: Optional[float] = None,
        timeout: Optional[float] = None,
        min_wait: Optional[float] = None,
        assets_base_dir: Optional[str] = None,
        screenshots_dir: Optional[str] = None,
        project_root: Optional[str] = None,
    ):
        """
        初始化配置

        Args:
            similarity: 图像匹配相似度阈值 (0.0 ~ 1.0)
            timeout: 默认超时时间（秒）
            min_wait: 最小轮询等待时间（秒）
            assets_base_dir: 图像资产基础目录
            screenshots_dir: 截图保存目录
            project_root: 项目根目录，默认自动检测
        """
        self.similarity = similarity if similarity is not None else self.DEFAULT_SIMILARITY
        self.timeout = timeout if timeout is not None else self.DEFAULT_TIMEOUT
        self.min_wait = min_wait if min_wait is not None else self.DEFAULT_MIN_WAIT
        self.assets_base_dir = assets_base_dir or self.ASSETS_BASE_DIR
        self.screenshots_dir = screenshots_dir or self.SCREENSHOTS_DIR
        self.project_root = project_root or self._detect_project_root()

    def _detect_project_root(self) -> str:
        """
        自动检测项目根目录

        从当前文件位置向上查找，定位到 sikulix-test-center 根目录
        """
        current_dir = os.path.dirname(os.path.abspath(__file__))
        # 从 core/ 向上回溯两层到项目根目录
        return os.path.dirname(current_dir)

    def get_asset_path(self, *sub_paths: str) -> str:
        """
        获取资产文件的完整路径

        Args:
            *sub_paths: 资产子路径（如 "global", "confirm.png"）

        Returns:
            资产文件的完整绝对路径
        """
        return os.path.join(self.project_root, self.assets_base_dir, *sub_paths)

    def get_screenshot_dir(self) -> str:
        """
        获取截图保存目录的完整路径
        """
        return os.path.join(self.project_root, self.screenshots_dir)

    def get_app_asset_path(self, app_name: str, *sub_paths: str) -> str:
        """
        获取指定应用的资产文件完整路径

        Args:
            app_name: 应用名称（对应 assets/apps/<app_name>/）
            *sub_paths: 资产子路径

        Returns:
            assets/apps/<app_name>/... 的完整路径
        """
        return self.get_asset_path("apps", app_name, *sub_paths)

    def override(self, **kwargs) -> "Config":
        """
        生成配置副本并覆盖指定参数

        Args:
            **kwargs: 要覆盖的配置参数

        Returns:
            新的 Config 实例
        """
        new_config = Config(
            similarity=kwargs.get("similarity", self.similarity),
            timeout=kwargs.get("timeout", self.timeout),
            min_wait=kwargs.get("min_wait", self.min_wait),
            assets_base_dir=kwargs.get("assets_base_dir", self.assets_base_dir),
            screenshots_dir=kwargs.get("screenshots_dir", self.screenshots_dir),
            project_root=kwargs.get("project_root", self.project_root),
        )
        return new_config

    def __repr__(self) -> str:
        return (
            f"Config("
            f"similarity={self.similarity}, "
            f"timeout={self.timeout}, "
            f"min_wait={self.min_wait}, "
            f"assets={self.assets_base_dir}, "
            f"screenshots={self.screenshots_dir}"
            f")"
        )
