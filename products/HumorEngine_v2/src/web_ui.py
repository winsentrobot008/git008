"""
HumorEngine_v2 — Gradio Web UI (3-Tab Layout)
===============================================

Tab 1 — Humor Workshop: video description, generate, feedback.
Tab 2 — Video Analyzer: upload, keyframe extraction, vision API.
Tab 3 — Trending Radar: search trending videos, download, analyze, auto-generate.

Usage:
    pip install gradio opencv-python yt-dlp
    python src/web_ui.py          # serves at http://127.0.0.1:7860
"""

from __future__ import annotations

import base64
import json
import logging
import os
import sys
import tempfile
from pathlib import Path
from typing import List, Optional

import requests

# ---------------------------------------------------------------------------
# Graceful gradio import
# ---------------------------------------------------------------------------

try:
    import gradio as gr
except ImportError:
    print("=" * 72,
          "  Missing dependency: gradio",
          "",
          "  Install it with:  pip install gradio",
          "=" * 72, sep="\n")
    sys.exit(1)

# ---------------------------------------------------------------------------
# Project imports
# ---------------------------------------------------------------------------

_project_root = Path(__file__).resolve().parent.parent
if str(_project_root) not in sys.path:
    sys.path.insert(0, str(_project_root))

from src.test_generator import (
    build_strict_system_prompt,
    execute_live_generation,
    load_constitution,
)
from src.data_pipeline import HumorDataPipeline

# Graceful video_utils import
try:
    from src.video_utils import extract_keyframes, frames_to_base64, cleanup_frames
    _HAS_CV2 = True
except ImportError:
    extract_keyframes = frames_to_base64 = cleanup_frames = None
    _HAS_CV2 = False

# Graceful downloader_utils import
try:
    from src.downloader_utils import download_viral_video
    _HAS_YTDLP = True
except ImportError:
    download_viral_video = None
    _HAS_YTDLP = False

# Graceful search_utils import
try:
    from src.search_utils import search_trending_videos
    _HAS_SEARCH = True
except ImportError:
    search_trending_videos = None
    _HAS_SEARCH = False

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-8s | %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("web_ui")

# ---------------------------------------------------------------------------
# Provider registry
# ---------------------------------------------------------------------------

PROVIDER_CONFIG = {
    "DeepSeek": {"env_key": "DEEPSEEK_API_KEY", "base_url": "https://api.deepseek.com/v1", "default_model": "deepseek-chat", "needs_key": True},
    "OpenAI": {"env_key": "OPENAI_API_KEY", "base_url": "https://api.openai.com/v1", "default_model": "gpt-4o", "needs_key": True},
    "Claude (OpenRouter)": {"env_key": "CLAUDE_API_KEY", "base_url": "https://openrouter.ai/api/v1", "default_model": "anthropic/claude-3.5-sonnet", "needs_key": True},
    "Ollama (Local)": {"env_key": None, "base_url": "http://localhost:11434/v1", "default_model": "llama3.2", "needs_key": False},
}
PROVIDER_NAMES = list(PROVIDER_CONFIG.keys())
TYPE_TO_RULE_KEY = {
    "audio_visual_counterpoint": "layer_2_non_sequitur",
    "cognitive_dissonance": "layer_2_non_sequitur",
    "deadpan": "layer_3_deadpan_tone",
    "tacit_consensus": "tacit_consensus",
}
HUMOR_TYPE_OPTIONS = list(TYPE_TO_RULE_KEY.keys())

# ---------------------------------------------------------------------------
# Secure local key storage
# ---------------------------------------------------------------------------

KEY_STORAGE_PATH = _project_root / "config" / "api_keys.json"
_OBFUSCATION_KEY = 0xAB


def _obfuscate(plain: str) -> str:
    return base64.b64encode(bytes(ord(c) ^ _OBFUSCATION_KEY for c in plain)).decode("ascii")


def _deobfuscate(obfuscated: str) -> str:
    return "".join(chr(b ^ _OBFUSCATION_KEY) for b in base64.b64decode(obfuscated.encode("ascii")))


