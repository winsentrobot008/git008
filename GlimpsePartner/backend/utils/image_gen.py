import os
import requests
from pathlib import Path
from dotenv import load_dotenv

env_path = Path(__file__).resolve().parent.parent / ".env"
load_dotenv(dotenv_path=env_path)

API_KEY = os.getenv("GEMINI_API_KEY")

def generate_image(prompt: str) -> str:
    if not API_KEY or API_KEY == "YOUR_GEMINI_API_KEY_HERE":
        return "https://picsum.photos/seed/" + str(hash(prompt)) + "/512/512"

    response = requests.post(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp-image-generation:generateContent",
        headers={
            "Content-Type": "application/json",
            "x-goog-api-key": API_KEY
        },
        json={
            "contents": [{"parts": [{"text": prompt}]}]
        }
    )
    data = response.json()
    if "candidates" in data:
        parts = data["candidates"][0]["content"]["parts"]
        for part in parts:
            if "inlineData" in part:
                return f"data:{part['inlineData']['mimeType']};base64,{part['inlineData']['data']}"
    return "https://picsum.photos/seed/" + str(hash(prompt)) + "/512/512"

def generate_image_hd(prompt, photos_b64):
    """HD generator wrapper:
    - Try Gemini client first (image-to-image conditioning).
    - Fallback to external_image_client if present.
    - Enforce portrait constraints (orientation, aspect_ratio).
    Returns: {'type':'b64','data': 'data:image/png;base64,...'} or {'type':'file','path':...} or None
    """
    import logging
    # Prepare generation payload
    constraints = prompt.get('generation_constraints', {})
    payload = {
      'prompt_text': prompt.get('questionnaire', {}),
      'constraints': constraints,
      'conditioning_images': photos_b64,
      'mode': 'image_to_image',
      'strength': prompt.get('tuning', {}).get('strength', 0.45),
      'guidance_scale': prompt.get('tuning', {}).get('guidance_scale', 8.5),
      'seed': prompt.get('seed', None),
      'upscale': True,
      'upscale_target': constraints.get('min_resolution', '2048x2732'),
      'conditioning_weight': prompt.get('tuning', {}).get('conditioning_weight', 0.8)
    }
    # Prefer Gemini client if available; fallback to external_image_client if present
    try:
        from clients.gemini_client import generate_image_with_conditioning as gemini_generate
    except Exception:
        gemini_generate = None
    try:
        from external_image_client import generate_with_conditioning as external_generate
    except Exception:
        external_generate = None

    # Try Gemini client first
    try:
        if gemini_generate:
            logging.getLogger().info('[IMAGE_GEN] calling gemini_generate')
            res = gemini_generate(payload)
            if res and res.get('status') == 'ok':
                return res.get('image')
    except Exception as e:
        logging.getLogger().exception('[IMAGE_GEN] gemini_generate error: %s', e)
    # Try external client if present
    try:
        if external_generate:
            logging.getLogger().info('[IMAGE_GEN] calling external_generate')
            res = external_generate(payload)
            if res and res.get('status') == 'ok':
                return res.get('image')
    except Exception as e:
        logging.getLogger().exception('[IMAGE_GEN] external_generate error: %s', e)
    # No generator available
    logging.getLogger().warning('[IMAGE_GEN] no external generator available, returning None')
    return None

# Debug fallback: if external generator fails, ensure we return first photo base64
def debug_return_first_photo(photos_b64):
    if photos_b64 and len(photos_b64)>0:
        first = photos_b64[0]
        if isinstance(first, dict) and first.get('data'):
            return {'type':'b64','data': first.get('data')}
    return None

# If no external model available, we keep existing debug_return_first_photo fallback.
# This file intentionally does not delete fallback logic.
