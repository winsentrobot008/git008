"""
Gemini Integration Test Script
===============================
Non-destructive test: triggers one /hd/generate call to validate
the Gemini client integration path.

Safety: if GEMINI_API_KEY is not set, the client shim logs a warning
and returns None; the pipeline falls through gracefully.
"""

import requests
import base64
import json
import sys
import logging

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')
logger = logging.getLogger(__name__)

# Tiny 1x1 red pixel PNG as base64 (valid data URL)
TINY_PNG_B64 = (
    "data:image/png;base64,"
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg=="
)

BASE_URL = "http://localhost:8100"


def run_test():
    logger.info("=== Gemini Integration Test ===")

    # Build payload matching /hd/generate expectations
    payload = {
        "questionnaire": {
            "aesthetic_preference": "photorealistic",
            "emotional_needs": ["warmth", "trust", "elegance"]
        },
        "growth_photos": [
            {
                "name": "test_photo.jpg",
                "data": TINY_PNG_B64
            }
        ],
        "generation_constraints": {
            "subject": "portrait, head and shoulders",
            "orientation": "vertical",
            "aspect_ratio": "3:4",
            "min_resolution": "2048x2732"
        },
        "tuning": {
            "strength": 0.4,
            "guidance_scale": 9.0,
            "conditioning_weight": 0.75
        }
    }

    logger.info("Payload keys: %s", list(payload.keys()))
    logger.info("Calling POST /hd/generate ...")

    try:
        resp = requests.post(
            f"{BASE_URL}/hd/generate",
            json=payload,
            timeout=120
        )
        logger.info("HTTP %s", resp.status_code)

        if resp.status_code == 200:
            data = resp.json()
            # Truncate base64 image data for logging
            safe = {}
            for k, v in data.items():
                if isinstance(v, str) and len(v) > 100:
                    safe[k] = v[:80] + "...<truncated>"
                else:
                    safe[k] = v
            logger.info("Response: %s", json.dumps(safe, indent=2))
            logger.info("TEST PASSED: /hd/generate responded successfully")
        else:
            logger.error("TEST FAILED: HTTP %s - %s", resp.status_code, resp.text)
            sys.exit(1)

    except requests.exceptions.Timeout:
        logger.error("TEST FAILED: Request timed out after 120s")
        sys.exit(1)
    except requests.exceptions.ConnectionError as e:
        logger.error("TEST FAILED: Connection error - %s", e)
        sys.exit(1)
    except Exception as e:
        logger.error("TEST FAILED: Unexpected error - %s", e)
        sys.exit(1)


if __name__ == "__main__":
    run_test()
