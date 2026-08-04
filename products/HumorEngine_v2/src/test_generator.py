"""
HumorEngine_v2 — Live API Test Generator
==========================================

Upgraded test harness that supports REAL API calls to OpenAI-compatible
endpoints (OpenAI, DeepSeek, OpenRouter, Ollama, vLLM, etc.).

Functionality:
    - Loads the DPO constitution from ``config/humor_constitution.json``.
    - Loads the seed mappings from ``data/humor_db.json``.
    - Constructs a strict system prompt embedding the Three-Layer DPO Rules.
    - ``generate_baseline_draft()`` — prints formatted mock payload (no API call).
    - ``execute_live_generation()`` — fires a REAL API request and returns the
      generated punchline.
    - ``_run_live_handcuff_test()`` — the "Handcuff Embarrassment" talk-show
      scenario end-to-end test with auto-save to ``sft_train.jsonl``.

Environment variables:
    LLM_API_KEY      — API key (default: reads OPENAI_API_KEY)
    LLM_BASE_URL     — API base URL
                       (default: https://api.openai.com/v1)
    LLM_MODEL        — Model name   (default: gpt-4o-mini)

Usage:
    # Mock mode (no API call — prints payload):
    python src/test_generator.py --mock

    # Live mode (requires valid LLM_API_KEY):
    python src/test_generator.py --live
    python src/test_generator.py --live --auto-save   # skip confirmation prompt
"""

from __future__ import annotations

import json
import logging
import os
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional

import requests

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-8s | %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("test_generator")

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

PROJECT_ROOT = Path(__file__).resolve().parent.parent

CONFIG_DIR = PROJECT_ROOT / "config"
DATA_DIR = PROJECT_ROOT / "data"
SRC_DIR = PROJECT_ROOT / "src"

CONSTITUTION_PATH = CONFIG_DIR / "humor_constitution.json"
HUMOR_DB_PATH = DATA_DIR / "humor_db.json"

# ---------------------------------------------------------------------------
# API configuration (from environment)
# ---------------------------------------------------------------------------

API_KEY = os.environ.get(
    "LLM_API_KEY",
    os.environ.get("OPENAI_API_KEY", ""),
)
API_BASE_URL = os.environ.get(
    "LLM_BASE_URL",
    os.environ.get("OPENAI_BASE_URL", "https://api.openai.com/v1"),
).rstrip("/")
API_MODEL = os.environ.get("LLM_MODEL", "gpt-4o-mini")

API_CHAT_ENDPOINT = f"{API_BASE_URL}/chat/completions"

# ---------------------------------------------------------------------------
# Loaders
# ---------------------------------------------------------------------------


def load_constitution(path: Path = CONSTITUTION_PATH) -> Dict[str, Any]:
    """Load the Three-Layer DPO Rules constitution."""
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def load_seed_mappings(path: Path = HUMOR_DB_PATH) -> List[Dict[str, str]]:
    """Load the seed cognitive-dissonance mappings."""
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    return data.get("seed_mappings", [])


# ---------------------------------------------------------------------------
# System-prompt builder
# ---------------------------------------------------------------------------