def _load_saved_keys() -> dict:
    if not KEY_STORAGE_PATH.exists():
        return {}
    try:
        with open(KEY_STORAGE_PATH, encoding="utf-8") as f:
            raw = json.load(f)
        saved = {}
        for name, obs in raw.items():
            try:
                saved[name] = _deobfuscate(obs)
            except Exception:
                logger.warning("Could not decode saved key for %s", name)
        return saved
    except Exception as e:
        logger.warning("Failed to load %s: %s", KEY_STORAGE_PATH.name, e)
        return {}


def _save_api_keys(keys: dict) -> None:
    existing = {}
    if KEY_STORAGE_PATH.exists():
        try:
            with open(KEY_STORAGE_PATH, encoding="utf-8") as f:
                existing = json.load(f)
        except Exception:
            existing = {}
    for name, plain in keys.items():
        if plain.strip():
            existing[name] = _obfuscate(plain.strip())
        elif name in existing:
            del existing[name]
    KEY_STORAGE_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(KEY_STORAGE_PATH, "w", encoding="utf-8") as f:
        json.dump(existing, f, ensure_ascii=False, indent=2)

# ---------------------------------------------------------------------------
# Backend helpers
# ---------------------------------------------------------------------------

_constitution = None
_pipeline: Optional[HumorDataPipeline] = None


def _ensure_backend() -> None:
    global _constitution, _pipeline
    if _constitution is None:
        _constitution = load_constitution()
    if _pipeline is None:
        _pipeline = HumorDataPipeline()


def _resolve_provider_config(provider: str, key_override: str = "") -> dict:
    cfg = PROVIDER_CONFIG.get(provider, PROVIDER_CONFIG["DeepSeek"])
    api_key = key_override.strip() or os.environ.get(cfg["env_key"], "") if cfg["env_key"] else ""
    return {"api_key": api_key, "api_base_url": cfg["base_url"], "api_model": cfg["default_model"], "needs_key": cfg["needs_key"]}


# ---------------------------------------------------------------------------
# Vision API
# ---------------------------------------------------------------------------

VISION_PROMPT = (
    "Describe what is happening in this video chronologically. "
    "Detail the subjects, their expressions, actions, and any ironic "
    "or absurd contrast in the scene. Keep it factual and detailed."
)


def generate_video_description(video_path: str, provider: str, key_override: str) -> str:
    if not _HAS_CV2 or extract_keyframes is None:
        return "opencv-python is not installed. Run: pip install opencv-python"
    prov_cfg = _resolve_provider_config(provider, key_override)
    if prov_cfg["needs_key"] and not prov_cfg["api_key"]:
        return "API key is missing. Set it in Global Settings first."
    try:
        frame_paths = extract_keyframes(video_path, num_frames=4)
    except Exception as e:
        return f"Frame extraction failed: {e}"
    if not frame_paths:
        return "No frames could be extracted."
    try:
        b64_frames = frames_to_base64(frame_paths)
    except Exception as e:
        cleanup_frames(frame_paths)
        return f"Base64 encoding failed: {e}"
    content_parts: List[dict] = [{"type": "text", "text": VISION_PROMPT}]
    for uri in b64_frames:
        content_parts.append({"type": "image_url", "image_url": {"url": uri}})
    payload = {"model": prov_cfg["api_model"], "messages": [{"role": "user", "content": content_parts}], "max_tokens": 1024}
    headers = {"Content-Type": "application/json", "Authorization": f"Bearer {prov_cfg['api_key']}"}
    endpoint = f"{prov_cfg['api_base_url'].rstrip('/')}/chat/completions"
    try:
        resp = requests.post(endpoint, headers=headers, json=payload, timeout=120)
        resp.raise_for_status()
        description = resp.json()["choices"][0]["message"]["content"].strip()
    except Exception as e:
        description = f"Vision API call failed: {e}"
    finally:
        cleanup_frames(frame_paths)
    return description


# ---------------------------------------------------------------------------
# UI Callbacks — Tab 1
# ---------------------------------------------------------------------------


