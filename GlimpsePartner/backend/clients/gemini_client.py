import os
import requests
import base64
import logging

GEMINI_API_URL = os.environ.get('GEMINI_API_URL', 'https://api.gemini.example/v1/generate')
GEMINI_API_KEY = os.environ.get('GEMINI_API_KEY', None)

def generate_image_with_conditioning(payload, timeout=60):
    """Test wrapper for Gemini image-to-image conditioning.
    payload: dict with keys: prompt_text, conditioning_images (list of {name,data}), strength, guidance_scale, conditioning_weight, upscale_target
    Returns: {'status':'ok','image':{'type':'b64','data': 'data:image/png;base64,...'}, 'meta':{...}} or None on failure
    NOTE: This is a test shim. Replace GEMINI_API_URL/GEMINI_API_KEY with real credentials in env.
    """
    if not GEMINI_API_KEY:
        logging.getLogger().warning('[GEMINI_CLIENT] GEMINI_API_KEY not set; skipping external call')
        return None
    try:
        headers = {'Authorization': f'Bearer {GEMINI_API_KEY}', 'Content-Type': 'application/json'}
        resp = requests.post(GEMINI_API_URL, json=payload, headers=headers, timeout=timeout)
        resp.raise_for_status()
        data = resp.json()
        # Expect data['image'] = base64 data URL or similar
        return data
    except Exception as e:
        logging.getLogger().exception('[GEMINI_CLIENT] generation failed: %s', e)
        return None
