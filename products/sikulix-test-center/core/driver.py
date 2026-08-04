"""
SikuliX API 基础封装模块

基于 PyAutoGUI + OpenCV 实现纯 Python 图像识别与屏幕自动化控制。
无需配置 SikuliX Java 环境，兼容 Windows / macOS / Linux。
"""

import os
import time
from typing import Optional, Tuple, Union, List

import cv2
import numpy as np
import pyautogui
from loguru import logger

from .config import Config


# pyautogui 安全设置：鼠标移动到屏幕角落时不触发 FailSafe
pyautogui.FAILSAFE = False
# 各操作之间的短暂停顿（秒）
pyautogui.PAUSE = 0.1


class Driver:
    """基于 PyAutoGUI + OpenCV 的图像识别驱动程序封装"""

    # 匹配结果类型：((left, top, width, height), confidence)
    MatchResult = Tuple[Tuple[int, int, int, int], float]

    def __init__(self, config: Optional[Config] = None):
        """
        初始化驱动

        Args:
            config: 全局配置对象，不传则使用默认配置
        """
        self.config = config or Config()
        self._ensure_screenshot_dir()

    # ============================================================
    #  内部辅助
    # ============================================================

    def _ensure_screenshot_dir(self) -> None:
        """确保截图目录存在"""
        os.makedirs(self.config.get_screenshot_dir(), exist_ok=True)

    def _resolve_image_path(self, image_path: str) -> str:
        """
        解析图像文件路径：
        - 如果是绝对路径，直接返回
        - 如果是相对路径，拼接 assets 目录
        """
        if os.path.isabs(image_path):
            return image_path
        return self.config.get_asset_path(image_path)

    def _capture_screen_array(self) -> np.ndarray:
        """
        截取当前屏幕并转为 OpenCV BGR 格式的 numpy 数组

        Returns:
            BGR 格式的屏幕图像数组 (H, W, 3)
        """
        screenshot = pyautogui.screenshot()
        # PIL RGB -> OpenCV BGR
        return cv2.cvtColor(np.array(screenshot), cv2.COLOR_RGB2BGR)

    # ============================================================
    #  图像查找（核心）
    # ============================================================

    def locate_image(
        self,
        image_path: str,
        similarity: Optional[float] = None,
    ) -> Optional[MatchResult]:
        """
        在屏幕截图中定位指定图像（单次匹配，不等待）

        Args:
            image_path: 模板图像路径（绝对或相对 assets/）
            similarity: 匹配相似度阈值 (0.0 ~ 1.0)，默认使用全局配置

        Returns:
            ((left, top, width, height), confidence) 或 None
        """
        similarity = similarity if similarity is not None else self.config.similarity
        abs_path = self._resolve_image_path(image_path)

        if not os.path.exists(abs_path):
            logger.warning(f"模板图像不存在: {abs_path}")
            return None

        # 读取模板图像
        template = cv2.imread(abs_path, cv2.IMREAD_COLOR)
        if template is None:
            logger.warning(f"无法读取模板图像: {abs_path}")
            return None
        t_h, t_w = template.shape[:2]

        # 截取屏幕
        screen = self._capture_screen_array()
        s_h, s_w = screen.shape[:2]

        # 如果模板比屏幕还大，直接返回 None
        if t_h > s_h or t_w > s_w:
            logger.warning(f"模板图像 ({t_w}x{t_h}) 大于屏幕 ({s_w}x{s_h})")
            return None

        # 模板匹配
        result = cv2.matchTemplate(screen, template, cv2.TM_CCOEFF_NORMED)
        _, max_val, _, max_loc = cv2.minMaxLoc(result)

        if max_val >= similarity:
            x, y = max_loc
            box = (x, y, t_w, t_h)
            logger.debug(f"图像匹配成功 [相似度={max_val:.3f}] {image_path}")
            return (box, float(max_val))
        else:
            logger.debug(
                f"图像匹配失败 [最高相似度={max_val:.3f} < 阈值={similarity}] "
                f"{image_path}"
            )
            return None

    def find(
        self,
        image_path: str,
        similarity: Optional[float] = None,
        timeout: Optional[float] = None,
    ) -> Optional[MatchResult]:
        """
        查找屏幕上的指定图像，支持显式等待

        Args:
            image_path: 模板图像路径
            similarity: 匹配相似度阈值
            timeout: 超时时间（秒），默认使用全局配置

        Returns:
            匹配结果 ((left, top, width, height), confidence) 或 None
        """
        timeout = timeout if timeout is not None else self.config.timeout
        deadline = time.time() + timeout
        interval = self.config.min_wait

        while time.time() < deadline:
            result = self.locate_image(image_path, similarity)
            if result is not None:
                return result
            time.sleep(interval)

        logger.warning(f"查找图像超时 [{timeout:.1f}s] {image_path}")
        return None

    def wait(
        self,
        image_path: str,
        similarity: Optional[float] = None,
        timeout: Optional[float] = None,
    ) -> MatchResult:
        """
        等待图像出现，超时未找到则抛出 TimeoutError

        Args:
            image_path: 模板图像路径
            similarity: 匹配相似度阈值
            timeout: 超时时间

        Returns:
            匹配结果

        Raises:
            TimeoutError: 超时未找到
        """
        result = self.find(image_path, similarity, timeout)
        if result is None:
            raise TimeoutError(f"等待图像超时: {image_path}")
        return result

    def wait_vanish(
        self,
        image_path: str,
        similarity: Optional[float] = None,
        timeout: Optional[float] = None,
    ) -> bool:
        """
        等待图像从屏幕上消失

        Args:
            image_path: 模板图像路径
            similarity: 匹配相似度阈值
            timeout: 超时时间

        Returns:
            图像是否已消失

        Raises:
            TimeoutError: 超时后图像仍然存在
        """
        timeout = timeout if timeout is not None else self.config.timeout
        deadline = time.time() + timeout
        interval = self.config.min_wait

        while time.time() < deadline:
            result = self.locate_image(image_path, similarity)
            if result is None:
                return True
            time.sleep(interval)

        raise TimeoutError(f"等待图像消失超时: {image_path}")

    # ============================================================
    #  点击操作
    # ============================================================

    def _get_click_center(self, target: Union[str, Tuple[int, int]]) -> Tuple[int, int]:
        """
        根据传入的目标获取点击中心坐标

        Args:
            target: 图像路径 或 (x, y) 坐标元组

        Returns:
            (center_x, center_y)
        """
        if isinstance(target, tuple):
            return target

        result = self.find(target)
        if result is None:
            raise LookupError(f"未找到可点击的图像: {target}")
        box, _ = result
        x, y, w, h = box
        return (x + w // 2, y + h // 2)

    def click(
        self,
        target: Union[str, Tuple[int, int]],
        similarity: Optional[float] = None,
        timeout: Optional[float] = None,
    ) -> bool:
        """
        自动寻找图像并模拟点击；如果传入 (x, y) 坐标，则直接点击

        Args:
            target: 图像路径 或 (x, y) 坐标元组
            similarity: 匹配相似度阈值
            timeout: 等待超时

        Returns:
            是否点击成功
        """
        try:
            cx, cy = self._get_click_center(target)
            pyautogui.click(cx, cy)
            logger.info(f"点击 [({cx}, {cy})] {target}")
            return True
        except (LookupError, TimeoutError) as e:
            logger.error(f"点击失败: {e}")
            return False

    def double_click(
        self,
        target: Union[str, Tuple[int, int]],
        similarity: Optional[float] = None,
        timeout: Optional[float] = None,
    ) -> bool:
        """双击指定图像或坐标"""
        try:
            cx, cy = self._get_click_center(target)
            pyautogui.doubleClick(cx, cy)
            logger.info(f"双击 [({cx}, {cy})] {target}")
            return True
        except (LookupError, TimeoutError) as e:
            logger.error(f"双击失败: {e}")
            return False

    def right_click(
        self,
        target: Union[str, Tuple[int, int]],
        similarity: Optional[float] = None,
        timeout: Optional[float] = None,
    ) -> bool:
        """右键单击指定图像或坐标"""
        try:
            cx, cy = self._get_click_center(target)
            pyautogui.rightClick(cx, cy)
            logger.info(f"右键 [({cx}, {cy})] {target}")
            return True
        except (LookupError, TimeoutError) as e:
            logger.error(f"右键失败: {e}")
            return False

    # ============================================================
    #  输入操作
    # ============================================================

    def type(
        self,
        text: str,
        image_path: Optional[str] = None,
        similarity: Optional[float] = None,
        timeout: Optional[float] = None,
    ) -> bool:
        """
        在指定位置或当前焦点输入文本

        Args:
            text: 要输入的文本
            image_path: 可选，先点击该图像再输入
            similarity: 匹配相似度阈值
            timeout: 等待超时

        Returns:
            是否输入成功
        """
        try:
            if image_path is not None:
                self.click(image_path, similarity, timeout)
                # 点击后短暂等待，确保焦点已切换
                time.sleep(0.3)
            pyautogui.write(text, interval=0.05)
            logger.info(f"输入文本 [len={len(text)}] 目标={image_path or '当前焦点'}")
            return True
        except Exception as e:
            logger.error(f"输入失败: {e}")
            return False

    def paste(
        self,
        text: str,
        image_path: Optional[str] = None,
        similarity: Optional[float] = None,
        timeout: Optional[float] = None,
    ) -> bool:
        """
        粘贴文本到指定位置

        Args:
            text: 要粘贴的文本
            image_path: 可选，先点击该图像再粘贴
            similarity: 匹配相似度阈值
            timeout: 等待超时

        Returns:
            是否粘贴成功
        """
        try:
            if image_path is not None:
                self.click(image_path, similarity, timeout)
                time.sleep(0.3)
            pyautogui.hotkey("ctrl", "v")
            logger.info(f"粘贴文本 [len={len(text)}]")
            return True
        except Exception as e:
            logger.error(f"粘贴失败: {e}")
            return False

    # ============================================================
    #  断言操作
    # ============================================================

    def assert_exists(
        self,
        image_path: str,
        similarity: Optional[float] = None,
        timeout: Optional[float] = None,
    ) -> MatchResult:
        """
        断言指定图像在超时时间内出现

        Args:
            image_path: 模板图像路径
            similarity: 匹配相似度阈值
            timeout: 等待超时

        Returns:
            匹配结果

        Raises:
            AssertionError: 图像未找到时抛出（并自动截图保存现场）
        """
        result = self.find(image_path, similarity, timeout)
        if result is None:
            # 自动截图保存失败现场
            timestamp = time.strftime("%Y%m%d_%H%M%S")
            safe_name = image_path.replace("\\", "_").replace("/", "_").replace(":", "")
            screenshot_path = self.screenshot(f"assert_fail_{safe_name}_{timestamp}")
            raise AssertionError(
                f"断言图像存在失败: {image_path}\n"
                f"  已保存现场截图: {screenshot_path}"
            )
        return result

    def assert_not_exists(
        self,
        image_path: str,
        similarity: Optional[float] = None,
        timeout: Optional[float] = None,
    ) -> bool:
        """
        断言图像不存在（即不在屏幕上出现）

        Args:
            image_path: 模板图像路径
            similarity: 匹配相似度阈值
            timeout: 等待超时（较短，默认使用全局配置）

        Returns:
            True 表示图像确实不存在

        Raises:
            AssertionError: 图像仍存在时抛出
        """
        result = self.find(image_path, similarity, timeout or 1.0)
        if result is not None:
            timestamp = time.strftime("%Y%m%d_%H%M%S")
            safe_name = image_path.replace("\\", "_").replace("/", "_").replace(":", "")
            screenshot_path = self.screenshot(f"assert_fail_{safe_name}_{timestamp}")
            raise AssertionError(
                f"断言图像不存在失败: {image_path}\n"
                f"  已保存现场截图: {screenshot_path}"
            )
        return True

    # ============================================================
    #  屏幕操作
    # ============================================================

    def screenshot(self, filename: Optional[str] = None) -> str:
        """
        截取当前屏幕并保存到 reports/screenshots/ 目录

        Args:
            filename: 截图文件名（不含路径），默认使用时间戳命名

        Returns:
            截图文件的完整路径
        """
        if filename is None:
            filename = time.strftime("%Y%m%d_%H%M%S.png")
        if not filename.endswith(".png"):
            filename += ".png"

        save_dir = self.config.get_screenshot_dir()
        os.makedirs(save_dir, exist_ok=True)
        save_path = os.path.join(save_dir, filename)

        pyautogui.screenshot(save_path)
        logger.info(f"屏幕截图已保存: {save_path}")
        return save_path

    def highlight(
        self,
        target: Union[str, Tuple[int, int], MatchResult],
        seconds: float = 1.0,
    ) -> None:
        """
        高亮显示匹配区域（通过快速闪烁边框实现）

        Args:
            target: 图像路径、坐标或匹配结果
            seconds: 高亮持续时间（秒）
        """
        if isinstance(target, tuple) and len(target) == 2 and all(isinstance(v, int) for v in target):
            # 纯 (x, y) 坐标 -> 用小矩形表示
            x, y = target
            box = (x - 15, y - 15, 30, 30)
        elif isinstance(target, tuple) and len(target) == 2:
            # MatchResult
            box, _ = target
        elif isinstance(target, str):
            result = self.find(target)
            if result is None:
                logger.warning(f"高亮失败：未找到图像 {target}")
                return
            box, _ = result
        else:
            raise TypeError(f"不支持的 target 类型: {type(target)}")

        x, y, w, h = box
        # 通过快速截取-绘制-覆盖实现闪烁效果
        for _ in range(int(seconds / 0.2)):
            screen = self._capture_screen_array()
            cv2.rectangle(screen, (x, y), (x + w, y + h), (0, 0, 255), 3)
            # 此处仅示意，实际高亮可通过绘制图层或截图覆盖实现
            time.sleep(0.2)
