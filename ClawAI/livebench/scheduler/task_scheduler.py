"""
TaskScheduler — 生产级任务调度器

职责：
1. 接收 POST /api/tasks 提交的任务描述
2. 初始化/唤醒 LiveAgent 实例
3. 协调多 Agent 调用 DeepSeek API
4. 通过 WebSocket 实时回传 Agent 思考日志、代码生成进度
"""

import os
import json
import asyncio
import uuid
import time
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Any, Callable

# ── 进度回调类型 ──────────────────────────────────────────────
ProgressCallback = Callable[[dict], None]


class AgentTaskRunner:
    """
    单个 Agent 任务执行器。
    包装 LiveAgent 的 run_daily_session，同时通过回调将进度推送到 WebSocket。
    """

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
        """通过回调发射进度事件"""
        if self._progress_callback:
            self._progress_callback({
                "type": event_type,
                "agent": self.signature,
                "timestamp": datetime.now().isoformat(),
                **payload,
            })

    async def initialize(self):
        """懒初始化 LiveAgent"""
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
            # 使用内联任务（由调度器动态创建）
            task_source_type="inline",
            inline_tasks=[],
            # LLM 评估 (heuristic evaluation 已不再支持)
            use_llm_evaluation=True,
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
        执行一个任务，实时发射进度事件。

        返回最终结果 dict。
        """
        await self.initialize()

        # ── 1. 创建内联任务 ──────────────────────────────────
        task = {
            "task_id": task_id,
            "occupation": occupation,
            "sector": sector,
            "prompt": task_prompt,
            "max_payment": max_payment,
            "source": "api_task",
        }

        # 注入到 task_manager
        self._agent.task_manager.inline_tasks = [task]
        self._agent.task_manager.load_tasks()

        await self._emit("task_assigned", {
            "task_id": task_id,
            "occupation": occupation,
            "sector": sector,
            "prompt": task_prompt[:200],
        })

        # ── 2. 运行 Agent ────────────────────────────────────
        date_str = datetime.now().strftime("%Y-%m-%d")
        self._agent.current_date = date_str
        self._agent.current_task = task

        # 设置工具状态
        from livebench.tools.direct_tools import set_global_state as set_tool_state
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

        # ── 3. 创建带进度钩子的 Agent ────────────────────────
        system_prompt = self._build_task_prompt(date_str, task)
        self._agent.agent = self._agent.model.bind_tools(self._agent.tools)

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": task_prompt},
        ]

        await self._emit("agent_thinking", {
            "task_id": task_id,
            "message": "Agent 开始分析任务...",
        })

        # ── 4. Agent 推理循环 ────────────────────────────────
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
                "message": f"推理迭代 {iteration + 1}/{max_iterations}",
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

            # 提取 Agent 思考内容
            agent_text = response.content if hasattr(response, 'content') else str(response)
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

            # 处理工具调用
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

                    # 发射代码生成事件
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

                    # 发射文件创建事件
                    if tool_name in ('write_file', 'create_file'):
                        file_path = tool_args.get('file_path', tool_args.get('path', ''))
                        await self._emit("artifact_created", {
                            "task_id": task_id,
                            "file_path": file_path,
                        })

                    # 执行工具
                    tool_result = await self._agent._execute_tool(tool_name, tool_args)

                    # 检查是否提交了工作
                    if tool_name == 'submit_work':
                        self._agent.economic_tracker.end_task()
                        self._agent.last_work_submitted = True

                        result_dict = tool_result if isinstance(tool_result, dict) else {}
                        payment = result_dict.get('actual_payment', result_dict.get('payment', 0))
                        eval_score = result_dict.get('evaluation_score', 0.0)

                        final_result["evaluation_score"] = eval_score
                        final_result["payment"] = payment
                        final_result["status"] = "completed"

                        # 收集 artifact 路径
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

                    # 添加工具结果到消息
                    from livebench.agent.message_formatter import format_tool_result_message
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

            # 没有工具调用 — 提示 Agent 继续
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
                    "message": "Agent 未提交工作，正在提示继续...",
                })
                continue

            break

        # ── 5. 最终状态 ──────────────────────────────────────
        if not activity_completed and final_result["status"] != "error":
            final_result["status"] = "incomplete"
            await self._emit("task_incomplete", {
                "task_id": task_id,
                "reason": "迭代次数耗尽，Agent 未提交工作",
            })

        # 记录任务完成
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
        """构建任务系统提示词"""
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
    生产级任务调度器。

    管理多个 AgentTaskRunner 实例，协调任务分配，
    并通过 WebSocket 广播实时进度。
    """

    def __init__(self, broadcast_callback: Optional[Callable] = None):
        self._runners: Dict[str, AgentTaskRunner] = {}
        self._tasks: Dict[str, dict] = {}
        self._broadcast = broadcast_callback or (lambda msg: None)
        self._lock = asyncio.Lock()

    def set_broadcast(self, cb: Callable):
        """设置广播回调（通常是 WebSocket manager.broadcast）"""
        self._broadcast = cb

    def _make_progress_callback(self, task_id: str):
        """为指定任务创建进度回调，自动广播到 WebSocket"""

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
        提交一个任务到调度器。

        Args:
            task_prompt: 任务描述
            agent_signature: 指定 Agent（None 则自动选择）
            occupation: 职业分类
            sector: 行业分类
            max_payment: 最大支付金额

        Returns:
            包含 task_id 和状态的 dict
        """
        task_id = f"task_{uuid.uuid4().hex[:12]}"

        # 自动选择或创建 Agent
        signature = agent_signature or self._select_agent(occupation)

        # 创建 runner（如果不存在）
        async with self._lock:
            if signature not in self._runners:
                self._runners[signature] = AgentTaskRunner(
                    signature=signature,
                    basemodel=os.getenv("TASK_MODEL", "deepseek-chat"),
                    data_path=f"./livebench/data/agent_data/{signature}",
                    progress_callback=self._make_progress_callback(task_id),
                )

            # 存储任务元数据
            self._tasks[task_id] = {
                "task_id": task_id,
                "prompt": task_prompt,
                "agent": signature,
                "occupation": occupation,
                "sector": sector,
                "status": "queued",
                "created_at": datetime.now().isoformat(),
            }

        runner = self._runners[signature]

        # 广播任务已排队
        await self._broadcast({
            "type": "task_queued",
            "task_id": task_id,
            "agent": signature,
            "prompt": task_prompt[:100],
        })

        # 异步执行任务（不阻塞返回）
        asyncio.create_task(self._execute_task(task_id, runner, task_prompt, occupation, sector, max_payment))

        return {
            "task_id": task_id,
            "agent": signature,
            "status": "queued",
            "message": f"任务已提交，由 Agent '{signature}' 处理",
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
        """后台执行任务"""
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
        根据职业选择或创建 Agent。
        简单实现：如果已有 Agent 则复用，否则创建新的。
        """
        if not self._runners:
            return "ClawAgent-001"

        # 找负载最轻的 Agent
        return min(self._runners.keys(), key=lambda sig: len([
            t for t in self._tasks.values()
            if t.get("agent") == sig and t.get("status") in ("queued", "running")
        ]))

    def get_task_status(self, task_id: str) -> Optional[dict]:
        """查询任务状态"""
        return self._tasks.get(task_id)

    def get_all_tasks(self) -> List[dict]:
        """获取所有任务列表"""
        return list(self._tasks.values())

    def get_agent_status(self, signature: str) -> Optional[dict]:
        """获取 Agent 状态"""
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
        """获取所有 Agent 状态"""
        return [self.get_agent_status(sig) for sig in self._runners]


# ── 全局单例 ────────────────────────────────────────────────
_scheduler: Optional[TaskScheduler] = None


def get_scheduler(broadcast_callback: Optional[Callable] = None) -> TaskScheduler:
    """获取全局调度器单例"""
    global _scheduler
    if _scheduler is None:
        _scheduler = TaskScheduler(broadcast_callback=broadcast_callback)
    if broadcast_callback and _scheduler:
        _scheduler.set_broadcast(broadcast_callback)
    return _scheduler
