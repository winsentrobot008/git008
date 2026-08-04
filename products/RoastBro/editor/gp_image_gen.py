import os
import requests
import base64
import struct
import zlib
import logging
import time
import threading
import uuid
import hashlib
from pathlib import Path
from dotenv import load_dotenv

logger = logging.getLogger(__name__)
env_path = Path(__file__).resolve().parent.parent / ".env"
load_dotenv(dotenv_path=env_path)

API_KEY = os.getenv("GEMINI_API_KEY")

# ============================================================
# STALL PROTECTION — Engine Timeouts (seconds)
# ============================================================
DASHSCOPE_TIMEOUT = int(os.environ.get("DASHSCOPE_TIMEOUT", "30"))  # 30s — DashScope 万相
FLUX_TIMEOUT = int(os.environ.get("FLUX_TIMEOUT", "3"))             # 3s — quick skip
TURBO_TIMEOUT = int(os.environ.get("TURBO_TIMEOUT", "10"))          # 10s — SDXL Turbo
POLLINATIONS_TIMEOUT = int(os.environ.get("POLLINATIONS_TIMEOUT", "60"))  # 60s — Pollinations
PIPELINE_TIMEOUT = int(os.environ.get("PIPELINE_TIMEOUT", "90"))    # 90s — global pipeline hard limit

# Debug log file path
_DEBUG_LOG_PATH = os.path.join(os.path.dirname(__file__), "..", "logs", "image_pipeline_debug.log")


def _write_debug_log(msg: str):
    """Write a timestamped debug message to the debug log file."""
    try:
        log_dir = os.path.dirname(_DEBUG_LOG_PATH)
        os.makedirs(log_dir, exist_ok=True)
        with open(_DEBUG_LOG_PATH, "a", encoding="utf-8") as f:
            f.write(f"{time.strftime('%Y-%m-%dT%H:%M:%S')} {msg}\n")
    except Exception:
        pass


# ============================================================
# DUPLICATE DETECTION
# ============================================================
# Tracks SHA256 hash of the last successful image to detect repeats
_LAST_IMAGE_HASH = None


class _PipelineTimeout:
    """Context manager for enforcing a hard global pipeline timeout."""
    
    def __init__(self, timeout):
        self.timeout = timeout
        self._start = None
        self._timed_out = False
    
    def __enter__(self):
        self._start = time.time()
        return self
    
    def __exit__(self, exc_type, exc_val, exc_tb):
        elapsed = time.time() - self._start
        if self._timed_out or (exc_type and issubclass(exc_type, TimeoutError)):
            logger.warning("[PIPELINE] Pipeline timed out after %.2fs", elapsed)
        return False  # Don't suppress exceptions
    
    def check_timeout(self):
        """Check if we've exceeded the pipeline timeout. Raises TimeoutError if so."""
        if time.time() - self._start > self.timeout:
            self._timed_out = True
            raise TimeoutError(f"Pipeline exceeded {self.timeout}s timeout")
    
    @property
    def timed_out(self):
        return self._timed_out


def _make_placeholder_png(width=512, height=512):
    """Generate a minimal PNG gradient placeholder (base64 data URL)."""
    pixels = []
    for y in range(height):
        row = []
        for x in range(width):
            r = int(80 + (x / width) * 60)
            g = int(60 + (y / height) * 80)
            b = int(120 + ((x + y) / (width + height)) * 80)
            row.extend([r, g, b])
        pixels.append(bytes(row))

    def create_chunk(chunk_type, data):
        chunk = chunk_type + data
        crc = struct.pack('>I', zlib.crc32(chunk) & 0xFFFFFFFF)
        return struct.pack('>I', len(data)) + chunk + crc

    sig = b'\x89PNG\r\n\x1a\n'
    ihdr_data = struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0)
    ihdr = create_chunk(b'IHDR', ihdr_data)
    raw = b''
    for row in pixels:
        raw += b'\x00' + row
    compressed = zlib.compress(raw)
    idat = create_chunk(b'IDAT', compressed)
    iend = create_chunk(b'IEND', b'')
    png_data = sig + ihdr + idat + iend
    b64_str = base64.b64encode(png_data).decode('ascii')
    return f"data:image/png;base64,{b64_str}"


