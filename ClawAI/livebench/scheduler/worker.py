"""
Worker process for executing queued tasks asynchronously.

This module provides a background worker that polls the scheduler
and executes tasks in a separate event loop, ensuring queued tasks
don't get stuck waiting for the web server's event loop.

Usage:
    python -m livebench.scheduler.worker

Or combined with server:
    python -m livebench.scheduler.worker --server-port 8000
"""

import os
import sys
import json
import asyncio
import time
import threading
import requests
from datetime import datetime
from pathlib import Path
from typing import Optional


POLL_INTERVAL = 1.0  # Check for new tasks every second
SERVER_BASE_URL = os.getenv("SERVER_BASE_URL", "http://localhost:8000")


class TaskWorker:
    """
    Background worker that fetches queued tasks from the scheduler
    and executes them in its own event loop.

    This prevents the main web server's event loop from being blocked
    by long-running task executions.
    """

    def __init__(self, server_url: str = SERVER_BASE_URL):
        self.server_url = server_url.rstrip("/")
        self._running = False
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        self._processing_tasks: set = set()

    async def poll_and_execute(self):
        """Main loop: poll for queued tasks and execute them."""
        self._running = True
        print(f"[Worker] Started polling {self.server_url}/api/tasks every {POLL_INTERVAL}s")

        while self._running:
            try:
                # Fetch all tasks
                response = requests.get(
                    f"{self.server_url}/api/tasks",
                    timeout=5,
                )
                if response.status_code != 200:
                    await asyncio.sleep(POLL_INTERVAL)
                    continue

                data = response.json()
                tasks = data.get("tasks", [])

                # Find queued tasks not yet being processed
                for task in tasks:
                    task_id = task.get("task_id")
                    status = task.get("status", "")

                    if status == "queued" and task_id not in self._processing_tasks:
                        self._processing_tasks.add(task_id)
                        # Execute in a thread to avoid blocking the worker's event loop
                        threading.Thread(
                            target=self._execute_task_blocking,
                            args=(task,),
                            daemon=True,
                        ).start()
                        print(f"[Worker] Dispatched task {task_id} for execution")

            except requests.RequestException as e:
                print(f"[Worker] Failed to poll server: {e}")
                await asyncio.sleep(POLL_INTERVAL * 2)
            except Exception as e:
                print(f"[Worker] Unexpected error in poll loop: {e}")
                await asyncio.sleep(POLL_INTERVAL)

            await asyncio.sleep(POLL_INTERVAL)

    def _execute_task_blocking(self, task: dict):
        """
        Execute a task by calling the scheduler's internal runner.
        This runs in a separate thread to avoid blocking the event loop.
        """
        task_id = task.get("task_id")
        try:
            # Tell the server to start executing this specific task
            print(f"[Worker] Executing task {task_id}...")
            response = requests.post(
                f"{self.server_url}/api/scheduler/execute-task",
                json={"task_id": task_id},
                timeout=10,
            )
            if response.status_code == 200:
                print(f"[Worker] Task {task_id} started successfully")
            else:
                print(f"[Worker] Task {task_id} failed to start: {response.text}")
        except Exception as e:
            print(f"[Worker] Error executing task {task_id}: {e}")
        finally:
            self._processing_tasks.discard(task_id)

    def stop(self):
        """Stop the worker loop."""
        self._running = False

    def run_forever(self):
        """Run the worker in the current thread with its own event loop."""
        self._loop = asyncio.new_event_loop()
        asyncio.set_event_loop(self._loop)
        try:
            self._loop.run_until_complete(self.poll_and_execute())
        except KeyboardInterrupt:
            pass
        finally:
            self._loop.close()


def run_worker_background(server_url: str = SERVER_BASE_URL) -> threading.Thread:
    """Start the worker in a background daemon thread and return it."""
    worker = TaskWorker(server_url)

    def _run():
        worker.run_forever()

    t = threading.Thread(target=_run, daemon=True, name="task-worker")
    t.start()
    print(f"[Worker] Background worker thread started (daemon)")
    return t


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="LiveBench Task Worker")
    parser.add_argument("--server-url", default=SERVER_BASE_URL, help="Server base URL")
    args = parser.parse_args()

    print("=" * 60)
    print("🧠 LiveBench Task Worker")
    print(f"   Server URL: {args.server_url}")
    print("=" * 60)

    worker = TaskWorker(server_url=args.server_url)
    try:
        worker.run_forever()
    except KeyboardInterrupt:
        print("\n[Worker] Shutting down...")
        worker.stop()