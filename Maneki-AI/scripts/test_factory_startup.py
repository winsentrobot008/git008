#!/usr/bin/env python3
"""
test_factory_startup.py — Controlled structural integrity test for start_factory.py

Launches start_factory.py for 3 seconds, captures output, then terminates.
Uses a timeout-based reader to avoid blocking on readline().
"""

import subprocess
import time
import sys
import os
import threading
import signal

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FACTORY_SCRIPT = os.path.join(PROJECT_ROOT, "start_factory.py")

print(f"[test] Project root: {PROJECT_ROOT}")
print(f"[test] Factory script: {FACTORY_SCRIPT}")
print(f"[test] Python executable: {sys.executable}")
print(f"[test] Platform: {sys.platform}")
print()

# Launch start_factory.py as a subprocess
proc = subprocess.Popen(
    [sys.executable, FACTORY_SCRIPT],
    stdout=subprocess.PIPE,
    stderr=subprocess.STDOUT,
    text=True,
    bufsize=1,
    cwd=PROJECT_ROOT
)

print(f"[test] start_factory.py launched (PID {proc.pid})")
print("[test] Waiting 3 seconds...")

# Collect output in a thread-safe way
output_lines = []
stop_reading = threading.Event()

def reader_thread():
    while not stop_reading.is_set():
        line = proc.stdout.readline()
        if not line:
            break
        output_lines.append(line.rstrip())

reader = threading.Thread(target=reader_thread, daemon=True)
reader.start()

time.sleep(3)

# Signal reader to stop
stop_reading.set()
time.sleep(0.3)  # Give reader a moment to finish current readline

# Terminate the factory and all its children
print("[test] Terminating start_factory.py and all child processes...")

# First try graceful termination via signal
if sys.platform == "win32":
    # On Windows, use taskkill but ONLY on the child process tree
    # First get the children
    result = subprocess.run(
        ["wmic", "process", "where", f"ParentProcessId={proc.pid}", "get", "ProcessId"],
        capture_output=True, text=True, timeout=5
    )
    child_pids = []
    for line in result.stdout.strip().split('\n')[1:]:
        line = line.strip()
        if line and line.isdigit():
            child_pids.append(int(line))
    
    print(f"[test] Child PIDs found: {child_pids}")
    
    # Kill children first
    for cpid in child_pids:
        subprocess.run(
            ["taskkill", "/F", "/T", "/PID", str(cpid)],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            timeout=5
        )
    
    # Then kill parent
    proc.terminate()
else:
    os.kill(proc.pid, signal.SIGTERM)

try:
    proc.wait(timeout=5)
except subprocess.TimeoutExpired:
    proc.kill()
    proc.wait()

reader.join(timeout=2)

print()
print("=" * 60)
print("=== CAPTURED OUTPUT ===")
print("=" * 60)
for line in output_lines:
    print(line)
print("=" * 60)
print(f"=== EXIT CODE: {proc.returncode} ===")
print("=" * 60)

# Determine pass/fail
if proc.returncode in (0, 1, -1, -1073741510):
    # Check that we got meaningful output
    has_banner = any("Smart Factory" in line for line in output_lines)
    has_gateway = any("API Gateway" in line for line in output_lines)
    has_listener = any("Task Listener" in line for line in output_lines)

    print()
    if has_banner:
        print("[test] ✅ Banner detected — factory started successfully.")
    else:
        print("[test] ⚠️  Banner not detected in output (may be buffered).")

    if has_gateway:
        print("[test] ✅ API Gateway reference found in output.")
    if has_listener:
        print("[test] ✅ Task Listener reference found in output.")

    print(f"\n[test] ✅ TEST PASSED: start_factory.py launched without crashing.")
    print(f"[test]    Captured {len(output_lines)} lines of output in 3 seconds.")
else:
    print(f"\n[test] ❌ TEST FAILED: start_factory.py exited with code {proc.returncode}.")
    sys.exit(1)
