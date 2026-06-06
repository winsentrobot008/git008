"""
TaskScheduler — 生产级任务调度器

职责：
1. 接收 POST /api/tasks 提交的任务描述
2. 初始化/唤醒 LiveAgent 实例
3. 协调多 Agent 调用 DeepSeek API
4. 通过 WebSocket 实时回传 Agent 思考日志、代码生成进度
"""

import os
import sys
import json
import asyncio
import uuid
import time
import random
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Any, Callable
from dotenv import load_dotenv

# 加载 .env 文件（override=True 确保 .env 覆盖系统环境变量）
load_dotenv(override=True)

# ── 进度回调类型 ──────────────────────────────────────────────
ProgressCallback = Callable[[dict], None]


class MockTaskRunner:
    """
    Mock（模拟）Agent 任务执行器。
    当真正的 LiveAgent 无法加载时（例如 API key 未配置或 import 失败），
    使用此模拟执行器生成伪结果，确保前端能看到完整的任务生命周期。

    模拟行为：
    - 状态从 queued -> running -> processing -> completed
    - 随机生成一个假想的 artifact 名称
    - 通过 WebSocket 广播进度事件
    """

    def __init__(
        self,
        progress_callback: Optional[ProgressCallback] = None,
    ):
        self._progress_callback = progress_callback

    def set_progress_callback(self, cb: ProgressCallback):
        self._progress_callback = cb

    async def _emit(self, event_type: str, payload: dict):
        """通过回调发射进度事件"""
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
        agent: str = "MockAgent-001",
        max_iterations: int = 5,
    ) -> dict:
        """
        模拟执行一个任务，分步骤发射进度事件。
        """
        await self._emit("task_assigned", {
            "task_id": task_id,
            "agent": agent,
            "prompt": task_prompt[:200],
        })

        # 模拟初始化
        await self._emit("agent_initializing", {"agent": agent, "model": "mock-deepseek-chat"})
        await asyncio.sleep(0.3)
        await self._emit("agent_initialized", {"agent": agent, "model": "mock-deepseek-chat"})

        # 模拟思考过程
        thinking_steps = [
            "Agent 开始分析任务需求...",
            "正在拆解任务为子步骤...",
            "确定需要实现的核心功能...",
            "开始编写解决方案代码...",
            "验证输出结果是否符合预期...",
        ]

        artifacts = []
        code_snippets = []

        for i in range(max_iterations):
            await asyncio.sleep(0.5)

            # 模拟 Agent 思考
            thought = thinking_steps[i] if i < len(thinking_steps) else f"执行第 {i+1} 步..."
            await self._emit("agent_thinking", {
                "task_id": task_id,
                "agent": agent,
                "iteration": i + 1,
                "max_iterations": max_iterations,
                "thought": thought,
            })

            # 模拟代码生成（第2步开始）
            if i >= 1:
                mock_code = f"# Mock generated code - step {i+1}\nprint('Processing...')"
                code_snippets.append(mock_code)
                await self._emit("code_generated", {
                    "task_id": task_id,
                    "agent": agent,
                    "code": mock_code[:300],
                    "language": "python",
                })

            # 模拟 artifact 创建（第3步开始）
            if i >= 2:
                artifact_name = f"output_{task_id[:8]}_{i}.html"
                artifacts.append(artifact_name)
                await self._emit("artifact_created", {
                    "task_id": task_id,
                    "agent": agent,
                    "file_path": artifact_name,
                })

        # 模拟提交工作
        mock_payment = round(random.uniform(10.0, 45.0), 2)
        mock_score = round(random.uniform(0.5, 0.95), 2)

        await self._emit("work_submitted", {
            "task_id": task_id,
            "agent": agent,
            "payment": mock_payment,
            "evaluation_score": mock_score,
            "artifacts": artifacts,
        })

        await asyncio.sleep(0.3)
        await self._emit("task_completed", {
            "task_id": task_id,
            "agent": agent,
            "payment": mock_payment,
            "evaluation_score": mock_score,
        })

        return {
            "task_id": task_id,
            "status": "completed",
            "payment": mock_payment,
            "evaluation_score": mock_score,
            "artifacts": artifacts,
            "code_generated": code_snippets,
            "thinking_log": thinking_steps,
        }


