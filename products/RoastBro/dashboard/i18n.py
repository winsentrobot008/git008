"""
Internationalization (i18n) Module for RoastBro Dashboard
===========================================================
Provides language switching between Chinese (zh) and English (en).

Usage:
    from dashboard.i18n import translate, set_language, get_current_lang

    set_language("zh")        # switch to Chinese
    text = translate("title") # returns translated string

    set_language("en")        # switch to English
    text = translate("title") # returns translated string
"""

import os
import json
from pathlib import Path
from typing import Optional

ROOT = Path(__file__).resolve().parent.parent

# ── Translation dictionaries ──────────────────────────
_translations: dict = {}
_current_lang: str = "zh"


def _load_translations(lang: str) -> dict:
    """Load translation dictionary for the given language code."""
    lang_file = ROOT / "dashboard" / "i18n" / f"{lang}.json"
    if not lang_file.exists():
        return {}
    try:
        return json.loads(lang_file.read_text(encoding="utf-8"))
    except Exception:
        return {}


def set_language(lang: str):
    """Set the current language (zh or en)."""
    global _current_lang, _translations
    if lang in ("zh", "en"):
        _current_lang = lang
        _translations = _load_translations(lang)


def get_current_lang() -> str:
    """Return the current language code."""
    return _current_lang


def translate(key: str, default: Optional[str] = None) -> str:
    """
    Translate a key to the current language.

    Args:
        key: The translation key (e.g. "title", "run_fullstack")
        default: Fallback text if key not found

    Returns:
        Translated string, or default, or the key itself as fallback.
    """
    if key in _translations:
        return _translations[key]
    if default is not None:
        return default
    return key


# ── Initialize with default language ──────────────────
def init():
    """Initialize i18n with the configured default language."""
    config_path = ROOT / "configs" / "language.json"
    lang = "zh"  # default
    if config_path.exists():
        try:
            data = json.loads(config_path.read_text(encoding="utf-8"))
            lang = data.get("default", "zh")
        except Exception:
            pass
    set_language(lang)


# Auto-init on import
init()
