"""GIT008 仓库路径统一解析。

根目录判定以本文件位置为锚点（src/core/paths.py → 仓库根），
所有制造模块（video / voice / indexer）都通过这里取产品目录与产物目录。
"""

from pathlib import Path

# C:\Users\aoogoost\Desktop\Projekt\git008
REPO_ROOT = Path(__file__).resolve().parents[2]

PRODUCTS_DIR = REPO_ROOT / "products"
VIDEO_FACTORY_DIR = PRODUCTS_DIR / "008-video-factory"
MODULES_DIR = VIDEO_FACTORY_DIR / "modules"
TEMPLATES_DIR = VIDEO_FACTORY_DIR / "templates"
# 视频工厂成品统一归档到 products/008-video-factory/output
OUTPUT_DIR = VIDEO_FACTORY_DIR / "output"
WORK_DIR = VIDEO_FACTORY_DIR / "work"


def product_dir(name: str) -> Path:
    """返回 products/<name> 目录（不存在时不自动创建）。"""
    return PRODUCTS_DIR / name


def video_factory_dir() -> Path:
    return VIDEO_FACTORY_DIR


def voice22_dir() -> Path:
    return product_dir("VOICE22")


def mediaindexer_dir() -> Path:
    return product_dir("MediaIndexerPro")
