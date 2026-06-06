"""
TaskScheduler 鈥?鐢熶骇绾т换鍔¤皟搴﹀櫒

鑱岃矗锛?1. 鎺ユ敹 POST /api/tasks 鎻愪氦鐨勪换鍔℃弿杩?2. 鍒濆鍖?鍞ら啋 LiveAgent 瀹炰緥
3. 鍗忚皟澶?Agent 璋冪敤 DeepSeek API
4. 閫氳繃 WebSocket 瀹炴椂鍥炰紶 Agent 鎬濊€冩棩蹇椼€佷唬鐮佺敓鎴愯繘搴?"""

import os
import json
import asyncio
import uuid
import time
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Any, Callable

# 鈹€鈹€ 杩涘害鍥炶皟绫诲瀷 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
ProgressCallback = Callable[[dict], None]


class AgentTaskRunner:
    """
    鍗曚釜 Agent 浠诲姟鎵ц鍣ㄣ€?    鍖呰 LiveAgent 鐨?run_daily_session锛屽悓鏃堕€氳繃鍥炶皟灏嗚繘搴︽帹閫佸埌 WebSocket銆?    """

    def __init__(
        self,
        signature: str,
        basemodel: str,
        initial_balance: float = 1000.0,
        data_path: Optional[str] = None,
        progress_callback: Optional[ProgressCallback] = None,
    ):
        self.signature = signature
        self.basemodel = basemodel
        self.initial_balance = initial_balance
        self.data_path = data_path or f"./livebench/data/agent_data/{signature}"
        self._progress_callback = progress_callback
        self._agent = None

    def set_progress_callback(self, cb: ProgressCallback):
        self._progress_callback = cb

    async def _emit(self, event_type: str, payload: dict):
        """閫氳繃鍥炶皟鍙戝皠杩涘害浜嬩欢"""
        if self._progress_callback:
            self._progress_callback({
                "type": event_type,
                "agent": self.signature,
                "timestamp": datetime.now().isoformat(),
                **payload,
            })

    async def initialize(self):
        """鎳掑垵濮嬪寲 LiveAgent"""
        if self._agent is not None:
            return

        await self._emit("agent_initializing", {"model": self.basemodel})

        from livebench.agent.live_agent import LiveAgent

        self._agent = LiveAgent(
            signature=self.signature,
            basemodel=self.basemodel,
            initial_balance=self.initial_balance,
            data_path=self.data_path,
            max_steps=20,
            max_retries=5,
            base_delay=1.0,
            api_timeout=120.0,
            # 浣跨敤鍐呰仈浠诲姟锛堢敱璋冨害鍣ㄥ姩鎬佸垱寤猴級
            task_source_type="inline",
            inline_tasks=[],
            # 绂佺敤 LLM 璇勪及浠ュ姞蹇搷搴?            use_llm_evaluation=False,
        )

        await self._agent.initialize()
        await self._emit("agent_initialized", {"model": self.basemodel})

    async def run_task(
        self,
        task_id: str,
        task_prompt: str,
        occupation: str = "Software Engineer",
        sector: str = "Technology",
        max_payment: float = 50.0,
    ) -> dict:
        """
        鎵ц涓€涓换鍔★紝瀹炴椂鍙戝皠杩涘害浜嬩欢銆?
        杩斿洖鏈€缁堢粨鏋?dict銆?        """
        await self.initialize()

        # 鈹€鈹€ 1. 鍒涘缓鍐呰仈浠诲姟 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
        task = {
            "task_id": task_id,
            "occupation": occupation,
            "sector": sector,
            "prompt": task_prompt,
            "max_payment": max_payment,
            "source": "api_task",
        }

        # 娉ㄥ叆鍒?task_manager
        self._agent.task_manager.inline_tasks = [task]
        self._agent.task_manager.load_tasks()

        await self._emit("task_assigned", {
            "task_id": task_id,
            "occupation": occupation,
            "sector": sector,
            "prompt": task_prompt[:200],
        })

        # 鈹€鈹€ 2. 杩愯 Agent 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
        date_str = datetime.now().strftime("%Y-%m-%d")
        self._agent.current_date = date_str
        self._agent.current_task = task

        # 璁剧疆宸ュ叿鐘舵€?        from livebench.tools.direct_tools import set_global_state as set_tool_state
        set_tool_state(
            signature=self.signature,
            economic_tracker=self._agent.economic_tracker,
            task_manager=self._agent.task_manager,
            evaluator=self._agent.evaluator,
            current_date=date_str,
            current_task=task,
            data_path=self.data_path,
            supports_multimodal=True,
        )

        # 鈹€鈹€ 3. 鍒涘缓甯﹁繘搴﹂挬瀛愮殑 Agent 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
        system_prompt = self._build_task_prompt(date_str, task)
        self._agent.agent = self._agent.model.bind_tools(self._agent.tools)

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": task_prompt},
        ]

        await self._emit("agent_thinking", {
            "task_id": task_id,
            "message": "Agent 寮€濮嬪垎鏋愪换鍔?..",
        })

        # 鈹€鈹€ 4. Agent 鎺ㄧ悊寰幆 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
        max_iterations = 15
        activity_completed = False
        final_result = {
            "task_id": task_id,
            "status": "running",
            "artifacts": [],
            "thinking_log": [],
            "code_generated": [],
            "evaluation_score": 0.0,
            "payment": 0.0,
        }

        for iteration in range(max_iterations):
            await self._emit("agent_thinking", {
                "task_id": task_id,
                "iteration": iteration + 1,
                "max_iterations": max_iterations,
                "message": f"鎺ㄧ悊杩唬 {iteration + 1}/{max_iterations}",
            })

            try:
                response = await self._agent._ainvoke_with_retry(messages, timeout=120.0)
            except Exception as e:
                await self._emit("agent_error", {
                    "task_id": task_id,
                    "error": str(e)[:300],
                })
                final_result["status"] = "error"
                final_result["error"] = str(e)
                break

            # 鎻愬彇 Agent 鎬濊€冨唴瀹?            agent_text = response.content if hasattr(response, 'content') else str(response)
            thinking_entry = {
                "iteration": iteration + 1,
                "text": agent_text[:500],
                "timestamp": datetime.now().isoformat(),
            }
            final_result["thinking_log"].append(thinking_entry)

            await self._emit("agent_thinking", {
                "task_id": task_id,
                "iteration": iteration + 1,
                "thought": agent_text[:300],
            })

            # 澶勭悊宸ュ叿璋冪敤
            if hasattr(response, 'tool_calls') and response.tool_calls:
                await self._emit("tool_calls", {
                    "task_id": task_id,
                    "count": len(response.tool_calls),
                    "tools": [tc.get('name', 'unknown') for tc in response.tool_calls],
                })

                messages.append({"role": "assistant", "content": agent_text})

                for tool_call in response.tool_calls:
                    tool_name = tool_call.get('name', 'unknown')
                    tool_args = tool_call.get('args', {})

                    # 鍙戝皠浠ｇ爜鐢熸垚浜嬩欢
                    if tool_name in ('execute_code', 'execute_code_sandbox'):
                        code_snippet = tool_args.get('code', '')[:500]
                        final_result["code_generated"].append({
                            "iteration": iteration + 1,
                            "code": code_snippet,
                        })
                        await self._emit("code_generated", {
                            "task_id": task_id,
                            "code": code_snippet,
                            "language": "python",
                        })

                    # 鍙戝皠鏂囦欢鍒涘缓浜嬩欢
                    if tool_name in ('write_file', 'create_file'):
                        file_path = tool_args.get('file_path', tool_args.get('path', ''))
                        await self._emit("artifact_created", {
                            "task_id": task_id,
                            "file_path": file_path,
                        })

                    # 鎵ц宸ュ叿
                    tool_result = await self._agent._execute_tool(tool_name, tool_args)

                    # 妫€鏌ユ槸鍚︽彁浜や簡宸ヤ綔
                    if tool_name == 'submit_work':
                        self._agent.economic_tracker.end_task()
                        self._agent.last_work_submitted = True

                        result_dict = tool_result if isinstance(tool_result, dict) else {}
                        payment = result_dict.get('actual_payment', result_dict.get('payment', 0))
                        eval_score = result_dict.get('evaluation_score', 0.0)

                        final_result["evaluation_score"] = eval_score
                        final_result["payment"] = payment
                        final_result["status"] = "completed"

                        # 鏀堕泦 artifact 璺緞
                        artifact_paths = result_dict.get('artifact_file_paths', [])
                        if isinstance(artifact_paths, list):
                            final_result["artifacts"] = artifact_paths

                        await self._emit("work_submitted", {
                            "task_id": task_id,
                            "payment": payment,
                            "evaluation_score": eval_score,
                            "artifacts": artifact_paths,
                        })

                        activity_completed = True

                    # 娣诲姞宸ュ叿缁撴灉鍒版秷鎭?                    from livebench.agent.message_formatter import format_tool_result_message
                    tool_msg = format_tool_result_message(tool_name, tool_result, tool_args, activity_completed)
                    messages.append(tool_msg)

                if activity_completed:
                    await self._emit("task_completed", {
                        "task_id": task_id,
                        "payment": final_result["payment"],
                        "evaluation_score": final_result["evaluation_score"],
                    })
                    break
                continue

            # 娌℃湁宸ュ叿璋冪敤 鈥?鎻愮ず Agent 缁х画
            if not activity_completed and iteration < max_iterations - 1:
                messages.append({"role": "assistant", "content": agent_text})
                nudge = (
                    "STOP explaining in text. You MUST use tool calls.\n"
                    "Call execute_code_sandbox with your code NOW.\n"
                    "After creating files, call submit_work with artifact paths."
                )
                messages.append({"role": "user", "content": nudge})
                await self._emit("agent_thinking", {
                    "task_id": task_id,
                    "message": "Agent 鏈彁浜ゅ伐浣滐紝姝ｅ湪鎻愮ず缁х画...",
                })
                continue

            break

        # 鈹€鈹€ 5. 鏈€缁堢姸鎬?鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
        if not activity_completed and final_result["status"] != "error":
            final_result["status"] = "incomplete"
            await self._emit("task_incomplete", {
                "task_id": task_id,
                "reason": "杩唬娆℃暟鑰楀敖锛孉gent 鏈彁浜ゅ伐浣?,
            })

        # 璁板綍浠诲姟瀹屾垚
        if activity_completed:
            self._agent.economic_tracker.record_task_completion(
                task_id=task_id,
                work_submitted=True,
                wall_clock_seconds=0.0,
                evaluation_score=final_result["evaluation_score"],
                money_earned=final_result["payment"],
                date=date_str,
            )

        return final_result

    def _build_task_prompt(self, date: str, task: dict) -> str:
        """鏋勫缓浠诲姟绯荤粺鎻愮ず璇?""
        return (
            f"You are a skilled AI agent working on a task.\n"
            f"Date: {date}\n"
            f"Task ID: {task.get('task_id', 'unknown')}\n"
            f"Occupation: {task.get('occupation', 'Software Engineer')}\n"
            f"Sector: {task.get('sector', 'Technology')}\n\n"
            f"Your goal is to complete the following task:\n"
            f"{task.get('prompt', '')}\n\n"
            f"Workflow:\n"
            f"1. Analyze the task and plan your approach\n"
            f"2. Use execute_code_sandbox to write and run code\n"
            f"3. Create any necessary files using write_file\n"
            f"4. Call submit_work with your artifacts when done\n\n"
            f"You have up to 15 iterations to complete this task."
        )


class TaskScheduler:
    """
    鐢熶骇绾т换鍔¤皟搴﹀櫒銆?
    绠＄悊澶氫釜 AgentTaskRunner 瀹炰緥锛屽崗璋冧换鍔″垎閰嶏紝
    骞堕€氳繃 WebSocket 骞挎挱瀹炴椂杩涘害銆?    """

    def __init__(self, broadcast_callback: Optional[Callable] = None):
        self._runners: Dict[str, AgentTaskRunner] = {}
        self._tasks: Dict[str, dict] = {}
        self._broadcast = broadcast_callback or (lambda msg: None)
        self._lock = asyncio.Lock()

    def set_broadcast(self, cb: Callable):
        """璁剧疆骞挎挱鍥炶皟锛堥€氬父鏄?WebSocket manager.broadcast锛?""
        self._broadcast = cb

    def _make_progress_callback(self, task_id: str):
        """涓烘寚瀹氫换鍔″垱寤鸿繘搴﹀洖璋冿紝鑷姩骞挎挱鍒?WebSocket"""

        def _cb(event: dict):
            event["task_id"] = task_id
            asyncio.ensure_future(self._broadcast(event))

        return _cb

    async def submit_task(
        self,
        task_prompt: str,
        agent_signature: Optional[str] = None,
        occupation: str = "Software Engineer",
        sector: str = "Technology",
        max_payment: float = 50.0,
    ) -> dict:
        """
        鎻愪氦涓€涓换鍔″埌璋冨害鍣ㄣ€?
        Args:
            task_prompt: 浠诲姟鎻忚堪
            agent_signature: 鎸囧畾 Agent锛圢one 鍒欒嚜鍔ㄩ€夋嫨锛?            occupation: 鑱屼笟鍒嗙被
            sector: 琛屼笟鍒嗙被
            max_payment: 鏈€澶ф敮浠橀噾棰?
        Returns:
            鍖呭惈 task_id 鍜岀姸鎬佺殑 dict
        """
        task_id = f"task_{uuid.uuid4().hex[:12]}"

        # 鑷姩閫夋嫨鎴栧垱寤?Agent
        signature = agent_signature or self._select_agent(occupation)

        # 鍒涘缓 runner锛堝鏋滀笉瀛樺湪锛?        async with self._lock:
            if signature not in self._runners:
                self._runners[signature] = AgentTaskRunner(
                    signature=signature,
                    basemodel=os.getenv("TASK_MODEL", "deepseek-chat"),
                    data_path=f"./livebench/data/agent_data/{signature}",
                    progress_callback=self._make_progress_callback(task_id),
                )

            # 瀛樺偍浠诲姟鍏冩暟鎹?            self._tasks[task_id] = {
                "task_id": task_id,
                "prompt": task_prompt,
                "agent": signature,
                "occupation": occupation,
                "sector": sector,
                "status": "queued",
                "created_at": datetime.now().isoformat(),
            }

        runner = self._runners[signature]

        # 骞挎挱浠诲姟宸叉帓闃?        await self._broadcast({
            "type": "task_queued",
            "task_id": task_id,
            "agent": signature,
            "prompt": task_prompt[:100],
        })

        # 寮傛鎵ц浠诲姟锛堜笉闃诲杩斿洖锛?        asyncio.create_task(self._execute_task(task_id, runner, task_prompt, occupation, sector, max_payment))

        return {
            "task_id": task_id,
            "agent": signature,
            "status": "queued",
            "message": f"浠诲姟宸叉彁浜わ紝鐢?Agent '{signature}' 澶勭悊",
        }

    async def _execute_task(
        self,
        task_id: str,
        runner: AgentTaskRunner,
        task_prompt: str,
        occupation: str,
        sector: str,
        max_payment: float,
    ):
        """鍚庡彴鎵ц浠诲姟"""
        try:
            self._tasks[task_id]["status"] = "running"
            await self._broadcast({
                "type": "task_started",
                "task_id": task_id,
                "agent": runner.signature,
            })

            result = await runner.run_task(
                task_id=task_id,
                task_prompt=task_prompt,
                occupation=occupation,
                sector=sector,
                max_payment=max_payment,
            )

            self._tasks[task_id]["status"] = result.get("status", "completed")
            self._tasks[task_id]["result"] = result

            await self._broadcast({
                "type": "task_finished",
                "task_id": task_id,
                "agent": runner.signature,
                "status": result.get("status"),
                "payment": result.get("payment", 0),
                "evaluation_score": result.get("evaluation_score", 0),
            })

        except Exception as e:
            self._tasks[task_id]["status"] = "error"
            self._tasks[task_id]["error"] = str(e)
            await self._broadcast({
                "type": "task_error",
                "task_id": task_id,
                "agent": runner.signature,
                "error": str(e)[:500],
            })
            import traceback
            traceback.print_exc()

    def _select_agent(self, occupation: str) -> str:
        """
        鏍规嵁鑱屼笟閫夋嫨鎴栧垱寤?Agent銆?        绠€鍗曞疄鐜帮細濡傛灉宸叉湁 Agent 鍒欏鐢紝鍚﹀垯鍒涘缓鏂扮殑銆?        """
        if not self._runners:
            return "ClawAgent-001"

        # 鎵捐礋杞芥渶杞荤殑 Agent
        return min(self._runners.keys(), key=lambda sig: len([
            t for t in self._tasks.values()
            if t.get("agent") == sig and t.get("status") in ("queued", "running")
        ]))

    def get_task_status(self, task_id: str) -> Optional[dict]:
        """鏌ヨ浠诲姟鐘舵€?""
        return self._tasks.get(task_id)

    def get_all_tasks(self) -> List[dict]:
        """鑾峰彇鎵€鏈変换鍔″垪琛?""
        return list(self._tasks.values())

    def get_agent_status(self, signature: str) -> Optional[dict]:
        """鑾峰彇 Agent 鐘舵€?""
        runner = self._runners.get(signature)
        if not runner:
            return None
        return {
            "signature": signature,
            "model": runner.basemodel,
            "active_tasks": len([
                t for t in self._tasks.values()
                if t.get("agent") == signature and t.get("status") == "running"
            ]),
            "total_tasks": len([
                t for t in self._tasks.values()
                if t.get("agent") == signature
            ]),
        }

    def get_all_agents(self) -> List[dict]:
        """鑾峰彇鎵€鏈?Agent 鐘舵€?""
        return [self.get_agent_status(sig) for sig in self._runners]


# 鈹€鈹€ 鍏ㄥ眬鍗曚緥 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
_scheduler: Optional[TaskScheduler] = None


def get_scheduler(broadcast_callback: Optional[Callable] = None) -> TaskScheduler:
    """鑾峰彇鍏ㄥ眬璋冨害鍣ㄥ崟渚?""
    global _scheduler
    if _scheduler is None:
        _scheduler = TaskScheduler(broadcast_callback=broadcast_callback)
    if broadcast_callback and _scheduler:
        _scheduler.set_broadcast(broadcast_callback)
    return _scheduler