def build_strict_system_prompt(constitution: Dict[str, Any]) -> str:
    """
    Construct a strict system prompt that embeds the full Three-Layer DPO
    Rules and forces the LLM to output ONLY the punchline — no conversational
    filler like "Here is your joke:" or "Sure, here's a humorous take:".
    """
    dpo = constitution["dpo_rules"]

    layers = [
        ("Layer 1 — No Mansplaining / Spoiler-free", dpo["layer_1_no_mansplaining"]),
        ("Layer 2 — Non-Sequitur", dpo["layer_2_non_sequitur"]),
        ("Layer 3 — Deadpan Tone", dpo["layer_3_deadpan_tone"]),
    ]

    parts = [
        "You are HumorEngine_v2, a high-intellect humor generation system.",
        "You produce sophisticated, high-IQ deadpan humor.",
        "",
        "=== THREE-LAYER DPO RULES (MUST OBEY) ===",
        "Violations will be rejected.",
        "",
    ]

    for title, data in layers:
        parts.append(f"[{title}]")
        parts.append(f"  Rule:        {data['rule']}")
        parts.append(f"  Enforcement: {data['enforcement']}")
        parts.append("")

    parts.append("=== STRICT OUTPUT RULES ===")
    parts.append(
        "1. Output ONLY the punchline. No introductions. No setup narration."
    )
    parts.append(
        "2. NEVER begin with phrases like \"Here is your joke:\", "
        "\"Sure!\", \"How about this:\", \"Here is a humorous take:\", "
        "\"As an AI\", or any meta-commentary."
    )
    parts.append(
        "3. The punchline must be a single sentence or a very short "
        "paragraph — flat, academic, matter-of-fact."
    )
    parts.append(
        "4. No exclamation marks, no emotional buzzwords, "
        "no internet meme language, no laugh cues."
    )
    parts.append(
        "5. If the context involves a taboo or awkward topic, "
        "imply it indirectly. Never name it explicitly."
    )
    parts.append(
        "6. The humor should emerge from the contrast between the "
        "straight delivery and the absurd/cognitive-dissonant content."
    )

    return "\n".join(parts)


def build_system_prompt(constitution: Dict[str, Any]) -> str:
    """
    Legacy mock-mode system prompt (less strict formatting).
    Kept for backward compatibility with ``generate_baseline_draft``.
    """
    return build_strict_system_prompt(constitution)


# ---------------------------------------------------------------------------
# Mappings printer
# ---------------------------------------------------------------------------


def describe_seed_mappings(mappings: List[Dict[str, str]]) -> str:
    """Format the seed mappings into a readable reference string."""
    lines = [
        "=== SEED COGNITIVE DISSONANCE MAPPINGS ===",
        "Use these as reference for high-context / low-context juxtaposition.",
    ]
    for i, m in enumerate(mappings, 1):
        lines.append(f"\n  Mapping #{i}")
        lines.append(f"    High context : {m['high_context']}")
        lines.append(f"    Low context  : {m['low_context']}")
        lines.append(f"    Tone style   : {m['tone_style']}")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Mock baseline draft generator (no API call)
# ---------------------------------------------------------------------------


def generate_baseline_draft(
    video_description: str,
    rule_key: str = "layer_2_non_sequitur",
    constitution: Optional[Dict[str, Any]] = None,
    mappings: Optional[List[Dict[str, str]]] = None,
) -> None:
    """
    Print a formatted system prompt and mock API request payload for the
    given *video_description*.  Does NOT call any API.
    """
    if constitution is None:
        constitution = load_constitution()
    if mappings is None:
        mappings = load_seed_mappings()

    system_prompt = build_system_prompt(constitution)
    seed_ref = describe_seed_mappings(mappings)

    dpo = constitution["dpo_rules"]
    if rule_key in dpo:
        layer_title = rule_key.replace("_", " ").title()
        emphasised = (
            f"\n[EMPHASISED RULE: {layer_title}]\n"
            f"  Rule:        {dpo[rule_key]['rule']}\n"
            f"  Enforcement: {dpo[rule_key]['enforcement']}\n"
        )
    else:
        emphasised = f"\n[Unknown rule_key: {rule_key} — using all layers]\n"

    mock_payload = {
        "model": API_MODEL,
        "messages": [
            {"role": "system", "content": system_prompt},
            {
                "role": "user",
                "content": (
                    f"Video description: {video_description}\n\n"
                    f"Apply the Three-Layer DPO Rules. "
                    f"Output ONLY the punchline."
                ),
            },
        ],
        "temperature": 0.7,
        "max_tokens": 256,
    }

    separator = "=" * 72
    print(f"\n{separator}")
    print("  HUMORENGINE_V2 — MOCK DRAFT GENERATOR")
    print(f"{separator}")
    print(f"\n── Input video description ──")
    print(f"  {video_description}")
    print(f"\n── Emphasised DPO rule ──")
    print(emphasised)
    print(f"\n── Seed reference mappings ──")
    print(seed_ref)
    print(f"\n── System prompt (length: {len(system_prompt)} chars) ──")
    print(system_prompt)
    print(f"\n── Mock API request payload (JSON) ──")
    print(json.dumps(mock_payload, ensure_ascii=False, indent=2))
    print(f"\n{separator}")
    print("  End of mock draft.")
    print(f"{separator}\n")