def on_generate(video_desc: str, humor_type: str, provider: str, key_override: str) -> tuple:
    if not video_desc.strip():
        return ("Please enter a video description.", "")
    _ensure_backend()
    cfg = PROVIDER_CONFIG.get(provider, PROVIDER_CONFIG["DeepSeek"])
    trimmed_key = key_override.strip()
    if trimmed_key and cfg.get("env_key") and trimmed_key != os.environ.get(cfg["env_key"], ""):
        os.environ[cfg["env_key"]] = trimmed_key
    prov_cfg = _resolve_provider_config(provider, key_override)
    if prov_cfg["needs_key"] and not prov_cfg["api_key"]:
        return (f"Error: Paste your API key in the '{PROVIDER_CONFIG[provider]['env_key']}' field.", "")
    rule_key = TYPE_TO_RULE_KEY.get(humor_type, "tacit_consensus")
    system_prompt = build_strict_system_prompt(_constitution)
    try:
        p = execute_live_generation(video_description=video_desc, rule_key=rule_key, constitution=_constitution,
                                     api_key=prov_cfg["api_key"], api_base_url=prov_cfg["api_base_url"], api_model=prov_cfg["api_model"])
        return p, system_prompt
    except RuntimeError as e:
        return f"API Error: {e}", system_prompt


def on_keep(video_desc: str, punchline: str, humor_type: str) -> str:
    if not punchline.strip() or punchline.startswith("["):
        return "Nothing to save."
    _ensure_backend()
    _pipeline.append_training_sample(video_desc=video_desc, punchline=punchline, is_positive=True,
                                     metadata={"humor_type": humor_type, "rating": 5, "source": "web_ui"})
    return f"Saved to SFT (total: {_pipeline.count_sft_samples()})."


def on_discard(video_desc: str, punchline: str, humor_type: str) -> str:
    if not punchline.strip() or punchline.startswith("["):
        return "Nothing to discard."
    _ensure_backend()
    _pipeline.append_training_sample(video_desc=video_desc, punchline=punchline, is_positive=False,
                                     metadata={"humor_type": humor_type, "reason": "rejected_by_user", "source": "web_ui"})
    return f"Logged discarded (total: {_pipeline.count_discarded_samples()})."


def on_provider_change(provider: str) -> tuple:
    cfg = PROVIDER_CONFIG.get(provider, PROVIDER_CONFIG["DeepSeek"])
    saved_keys = _load_saved_keys()
    saved_key = saved_keys.get(provider, "")
    if not cfg["needs_key"]:
        return "Ollama — no key required.", ""
    env = os.environ.get(cfg["env_key"], "")
    if saved_key:
        return (f"Key loaded from local storage ({provider})", saved_key)
    elif env:
        return (f"Key from {cfg['env_key']} (****{env[-4:]})", env)
    return (f"Enter your {cfg['env_key']} above.", "")


def on_save_keys(provider: str, key_value: str) -> str:
    cfg = PROVIDER_CONFIG.get(provider, PROVIDER_CONFIG["DeepSeek"])
    if not cfg["needs_key"]:
        return "Ollama — no key needed."
    if not key_value.strip():
        return "Key field is empty."
    _save_api_keys({provider: key_value.strip()})
    os.environ[cfg["env_key"]] = key_value.strip()
    return f"Key saved for {provider}!"


# ---------------------------------------------------------------------------
# UI Callbacks — Tab 2
# ---------------------------------------------------------------------------


def on_analyze_video(video_path: str, provider: str, key_override: str) -> tuple:
    if not video_path:
        return ("Upload a video first.", None)
    if not _HAS_CV2:
        return ("Install opencv-python: pip install opencv-python", None)
    try:
        frame_paths = extract_keyframes(video_path, num_frames=5)
    except Exception as e:
        return (f"Frame extraction failed: {e}", None)
    description = generate_video_description(video_path, provider, key_override)
    return description, frame_paths


def on_import_captions(analysis_text: str) -> str:
    if not analysis_text or analysis_text.startswith("opencv") or analysis_text.startswith("API") or analysis_text.startswith("Frame"):
        return ""
    return analysis_text


# ---------------------------------------------------------------------------
# UI Callbacks — Tab 3 (Trending Radar)
# ---------------------------------------------------------------------------


