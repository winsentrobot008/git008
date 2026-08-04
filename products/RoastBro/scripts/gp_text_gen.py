import os
import requests
from pathlib import Path
from dotenv import load_dotenv

env_path = Path(__file__).resolve().parent.parent / ".env"
load_dotenv(dotenv_path=env_path)

API_KEY = os.getenv("GEMINI_API_KEY") or os.getenv("DEEPSEEK_KEY")

def generate_report(prompt: str) -> str:
    """Generate a report using DeepSeek or fallback.
    Uses timeout=15 to avoid hanging when API is unavailable.
    """
    import logging
    logger = logging.getLogger(__name__)

    if os.getenv("DEEPSEEK_KEY"):
        try:
            url = "https://api.deepseek.com/v1/chat/completions"
            headers = {
                "Authorization": f"Bearer {os.getenv('DEEPSEEK_KEY')}",
                "Content-Type": "application/json"
            }
            payload = {
                "model": "deepseek-chat",
                "messages": [{"role": "user", "content": f"Generate a soulmate psychological report based on: {prompt}"}]
            }
            response = requests.post(url, json=payload, headers=headers, timeout=15)
            data = response.json()
            if "choices" in data:
                return data["choices"][0]["message"]["content"]
        except Exception as e:
            logger.warning("[TEXT_GEN] DeepSeek API call failed: %s", e)

    logger.info("[TEXT_GEN] No DeepSeek key or API failed; returning fallback")
    return "Your soulmate report could not be generated."