# ---------------------------------------------------------------------------
# REAL API caller
# ---------------------------------------------------------------------------


def execute_live_generation(
    video_description: str,
    rule_key: str = "tacit_consensus",
    constitution: Optional[Dict[str, Any]] = None,
    api_key: Optional[str] = None,
    api_base_url: Optional[str] = None,
    api_model: Optional[str] = None,
) -> str:
    """
    Make a REAL API call to the configured LLM endpoint and return the
    generated punchline text.

    The system prompt is injected with the full Three-Layer DPO Rules
    and strict formatting constraints to force the LLM to output ONLY
    the punchline without any conversational filler.

    Parameters
    ----------
    video_description : str
        A short description of the video / visual scene.
    rule_key : str
        Which DPO rule layer to emphasise in the user prompt.
    constitution : dict or None
        Pre-loaded constitution; auto-loaded if ``None``.

    Returns
    -------
    str
        The raw punchline text returned by the LLM.

    Raises
    ------
    RuntimeError
        If the API key is missing or the request fails.
    """
    if constitution is None:
        constitution = load_constitution()

    # Resolve API config — use overrides if provided, else fall back to env
    _resolved_key = api_key if api_key is not None else API_KEY
    _resolved_base_url = (api_base_url if api_base_url is not None else API_BASE_URL).rstrip("/")
    _resolved_model = api_model if api_model is not None else API_MODEL
    _resolved_endpoint = f"{_resolved_base_url}/chat/completions"

    # --- Validate API configuration ---
    # Ollama / local endpoints don't require an API key
    _is_ollama = "localhost" in _resolved_base_url or "127.0.0.1" in _resolved_base_url
    if not _resolved_key and not _is_ollama:
        raise RuntimeError(
            "No API key found. Set the LLM_API_KEY (or OPENAI_API_KEY) "
            "environment variable.\n\n"
            "Examples:\n"
            "  # PowerShell:\n"
            '  $env:LLM_API_KEY="sk-..."\n'
            '  $env:LLM_BASE_URL="https://api.deepseek.com/v1"\n'
            '  $env:LLM_MODEL="deepseek-chat"\n\n'
            "  # CMD:\n"
            "  set LLM_API_KEY=sk-...\n\n"
            "  # Ollama (no key needed):\n"
            '  $env:LLM_BASE_URL="http://localhost:11434/v1"\n'
            '  $env:LLM_MODEL="llama3.2"\n'
            "  (leave LLM_API_KEY empty or set to 'ollama')"
        )

    system_prompt = build_strict_system_prompt(constitution)
    dpo = constitution["dpo_rules"]

    # Build emphasised-rule snippet for the user message
    if rule_key in dpo:
        layer_title = rule_key.replace("_", " ").title()
        emphasised = (
            f"[EMPHASISED RULE: {layer_title}]\n"
            f"  Rule:        {dpo[rule_key]['rule']}\n"
            f"  Enforcement: {dpo[rule_key]['enforcement']}"
        )
    else:
        emphasised = "[Using all Three-Layer DPO Rules]"

    user_content = (
        f"Video description: {video_description}\n\n"
        f"{emphasised}\n\n"
        f"Apply the Three-Layer DPO Rules above. "
        f"Output ONLY the punchline — a single deadpan, academic, "
        f"matter-of-fact sentence. No introductions, no setup. "
        f"Never explain the joke."
    )

    payload: Dict[str, Any] = {
        "model": _resolved_model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_content},
        ],
        "temperature": 0.7,
        "max_tokens": 256,
    }

    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {_resolved_key}",
    }

    logger.info("Sending real API request to %s (model=%s) ...", _resolved_base_url, _resolved_model)

    # Print the system prompt and payload for CEO verification
    separator = "=" * 72
    print(f"\n{separator}")
    print("  HUMORENGINE_V2 — LIVE GENERATION")
    print(f"{separator}")
    print(f"\n── Endpoint ──")
    print(f"  URL:   {_resolved_endpoint}")
    print(f"  Model: {_resolved_model}")
    print(f"\n── System prompt (length: {len(system_prompt)} chars) ──")
    print(system_prompt)
    print(f"\n── User message ──")
    print(user_content)

    try:
        response = requests.post(
            _resolved_endpoint,
            headers=headers,
            json=payload,
            timeout=60,
        )
        response.raise_for_status()
    except requests.exceptions.ConnectionError:
        raise RuntimeError(
            f"Could not connect to {_resolved_base_url}.\n"
            "Check that:\n"
            "  1. The URL is correct (LLM_BASE_URL environment variable).\n"
            "  2. If using Ollama, run 'ollama serve' first.\n"
            "  3. Your network/firewall allows the connection."
        )
    except requests.exceptions.HTTPError as e:
        status = response.status_code
        body = response.text[:500]
        raise RuntimeError(
            f"API returned HTTP {status}: {body}"
        )
    except requests.exceptions.Timeout:
        raise RuntimeError(
            "API request timed out after 60 seconds. "
            "Check your network or try a smaller/faster model."
        )
    except requests.exceptions.RequestException as e:
        raise RuntimeError(f"API request failed: {e}")

    data = response.json()

    # Extract the assistant's message text
    try:
        choices = data.get("choices", [])
        if not choices:
            raise RuntimeError(
                f"API response contained no choices. Full response:\n"
                f"{json.dumps(data, ensure_ascii=False, indent=2)}"
            )
        raw_text = choices[0].get("message", {}).get("content", "").strip()
    except (KeyError, IndexError, AttributeError) as e:
        raise RuntimeError(
            f"Unexpected API response format: {e}\n"
            f"Raw: {json.dumps(data, ensure_ascii=False, indent=2)[:1000]}"
        )

    print(f"\n── Raw API response (content) ──")
    print(f"  {raw_text}")
    print(f"\n── Usage ──")
    usage = data.get("usage", {})
    if usage:
        print(
            f"  prompt_tokens: {usage.get('prompt_tokens', '?')}  |  "
            f"completion_tokens: {usage.get('completion_tokens', '?')}  |  "
            f"total_tokens: {usage.get('total_tokens', '?')}"
        )
    print(f"{separator}\n")

    return raw_text


