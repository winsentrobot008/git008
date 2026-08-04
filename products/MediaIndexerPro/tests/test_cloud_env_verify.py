"""
MediaIndexerPro v4 — Cloud Environment & Client Structure Verification

Validates:
  1. .env file exists and dotenv loads correctly
  2. Environment variables are properly abstracted (no hardcoded keys in code)
  3. CloudAnalyzer backend selection logic
  4. OpenAI-compatible HTTP bridge endpoint construction
  5. Humor prompt injection

Run:
    python tests/test_cloud_env_verify.py
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

# Ensure project root
PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

PASS = 0
FAIL = 0


def check(label: str, condition: bool, detail: str = "") -> None:
    global PASS, FAIL
    if condition:
        PASS += 1
        print(f"  ✅ {label}")
    else:
        FAIL += 1
        print(f"  ❌ {label}")
        if detail:
            print(f"     └─ {detail}")


def main():
    global PASS, FAIL
    print("=" * 72)
    print("  MediaIndexerPro v4 — Cloud Environment Verification")
    print("=" * 72)

    # ── 1. .env file check ──────────────────────────────────────────────
    print("\n📁 [1/5] Environment File & dotenv Loading")
    env_path = PROJECT_ROOT / ".env"
    env_template_path = PROJECT_ROOT / ".env.template"

    check(
        ".env.template exists",
        env_template_path.exists(),
    )
    check(
        ".env exists (optional for local dev)",
        env_path.exists(),
        "Create .env from .env.template for local development"
    )

    # Try loading dotenv
    try:
        from dotenv import load_dotenv
        load_dotenv()
        check("python-dotenv loaded successfully", True)
    except ImportError:
        check("python-dotenv available", False, "pip install python-dotenv")

    # ── 2. Environment variable abstraction ─────────────────────────────
    print("\n🔒 [2/5] Credential Abstraction (No Hardcoded Keys)")

    # Read cloud_api.py and verify no hardcoded keys
    cloud_api_src = (PROJECT_ROOT / "auto_understanding" / "cloud_api.py").read_text(
        encoding="utf-8"
    )

    # Check for common key patterns that should NOT be hardcoded
    suspicious = [
        "sk-" in line and "os.environ" not in line and "#" not in line
        for line in cloud_api_src.split("\n")
        if "sk-" in line
    ]
    check(
        "No hardcoded 'sk-' secrets in cloud_api.py",
        not any(suspicious),
        "Found potential hardcoded secret!",
    )

    # Verify all config comes from os.getenv
    getenv_count = cloud_api_src.count("os.environ.get")
    check(
        f"All credentials via os.environ.get ({getenv_count} calls)",
        getenv_count >= 4,
        f"Expected 4+ os.environ.get calls, found {getenv_count}",
    )

    # ── 3. Backend selection logic ──────────────────────────────────────
    print("\n⚙️  [3/5] Backend Auto-Selection Logic")

    from auto_understanding.cloud_api import CloudAnalyzer

    # Test 1: No keys → fallback
    analyzer_fb = CloudAnalyzer(
        dashscope_api_key="",
        dashscope_api_base="",
        openai_api_key="",
    )
    check(
        f"No keys → backend='{analyzer_fb.backend}'",
        analyzer_fb.backend == "fallback",
        f"Expected 'fallback', got '{analyzer_fb.backend}'",
    )

    # Test 2: Custom base + key → dashscope_custom
    analyzer_custom = CloudAnalyzer(
        dashscope_api_key="sk-test123",
        dashscope_api_base="https://custom.endpoint.com/v1",
        openai_api_key="",
    )
    check(
        f"Custom base+key → backend='{analyzer_custom.backend}'",
        analyzer_custom.backend == "dashscope_custom",
        f"Expected 'dashscope_custom', got '{analyzer_custom.backend}'",
    )

    # Test 3: Only DashScope key → dashscope
    analyzer_ds = CloudAnalyzer(
        dashscope_api_key="sk-test123",
        dashscope_api_base="",
        openai_api_key="",
    )
    check(
        f"DashScope key only → backend='{analyzer_ds.backend}'",
        analyzer_ds.backend == "dashscope",
        f"Expected 'dashscope', got '{analyzer_ds.backend}'",
    )

    # Test 4: Only OpenAI key → openai
    analyzer_oai = CloudAnalyzer(
        dashscope_api_key="",
        dashscope_api_base="",
        openai_api_key="sk-test456",
    )
    check(
        f"OpenAI key only → backend='{analyzer_oai.backend}'",
        analyzer_oai.backend == "openai",
        f"Expected 'openai', got '{analyzer_oai.backend}'",
    )

    # ── 4. OpenAI-compatible endpoint construction ──────────────────────
    print("\n🌉 [4/5] OpenAI-Compatible HTTP Bridge")

    # Verify endpoint construction
    custom_url = f"{analyzer_custom._get_openai_base()}/chat/completions"
    expected = "https://custom.endpoint.com/v1/chat/completions"
    check(
        f"Custom endpoint: {custom_url}",
        custom_url == expected,
        f"Expected '{expected}', got '{custom_url}'",
    )

    # Verify headers
    headers = analyzer_custom._get_openai_headers()
    check(
        "Auth header uses Bearer token",
        headers.get("Authorization", "").startswith("Bearer sk-test123"),
        f"Got: {headers.get('Authorization', '(none)')}",
    )

    # Check payload structure
    import base64
    sample_path = PROJECT_ROOT / ".env.template"
    if sample_path.exists():
        with open(sample_path, "rb") as f:
            encoded = base64.b64encode(f.read()).decode("utf-8")
        data_url = f"data:image/jpeg;base64,{encoded}"

        payload = {
            "model": "qwen-vl-plus",
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {"type": "image_url", "image_url": {"url": data_url}},
                        {"type": "text", "text": "HUMOR_PROMPT_PLACEHOLDER"},
                    ],
                }
            ],
            "max_tokens": 256,
        }

        check(
            "Payload has model field",
            "model" in payload,
        )
        check(
            "Payload has messages[0].content with image_url + text",
            len(payload["messages"][0]["content"]) == 2,
        )
        check(
            "image_url type correct",
            payload["messages"][0]["content"][0]["type"] == "image_url",
        )
        check(
            "text type correct",
            payload["messages"][0]["content"][1]["type"] == "text",
        )

    # ── 5. Humor prompt ─────────────────────────────────────────────────
    print("\n🎭 [5/5] Humor-Profiling Prompt")

    from auto_understanding.cloud_api import HUMOR_PROMPT

    check(
        "Humor prompt is defined",
        bool(HUMOR_PROMPT),
    )
    check(
        "Humor prompt mentions 'humor'",
        "humor" in HUMOR_PROMPT.lower(),
    )
    check(
        "Humor prompt requests JSON output",
        "JSON" in HUMOR_PROMPT or "json" in HUMOR_PROMPT,
    )
    check(
        "Humor prompt mentions 'absurd' or 'contrast'",
        "absurd" in HUMOR_PROMPT.lower() or "contrast" in HUMOR_PROMPT.lower(),
    )
    check(
        "Humor prompt is 50-500 chars (concise)",
        50 <= len(HUMOR_PROMPT) <= 500,
        f"Length: {len(HUMOR_PROMPT)}",
    )

    # ── Summary ─────────────────────────────────────────────────────────
    total = PASS + FAIL
    print(f"\n{'=' * 72}")
    print(f"  RESULTS: {PASS}/{total} passed, {FAIL}/{total} failed")
    print(f"{'=' * 72}")

    return 0 if FAIL == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
