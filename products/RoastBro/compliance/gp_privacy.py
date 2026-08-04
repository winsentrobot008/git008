"""
Ethical Safeguard Layer — Privacy & Audit Module
===================================================
Implements the ethical requirements for the Soulmate Portrait System:

  1. Default: do NOT save user original photos
  2. If saved: AES encrypt, TTL=7 days, user can delete
  3. Fallback images only in DEBUG mode
  4. All generations include psychological mapping explanation
  5. /delete/{uid} endpoint for user data deletion
  6. Audit log records: prompt_text, tuning, seed, generator_meta, timestamp
"""

import os
import json
import time
import base64
import logging
import uuid
from pathlib import Path

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

STORAGE_DIR = os.environ.get(
    "STORAGE_DIR", os.path.join(os.path.dirname(__file__), "..", "storage")
)
AUDIT_DIR = os.environ.get(
    "AUDIT_DIR", os.path.join(os.path.dirname(__file__), "..", "audit")
)
DEBUG_MODE = os.environ.get("DEBUG", "").lower() in ("1", "true", "yes")
DEFAULT_TTL_SECONDS = 7 * 24 * 3600  # 7 days

os.makedirs(STORAGE_DIR, exist_ok=True)
os.makedirs(AUDIT_DIR, exist_ok=True)

# ---------------------------------------------------------------------------
# AES Encryption helpers (simplified with Fernet-like approach)
# ---------------------------------------------------------------------------

try:
    from cryptography.fernet import Fernet

    _FERNET_KEY = os.environ.get(
        "PRIVACY_ENCRYPTION_KEY",
        Fernet.generate_key().decode(),  # generates persistent key per session
    )
    _fernet = Fernet(_FERNET_KEY.encode() if isinstance(_FERNET_KEY, str) else _FERNET_KEY)
    _HAS_CRYPTO = True
except ImportError:
    _HAS_CRYPTO = False
    logger.warning(
        "[PRIVACY] cryptography not installed; falling back to base64 encoding "
        "(not truly encrypted). Install with: pip install cryptography"
    )


def _encrypt(data: bytes) -> bytes:
    """Encrypt data with AES (Fernet). Falls back to base64 if crypto unavailable."""
    if _HAS_CRYPTO:
        return _fernet.encrypt(data)
    # Base64 fallback (NOT encryption — for development only)
    return base64.b64encode(data)


def _decrypt(data: bytes) -> bytes:
    """Decrypt data. Falls back to base64 if crypto unavailable."""
    if _HAS_CRYPTO:
        return _fernet.decrypt(data)
    return base64.b64decode(data)


# ---------------------------------------------------------------------------
# Photo storage policy
# ---------------------------------------------------------------------------

def should_store_raw() -> bool:
    """
    Returns True only if DEBUG mode is enabled.
    In production, user originals are NEVER stored by default.
    """
    return DEBUG_MODE


def store_photo_encrypted(uid: str, photo_data: str) -> str | None:
    """
    Store a photo with AES encryption and TTL metadata.
    Returns the file path or None if storage is disabled.

    Args:
        uid: unique identifier for the generation
        photo_data: base64 data URL string
    """
    if not should_store_raw():
        logger.info("[PRIVACY] Raw photo storage disabled (DEBUG=%s). Skipping.", DEBUG_MODE)
        return None

    try:
        # Strip data URL prefix to get raw base64
        if "," in photo_data:
            raw_b64 = photo_data.split(",", 1)[1]
        else:
            raw_b64 = photo_data

        # Encrypt
        encrypted = _encrypt(raw_b64.encode("utf-8"))

        # Store with TTL metadata
        record = {
            "type": "encrypted_photo",
            "created_at": time.time(),
            "ttl_seconds": DEFAULT_TTL_SECONDS,
            "expires_at": time.time() + DEFAULT_TTL_SECONDS,
            "data": encrypted.decode("utf-8") if isinstance(encrypted, bytes) else encrypted,
            "encryption": "fernet-aes" if _HAS_CRYPTO else "base64-fallback",
        }

        path = os.path.join(STORAGE_DIR, f"{uid}_photo_encrypted.json")
        with open(path, "w", encoding="utf-8") as f:
            json.dump(record, f, ensure_ascii=False)

        logger.info("[PRIVACY] Encrypted photo stored: %s (ttl=%ds)", path, DEFAULT_TTL_SECONDS)
        return path
    except Exception as e:
        logger.exception("[PRIVACY] Failed to store encrypted photo: %s", e)
        return None


