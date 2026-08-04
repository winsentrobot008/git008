"""
MediaIndexerPro v4 — Sandbox Startup Harness

Loads the FastAPI backend and launches the browser-based
Humor Engine Console for live CEO experience.

Usage:
    python start_sandbox.py

    # Press Ctrl+C to stop
"""

import os
import sys
import time
import webbrowser
from pathlib import Path

# ─── Paths ────────────────────────────────────────────────────────────────
PROJECT_ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(PROJECT_ROOT))

# Load .env
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

# ─── Banner ───────────────────────────────────────────────────────────────
BANNER = r"""
╔══════════════════════════════════════════════════════════════════╗
║                                                                  ║
║   ███╗   ███╗███████╗██████╗ ██╗ █████╗ ██╗███╗   ██╗██████╗   ║
║   ████╗ ████║██╔════╝██╔══██╗██║██╔══██╗██║████╗  ██║██╔══██╗  ║
║   ██╔████╔██║█████╗  ██║  ██║██║███████║██║██╔██╗ ██║██║  ██║  ║
║   ██║╚██╔╝██║██╔══╝  ██║  ██║██║██╔══██║██║██║╚██╗██║██║  ██║  ║
║   ██║ ╚═╝ ██║███████╗██████╔╝██║██║  ██║██║██║ ╚████║██████╔╝  ║
║   ╚═╝     ╚═╝╚══════╝╚═════╝ ╚═╝╚═╝  ╚═╝╚═╝╚═╝  ╚═══╝╚═════╝   ║
║                                                                  ║
║   MediaIndexerPro v4  —  Humor Engine Sandbox                    ║
║   Cloud-API First · Edge-TTS Voice · Batch Production Ready      ║
║                                                                  ║
╚══════════════════════════════════════════════════════════════════╝
"""


def patch_server_routes():
    """
    Add missing mount routes to the FastAPI app:
    - /storage/  → storage/  directory (humor_shadow_index.json)
    - /tests/    → tests/    directory (test_humor_script.json)
    """
    from api.server import APP
    from fastapi.staticfiles import StaticFiles

    storage_dir = PROJECT_ROOT / "storage"
    tests_dir = PROJECT_ROOT / "tests"

    # Mount storage/ for shadow index access
    if storage_dir.exists():
        try:
            APP.mount("/storage", StaticFiles(directory=str(storage_dir)), name="storage")
            print(f"  ✓ Mounted /storage/ → {storage_dir}")
        except Exception as e:
            print(f"  ⚠ /storage mount: {e}")

    # Mount tests/ for script access
    if tests_dir.exists():
        try:
            APP.mount("/tests", StaticFiles(directory=str(tests_dir)), name="tests")
            print(f"  ✓ Mounted /tests/  → {tests_dir}")
        except Exception as e:
            print(f"  ⚠ /tests mount: {e}")


def start_server():
    """Start the FastAPI server and launch browser."""
    import uvicorn
    from api.server import APP, STATIC_DIR, DATA_DIR, MIP_ROOT

    port = int(os.environ.get("PORT", 8000))
    host = os.environ.get("HOST", "127.0.0.1")

    # Print banner
    print(BANNER)
    print(f"  📂 Project  : {MIP_ROOT}")
    print(f"  📁 Static   : {STATIC_DIR}")
    print(f"  📁 Data     : {DATA_DIR}")
    print(f"  📁 Storage  : {PROJECT_ROOT / 'storage'}")
    print(f"  📁 Scripts  : {PROJECT_ROOT / 'scripts'}")
    print()
    print(f"  🌐 URL      : http://{host}:{port}/")
    print(f"  🎬 Generate : http://{host}:{port}/generate.html")
    print(f"  ⏱ Timeline  : http://{host}:{port}/timeline.html")
    print(f"  📦 Library  : http://{host}:{port}/media_library.html")
    print(f"  📖 Shadow   : http://{host}:{port}/storage/humor_shadow_index.json")
    print()
    print(f"  🚀 Launching in 2 seconds...")
    print(f"  Press Ctrl+C to stop the server\n")

    # Patch routes (storage/ + tests/)
    patch_server_routes()

    # Pre-load: ensure generated directory has our batch videos
    generated_dir = DATA_DIR / "generated"
    generated_dir.mkdir(parents=True, exist_ok=True)
    batch_count = len(list(generated_dir.glob("scheduled_*.mp4")))
    if batch_count > 0:
        print(f"  ✅ {batch_count} batch-produced videos pre-loaded in library\n")
    else:
        print(f"  ⚠ No batch videos found — run `python workflow/scheduler.py --once`\n")

    # Schedule browser launch after 2s
    def _open_browser():
        time.sleep(2)
        url = f"http://{host}:{port}/generate.html"
        print(f"  Opening browser: {url}")
        webbrowser.open(url)

    import threading
    threading.Thread(target=_open_browser, daemon=True).start()

    # Start server
    print(f"  Starting uvicorn on {host}:{port}...\n")
    uvicorn.run(
        APP,
        host=host,
        port=port,
        log_level="info",
        access_log=False,
    )


if __name__ == "__main__":
    try:
        start_server()
    except KeyboardInterrupt:
        print("\n\n  🛑 Server stopped. Goodbye!")
        sys.exit(0)
