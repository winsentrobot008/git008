import os
import json
import time
import base64


def save_result(uid, data):
    """Save generation result to storage."""
    storage_dir = os.environ.get('STORAGE_DIR', os.path.join(os.path.dirname(__file__), '..', 'storage'))
    os.makedirs(storage_dir, exist_ok=True)
    path = os.path.join(storage_dir, f'{uid}.json')
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    return path


def load_result(uid):
    """Load generation result from storage."""
    storage_dir = os.environ.get('STORAGE_DIR', os.path.join(os.path.dirname(__file__), '..', 'storage'))
    path = os.path.join(storage_dir, f'{uid}.json')
    if os.path.exists(path):
        with open(path, 'r', encoding='utf-8') as f:
            return json.load(f)
    return None


# Test storage policy: if saving raw uploads during test, mark as 'ephemeral' and set TTL=1 day
def save_ephemeral_upload(uid, file_b64):
    import os, base64, time, json
    storage_dir = os.environ.get('STORAGE_DIR', 'backend/storage')
    os.makedirs(storage_dir, exist_ok=True)
    fname = os.path.join(storage_dir, f'{uid}_ephemeral.json')
    payload = {'created_at': time.time(), 'data_prefix': file_b64[:80]}
    with open(fname, 'w', encoding='utf-8') as f:
        json.dump(payload, f)
    return fname
