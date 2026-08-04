# -*- coding: utf-8 -*-
"""
RoastBro Download Test - real download pipeline verification.
Tests orchestrator --mode download with a public URL.
"""

import sys, os, json, subprocess, time
from pathlib import Path
from datetime import datetime

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parent.parent
PENDING_DIR = ROOT / "output" / "pending_review"
LOG_FILE = ROOT / "test_environment" / "download_test.log"

_log = []
def log(msg):
    ts = datetime.now().strftime("%H:%M:%S.%f")[:-3]
    line = f"[{ts}] {msg}"
    _log.append(line)
    print(line)

def write_log():
    LOG_FILE.write_text("\n".join(_log) + "\n", encoding="utf-8")
    print(f"\nLog written: {LOG_FILE}")

# ---- 1. Environment ----
log("")
log("=" * 60)
log("  RoastBro Download Test")
log("=" * 60)

log("\n--- 1. Environment ---")
log(f"  Python: {sys.version.split()[0]}")

r = subprocess.run([sys.executable, "-m", "yt_dlp", "--version"],
                   capture_output=True, text=True, encoding="utf-8", errors="replace")
log(f"  yt-dlp: {r.stdout.strip() or r.stderr.strip()}")

r = subprocess.run(["where", "ffmpeg"], capture_output=True, text=True,
                   encoding="utf-8", errors="replace")
log(f"  ffmpeg: {r.stdout.strip() if r.returncode == 0 else 'NOT FOUND'}")

# ---- 2. Clean ----
log("\n--- 2. Clean pending_review ---")
if PENDING_DIR.exists():
    for f in list(PENDING_DIR.glob("*")):
        f.unlink()
        log(f"  deleted: {f.name}")
else:
    PENDING_DIR.mkdir(parents=True)
    log(f"  created: {PENDING_DIR}")

# ---- 3. Download test ----
log("\n--- 3. Download test ---")
TEST_URL = "https://www.tiktok.com/@tiktok/video/7104163823139876142"
log(f"  URL: {TEST_URL}")

cmd = [sys.executable, str(ROOT / "orchestrator.py"), "--mode", "download", "--url", TEST_URL]
log(f"  CMD: {' '.join(cmd)}")

start = time.time()
try:
    result = subprocess.run(cmd, capture_output=True, text=True,
                           encoding="utf-8", errors="replace", timeout=30)
    elapsed = time.time() - start
    log(f"  Time: {elapsed:.1f}s")
    log(f"  Exit code: {result.returncode}")
    if result.stdout:
        for line in result.stdout.strip().splitlines()[-8:]:
            log(f"  OUT: {line}")
    if result.stderr:
        for line in result.stderr.strip().splitlines()[-5:]:
            log(f"  ERR: {line}")
except subprocess.TimeoutExpired:
    log("  TIMEOUT after 30s")
    write_log()
    sys.exit(1)
except Exception as e:
    log(f"  Exception: {e}")
    write_log()
    sys.exit(1)

# ---- 4. Output check ----
log("\n--- 4. Output files ---")
mp4s = list(PENDING_DIR.glob("*.mp4"))
jsons = list(PENDING_DIR.glob("*.json"))
apps = list(PENDING_DIR.glob("*.approval.json"))

log(f"  MP4: {len(mp4s)}")
for f in mp4s:
    log(f"    [OK] {f.name} ({f.stat().st_size / 1024 / 1024:.2f} MB)")
log(f"  JSON: {len(jsons)}")
for f in jsons:
    log(f"    {f.name}")
log(f"  Approval: {len(apps)}")
for f in apps:
    log(f"    {f.name}")

# ---- 5. Verify ----
log("\n--- 5. Verification ---")
passed = bool(mp4s)
if passed:
    f = max(mp4s, key=lambda p: p.stat().st_size)
    mb = f.stat().st_size / 1024 / 1024
    log(f"  [OK] Largest file: {f.name} ({mb:.2f} MB)")
    r = subprocess.run(["ffprobe", "-v", "quiet", "-print_format", "json",
                        "-show_format", str(f)],
                       capture_output=True, text=True,
                       encoding="utf-8", errors="replace", timeout=10)
    if r.returncode == 0:
        info = json.loads(r.stdout)
        dur = float(info.get("format", {}).get("duration", 0))
        log(f"  [OK] ffprobe: duration={dur:.1f}s")
    else:
        log(f"  [WARN] ffprobe failed: {r.stderr[:100]}")
else:
    log("  [FAIL] No MP4 files produced!")

# ---- Summary ----
log("")
log("=" * 60)
log(f"  {'[PASS] DOWNLOAD TEST PASSED' if passed else '[FAIL] DOWNLOAD TEST FAILED'}")
log("=" * 60)

write_log()
sys.exit(0 if passed else 1)