# ---------------------------------------------------------------------------
# Live Handcuff Scenario Test
# ---------------------------------------------------------------------------


def _run_live_handcuff_test(auto_save: bool = False) -> int:
    """
    End-to-end live test using the classic "Handcuff Embarrassment"
    talk-show scenario with ``tacit_consensus`` template.

    1. Loads constitution and seed mappings.
    2. Calls ``execute_live_generation()`` with the handcuff scenario.
    3. Prompts the user (or auto-saves) to append the result to
       ``data/sft_train.jsonl`` via ``HumorDataPipeline``.
    """
    print("\nLoading constitution and seed mappings...")
    constitution = load_constitution()
    mappings = load_seed_mappings()
    logger.info("Constitution loaded: %s", constitution["project_name"])
    logger.info("Seed mappings loaded: %d", len(mappings))

    # Print the relevant mapping
    print("\n── Selected seed mapping (tacit_consensus) ──")
    for m in mappings:
        if "handcuff" in m.get("low_context", "").lower() or \
           "adult" in m.get("low_context", "").lower() or \
           "沉默" in m.get("high_context", ""):
            print(f"  High context : {m['high_context']}")
            print(f"  Low context  : {m['low_context']}")
            print(f"  Tone style   : {m['tone_style']}")
            break

    # ------------------------------------------------------------------
    # The handcuff scenario (exact user-provided text)
    # ------------------------------------------------------------------
    scenario = (
        "一段脱口秀节目，女嘉宾被问到手铐经历，"
        "她没有透露细节，而是突然犹豫并眼神闪躲，"
        "尴尬地陷入长达3秒的沉默，"
        "全场观众心领神会地爆发大笑。"
    )

    print(f"\n── Handcuff scenario input ──")
    print(f"  {scenario}")

    # --- Fire the real API call ---
    try:
        punchline = execute_live_generation(
            video_description=scenario,
            rule_key="tacit_consensus",
            constitution=constitution,
        )
    except RuntimeError as e:
        print(f"\n  [ERROR] {e}")
        return 1

    # ------------------------------------------------------------------
    # Append to SFT dataset using HumorDataPipeline
    # ------------------------------------------------------------------
    # Dynamically import to avoid circular dependency
    sys.path.insert(0, str(SRC_DIR.parent))
    from src.data_pipeline import HumorDataPipeline  # type: ignore

    pipeline = HumorDataPipeline()

    print("\n── Append to SFT dataset? ──")
    if auto_save:
        decision = "y"
        print("  Auto-save enabled → auto-approving.")
    else:
        decision = input("  Append this generation to data/sft_train.jsonl? (Y/n): ").strip().lower()
        if decision == "":
            decision = "y"

    if decision == "y":
        pipeline.append_training_sample(
            video_desc=scenario,
            punchline=punchline,
            is_positive=True,
            metadata={
                "humor_type": "tacit_consensus",
                "rule_key": "tacit_consensus",
                "rating": 5,
                "model": API_MODEL,
                "source": "live_test_handcuff_scenario",
            },
        )
        print(f"  ✅ Appended to sft_train.jsonl")
    else:
        pipeline.append_training_sample(
            video_desc=scenario,
            punchline=punchline,
            is_positive=False,
            metadata={
                "reason": "rejected_by_operator_during_live_test",
                "model": API_MODEL,
            },
        )
        print(f"  ⏩ Logged to discarded_samples.json")

    total = pipeline.count_sft_samples()
    print(f"\n  Total SFT samples now: {total}")
    return 0