def _log_stall(start_time, engine, stalled, skipped=False, reason=""):
    """Log stall information to both logger and stall log file."""
    elapsed = time.time() - start_time
    status = "STALLED" if stalled else "OK"
    skip_tag = " (SKIPPED)" if skipped else ""
    msg = f"[STALL_LOG] engine={engine} status={status}{skip_tag} elapsed={elapsed:.2f}s reason={reason}"
    logger.info(msg)
    try:
        log_dir = os.path.join(os.path.dirname(__file__), "..", "logs")
        os.makedirs(log_dir, exist_ok=True)
        with open(os.path.join(log_dir, "image_pipeline.log"), "a") as f:
            f.write(f"{time.strftime('%Y-%m-%dT%H:%M:%S')} {msg}\n")
    except Exception:
        pass


def _compute_data_hash(data_url: str) -> str:
    """Compute SHA256 hash of a base64 data URL."""
    if data_url and "base64," in data_url:
        _, b64_part = data_url.split("base64,", 1)
        return hashlib.sha256(b64_part.encode("ascii")).hexdigest()
    return hashlib.sha256((data_url or "").encode("ascii")).hexdigest()


def _is_duplicate(data_url: str) -> bool:
    """Check if this data URL matches the last generated image."""
    global _LAST_IMAGE_HASH
    if _LAST_IMAGE_HASH is None:
        return False
    current_hash = _compute_data_hash(data_url)
    return current_hash == _LAST_IMAGE_HASH


def _update_last_hash(data_url: str):
    """Update the last image hash tracker."""
    global _LAST_IMAGE_HASH
    _LAST_IMAGE_HASH = _compute_data_hash(data_url)


def generate_image(prompt: str) -> str:
    """
    Generate image from text prompt using Gemini API.
    Falls back to a programmatic placeholder when no API key is set.
    Returns a base64 data URL string.
    """
    if not API_KEY or API_KEY == "YOUR_GEMINI_API_KEY_HERE":
        logger.info('[IMAGE_GEN] No API key; returning symbolic placeholder')
        return _make_placeholder_png(512, 512)

    try:
        response = requests.post(
            "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp-image-generation:generateContent",
            headers={
                "Content-Type": "application/json",
                "x-goog-api-key": API_KEY
            },
            json={
                "contents": [{"parts": [{"text": prompt}]}]
            },
            timeout=30
        )
        data = response.json()
        if "candidates" in data:
            parts = data["candidates"][0]["content"]["parts"]
            for part in parts:
                if "inlineData" in part:
                    return f"data:{part['inlineData']['mimeType']};base64,{part['inlineData']['data']}"
    except Exception as e:
        logger.exception('[IMAGE_GEN] API call failed: %s', e)

    logger.warning('[IMAGE_GEN] API failed; returning symbolic placeholder')
    return _make_placeholder_png(512, 512)