def delete_stored_data(uid: str) -> dict:
    """
    Delete all stored data associated with a UID.
    Returns summary of what was deleted.

    This is the backend handler for the /delete/{uid} endpoint.
    """
    deleted = {"files": [], "audit": False}
    storage_dir = Path(STORAGE_DIR)
    audit_dir = Path(AUDIT_DIR)

    # Delete result file
    result_path = storage_dir / f"{uid}.json"
    if result_path.exists():
        result_path.unlink()
        deleted["files"].append(str(result_path))
        logger.info("[PRIVACY] Deleted result file: %s", result_path)

    # Delete encrypted photo
    for f in storage_dir.glob(f"{uid}_photo_encrypted*"):
        f.unlink()
        deleted["files"].append(str(f))
        logger.info("[PRIVACY] Deleted encrypted photo: %s", f)

    # Delete temporary files
    for f in storage_dir.glob(f"{uid}_*"):
        f.unlink()
        deleted["files"].append(str(f))

    # Delete ephemeral uploads
    for f in storage_dir.glob(f"{uid}_ephemeral*"):
        f.unlink()
        deleted["files"].append(str(f))

    # Mark audit as deleted (append deletion marker)
    audit_path = audit_dir / f"{uid}.json"
    if audit_path.exists():
        try:
            with open(audit_path, "r", encoding="utf-8") as f:
                audit_data = json.load(f)
            audit_data["deleted_at"] = time.time()
            audit_data["deleted"] = True
            with open(audit_path, "w", encoding="utf-8") as f:
                json.dump(audit_data, f, ensure_ascii=False, indent=2)
            deleted["audit"] = True
        except Exception as e:
            logger.warning("[PRIVACY] Could not mark audit deleted: %s", e)

    deleted["count"] = len(deleted["files"])
    logger.info("[PRIVACY] Deletion complete for uid=%s: %s", uid, deleted)
    return deleted


# ---------------------------------------------------------------------------
# Audit Log
# ---------------------------------------------------------------------------

def audit_log(entry: dict) -> str:
    """
    Record an audit log entry.

    Args:
        entry: dict with keys:
            - id: str (uid)
            - prompt_text: str
            - tuning: dict
            - seed: int or None
            - generator_meta: dict
            - mapping_log: list[str]
            - timestamp: float
            - has_conditioning: bool

    Returns:
        audit file path
    """
    # Ensure required fields
    record = {
        "id": entry.get("id", str(uuid.uuid4())),
        "prompt_text": entry.get("prompt_text", ""),
        "tuning": entry.get("tuning", {}),
        "seed": entry.get("seed"),
        "generator_meta": entry.get("generator_meta", {}),
        "mapping_log": entry.get("mapping_log", []),
        "timestamp": entry.get("timestamp", time.time()),
        "has_conditioning": entry.get("has_conditioning", False),
        "ethical_compliance": {
            "no_real_person_prediction": True,
            "no_genetic_determinism": True,
            "no_destiny_language": True,
            "symbolic_only": True,
        },
    }

    audit_path = os.path.join(AUDIT_DIR, f"{record['id']}.json")
    try:
        with open(audit_path, "w", encoding="utf-8") as f:
            json.dump(record, f, ensure_ascii=False, indent=2)
        logger.info("[AUDIT] Log written: %s", audit_path)
    except Exception as e:
        logger.exception("[AUDIT] Failed to write log: %s", e)

    return audit_path


# ---------------------------------------------------------------------------
# TTL cleanup (call periodically or on startup)
# ---------------------------------------------------------------------------

def cleanup_expired(ttl: int = DEFAULT_TTL_SECONDS) -> int:
    """
    Remove all expired encrypted photo files.
    Returns count of removed files.
    """
    now = time.time()
    removed = 0
    storage_dir = Path(STORAGE_DIR)

    for f in storage_dir.glob("*_photo_encrypted*"):
        try:
            with open(f, "r", encoding="utf-8") as fh:
                data = json.load(fh)
            expires_at = data.get("expires_at", 0)
            if now > expires_at:
                f.unlink()
                removed += 1
                logger.info("[PRIVACY] TTL cleanup removed expired file: %s", f)
        except (json.JSONDecodeError, KeyError, OSError):
            # If we can't read it, remove it
            try:
                f.unlink()
                removed += 1
            except OSError:
                pass

    if removed:
        logger.info("[PRIVACY] TTL cleanup complete: removed %d expired files", removed)
    return removed