# ---------------------------------------------------------------------------
# CLI entrypoint
# ---------------------------------------------------------------------------


def main() -> int:
    """CLI entrypoint."""

    import argparse

    parser = argparse.ArgumentParser(
        description="HumorEngine_v2 — Live API Test Generator",
    )
    parser.add_argument(
        "--mock",
        action="store_true",
        help="Run in mock mode (print payload, no API call).",
    )
    parser.add_argument(
        "--live",
        action="store_true",
        help="Run live handcuff scenario test (requires API key).",
    )
    parser.add_argument(
        "--auto-save",
        action="store_true",
        help="When used with --live, skip confirmation and auto-save.",
    )
    args = parser.parse_args()

    # Default: show help if no flags
    if not args.mock and not args.live:
        parser.print_help()
        print("\nNo action flag provided. Use --mock or --live.\n")
        return 0

    # --- Mock mode (no API call) ---
    if args.mock:
        print("\nLoading constitution and seed mappings...")
        constitution = load_constitution()
        mappings = load_seed_mappings()
        logger.info("Constitution loaded: %s", constitution["project_name"])
        logger.info("Seed mappings loaded: %d", len(mappings))

        generate_baseline_draft(
            video_description=(
                "一段脱口秀节目，女嘉宾被问到手铐经历，"
                "她没有透露细节，而是突然犹豫并眼神闪躲，"
                "尴尬地陷入长达3秒的沉默，"
                "全场观众心领神会地爆发大笑。"
            ),
            rule_key="tacit_consensus",
            constitution=constitution,
            mappings=mappings,
        )
        return 0

    # --- Live mode (real API call) ---
    if args.live:
        return _run_live_handcuff_test(auto_save=args.auto_save)

    return 0


if __name__ == "__main__":
    sys.exit(main())
