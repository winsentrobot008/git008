"""
MediaIndexerPro — 语义关键词扩展引擎

输入主题 → 输出扩展关键词列表
当前为占位实现：从 keyword_map.yaml 匹配已知主题；
未知主题直接返回主题本身作为关键词。
"""

from pathlib import Path
from typing import Optional
import yaml


def load_keyword_map() -> dict:
    """Load the keyword map from YAML"""
    map_path = Path(__file__).parent / "keyword_map.yaml"
    with open(map_path, "r", encoding="utf-8") as f:
        return yaml.safe_load(f)


def expand_keywords(topic: str, keyword_map: Optional[dict] = None) -> list[str]:
    """
    Expand a topic into a list of search keywords.

    Args:
        topic: The user-input topic (e.g. "焦虑型人格", "Elon Musk")
        keyword_map: Optional pre-loaded keyword map. If None, loads from file.

    Returns:
        List of expanded keyword strings for searching.
    """
    if keyword_map is None:
        keyword_map = load_keyword_map()

    # Try to match topic label (Chinese or English)
    for key, entry in keyword_map.items():
        label = entry.get("label", "")
        if topic.lower() in label.lower() or topic.lower() in key.lower():
            return entry.get("keywords", [topic])

    # Fallback: return topic as-is
    # TODO: Implement LLM-based semantic expansion for unseen topics
    return [topic]
