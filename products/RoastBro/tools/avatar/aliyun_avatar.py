"""Alibaba Cloud (DashScope) 2D Avatar Video Synthesis tool.

Uses the DashScope async submission + polling pattern (same as dashscope_asr)
to generate talking-head avatar videos from text scripts via Alibaba Cloud's
text-to-video digital human API.

Pattern: submit (POST) → poll (GET /tasks/{task_id}) → download video.

Requires ``DASHSCOPE_API_KEY`` in the environment or .env.
"""

from __future__ import annotations

import json
import os
import time
from pathlib import Path
from typing import Any

from tools.base_tool import (
    BaseTool,
    Determinism,
    ExecutionMode,
    ResourceProfile,
    RetryPolicy,
    ToolResult,
    ToolRuntime,
    ToolStability,
    ToolStatus,
    ToolTier,
)


class AliyunAvatar(BaseTool):
    """Alibaba Cloud 2D Avatar digital human renderer.

    The agent provides a script text and optional voice/avatar parameters.
    This tool calls the DashScope text-to-video avatar synthesis API to
    produce a talking-head video, downloads the result, and returns the path.
    """

    name = "aliyun_avatar"
    version = "1.0.0"
    tier = ToolTier.GENERATE
    capability = "avatar"
    provider = "dashscope"
    stability = ToolStability.EXPERIMENTAL
    execution_mode = ExecutionMode.ASYNC
    determinism = Determinism.STOCHASTIC
    runtime = ToolRuntime.API

    dependencies = []
    install_instructions = (
        "Set DASHSCOPE_API_KEY to your Alibaba Cloud DashScope API key.\n"
        "  Get one at https://dashscope.aliyun.com/"
    )
    fallback = "linly_talker_avatar"
    fallback_tools = ["linly_talker_avatar"]
    agent_skills = ["dashscope", "ffmpeg"]

    capabilities = [
        "text_to_video",
        "talking_head",
        "digital_human",
        "cloud_avatar",
    ]
    supports = {
        "cloud_rendering": True,
        "multi_voice": True,
        "offline": False,
    }
    best_for = [
        "cloud-based avatar video generation when local GPU is insufficient",
        "professional talking-head videos with Alibaba Cloud digital humans",
        "replacing HeyGen cloud path with DashScope alternative",
    ]
    not_good_for = [
        "local/offline avatar rendering",
        "real-time avatar animation",
    ]

    input_schema = {
        "type": "object",
        "required": ["text"],
        "properties": {
            "text": {
                "type": "string",
                "description": "Script text for the digital human to speak",
            },
            "voice": {
                "type": "string",
                "default": "Cherry",
                "description": "DashScope TTS voice for narration",
            },
            "model": {
                "type": "string",
                "default": "",
                "description": "Aliyun avatar model name (default: auto-selected by API)",
            },
            "avatar_id": {
                "type": "string",
                "description": "Digital human avatar template ID (optional, uses API default if omitted)",
            },
            "background_url": {
                "type": "string",
                "description": "Background image/video URL (optional)",
            },
            "output_path": {
                "type": "string",
                "description": "Output video path (default: auto-generated under projects/)",
            },
            "poll_interval_seconds": {
                "type": "number",
                "default": 5.0,
                "minimum": 1.0,
            },
            "timeout_seconds": {
                "type": "integer",
                "default": 600,
                "minimum": 30,
            },
        },
    }

    resource_profile = ResourceProfile(
        cpu_cores=1, ram_mb=256, vram_mb=0, disk_mb=500, network_required=True
    )
    retry_policy = RetryPolicy(
        max_retries=2,
        backoff_seconds=3.0,
        retryable_errors=["timeout", "rate_limit"],
    )
    idempotency_key_fields = ["text", "voice", "avatar_id", "model"]
    side_effects = [
        "writes video file to output_path",
        "calls DashScope (Alibaba Cloud) avatar synthesis API (async submit + poll)",
    ]
    user_visible_verification = [
        "Watch generated video for lip-sync and naturalness",
        "Verify audio-video synchronization",
    ]

    # DashScope async submission endpoint
    SUBMIT_URL = (
        "https://dashscope.aliyuncs.com/api/v1/services/aigc/"
        "text-to-video/video-synthesis"
    )
    # Standard DashScope task polling endpoint
    POLL_URL_TEMPLATE = (
        "https://dashscope.aliyuncs.com/api/v1/tasks/{task_id}"
    )

    # ------------------------------------------------------------------
    # Status
    # ------------------------------------------------------------------

    def get_status(self) -> ToolStatus:
        """AVAILABLE when DASHSCOPE_API_KEY is configured."""
        if os.environ.get("DASHSCOPE_API_KEY"):
            return ToolStatus.AVAILABLE
        return ToolStatus.UNAVAILABLE

    # ------------------------------------------------------------------
    # Cost & runtime estimates
    # ------------------------------------------------------------------

    def estimate_cost(self, inputs: dict[str, Any]) -> float:
        """DashScope avatar API pricing — default $0 estimate.
        Actual cost depends on Alibaba Cloud billing.
        """
        return 0.0

    def estimate_runtime(self, inputs: dict[str, Any]) -> float:
        """Rough estimate based on text length."""
        text_len = len(inputs.get("text", ""))
        if text_len < 100:
            return 60.0
        if text_len < 500:
            return 120.0
        return 300.0

    # ------------------------------------------------------------------
    # Execution
    # ------------------------------------------------------------------

    def execute(self, inputs: dict[str, Any]) -> ToolResult:
        api_key = os.environ.get("DASHSCOPE_API_KEY")
        if not api_key:
            return ToolResult(
                success=False,
                error="DASHSCOPE_API_KEY not set. " + self.install_instructions,
            )

        text = inputs.get("text", "").strip()
        if not text:
            return ToolResult(success=False, error="text is required.")

        start = time.time()
        try:
            result = self._synthesize(inputs, api_key=api_key)
        except Exception as exc:
            return ToolResult(
                success=False,
                error=f"Aliyun Avatar failed: {self._safe_error(exc)}",
            )

        result.duration_seconds = round(time.time() - start, 2)
        return result

    # ------------------------------------------------------------------
    # Internal: API flow
    # ------------------------------------------------------------------

    def _synthesize(
        self, inputs: dict[str, Any], *, api_key: str
    ) -> ToolResult:
        import requests

        payload = self._build_payload(inputs)
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "X-DashScope-Async": "enable",
        }

        # Step 1: Submit the synthesis job
        submit_resp = requests.post(
            self.SUBMIT_URL, headers=headers, json=payload, timeout=(10, 60)
        )
        submit_data = self._json_or_raise(submit_resp)
        self._raise_for_error(submit_resp.status_code, submit_data)

        task_id = submit_data.get("output", {}).get("task_id")
        if not task_id:
            raise RuntimeError(
                "Aliyun Avatar submit succeeded but did not return output.task_id"
            )

        # Step 2: Poll for completion
        poll_data = self._poll_task(
            requests_module=requests,
            api_key=api_key,
            task_id=task_id,
            poll_interval=float(inputs.get("poll_interval_seconds", 5.0)),
            timeout_seconds=int(inputs.get("timeout_seconds", 600)),
        )

        # Step 3: Extract video URL from completed task
        output = poll_data.get("output", {})
        video_url = (
            output.get("video_url")
            or output.get("result", {}).get("video_url")
            or ""
        )
        if not video_url:
            raise RuntimeError(
                "Aliyun Avatar task succeeded but no video_url in response"
            )

        # Step 4: Download the video
        dl_resp = requests.get(video_url, timeout=300)
        dl_resp.raise_for_status()

        output_path = Path(
            inputs.get(
                "output_path",
                f"projects/aliyun-avatar-{task_id[:8]}/assets/video/"
                f"{task_id[:12]}.mp4",
            )
        )
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_bytes(dl_resp.content)
        size_mb = len(dl_resp.content) / 1024 / 1024

        return ToolResult(
            success=True,
            data={
                "provider": "dashscope",
                "task_id": task_id,
                "output_path": str(output_path),
                "size_mb": round(size_mb, 1),
                "video_url": video_url,
            },
            artifacts=[str(output_path)],
            cost_usd=self.estimate_cost(inputs),
        )

    # ------------------------------------------------------------------
    # Internal: payload builder
    # ------------------------------------------------------------------

    def _build_payload(self, inputs: dict[str, Any]) -> dict[str, Any]:
        """Build the DashScope avatar synthesis request body.

        The base structure follows the DashScope convention:
            {model, input: {...}, parameters: {...}}

        Model name is resolved in order:
          1. inputs['model'] (explicit per-request override)
          2. DASHSCOPE_AVATAR_MODEL env var
          3. Hard-coded default (empty string — API will reject with a clear error)
        """
        model = (
            inputs.get("model")
            or os.environ.get("DASHSCOPE_AVATAR_MODEL")
            or ""
        )
        payload: dict[str, Any] = {
            "model": model,
            "input": {
                "text": inputs["text"],
            },
        }

        # Optional avatar template ID
        avatar_id = (
            inputs.get("avatar_id")
            or os.environ.get("DASHSCOPE_AVATAR_ID")
            or ""
        )
        if avatar_id:
            payload["input"]["avatar_id"] = avatar_id

        # Optional voice override
        voice = inputs.get("voice", "Cherry")
        if voice:
            payload["input"]["voice"] = voice

        # Optional background
        bg = inputs.get("background_url", "")
        if bg:
            payload["input"]["background_url"] = bg

        return payload

    # ------------------------------------------------------------------
    # Internal: polling
    # ------------------------------------------------------------------

    def _poll_task(
        self,
        *,
        requests_module: Any,
        api_key: str,
        task_id: str,
        poll_interval: float,
        timeout_seconds: int,
    ) -> dict[str, Any]:
        """Poll the DashScope task status endpoint until completion."""
        deadline = time.time() + timeout_seconds
        headers = {"Authorization": f"Bearer {api_key}"}
        while time.time() < deadline:
            time.sleep(poll_interval)
            resp = requests_module.get(
                self.POLL_URL_TEMPLATE.format(task_id=task_id),
                headers=headers,
                timeout=(10, 60),
            )
            data = self._json_or_raise(resp)
            self._raise_for_error(resp.status_code, data)
            status = data.get("output", {}).get("task_status")
            if status == "SUCCEEDED":
                return data
            if status == "FAILED":
                msg = data.get("output", {}).get(
                    "message", "unknown error"
                )
                raise RuntimeError(
                    f"Aliyun Avatar task failed: {msg}"
                )
        raise TimeoutError(
            f"Aliyun Avatar task {task_id} did not finish within "
            f"{timeout_seconds}s"
        )

    # ------------------------------------------------------------------
    # Internal: helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _json_or_raise(response: Any) -> dict[str, Any]:
        try:
            return response.json()
        except ValueError as exc:
            raise RuntimeError(
                f"Non-JSON response from DashScope API: "
                f"HTTP {response.status_code}"
            ) from exc

    @staticmethod
    def _raise_for_error(
        http_status: int, payload: dict[str, Any]
    ) -> None:
        if http_status < 400:
            return
        code = payload.get("code")
        message = payload.get("message", "unknown error")
        raise RuntimeError(
            f"DashScope API error: HTTP {http_status}, "
            f"code {code}: {message}"
        )

    @staticmethod
    def _safe_error(exc: Exception) -> str:
        return str(exc).replace(
            os.environ.get("DASHSCOPE_API_KEY", ""), "[redacted]"
        )