def on_search_videos(keyword: str) -> tuple:
    """
    Search for trending videos matching *keyword*.
    Returns a DataFrame-compatible list and a human-readable summary.
    """
    if not keyword.strip():
        return [], "Enter a search keyword."

    if not _HAS_SEARCH or search_trending_videos is None:
        return [], "search_utils not available."

    try:
        results = search_trending_videos(keyword, max_results=5)
    except Exception as e:
        return [], f"Search failed: {e}"

    if not results:
        return [], "No results found."

    # Format as list of dicts for gr.Dataframe
    rows = []
    for r in results:
        rows.append({
            "Title": r.get("title", "")[:80],
            "Source": r.get("source", ""),
            "Duration": r.get("duration", ""),
            "URL": r.get("url", ""),
        })

    summary = f"Found {len(rows)} result(s). Click a row to select, then use the action buttons below."
    return rows, summary


def on_search_analyze(keyword: str, selected_index: int, provider: str, key_override: str) -> tuple:
    """
    Download the selected video, analyze it, and return results
    for Tab 2 (analysis text + keyframes).
    """
    if not _HAS_YTDLP or download_viral_video is None:
        return "yt-dlp not installed. Run: pip install yt-dlp", None, ""

    # Re-run search to get the URL
    try:
        results = search_trending_videos(keyword, max_results=5)
    except Exception:
        return "Search failed — try again.", None, ""

    if selected_index < 0 or selected_index >= len(results):
        return "Invalid selection.", None, ""

    video_url = results[selected_index].get("url", "")
    if not video_url:
        return "No URL for selected item.", None, ""

    # Download
    try:
        local_path = download_viral_video(video_url)
    except Exception as e:
        return f"Download failed: {e}", None, ""

    # Analyze
    description, frame_paths = on_analyze_video(local_path, provider, key_override)

    status_msg = f"Downloaded + analyzed: {results[selected_index]['title'][:60]}"
    return description, frame_paths, status_msg


def on_search_autogen(keyword: str, selected_index: int, humor_type: str, provider: str, key_override: str) -> tuple:
    """
    Full pipeline: search -> download -> analyze -> generate punchline.
    Returns (description_for_tab2, punchline_for_tab1).
    """
    if not _HAS_YTDLP or download_viral_video is None:
        return "yt-dlp not installed.", "", ""

    try:
        results = search_trending_videos(keyword, max_results=5)
    except Exception:
        return "Search failed.", "", ""

    if selected_index < 0 or selected_index >= len(results):
        return "Invalid selection.", "", ""

    video_url = results[selected_index].get("url", "")
    if not video_url:
        return "No URL.", "", ""

    try:
        local_path = download_viral_video(video_url)
    except Exception as e:
        return f"Download failed: {e}", "", ""

    # Generate description via vision API
    description = generate_video_description(local_path, provider, key_override)
    if description.startswith("opencv") or description.startswith("API") or description.startswith("Frame"):
        return description, "", ""

    # Now generate punchline using the description
    _ensure_backend()
    prov_cfg = _resolve_provider_config(provider, key_override)
    if prov_cfg["needs_key"] and not prov_cfg["api_key"]:
        return "API key missing.", "", ""

    rule_key = TYPE_TO_RULE_KEY.get(humor_type, "tacit_consensus")
    system_prompt = build_strict_system_prompt(_constitution)

    try:
        punchline = execute_live_generation(
            video_description=description,
            rule_key=rule_key,
            constitution=_constitution,
            api_key=prov_cfg["api_key"],
            api_base_url=prov_cfg["api_base_url"],
            api_model=prov_cfg["api_model"],
        )
    except RuntimeError as e:
        return description, f"Punchline generation failed: {e}", ""

    status = f"Auto-generated from: {results[selected_index]['title'][:60]}"
    return description, punchline, status


# ---------------------------------------------------------------------------
# Build the Gradio UI
# ---------------------------------------------------------------------------

