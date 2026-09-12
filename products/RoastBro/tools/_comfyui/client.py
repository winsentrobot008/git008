"""Thin REST client for a running ComfyUI server.

Handles the full generation cycle: submit workflow, poll for completion,
download artifacts.  Used by comfyui_image, comfyui_video, and comfyui_music.

GPU-bound calls are serialized through :class:`FileLock`, a cross-process file
lock.  ComfyUI keeps the whole diffusion pipeline resident in VRAM, so a second
local process hitting the same server OOMs a 12 GB card in seconds.
"""

from __future__ import annotations

import copy
import functools
import json
import os
import random
import tempfile
import threading
import time
from pathlib import Path
from typing import Any

import requests

try:  # pragma: no cover - Windows
    import msvcrt
except ImportError:  # pragma: no cover - POSIX
    msvcrt = None  # type: ignore[assignment]

try:  # pragma: no cover - POSIX
    import fcntl
except ImportError:  # pragma: no cover - Windows
    fcntl = None  # type: ignore[assignment]


DEFAULT_SERVER_URL = "http://127.0.0.1:8188"

_LOCK_STATE = threading.local()


class ComfyUIError(Exception):
    """Raised when ComfyUI returns an error or times out."""


class FileLock:
    """Cross-process exclusive lock backed by a single lock file.

    Serializes every GPU-bound ComfyUI request so that two local processes
    cannot drive the same server at once.  Re-entrant within a single thread,
    so generate() may wrap submit() without deadlocking.

    Lock file: COMFYUI_LOCK_FILE env var, else
    <tempdir>/008_comfyui_gpu.lock.  Wait budget: COMFYUI_LOCK_TIMEOUT
    seconds (default 3600).  Usable as context manager and as decorator.
    """

    def __init__(
        self,
        path: str | os.PathLike[str] | None = None,
        *,
        timeout: float | None = None,
        poll: float = 0.25,
    ) -> None:
        self.path = Path(
            path
            or os.environ.get("COMFYUI_LOCK_FILE")
            or Path(tempfile.gettempdir()) / "008_comfyui_gpu.lock"
        )
        if timeout is None:
            timeout = float(os.environ.get("COMFYUI_LOCK_TIMEOUT") or 3600)
        self.timeout = timeout
        self.poll = poll
        self._fd = None

    def __call__(self, func):
        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            with self:
                return func(*args, **kwargs)

        return wrapper

    def _depths(self) -> dict[str, int]:
        depths = getattr(_LOCK_STATE, "depths", None)
        if depths is None:
            depths = {}
            _LOCK_STATE.depths = depths
        return depths

    def _depth(self) -> int:
        return self._depths().get(str(self.path), 0)

    def _set_depth(self, depth: int) -> None:
        self._depths()[str(self.path)] = depth

    @staticmethod
    def _try_lock(fd) -> None:
        """Acquire the OS lock; raise OSError when another holder exists."""
        if msvcrt is not None:
            fd.seek(0)
            msvcrt.locking(fd.fileno(), msvcrt.LK_NBLCK, 1)
        elif fcntl is not None:
            fcntl.flock(fd.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)

    @staticmethod
    def _unlock(fd) -> None:
        try:
            if msvcrt is not None:
                fd.seek(0)
                msvcrt.locking(fd.fileno(), msvcrt.LK_UNLCK, 1)
            elif fcntl is not None:
                fcntl.flock(fd.fileno(), fcntl.LOCK_UN)
        except OSError:
            pass

    def acquire(self) -> "FileLock":
        depth = self._depth()
        if depth:
            self._set_depth(depth + 1)
            return self

        self.path.parent.mkdir(parents=True, exist_ok=True)
        fd = open(self.path, "a+b")
        fd.seek(0, os.SEEK_END)
        if fd.tell() == 0:
            fd.write(b"008")
            fd.flush()

        deadline = time.monotonic() + self.timeout
        while True:
            try:
                self._try_lock(fd)
                break
            except OSError:
                if time.monotonic() >= deadline:
                    fd.close()
                    raise ComfyUIError(
                        f"Timed out waiting for the ComfyUI GPU lock "
                        f"({self.path}) after {self.timeout:.0f}s. Another "
                        f"local process is generating; retry when it ends."
                    ) from None
                time.sleep(self.poll)

        self._fd = fd
        self._set_depth(1)
        return self

    def release(self) -> None:
        depth = self._depth()
        if depth > 1:
            self._set_depth(depth - 1)
            return
        self._set_depth(0)
        fd, self._fd = self._fd, None
        if fd is None:
            return
        try:
            self._unlock(fd)
        finally:
            fd.close()

    def __enter__(self) -> "FileLock":
        return self.acquire()

    def __exit__(self, *exc_info) -> None:
        self.release()

    def locked(self) -> bool:
        """True when the current thread already holds this lock."""
        return self._depth() > 0


