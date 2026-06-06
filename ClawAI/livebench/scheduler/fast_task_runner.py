"""
FastTaskRunner — 轻量级"快速通道"任务执行器

直接调用 DeepSeek API 绕过 5 层 LiveAgent 循环，
在 ~45 秒内完成生成，与 Hugging Face 在线版行为一致。

通信方式：
- 通过 SSE（Server-Sent Events）流式返回进度
- 不依赖 WebSocket / LiveAgent

使用方式：
   runner = FastTaskRunner()
   await runner.run_task(task_id, prompt, callback)
"""

import os
import sys
import json
import asyncio
import time
import uuid
from datetime import datetime
from pathlib import Path
from typing import Optional, Callable, Dict, Any, List
from dotenv import load_dotenv

load_dotenv(override=True)

ProgressCallback = Callable[[dict], None]


class FastTaskRunner:
    """
    快速通道任务执行器 — 直接调用 DeepSeek API。

    区别于 LiveAgent 的 5 层循环（经济跟踪、生存管理、决策框架、工具执行、评估），
    本执行器只做两件事：
    1. 调用 DeepSeek Chat API 生成结果
    2. 将生成结果写入本地文件系统
    """

    def __init__(
        self,
        progress_callback: Optional[ProgressCallback] = None,
    ):
        self._progress_callback = progress_callback
        self._api_key = (
            os.getenv("DEEPSEEK_API_KEY")
            or os.getenv("OPENAI_API_KEY")
            or ""
        )
        self._api_base = os.getenv(
            "OPENAI_API_BASE",
            os.getenv("DEEPSEEK_API_BASE", "https://api.deepseek.com/v1"),
        )
        self._model = os.getenv("TASK_MODEL", "deepseek-chat")

    def set_progress_callback(self, cb: ProgressCallback):
        self._progress_callback = cb

    async def _emit(self, event_type: str, payload: dict):
        # ===== 终端实时追踪钩子 =====
        emoji_map = {
            "task_started": "🚀", "agent_thinking": "🤔",
            "code_generated": "💻", "artifact_created": "📄",
            "work_submitted": "📤", "task_completed": "✅",
            "task_error": "❌",
        }
        emoji = emoji_map.get(event_type, "•")
        msg = payload.get("message", payload.get("error", json.dumps(payload)[:150]))
        print(f"[STAGE UPDATE] {emoji} [FastAgent] [{event_type}] {msg}")
        if self._progress_callback:
            self._progress_callback({
                "type": event_type,
                "timestamp": datetime.now().isoformat(),
                **payload,
            })

    async def run_task(
        self,
        task_id: str,
        task_prompt: str,
        occupation: str = "Software Engineer",
        sector: str = "Technology",
        max_payment: float = 50.0,
        output_dir: Optional[str] = None,
    ) -> dict:
        """
        执行快速通道任务。

        Args:
            task_id: 任务 ID
            task_prompt: 用户任务描述
            occupation: 职业分类
            sector: 行业分类
            max_payment: 最大支付
            output_dir: 输出目录（默认为 ./产出/）

        Returns:
            包含 status, artifacts, code 等字段的 dict
        """
        start_time = time.time()
        print(f"\n{'='*50}")
        print(f"[STAGE UPDATE] 🚀 [FAST-TRACK START] task_id={task_id}")
        print(f"[STAGE UPDATE] 📝 [PLANNING] prompt={task_prompt[:200]}")
        print(f"{'='*50}\n")

        # ── 1. 发射任务开始事件 ──
        await self._emit("task_started", {
            "task_id": task_id,
            "agent": "FastAgent-001",
            "prompt": task_prompt[:200],
            "mode": "fast_track",
        })

        await self._emit("agent_thinking", {
            "task_id": task_id,
            "message": "Fast Track: 正在调用 DeepSeek API 生成结果...",
            "iteration": 1,
            "max_iterations": 2,
        })

        # ── 2. 构建系统提示词 ──
        system_prompt = self._build_system_prompt(occupation, sector)
        print(f"[STAGE UPDATE] 🔄 [EXECUTING] Calling DeepSeek API (model={self._model})...")

        # ── 3. 调用 DeepSeek API ──
        result_code = ""
        try:
            if not self._api_key:
                raise RuntimeError("未配置 DEEPSEEK_API_KEY 或 OPENAI_API_KEY")

            import openai
            client = openai.OpenAI(
                api_key=self._api_key,
                base_url=self._api_base,
            )

            # Step 1: 生成代码/内容
            await self._emit("code_generated", {
                "task_id": task_id,
                "language": "python/html",
                "message": "Fast Track: DeepSeek 正在生成...",
            })

            response = client.chat.completions.create(
                model=self._model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": task_prompt},
                ],
                temperature=0.7,
                max_tokens=4096,
            )

            result_code = response.choices[0].message.content or ""
            print(f"[STAGE UPDATE] 💻 [API RESPONSE] Got {len(result_code)} chars from DeepSeek")

            await self._emit("agent_thinking", {
                "task_id": task_id,
                "message": "Fast Track: 内容生成完成，正在写入文件系统...",
                "iteration": 2,
                "max_iterations": 2,
            })

        except Exception as e:
            print(f"[STAGE UPDATE] ❌ [API ERROR] {str(e)[:300]}")
            await self._emit("task_error", {
                "task_id": task_id,
                "error": str(e)[:500],
            })
            elapsed = time.time() - start_time
            return {
                "task_id": task_id,
                "status": "error",
                "error": str(e),
                "elapsed_seconds": round(elapsed, 1),
                "artifacts": [],
                "code_generated": [result_code],
                "thinking_log": [f"Error: {str(e)}"],
                "payment": 0.0,
                "evaluation_score": 0.0,
            }

        # ── 4. 写入文件系统 ──
        print(f"[STAGE UPDATE] 📄 [ARTIFACT] Writing output files...")
        output_base = output_dir or str(Path(__file__).parent.parent.parent / "产出")
        os.makedirs(output_base, exist_ok=True)

        artifacts = []
        code_snippets = [result_code]

        # 提取文件名：从结果中查找 # File: 或 ## 产出文件等标记
        artifact_paths = self._extract_and_write_artifacts(
            result_code, output_base, task_id
        )
        artifacts.extend(artifact_paths)

        # 如果没有提取到 artifact，创建一个默认的 HTML 文件
        if not artifacts:
            default_filename = f"fast_output_{task_id[:8]}.html"
            default_path = os.path.join(output_base, default_filename)
            with open(default_path, "w", encoding="utf-8") as f:
                f.write(result_code)
            artifacts.append(default_path)

        await self._emit("artifact_created", {
            "task_id": task_id,
            "file_path": artifacts[-1],
        })

        # ── 5. 统计耗时 ──
        elapsed = time.time() - start_time

        # ── 6. 发射完成事件 ──
        mock_payment = min(max_payment, round(elapsed * 0.1, 2))
        mock_score = round(min(0.95, elapsed / 60.0 * 0.3 + 0.5), 2)

        print(f"[STAGE UPDATE] ✅ [COMPLETE] elapsed={elapsed:.1f}s, payment=${mock_payment}, score={mock_score}")
        print(f"[STAGE UPDATE] 📊 [SUMMARY] artifacts={len(artifacts)}, code_segments={len(code_snippets)}")

        await self._emit("work_submitted", {
            "task_id": task_id,
            "agent": "FastAgent-001",
            "payment": mock_payment,
            "evaluation_score": mock_score,
            "artifacts": artifacts,
            "elapsed_seconds": round(elapsed, 1),
        })

        await asyncio.sleep(0.1)
        await self._emit("task_completed", {
            "task_id": task_id,
            "agent": "FastAgent-001",
            "payment": mock_payment,
            "evaluation_score": mock_score,
            "elapsed_seconds": round(elapsed, 1),
        })

        return {
            "task_id": task_id,
            "status": "completed",
            "elapsed_seconds": round(elapsed, 1),
            "payment": mock_payment,
            "evaluation_score": mock_score,
            "artifacts": artifacts,
            "code_generated": code_snippets,
            "thinking_log": [
                "Fast Track: DeepSeek API 直接调用",
                f"生成耗时: {elapsed:.1f} 秒",
            ],
        }

    def _extract_and_write_artifacts(
        self, content: str, output_base: str, task_id: str
    ) -> List[str]:
        """
        从 DeepSeek 返回的内容中提取并写入文件。

        支持标记格式：
        - ```file:path\n...\n```
        - # File: path\n...\n
        - [filename]\n...\n
        """
        import re

        artifact_paths = []

        # 模式1: ```file:path 或 ```path 代码块
        pattern1 = r"```(?:file:|)([^\n]+?\.(?:html|py|js|css|json|md|txt|jsx|ts|tsx|vue|svelte))\n(.*?)```"
        matches = list(re.finditer(pattern1, content, re.DOTALL))
        if matches:
            base_dir = os.path.join(output_base, f"task_{task_id[:8]}")
            os.makedirs(base_dir, exist_ok=True)
            for m in matches:
                rel_path = m.group(1).strip()
                code = m.group(2).strip()
                if not code:
                    continue
                full_path = os.path.join(base_dir, rel_path)
                os.makedirs(os.path.dirname(full_path), exist_ok=True)
                with open(full_path, "w", encoding="utf-8") as f:
                    f.write(code)
                artifact_paths.append(full_path)
            return artifact_paths

        # 模式2: # File: 注释
        pattern2 = r"(?:#|//|<!--)\s*File:\s*([^\n]+)\s*(?:-->)?\n([\s\S]*?)(?=\n\s*(?:#|//|<!--)\s*File:|$)"
        matches = list(re.finditer(pattern2, content))
        if matches:
            base_dir = os.path.join(output_base, f"task_{task_id[:8]}")
            os.makedirs(base_dir, exist_ok=True)
            for m in matches:
                rel_path = m.group(1).strip()
                code = m.group(2).strip()
                if not code:
                    continue
                full_path = os.path.join(base_dir, rel_path)
                os.makedirs(os.path.dirname(full_path), exist_ok=True)
                with open(full_path, "w", encoding="utf-8") as f:
                    f.write(code)
                artifact_paths.append(full_path)
            return artifact_paths

        return artifact_paths

    def _build_system_prompt(self, occupation: str, sector: str) -> str:
        """构建系统提示词"""
        return (
            f"You are a skilled {occupation} working in {sector}.\n"
            f"You are tasked with generating a complete, working solution.\n\n"
            f"Important instructions:\n"
            f"1. Generate a complete, self-contained solution.\n"
            f"2. Put each file in a code block with the filename: ```file:path/to/file\n"
            f"3. Make sure the solution is fully functional.\n"
            f"4. If generating HTML, make it a single self-contained file.\n"
            f"5. Include all necessary CSS and JavaScript inline.\n"
            f"6. The output should be immediately usable.\n"
        )