CSS = """
:root{--pink-light:#FFE4E1;--pink-pastel:#FFB7C5;--pink-baby:#FFC0CB;--pink-hot:#FF69B4;--pink-rose:#F08080;--pink-lavender:#E6C3D8;--pink-blush:#FFF0F5;--pink-peach:#FFDAB9;--pink-border:#FAA0A0}
.gradio-container{background:linear-gradient(135deg,#FFF0F5 0%,#FFE4E1 50%,#FFF5EE 100%)!important}
.panel,.gr-box,.gr-form,.tabs,.tab-nav,.accordion{background:rgba(255,255,255,0.75)!important;border-radius:16px!important;border:1px solid rgba(255,183,197,0.3)!important;box-shadow:0 4px 20px rgba(255,105,180,0.08)!important}
input,textarea,select,.gr-input,.gr-text-input{border-radius:12px!important;border:1.5px solid #FFD1DC!important;background:rgba(255,255,255,0.85)!important;transition:border-color 0.3s ease,box-shadow 0.3s ease!important}
input:focus,textarea:focus,select:focus,.gr-input:focus,.gr-text-input:focus{border-color:#FF69B4!important;box-shadow:0 0 0 3px rgba(255,105,180,0.15)!important;outline:none!important}
label,.gr-label{color:#D4618C!important;font-weight:600!important;font-size:.9rem!important}
button,.gr-button{border-radius:14px!important;font-weight:600!important;transition:all .25s ease!important;border:none!important}
button:hover{transform:translateY(-1px)!important;box-shadow:0 6px 20px rgba(255,105,180,0.2)!important}
button:has-text("Generate"),.gr-button.primary{background:linear-gradient(135deg,#FF69B4,#FFB7C5)!important;color:#fff!important;font-size:1.05rem!important;padding:12px 24px!important}
button:has-text("Generate"):hover,.gr-button.primary:hover{background:linear-gradient(135deg,#FF1493,#FF69B4)!important}
button:has-text("Keep"){background:linear-gradient(135deg,#FFDAB9,#FFB7C5)!important;color:#5C3D4A!important}
button:has-text("Keep"):hover{background:linear-gradient(135deg,#FFC0CB,#FF69B4)!important;color:#fff!important}
button:has-text("Discard"){background:linear-gradient(135deg,#E6C3D8,#D8BFD8)!important;color:#5C3D4A!important}
button:has-text("Discard"):hover{background:linear-gradient(135deg,#DDA0DD,#BA55D3)!important;color:#fff!important}
select,.gr-dropdown{border-radius:12px!important;border:1.5px solid #FFD1DC!important}
input[type=checkbox],input[type=radio]{accent-color:#FF69B4!important}
.gr-info,.gr-description{color:#B35C7A!important}
.accordion{border-radius:14px!important;border:1px solid rgba(255,183,197,0.3)!important}
h1,h2,h3,h4{color:#C44569!important}
h1{font-size:1.8rem!important;background:linear-gradient(135deg,#FF69B4,#C44569);-webkit-background-clip:text!important;-webkit-text-fill-color:transparent!important;background-clip:text!important}
.feedback-row{gap:.75rem}.feedback-row button{flex:1}
::-webkit-scrollbar{width:8px;height:8px}
::-webkit-scrollbar-track{background:#FFF0F5;border-radius:10px}
::-webkit-scrollbar-thumb{background:#FFB7C5;border-radius:10px}
::-webkit-scrollbar-thumb:hover{background:#FF69B4}
footer{color:#D4618C!important;font-size:.85rem!important}
"""