class RealTaskRunnerProxy:
    """
    真正的 LiveAgent 任务执行器代理。
    尝试使用 LiveAgent，如果导入失败则自动回退到 MockTaskRunner。
    """

    def __init__(
        self,
        signature: str,
        basemodel: str = "deepseek-chat",
        initial_balance: float = 1000.0,
        data_path: Optional[str] = None,
        progress_callback: Optional[ProgressCallback] = None,
    ):
        self.signature = signature
        self.basemodel = basemodel
        self.initial_balance = initial_balance
        self.data_path = data_path or f"./livebench/data/agent_data/{signature}"
        self._progress_callback = progress_callback
        self._real_runner = None
        self._mock_runner = None
        self._use_mock = False

    def _ensure_runner(self):
        """延迟初始化运行器，优先尝试真正的 LiveAgent"""
        if self._real_runner is not None or self._mock_runner is not None:
            return

        # 检查是否有可用的 API key
        api_key = os.getenv("DEEPSEEK_API_KEY") or os.getenv("OPENAI_API_KEY")
        if not api_key:
            print(f"⚠️ [{self.signature}] 未配置 API key，直接使用 Mock 执行器")
            self._mock_runner = MockTaskRunner(progress_callback=self._progress_callback)
            self._use_mock = True
            return

        _liveagent_available = False
        # 先测试 LiveAgent 是否可导入
        try:
            sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
            from agent.live_agent import LiveAgent
            _liveagent_available = True
        except Exception:
            _liveagent_available = False

        if _liveagent_available:
            # 使用真正的 AgentTaskRunner
            runner = AgentTaskRunner(
                signature=self.signature,
                basemodel=self.basemodel,
                initial_balance=self.initial_balance,
                data_path=self.data_path,
                progress_callback=self._progress_callback,
            )
            self._real_runner = runner
            print(f"✅ [{self.signature}] 使用真正的 LiveAgent 执行器（API key 已配置）")
        else:
            print(f"⚠️ [{self.signature}] LiveAgent 不可用，回退到 Mock 执行器")
            self._mock_runner = MockTaskRunner(progress_callback=self._progress_callback)
            self._use_mock = True

    def set_progress_callback(self, cb: ProgressCallback):
        self._progress_callback = cb
        if self._real_runner:
            self._real_runner.set_progress_callback(cb)
        if self._mock_runner:
            self._mock_runner.set_progress_callback(cb)

    async def run_task(
        self,
        task_id: str,
        task_prompt: str,
        occupation: str = "Software Engineer",
        sector: str = "Technology",
        max_payment: float = 50.0,
    ) -> dict:
        """执行任务，优先使用真正的 LiveAgent"""
        self._ensure_runner()

        if self._use_mock:
            return await self._mock_runner.run_task(
                task_id=task_id,
                task_prompt=task_prompt,
                agent=self.signature,
            )

        # 尝试使用真实的 LiveAgent，如果 API 认证失败则回退到 Mock
        try:
            result = await self._real_runner.run_task(
                task_id=task_id,
                task_prompt=task_prompt,
                occupation=occupation,
                sector=sector,
                max_payment=max_payment,
            )

            # 检查返回结果是否包含 API 认证错误
            error_str = str(result.get("error", "") or "")
            if result.get("status") == "error" and ("401" in error_str or "authentication" in error_str.lower() or "AuthenticationError" in error_str):
                print(f"⚠️ [{self.signature}] 检测到 API 认证失败，回退到 Mock 执行器")
                self._use_mock = True
                self._mock_runner = MockTaskRunner(progress_callback=self._progress_callback)
                return await self._mock_runner.run_task(
                    task_id=task_id,
                    task_prompt=task_prompt,
                    agent=self.signature,
                )

            return result

        except Exception as e:
            error_str = str(e)
            # 捕获 API 认证错误，回退到 Mock 执行器
            if "AuthenticationError" in error_str or "401" in error_str or "authentication" in error_str.lower():
                print(f"⚠️ [{self.signature}] API 认证失败（异常），回退到 Mock 执行器: {str(e)[:100]}")
                self._use_mock = True
                self._mock_runner = MockTaskRunner(progress_callback=self._progress_callback)
                return await self._mock_runner.run_task(
                    task_id=task_id,
                    task_prompt=task_prompt,
                    agent=self.signature,
                )
            raise


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
        # ===== 终端实时追踪钩子 =====
        emoji_map = {
            "agent_initializing": "🔧", "agent_initialized": "✅",
            "task_assigned": "🎯", "agent_thinking": "🤔",
            "code_generated": "💻", "artifact_created": "📄",
            "tool_calls": "🛠️", "work_submitted": "📤",
            "task_completed": "🏁", "task_error": "❌",
            "task_started": "🚀", "task_finished": "✅",
            "agent_error": "⚠️", "task_incomplete": "⏸️",
        }
        emoji = emoji_map.get(event_type, "•")
        msg = payload.get("message", payload.get("thought", payload.get("error", json.dumps(payload)[:150])))
        print(f"[STAGE UPDATE] {emoji} [{self.signature}] [{event_type}] {msg}")
        # =================================
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

        # 使用一个占位任务初始化，实际任务在 run_task 中注入
        placeholder_task = [{
            "task_id": "_placeholder_",
            "occupation": "Software Engineer",
            "sector": "Technology",
            "prompt": "Placeholder",
            "source": "initialization"
        }]

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
            inline_tasks=placeholder_task,
            # 使用 LLM 评估（heuristic 已不再支持）
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
        print(f"\n{'='*60}")
        print(f"[STAGE UPDATE] 🚀 [5-LAYER LOOP START] Agent={self.signature}, task_id={task_id}")
        print(f"[STAGE UPDATE] 📝 [LAYER 1: PLANNING] task_prompt={task_prompt[:200]}")
        print(f"{'='*60}\n")
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

        # ── 4. Agent 推理循环 (5-Layer Loop) ─────────────────
        print(f"[STAGE UPDATE] 🔄 [LAYER 2: EXECUTING] Starting agent inference loop (max {max_iterations} iterations)")
        print(f"[STAGE UPDATE] 📋 [LAYER 3: TOOL USE] Agent will use tools: execute_code_sandbox, write_file, submit_work")
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
            print(f"[STAGE UPDATE] 🤔 [ITERATION {iteration + 1}/{max_iterations}] Agent reasoning step...")
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
                tool_names = [tc.get('name', 'unknown') for tc in response.tool_calls]
                print(f"[STAGE UPDATE] 🛠️ [TOOL CALL] tools={tool_names}")
                await self._emit("tool_calls", {
                    "task_id": task_id,
                    "count": len(response.tool_calls),
                    "tools": tool_names,
                })

                messages.append({"role": "assistant", "content": agent_text})

                for tool_call in response.tool_calls:
                    tool_name = tool_call.get('name', 'unknown')
                    tool_args = tool_call.get('args', {})

                    # 发射代码生成事件
                    if tool_name in ('execute_code', 'execute_code_sandbox'):
                        code_snippet = tool_args.get('code', '')[:200]
                        print(f"[STAGE UPDATE] 💻 [CODE_EXEC] iteration={iteration+1}, code_preview={code_snippet}")
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
                        print(f"[STAGE UPDATE] 📄 [FILE_CREATED] path={file_path}")
                        await self._emit("artifact_created", {
                            "task_id": task_id,
                            "file_path": file_path,
                        })

                    # 执行工具
                    tool_result = await self._agent._execute_tool(tool_name, tool_args)

                    # 检查是否提交了工作
                    if tool_name == 'submit_work':
                        print(f"[STAGE UPDATE] 📤 [LAYER 4: SUBMIT_WORK] Agent submitted work for task {task_id}")
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
            print(f"[STAGE UPDATE] ⏸️ [LAYER 5: INCOMPLETE] Agent exhausted {max_iterations} iterations without submit")
            await self._emit("task_incomplete", {
                "task_id": task_id,
                "reason": "迭代次数耗尽，Agent 未提交工作",
            })
        else:
            print(f"[STAGE UPDATE] 🏁 [LAYER 5: COMPLETE] status={final_result['status']}, payment=${final_result.get('payment', 0)}, score={final_result.get('evaluation_score', 0)}")
            print(f"[STAGE UPDATE] 📊 [SUMMARY] artifacts={len(final_result.get('artifacts', []))}, code_segments={len(final_result.get('code_generated', []))}")

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

    管理多个 AgentTaskRunner / MockTaskRunner 实例，协调任务分配，
    并通过 WebSocket 广播实时进度。

    当 LiveAgent (DeepSeek API) 不可用时自动回退到 Mock 执行器。
    """

    def __init__(self, broadcast_callback: Optional[Callable] = None):
        self._runners: Dict[str, RealTaskRunnerProxy] = {}
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
                self._runners[signature] = RealTaskRunnerProxy(
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

        # 广播任务已排队
        await self._broadcast({
            "type": "task_queued",
            "task_id": task_id,
            "agent": signature,
            "prompt": task_prompt[:100],
        })

        # 注意：不再在此处调用 asyncio.create_task
        # 由 BackgroundTasks 框架负责生命周期管理（通过 _execute_task_background 调用）
        return {
            "task_id": task_id,
            "agent": signature,
            "status": "queued",
            "message": f"任务已提交，由 Agent '{signature}' 处理",
        }

    async def _execute_task_background(
        self,
        task_id: str,
        agent_signature: str,
        task_prompt: str,
        occupation: str,
        sector: str,
        max_payment: float,
    ):
        """
        BackgroundTasks 回调 — 框架级生命周期管理的后台任务执行。
        由 server.py 的 POST /api/tasks 通过 background_tasks.add_task() 注册。
        """
        print(f"\n{'='*70}")
        print(f"🚀 [SCHEDULER::_execute_task_background] 开始后台执行")
        print(f"   task_id:     {task_id}")
        print(f"   agent:       {agent_signature}")
        print(f"   occupation:  {occupation}")
        print(f"   sector:      {sector}")
        print(f"   prompt:      {task_prompt[:120]}...")
        print(f"{'='*70}\n")

        # 获取或创建 runner
        async with self._lock:
            if agent_signature not in self._runners:
                print(f"   ℹ️  创建新的 RealTaskRunnerProxy for {agent_signature}")
                self._runners[agent_signature] = RealTaskRunnerProxy(
                    signature=agent_signature,
                    basemodel=os.getenv("TASK_MODEL", "deepseek-chat"),
                    data_path=f"./livebench/data/agent_data/{agent_signature}",
                    progress_callback=self._make_progress_callback(task_id),
                )
            runner = self._runners[agent_signature]
            print(f"   ✅ Runner 就绪: {type(runner).__name__}")

        print(f"   🏃 委托执行至 _execute_task...")
        await self._execute_task(task_id, runner, task_prompt, occupation, sector, max_payment)
        print(f"   🏁 [_execute_task_background] 执行完毕\n")

    async def _execute_task(
        self,
        task_id: str,
        runner: RealTaskRunnerProxy,
        task_prompt: str,
        occupation: str,
        sector: str,
        max_payment: float,
    ):
        """后台执行任务"""
        print(f"\n{'='*60}")
        print(f"[STAGE UPDATE] 🚀 [SCHEDULER] Dispatching task {task_id} to runner {runner.signature}")
        print(f"[STAGE UPDATE] 📋 [SCHEDULER] occupation={occupation}, sector={sector}, max_payment=${max_payment}")
        print(f"{'='*60}\n")
        try:
            self._tasks[task_id]["status"] = "running"
            print(f"[STAGE UPDATE] 🔄 [SCHEDULER] task status -> running")
            await self._broadcast({
                "type": "task_started",
                "task_id": task_id,
                "agent": runner.signature,
            })

            print(f"[STAGE UPDATE] ⏳ [SCHEDULER] Waiting for runner.run_task() to complete...")
            result = await runner.run_task(
                task_id=task_id,
                task_prompt=task_prompt,
                occupation=occupation,
                sector=sector,
                max_payment=max_payment,
            )

            self._tasks[task_id]["status"] = result.get("status", "completed")
            self._tasks[task_id]["result"] = result
            print(f"[STAGE UPDATE] ✅ [SCHEDULER] Runner completed: status={result.get('status')}, payment=${result.get('payment', 0)}")

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
            print(f"[STAGE UPDATE] ❌ [SCHEDULER ERROR] task={task_id}, error={str(e)[:300]}")
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

    def delete_task(self, task_id: str) -> bool:
        """删除指定任务"""
        if task_id in self._tasks:
            del self._tasks[task_id]
            return True
        return False

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
            "model": "auto",
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