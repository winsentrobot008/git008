"""DeepSeek API client for AI-powered script generation.

Usage:
    from tools.deepseek_client import DeepSeekClient
    client = DeepSeekClient()
    response = client.chat("Write a script about AI", system="You are a script writer")
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from typing import Any

# Ensure OpenMontage root is on path
_REPO_ROOT = Path(__file__).resolve().parent.parent
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

# Load .env if available
try:
    from dotenv import load_dotenv
    load_dotenv(_REPO_ROOT / ".env")
except Exception:
    pass


class DeepSeekError(Exception):
    """Raised when DeepSeek API returns an error."""


class DeepSeekClient:
    """Client for the DeepSeek Chat API (compatible with OpenAI SDK format)."""

    API_URL = "https://api.deepseek.com/chat/completions"
    MODEL = "deepseek-chat"

    def __init__(self):
        self.api_key = os.environ.get("DEEPSEEK_API_KEY")
        if not self.api_key:
            # Also check in OpenMontage .env
            env_path = _REPO_ROOT / ".env"
            if env_path.exists():
                with open(env_path, encoding="utf-8") as f:
                    for line in f:
                        line = line.strip()
                        if line.startswith("DEEPSEEK_API_KEY="):
                            self.api_key = line.split("=", 1)[1].strip().strip("\"'")
                            break

    def is_available(self) -> bool:
        """Check if the API key is configured."""
        return bool(self.api_key)

    def chat(
        self,
        prompt: str,
        system: str | None = None,
        temperature: float = 0.7,
        max_tokens: int = 2048,
    ) -> str:
        """Send a chat completion request to DeepSeek.

        Args:
            prompt: The user message / prompt.
            system: Optional system message.
            temperature: Sampling temperature (0-2).
            max_tokens: Maximum tokens in the response.

        Returns:
            The response text content.

        Raises:
            DeepSeekError: If the API returns an error or key is missing.
        """
        if not self.api_key:
            raise DeepSeekError(
                "DEEPSEEK_API_KEY not configured. "
                "Set it in .env or as an environment variable."
            )

        import requests

        messages = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": prompt})

        try:
            response = requests.post(
                self.API_URL,
                headers={
                    "Authorization": f"Bearer {self.api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": self.MODEL,
                    "messages": messages,
                    "temperature": temperature,
                    "max_tokens": max_tokens,
                },
                timeout=60,
            )

            if response.status_code == 200:
                data = response.json()
                content = data["choices"][0]["message"]["content"]
                return content
            else:
                error_body = response.text[:500]
                raise DeepSeekError(
                    f"API error {response.status_code}: {error_body}"
                )

        except requests.exceptions.Timeout:
            raise DeepSeekError("DeepSeek API request timed out after 60s")
        except requests.exceptions.ConnectionError:
            raise DeepSeekError(
                "Could not connect to DeepSeek API. Check your internet connection."
            )
        except Exception as e:
            raise DeepSeekError(str(e))

    def chat_structured(
        self,
        prompt: str,
        system: str | None = None,
        temperature: float = 0.7,
    ) -> dict[str, Any]:
        """Chat completion that expects a JSON response.

        Asks DeepSeek to return valid JSON that can be parsed.
        """
        json_system = (system or "") + (
            "\n\nYou MUST respond with valid JSON only. "
            "No markdown, no code fences, no explanation."
        )
        try:
            raw = self.chat(prompt, system=json_system, temperature=temperature, max_tokens=4096)
            # Try to parse as JSON
            # Strip any markdown code fences
            cleaned = raw.strip()
            if cleaned.startswith("```"):
                # Remove code fences
                lines = cleaned.split("\n")
                start = 1 if lines[0].startswith("```") else 0
                end = -1 if lines[-1].strip().startswith("```") else len(lines)
                cleaned = "\n".join(lines[start:end])
            return json.loads(cleaned.strip())
        except json.JSONDecodeError as e:
            raise DeepSeekError(f"DeepSeek returned invalid JSON: {e}\nRaw: {raw[:500]}")


def safe_error(exc: Exception) -> str:
    """Redact the API key from error messages."""
    key = os.environ.get("DEEPSEEK_API_KEY", "")
    if key:
        return str(exc).replace(key, "[redacted]")
    # Also check loaded from .env
    env_path = _REPO_ROOT / ".env"
    if env_path.exists():
        try:
            with open(env_path, encoding="utf-8") as f:
                for line in f:
                    if line.startswith("DEEPSEEK_API_KEY="):
                        key = line.split("=", 1)[1].strip().strip("\"'")
                        if key:
                            return str(exc).replace(key, "[redacted]")
        except Exception:
            pass
    return str(exc)