with gr.Blocks(title="HumorEngine_v2 \u2022 Pastel Pink Studio", fill_width=True) as demo:

    gr.Markdown("""
    # 🧠🌸 HumorEngine_v2 \u2022 Pastel Pink Studio 🎀
    **High-intellect humor generation \u2014 Audio-Visual Counterpoint \u00b7 Cognitive Dissonance \u00b7 Deadpan \u00b7 Tacit Consensus**
    """)

    # Hidden state
    state_punchline = gr.State("")
    state_humor_type = gr.State("tacit_consensus")
    state_frame_paths = gr.State([])

    # ==================================================================
    # Tabs
    # ==================================================================
    with gr.Tabs():
        # ── Tab 1: Humor Workshop ──
        with gr.Tab("🌸 Humor Workshop"):
            with gr.Row(equal_height=False):
                with gr.Column(scale=1, min_width=400):
                    gr.Markdown("### 🎀 Video Description")
                    video_input = gr.Textbox(label="Video Description",
                        placeholder="Describe the video / visual scene in detail...\n\nExample: A talk show host asks a female guest about her experience with handcuffs...",
                        lines=6, max_lines=12, autofocus=True)
                    with gr.Row():
                        import_btn = gr.Button("📥 Import Captions", variant="secondary", size="sm")
                    humor_dropdown = gr.Dropdown(choices=HUMOR_TYPE_OPTIONS, value="tacit_consensus",
                        label="Humor Type", interactive=True)
                    generate_btn = gr.Button("🚀 Generate Punchline", variant="primary", size="lg")

                with gr.Column(scale=1, min_width=400):
                    gr.Markdown("### 💬🌸 Generated Punchline")
                    output_box = gr.Textbox(label="Generated Punchline",
                        placeholder="The high-IQ punchline will appear here...", lines=6, max_lines=12)
                    gr.Markdown("### 🎯 Feedback & Save")
                    with gr.Row(elem_classes="feedback-row"):
                        keep_btn = gr.Button("✅ Keep & Save to SFT", variant="primary", size="lg")
                        discard_btn = gr.Button("❌ Discard & Log", variant="stop", size="lg")
                    status_box = gr.Textbox(label="Status", lines=2, max_lines=4, interactive=False)

        # ── Tab 2: Video Analyzer ──
        with gr.Tab("🎬 Video Analyzer"):
            with gr.Row(equal_height=False):
                with gr.Column(scale=1, min_width=400):
                    gr.Markdown("### 🎬 Upload Video")
                    video_upload = gr.Video(label="Drag & drop video file", interactive=True)
                    analyze_btn = gr.Button("🎬 Extract & Analyze", variant="primary", size="lg")
                with gr.Column(scale=1, min_width=400):
                    gr.Markdown("### 📝 Visual Analysis")
                    analysis_output = gr.Textbox(label="Visual Analysis Output", lines=8, max_lines=16)
                    gr.Markdown("### 🖼️ Keyframes")
                    keyframe_gallery = gr.Gallery(label="Keyframes", columns=5, height=180, object_fit="contain")

        # ── Tab 3: Trending Radar ──
        with gr.Tab("🔍 Trending Radar"):
            gr.Markdown("### 🔍 Search Trending Videos")
            with gr.Row():
                search_input = gr.Textbox(label="Search keyword",
                    placeholder="e.g. funny pets, awkward moments, 尴尬瞬间",
                    lines=1, max_lines=1, scale=4)
                search_btn = gr.Button("🔍 Search", variant="primary", size="lg", scale=1)

            search_results = gr.Dataframe(
                label="Search Results (click a row to select)",
                headers=["Title", "Source", "Duration", "URL"],
                datatype=["str", "str", "str", "str"],
                row_count=5,
                col_count=(4, "fixed"),
                interactive=True,
                wrap=True,
            )

            search_status = gr.Textbox(label="Search Status", lines=1, interactive=False)

            gr.Markdown("### 🎯 Actions for Selected Video")
            with gr.Row():
                analyze_from_search_btn = gr.Button("🎬 Analyze Video", variant="secondary", size="lg")
                autogen_btn = gr.Button("🚀 Auto-Generate Punchline", variant="primary", size="lg")

            # Hidden state for selected row index
            selected_idx = gr.State(-1)

    # ==================================================================
    # Global settings (collapsed)
    # ==================================================================
    with gr.Accordion("⚙️ Global Settings", open=False):
        gr.Markdown("### 🔑 API Provider & Key Management")
        provider_dropdown = gr.Dropdown(choices=PROVIDER_NAMES, value="DeepSeek",
            label="API Provider", interactive=True)
        key_input = gr.Textbox(label="API Key (optional)", type="password", lines=1, interactive=True)
        with gr.Row():
            save_btn = gr.Button("💾 Save Keys", variant="secondary", size="sm", scale=1)
            provider_status = gr.Textbox(label="Provider Status", lines=1, interactive=False, scale=3)
        with gr.Accordion("📜 System Prompt", open=False):
            system_prompt_box = gr.Textbox(label="Constructed System Prompt", lines=10, max_lines=20)

    # ==================================================================
    # Event wiring
    # ==================================================================

    provider_dropdown.change(fn=on_provider_change, inputs=[provider_dropdown], outputs=[provider_status, key_input])
    humor_dropdown.change(fn=lambda t: t, inputs=[humor_dropdown], outputs=[state_humor_type])

    gen = generate_btn.click(fn=on_generate, inputs=[video_input, humor_dropdown, provider_dropdown, key_input],
                             outputs=[output_box, system_prompt_box])
    gen.then(fn=lambda p: p, inputs=[output_box], outputs=[state_punchline])

    keep_btn.click(fn=on_keep, inputs=[video_input, state_punchline, state_humor_type], outputs=[status_box])
    discard_btn.click(fn=on_discard, inputs=[video_input, state_punchline, state_humor_type], outputs=[status_box])
    save_btn.click(fn=on_save_keys, inputs=[provider_dropdown, key_input], outputs=[provider_status])

    # Tab 2 events
    analyze_btn.click(fn=on_analyze_video, inputs=[video_upload, provider_dropdown, key_input],
                      outputs=[analysis_output, keyframe_gallery])
    import_btn.click(fn=on_import_captions, inputs=[analysis_output], outputs=[video_input])

    # Tab 3 events
    search_btn.click(fn=on_search_videos, inputs=[search_input], outputs=[search_results, search_status])

    # When a row is selected in the dataframe, store the index
    search_results.select(
        fn=lambda idx: idx,
        inputs=[search_results],
        outputs=[selected_idx],
    )

    # Analyze from search: download -> analyze -> show in Tab 2
    analyze_from_search_btn.click(
        fn=on_search_analyze,
        inputs=[search_input, selected_idx, provider_dropdown, key_input],
        outputs=[analysis_output, keyframe_gallery, status_box],
    )

    # Auto-generate: download -> analyze -> generate -> show punchline + description
    autogen_btn.click(
        fn=on_search_autogen,
        inputs=[search_input, selected_idx, humor_dropdown, provider_dropdown, key_input],
        outputs=[analysis_output, output_box, status_box],
    ).then(
        fn=lambda d, p: (d, p),
        inputs=[analysis_output, output_box],
        outputs=[video_input, state_punchline],
    )

    # Initial provider status
    demo.load(fn=on_provider_change, inputs=[provider_dropdown], outputs=[provider_status, key_input])

    gr.Markdown("""---\n<p style="text-align:center;">🧁 HumorEngine_v2 — <em>Engineering sophistication into machine-generated comedy.</em> 🧁</p>""")