def generate_image_hd(prompt, photos_b64):
    """HD generator wrapper — accelerated pipeline: dashscope → flux → sdxl_turbo → pollinations → placeholder.

    Gemini is NOT called here. It is an *optional* engine gated by
    detect_gemini_available() in the portrait_service layer.

    STALL PROTECTION:
      - dashscope_timeout=30s, flux_timeout=3s, turbo_timeout=10s, pollinations_timeout=60s
      - Global pipeline_timeout=90s
      - If any engine stalls, auto-skip with stall logging
      - If pipeline times out, return placeholder immediately
      - DashScope has built-in 2 retry mechanism

    CACHE PREVENTION (Pollinations):
      - Seed is randomized per-call (see pollinations_client.py)
      - Unique UUID suffix appended to prompt as double insurance
      - SHA256 hash tracked; duplicates trigger auto-retry (max 2)
      - If still duplicate after retry, fallback to SDXL Turbo

    Pipeline:
      1. clients.dashscope_client.generate_image()      — PRIMARY: DashScope 通义万相 (30s timeout)
         Model: wanx-v1, style=photorealistic, refine=detail
      2. clients.flux_client.generate_image()           — fallback: Flux (3s timeout)
         Providers: BFL → Replicate → HuggingFace (free API key)
      3. clients.sdxl_client.generate_image()           — fallback: SDXL Turbo (10s timeout)
      4. clients.pollinations_client.generate_image()   — fallback: free cloud (60s timeout)
      5. placeholder                                    — last resort

    Returns:
      {'type':'b64','data':'data:image/png;base64,...'} or None
    """
    import logging
    log = logging.getLogger(__name__)
    pipeline_start = time.time()

    # Track which engine ultimately succeeded
    engine_used = None

    # Extract prompt text
    prompt_text = (
        prompt.get('prompt_text') or
        prompt.get('questionnaire', {}).get('aesthetic_preference', '') or
        'A symbolic soulmate portrait'
    )

    # ================================================================
    # CACHE FIX: Append UUID suffix to prompt (double insurance)
    # Even if seed somehow doesn't change, the prompt variation forces
    # Pollinations to generate a new image.
    # ================================================================
    prompt_unique_suffix = uuid.uuid4().hex[:4]
    prompt_text_augmented = f"{prompt_text} {prompt_unique_suffix}"
    log.info("[IMAGE_GEN] Prompt augmented with uuid suffix: %s", prompt_unique_suffix)

    # Compute prompt hash for debug traceability
    prompt_hash = hashlib.sha256(prompt_text_augmented.encode("utf-8")).hexdigest()[:16]
    _write_debug_log(
        f"[DEBUG] pipeline start | prompt_hash={prompt_hash} | "
        f"prompt_len={len(prompt_text_augmented)} | seed={seed}"
    )

    seed = prompt.get('seed', None)

    # Use pipeline timeout context
    with _PipelineTimeout(PIPELINE_TIMEOUT) as pipeline:

        # --- 1. DashScope 万相 (primary engine, 30s timeout, 2 retries) ---
        _write_debug_log(f"[DEBUG] pipeline: trying dashscope-wanxiang | seed={seed} | prompt_hash={prompt_hash}")
        try:
            from clients.dashscope_client import generate_image as dashscope_generate
            log.info('[ENGINE] dashscope-wanxiang: starting (timeout=%ds)', DASHSCOPE_TIMEOUT)
            result = dashscope_generate(
                prompt_text=prompt_text_augmented,
                conditioning_images=photos_b64,
                strength=prompt.get('tuning', {}).get('strength', 0.45),
                guidance_scale=prompt.get('tuning', {}).get('guidance_scale', 8.5),
                seed=seed,
            )
            if result and result.get('status') == 'ok' and not result.get('symbolic_only', True):
                log.info('[ENGINE] dashscope-wanxiang: success')
                _write_debug_log("[DEBUG] pipeline: dashscope-wanxiang success | prompt_hash={}".format(prompt_hash))
                engine_used = "dashscope-wanxiang"
                _log_stall(pipeline_start, "pipeline_dashscope", stalled=False)
                _update_last_hash(result['image'].get('data', ''))
                log.info("Engine detection: dashscope=True, flux=False, turbo=False, pollinations=False")
                return result['image']
            else:
                status_str = result.get('status') if result else 'None'
                log.warning('[ENGINE] dashscope-wanxiang: failed → fallback (status=%s)', status_str)
                _write_debug_log(f"[DEBUG] pipeline: dashscope-wanxiang failed -> fallback | status={status_str} | prompt_hash={prompt_hash}")
        except Exception as e:
            log.warning('[ENGINE] dashscope-wanxiang: failed → fallback (error=%s)', e)
            _write_debug_log(f"[DEBUG] pipeline: dashscope-wanxiang failed -> fallback | error={e} | prompt_hash={prompt_hash}")
            _log_stall(pipeline_start, "pipeline_dashscope", stalled=True, reason=str(e))

        # Check pipeline timeout before proceeding
        try:
            pipeline.check_timeout()
        except TimeoutError:
            log.warning('[IMAGE_GEN] PIPELINE TIMEOUT after dashscope — returning placeholder')
            _log_stall(pipeline_start, "pipeline", stalled=True, reason="pipeline_timeout_after_dashscope")
            return {'type': 'b64', 'data': _make_placeholder_png(512, 512)}

        # --- 2. Flux (fallback engine) ---
        _write_debug_log(f"[DEBUG] pipeline: fallback to flux | prompt_hash={prompt_hash}")
        try:
            from clients.flux_client import generate_image as flux_generate, FallbackException
            log.info('[IMAGE_GEN] trying flux (fallback engine, timeout=%ds)', FLUX_TIMEOUT)
            result = flux_generate(
                prompt_text=prompt_text_augmented,
                conditioning_images=photos_b64,
                strength=prompt.get('tuning', {}).get('strength', 0.45),
                guidance_scale=prompt.get('tuning', {}).get('guidance_scale', 8.5),
                seed=seed,
            )
            if result and result.get('status') == 'ok' and not result.get('symbolic_only', True):
                log.info('[IMAGE_GEN] flux succeeded')
                _write_debug_log(f"[DEBUG] pipeline: flux success | prompt_hash={prompt_hash}")
                engine_used = "flux"
                _log_stall(pipeline_start, "pipeline_flux", stalled=False)
                _update_last_hash(result['image'].get('data', ''))
                log.info("Engine detection: dashscope=False, flux=True, turbo=False, pollinations=False")
                return result['image']
        except FallbackException:
            log.info('[IMAGE_GEN] flux unavailable (FallbackException)')
            _write_debug_log(f"[DEBUG] pipeline: fallback from flux to sdxl (FallbackException) | prompt_hash={prompt_hash}")
            _log_stall(pipeline_start, "pipeline_flux", stalled=False, skipped=True, reason="FallbackException")
        except Exception as e:
            log.warning('[IMAGE_GEN] flux error: %s', e)
            _write_debug_log(f"[DEBUG] pipeline: fallback from flux to sdxl (error={e}) | prompt_hash={prompt_hash}")
            _log_stall(pipeline_start, "pipeline_flux", stalled=True, reason=str(e))

        # Check pipeline timeout before proceeding
        try:
            pipeline.check_timeout()
        except TimeoutError:
            log.warning('[IMAGE_GEN] PIPELINE TIMEOUT after flux — returning placeholder')
            _log_stall(pipeline_start, "pipeline", stalled=True, reason="pipeline_timeout_after_flux")
            return {'type': 'b64', 'data': _make_placeholder_png(512, 512)}

        # --- 3. SDXL Turbo (fast local fallback, 4 inference steps) ---
        _write_debug_log(f"[DEBUG] pipeline: fallback to sdxl_turbo | prompt_hash={prompt_hash}")
        try:
            from clients.sdxl_client import generate_image as sdxl_generate
            log.info('[IMAGE_GEN] trying sdxl (SDXL Turbo / local fallback, timeout=%ds)', TURBO_TIMEOUT)
            result = sdxl_generate(
                prompt_text=prompt_text_augmented,
                conditioning_images=photos_b64,
                strength=prompt.get('tuning', {}).get('strength', 0.45),
                guidance_scale=prompt.get('tuning', {}).get('guidance_scale', 8.5),
                seed=seed,
            )
            if result and result.get('status') == 'ok':
                img_data = result.get('image', {}).get('data', '')
                symbolic = result.get('symbolic_only', True)
                if img_data and len(img_data) > 100000 and not symbolic:
                    log.info('[IMAGE_GEN] sdxl returned real image (len=%d)', len(img_data))
                    _write_debug_log(f"[DEBUG] pipeline: sdxl_turbo success | prompt_hash={prompt_hash}")
                    engine_used = "sdxl_turbo"
                    _log_stall(pipeline_start, "pipeline_sdxl", stalled=False)
                    _update_last_hash(img_data)
                    log.info("Engine detection: flux=False, turbo=True, pollinations=False")
                    return result['image']
                else:
                    log.info('[IMAGE_GEN] sdxl returned placeholder/symbolic (len=%d); continuing', len(img_data))
        except Exception as e:
            log.warning('[IMAGE_GEN] sdxl error: %s', e)
            _write_debug_log(f"[DEBUG] pipeline: fallback from sdxl to pollinations (error={e}) | prompt_hash={prompt_hash}")
            _log_stall(pipeline_start, "pipeline_sdxl", stalled=True, reason=str(e))

        # Check pipeline timeout before proceeding
        try:
            pipeline.check_timeout()
        except TimeoutError:
            log.warning('[IMAGE_GEN] PIPELINE TIMEOUT after sdxl — returning placeholder')
            _log_stall(pipeline_start, "pipeline", stalled=True, reason="pipeline_timeout_after_sdxl")
            return {'type': 'b64', 'data': _make_placeholder_png(512, 512)}

        # --- 4. Pollinations (free cloud fallback, 60s timeout, 2 retries) ---
        _write_debug_log(f"[DEBUG] pipeline: fallback to pollinations | prompt_hash={prompt_hash}")
        pollinations_attempts = 0
        max_pollinations_attempts = 3  # 1 initial + 2 retries for cache duplicate

        while pollinations_attempts < max_pollinations_attempts:
            pollinations_attempts += 1
            try:
                from clients.pollinations_client import generate_image as pollinations_generate
                log.info('[IMAGE_GEN] trying pollinations (attempt %d/%d, timeout=%ds)',
                         pollinations_attempts, max_pollinations_attempts, POLLINATIONS_TIMEOUT)
                result = pollinations_generate(
                    prompt_text=prompt_text_augmented,
                    conditioning_images=photos_b64,
                    seed=seed,
                    timeout=POLLINATIONS_TIMEOUT,
                )
                if result and result.get('status') == 'ok':
                    img_data = result.get('image', {}).get('data', '')
                    if img_data and len(img_data) > 1000:
                        # --- DUPLICATE DETECTION ---
                        is_dup = _is_duplicate(img_data)
                        cache_hit = result.get('_cache_hit', False)
                        
                        if is_dup or cache_hit:
                            log.warning(
                                '[IMAGE_GEN] Pollinations returned duplicate image (attempt %d/%d, cache_hit=%s)',
                                pollinations_attempts, max_pollinations_attempts, cache_hit,
                            )
                            if pollinations_attempts < max_pollinations_attempts:
                                log.info('[IMAGE_GEN] Retrying Pollinations with new random seed...')
                                # Force a new random seed for retry (overrides any fixed seed)
                                # The pollinations_client will randomize since we pass None
                                import random as _rnd
                                seed = _rnd.randint(1, 999999)
                                continue
                            else:
                                log.warning('[IMAGE_GEN] Pollinations still returning duplicate after %d attempts — falling back to SDXL Turbo',
                                           max_pollinations_attempts)
                                # Fall through: will check if SDXL Turbo is available
                                break
                        
                        # New unique image!
                        log.info('[IMAGE_GEN] pollinations returned unique image (len=%d)', len(img_data))
                        _write_debug_log(f"[DEBUG] pipeline: pollinations success | prompt_hash={prompt_hash}")
                        engine_used = "pollinations"
                        _log_stall(pipeline_start, "pipeline_pollinations", stalled=False)
                        _update_last_hash(img_data)
                        log.info("Engine detection: flux=False, turbo=False, pollinations=True")
                        return result['image']
                    else:
                        log.warning('[IMAGE_GEN] pollinations returned empty/short data')
            except Exception as e:
                log.warning('[IMAGE_GEN] pollinations error: %s', e)
                _log_stall(pipeline_start, "pipeline_pollinations", stalled=True, reason=str(e))

        # --- Fallback to SDXL Turbo if Pollinations kept returning duplicates ---
        log.info('[IMAGE_GEN] Pollinations exhausted; trying SDXL Turbo as fallback from duplicate')
        try:
            from clients.sdxl_client import generate_image as sdxl_generate
            result = sdxl_generate(
                prompt_text=prompt_text_augmented,
                conditioning_images=photos_b64,
                strength=prompt.get('tuning', {}).get('strength', 0.45),
                guidance_scale=prompt.get('tuning', {}).get('guidance_scale', 8.5),
                seed=seed,
            )
            if result and result.get('status') == 'ok':
                img_data = result.get('image', {}).get('data', '')
                symbolic = result.get('symbolic_only', True)
                if img_data and len(img_data) > 100000 and not symbolic:
                    log.info('[IMAGE_GEN] SDXL Turbo fallback from duplicate returned real image')
                    engine_used = "sdxl_turbo"
                    _update_last_hash(img_data)
                    log.info("Engine detection: flux=False, turbo=True, pollinations=False")
                    return result['image']
        except Exception as e:
            log.warning('[IMAGE_GEN] SDXL Turbo fallback from duplicate failed: %s', e)

        # --- 5. Fallback: placeholder ---
        log.warning('[IMAGE_GEN] all engines exhausted; returning placeholder')
        _write_debug_log(f"[DEBUG] pipeline: all engines exhausted -> placeholder | prompt_hash={prompt_hash}")
        _log_stall(pipeline_start, "pipeline", stalled=True, reason="all_engines_exhausted")
        return {'type': 'b64', 'data': _make_placeholder_png(512, 512)}


# Debug fallback: if external generator fails, ensure we return first photo base64
def debug_return_first_photo(photos_b64):
    if photos_b64 and len(photos_b64)>0:
        first = photos_b64[0]
        if isinstance(first, dict) and first.get('data'):
            return {'type':'b64','data': first.get('data')}
    return None

# If no external model available, we keep existing debug_return_first_photo fallback.
# This file intentionally does not delete fallback logic.