# One lock for the whole process: the GPU is a single shared resource, so the
# lock file is not per client instance and not per server URL.
gpu_lock = FileLock()


class ComfyUIClient:
    """Client for the ComfyUI REST API.

    The protocol is simple and battle-tested:
      1. POST /prompt           → queue a workflow, get a prompt_id
      2. GET  /history/{id}     → poll until outputs appear
      3. GET  /view?filename=…  → download the generated artifact
      4. POST /upload/image     → stage a local image for I2V workflows
    """

    def __init__(self, server_url: str | None = None) -> None:
        self.server_url = (
            server_url
            or os.environ.get("COMFYUI_SERVER_URL", DEFAULT_SERVER_URL)
        ).rstrip("/")

    # ------------------------------------------------------------------
    # Health
    # ------------------------------------------------------------------

    @property
    def is_default_url(self) -> bool:
        """True if using the fallback URL (user didn't set COMFYUI_SERVER_URL)."""
        return not os.environ.get("COMFYUI_SERVER_URL")

    def is_available(self) -> bool:
        """Return True if the ComfyUI server is reachable."""
        try:
            resp = requests.get(
                f"{self.server_url}/system_stats", timeout=5
            )
            return resp.status_code == 200
        except Exception:
            return False

    def unavailable_reason(self) -> str:
        """Human-readable explanation of why the server can't be reached."""
        if self.is_default_url:
            return (
                f"No ComfyUI server found at {self.server_url} "
                f"(default — no COMFYUI_SERVER_URL configured).\n"
                f"Set COMFYUI_SERVER_URL in your .env file to the address of "
                f"your ComfyUI server (e.g. http://127.0.0.1:8188)."
            )
        return (
            f"ComfyUI server not reachable at {self.server_url}.\n"
            f"Check that ComfyUI is running and the URL is correct."
        )

    # ------------------------------------------------------------------
    # Model discovery
    # ------------------------------------------------------------------

    def list_models(self) -> dict[str, list[str]]:
        """Query ComfyUI for available models, grouped by type.

        Returns a dict like::

            {
                "checkpoints": ["sd_xl_base.safetensors", ...],
                "diffusion_models": ["flux2-dev-nvfp4.safetensors", ...],
                "vae": ["ae.safetensors", ...],
                "clip": ["clip_l.safetensors", ...],
                "loras": ["my_lora.safetensors", ...],
            }
        """
        node_to_key = {
            "CheckpointLoaderSimple": ("ckpt_name", "checkpoints"),
            "UNETLoader": ("unet_name", "diffusion_models"),
            "VAELoader": ("vae_name", "vae"),
            "CLIPLoader": ("clip_name", "clip"),
            "LoraLoaderModelOnly": ("lora_name", "loras"),
        }
        result: dict[str, list[str]] = {}
        for node_class, (field, group) in node_to_key.items():
            try:
                resp = requests.get(
                    f"{self.server_url}/object_info/{node_class}", timeout=10
                )
                resp.raise_for_status()
                data = resp.json()
                options = (
                    data.get(node_class, {})
                    .get("input", {})
                    .get("required", {})
                    .get(field, [[]])[0]
                )
                if isinstance(options, list):
                    result[group] = options
            except Exception:
                result[group] = []
        return result

    def check_models(
        self, required: list[str]
    ) -> tuple[list[str], list[str]]:
        """Check which of *required* model filenames are available.

        Returns ``(found, missing)`` — two lists of filenames.
        """
        all_models: set[str] = set()
        for names in self.list_models().values():
            all_models.update(names)

        found = [m for m in required if m in all_models]
        missing = [m for m in required if m not in all_models]
        return found, missing

    # ------------------------------------------------------------------
    # Core cycle
    # ------------------------------------------------------------------

    @gpu_lock
    def submit(self, workflow: dict) -> str:
        """Queue a workflow for execution.  Returns the ``prompt_id``."""
        resp = requests.post(
            f"{self.server_url}/prompt",
            json={"prompt": workflow},
            timeout=30,
        )
        try:
            data = resp.json()
        except ValueError:
            data = {}
        if data.get("node_errors"):
            raise ComfyUIError(f"Node errors: {json.dumps(data['node_errors'])}")
        if data.get("error"):
            raise ComfyUIError(f"Prompt error: {json.dumps(data['error'])}")
        resp.raise_for_status()
        prompt_id = data.get("prompt_id")
        if not prompt_id:
            raise ComfyUIError(f"No prompt_id in response: {data}")
        return prompt_id

    def poll(
        self,
        prompt_id: str,
        *,
        timeout: int = 600,
        interval: int = 5,
    ) -> dict:
        """Block until *prompt_id* finishes.  Returns the history entry."""
        deadline = time.time() + timeout
        while time.time() < deadline:
            resp = requests.get(
                f"{self.server_url}/history/{prompt_id}", timeout=10
            )
            resp.raise_for_status()
            history = resp.json()
            if prompt_id in history:
                entry = history[prompt_id]
                status = entry.get("status", {})
                if status.get("status_str") == "error":
                    msgs = status.get("messages", [])
                    raise ComfyUIError(f"Execution error: {msgs}")
                return entry
            time.sleep(interval)
        raise ComfyUIError(
            f"Prompt {prompt_id} did not complete within {timeout}s"
        )

    def download(
        self,
        filename: str,
        subfolder: str,
        dest: Path,
        folder_type: str = "output",
    ) -> Path:
        """Download an output artifact from the ComfyUI server."""
        resp = requests.get(
            f"{self.server_url}/view",
            params={
                "filename": filename,
                "subfolder": subfolder,
                "type": folder_type,
            },
            timeout=120,
        )
        resp.raise_for_status()
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(resp.content)
        return dest

    @gpu_lock
    def upload_image(self, local_path: Path, name: str) -> str:
        """Upload a local image so it can be referenced by LoadImage nodes.

        Returns the server-side filename.
        """
        with open(local_path, "rb") as f:
            resp = requests.post(
                f"{self.server_url}/upload/image",
                files={"image": (name, f, "image/png")},
                timeout=30,
            )
        resp.raise_for_status()
        return resp.json()["name"]

    # ------------------------------------------------------------------
    # High-level helper
    # ------------------------------------------------------------------

    @gpu_lock
    def generate(
        self,
        workflow: dict,
        output_node: str,
        dest: Path,
        *,
        timeout: int = 600,
        interval: int = 5,
    ) -> list[Path]:
        """Submit → poll → download.  Returns list of artifact paths."""
        prompt_id = self.submit(workflow)
        entry = self.poll(prompt_id, timeout=timeout, interval=interval)

        outputs = entry.get("outputs", {})
        node_output = outputs.get(output_node, {})

        # ComfyUI stores images and videos under the "images" key
        items = node_output.get("images", []) or node_output.get("gifs", [])
        if not items:
            raise ComfyUIError(
                f"No output artifacts on node {output_node}. "
                f"Available nodes: {list(outputs.keys())}"
            )

        paths: list[Path] = []
        for i, item in enumerate(items):
            suffix = Path(item["filename"]).suffix
            if len(items) == 1:
                target = dest
            else:
                target = dest.with_stem(f"{dest.stem}_{i:03d}").with_suffix(suffix)
            self.download(
                item["filename"],
                item.get("subfolder", ""),
                target,
                item.get("type", "output"),
            )
            paths.append(target)
        return paths

    # ------------------------------------------------------------------
    # Workflow helpers
    # ------------------------------------------------------------------

    @staticmethod
    def load_workflow(path: Path) -> dict:
        """Load a workflow JSON template from disk."""
        with open(path) as f:
            return json.load(f)

    @staticmethod
    def patch_workflow(
        workflow: dict, patches: dict[str, dict[str, Any]]
    ) -> dict:
        """Deep-copy *workflow* and apply *patches*.

        *patches* maps ``node_id`` → ``{input_name: value, ...}``.
        """
        w = copy.deepcopy(workflow)
        for node_id, values in patches.items():
            if node_id not in w:
                raise ComfyUIError(
                    f"Node {node_id!r} not found in workflow. "
                    f"Available: {list(w.keys())}"
                )
            for key, val in values.items():
                w[node_id]["inputs"][key] = val
        return w

    @staticmethod
    def random_seed() -> int:
        """Return a random seed suitable for ComfyUI noise nodes."""
        return random.randint(0, 2**32 - 1)