# ---------------------------------------------------------------------------
# Launch
# ---------------------------------------------------------------------------

def main() -> int:
    host = os.environ.get("GRADIO_HOST", "127.0.0.1")
    port = int(os.environ.get("GRADIO_PORT", "7860"))
    share = os.environ.get("GRADIO_SHARE", "").lower() in ("1", "true", "yes")

    theme = gr.themes.Soft(primary_hue="pink", neutral_hue="rose", font=gr.themes.GoogleFont("Quicksand"))

    print("=" * 72)
    print("  HumorEngine_v2 — Web UI")
    print("=" * 72)
    print(f"\n  Local URL:  http://{host}:{port}")
    if share:
        print("  Public URL: will be shown below")
    print("\n  Press Ctrl+C to stop.")
    saved_keys = _load_saved_keys()
    print("\n  Provider key status:")
    for name, cfg in PROVIDER_CONFIG.items():
        if cfg["needs_key"]:
            ik = "🔑" if name in saved_keys else " "
            val = os.environ.get(cfg["env_key"], "")
            st = "env" if val else ("saved" if name in saved_keys else "missing")
            print(f"    {ik} {name:25s}  {st}")
        else:
            print(f"      {name:25s}  no key required")
    print(f"\n  cv2:   {'OK' if _HAS_CV2 else 'missing (pip install opencv-python)'}")
    print(f"  yt-dlp: {'OK' if _HAS_YTDLP else 'missing (pip install yt-dlp)'}")
    print(f"  search: {'OK' if _HAS_SEARCH else 'missing'}")
    print("\n" + "=" * 72 + "\n")

    demo.launch(server_name=host, server_port=port, share=share, show_error=True, theme=theme, css=CSS)
    return 0


if __name__ == "__main__":
    sys.exit(main())
