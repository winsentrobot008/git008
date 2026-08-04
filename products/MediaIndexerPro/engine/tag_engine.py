"""
MediaIndexerPro — Tag Engine: Tags, History, Favorites

JSON-based storage at storage/tags.json, storage/history.json, storage/favorites.json
"""

import json
import time
from datetime import datetime
from pathlib import Path

STORAGE_DIR = Path(__file__).parent.parent / "storage"


def _read_json(name: str) -> dict:
    path = STORAGE_DIR / name
    if path.exists():
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    return {}


def _write_json(name: str, data: dict) -> None:
    path = STORAGE_DIR / name
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


# ── Tags ──

def add_tag(item_id: str, tag: str) -> dict:
    data = _read_json("tags.json")
    if item_id not in data:
        data[item_id] = []
    if tag not in data[item_id]:
        data[item_id].append(tag)
    _write_json("tags.json", data)
    return {"status": "ok", "tags": data[item_id]}


def remove_tag(item_id: str, tag: str) -> dict:
    data = _read_json("tags.json")
    if item_id in data and tag in data[item_id]:
        data[item_id].remove(tag)
        if not data[item_id]:
            del data[item_id]
        _write_json("tags.json", data)
    return {"status": "ok", "tags": data.get(item_id, [])}


def search_tags(tag: str) -> list[dict]:
    """Find all items with a given tag. Returns list of {item_id, title?}."""
    data = _read_json("tags.json")
    results = []
    for item_id, tags in data.items():
        if any(tag.lower() in t.lower() for t in tags):
            results.append({"item_id": item_id, "tags": tags})
    return results


# ── History ──

def add_history(topic: str, category: str = "all", total_items: int = 0) -> dict:
    data = _read_json("history.json")
    entry = {
        "topic": topic,
        "category": category,
        "total_items": total_items,
        "timestamp": datetime.utcnow().isoformat() + "Z",
    }
    # Insert at front, keep max 20
    entries = data.get("entries", [])
    # Remove duplicate topic
    entries = [e for e in entries if e.get("topic") != topic]
    entries.insert(0, entry)
    entries = entries[:20]
    data["entries"] = entries
    _write_json("history.json", data)
    return entry


def list_history() -> list[dict]:
    data = _read_json("history.json")
    return data.get("entries", [])


def clear_history() -> dict:
    _write_json("history.json", {"entries": []})
    return {"status": "ok", "message": "History cleared"}


# ── Favorites ──

def add_favorite(item: dict) -> dict:
    data = _read_json("favorites.json")
    items = data.get("items", [])
    # Check duplicate by URL
    url = item.get("url", "") or item.get("link", "")
    if not any(i.get("url") == url or i.get("link") == url for i in items):
        item["added_at"] = datetime.utcnow().isoformat() + "Z"
        items.insert(0, item)
        data["items"] = items[:100]  # max 100
        _write_json("favorites.json", data)
    return {"status": "ok", "count": len(items)}


def remove_favorite(url: str) -> dict:
    data = _read_json("favorites.json")
    items = data.get("items", [])
    data["items"] = [i for i in items if i.get("url") != url and i.get("link") != url]
    _write_json("favorites.json", data)
    return {"status": "ok", "count": len(data["items"])}


def list_favorites() -> list[dict]:
    data = _read_json("favorites.json")
    return data.get("items", [])
