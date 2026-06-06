# 🏭 Maneki-AI 机制与架构深度分析

> **生成时间**: 2026-06-05
> **分析方法**: 逐文件源码遍历 + 执行链路追踪
> **覆盖范围**: Maneki-AI 全部 30+ 源文件

---

## 目录

1. [总览：四条并行的任务执行路径](#1-总览四条并行的任务执行路径)
2. [路径 A：FastAPI 云端路径 (app.py)](#2-路径-a-fastapi-云端路径)
3. [路径 B：本地工厂路径 (start_factory.py → task_listener.py)](#3-路径-b-本地工厂路径)
4. [路径 C：ECC 编排路径 (ecc_core.py)](#4-路径-c-ecc-编排路径)
5. [路径 D：独立任务执行器路径 (run_task.py)](#5-路径-d-独立任务执行器路径)
6. [HQ- Worker-Safety 三部门架构](#6-hq--worker--safety-三部门架构)
7. [Grip 验证闭环机制](#7-grip-验证闭环机制)
8. [CircuitBreaker 防卡死机制](#8-circuitbreaker-防卡死机制)
9. [Action 注册表与 DeepSeek 调用机制](#9-action-注册表与-deepseek-调用机制)
10. [双 API 网关共存机制](#10-双-api-网关共存机制)
11. [GitHub Gist 隧道公告板机制](#11-github-gist-隧道公告板机制)
12. [扩展模块实现细节](#12-扩展模块实现细节)
13. [完整文件依赖关系图](#13-完整文件依赖关系图)

---

## 1. 总览：四条并行的任务执行路径

Maneki-AI 存在 **4 条独立的执行路径**，分别服务于不同的触发方式和运行环境，它们共享底层组件但启动方式完全不同：

```
                    用户输入
                       │
         ┌─────────────┼─────────────┐
         ▼             ▼             ▼
   Factory UI    WebSocket     CLI 命令行
  (app.py:417)  (app.py:621)  (run_task.py)
         │             │             │
         ▼             ▼             ▼
   写 pending/   广播到 WS    直接 subprocess
   JSON 文件     + 写 pending   执行命令
         │             │             │
         └─────────────┼─────────────┘
                       │
               ┌───────┴───────┐
               ▼               ▼
        task_listener.py   ECC.orchestrate()
        (5s 轮询)          (手动调用)
               │               │
               ▼               ▼
        HQ → Worker →     decompose() →
        Safety 三阶段      execute steps →
               │           ClearingEngine
               ▼               ▼
           写日志 +      Success-Share
           N8N 回调       结算
```

### 路径对比

| 维度 | 路径 A: FastAPI | 路径 B: 本地工厂 | 路径 C: ECC | 路径 D: 独立执行器 |
|------|----------------|-----------------|-------------|-------------------|
| 入口 | `app.py` | `start_factory.py` | `ecc_core.py` | `run_task.py` |
| 触发方式 | HTTP API / Web UI | 本地命令行 | Python API 调用 | 本地命令行 |
| 传输机制 | HTTP + WebSocket | subprocess | 直接 Python 调用 | subprocess |
| 排队方式 | 文件系统 pending/ | 文件系统 pending/ | 无排队，直接执行 | 无排队，直接执行 |
| AI 调用 | 无（仅路由） | HQ(Claude) + Worker(DeepSeek) | 可选 ClearingEngine | 无 AI 调用 |
| 验证机制 | RiskManager | GripVerifier + CircuitBreaker | 无 | 无 |

---

## 2. 路径 A：FastAPI 云端路径 (app.py)

### 2.1 架构

`app.py` 是部署在 **Render Cloud** 上的主入口。它不是一个简单的 API 服务器 — 它是一个同时运行 HTTP 服务器、WebSocket 服务器、任务轮询后台线程的 **复合进程**。

### 2.2 启动机制

```python
# app.py:50-59
@asynccontextmanager
async def lifespan(app: FastAPI):
    from core.task_listener import main as start_listener
    listener_thread = threading.Thread(target=start_listener, daemon=True)
    listener_thread.start()
    print("[app] TaskListener thread started")
    yield
```

**关键机制**：
- 使用 FastAPI `lifespan` 上下文管理器
- 在应用启动时，spawn 一个 **daemon 线程**运行 `core/task_listener.py` 的 `main()` 函数
- daemon 线程意味着进程退出时自动终止，不需要显式清理
- 这意味着 **Render Cloud 上的 app.py 实际上同时运行着 Web 服务器和任务轮询器**

### 2.3 已发现的双 API 网关

存在 **两套独立的 API 网关实现**：

| 实现 | 文件 | 框架 | 端口 | 部署位置 |
|------|------|------|------|----------|
| **主网关** | `app.py` | FastAPI | 8000 | Render Cloud（实际运行） |
| **备用网关** | `core/api_gateway.py` | http.server (stdlib) | 8000 | 本地（由 start_factory.py 启动） |

**冲突分析**：两者默认都使用端口 8000。在 Render Cloud 上，只有 `app.py` 会被执行（`render.yaml` 指定 `uvicorn app:app`）。在本地，`start_factory.py` 以 subprocess 方式启动 `core/api_gateway.py`。

### 2.4 WebSocket 实时流机制

```python
# app.py:19-48
class ConnectionManager:
    def __init__(self):
        self.active_connections: list[WebSocket] = []

    async def broadcast(self, message: dict):
        disconnected = []
        for connection in self.active_connections:
            try:
                await connection.send_json(message)
            except Exception:
                disconnected.append(connection)
        for conn in disconnected:
            self.disconnect(conn)
```

**广播流程**：
1. ECC 的 `orchestrate()` 方法在执行过程中调用 `_broadcast_event()`
2. `_broadcast_event()` 内部调用 `POST http://localhost:8000/api/broadcast`
3. `/api/broadcast` 端点调用 `ws_manager.broadcast(message)`
4. 消息被推送到所有已连接 WebSocket 客户端

**事件类型**（共 8 种）：
```
task_started → ecc_decompose → agent_thinking (多次) →
settlement → task_completed
```
以及 WebSocket 层面的事件：`connected`, `board_initialized`, `heartbeat`

---

## 3. 路径 B：本地工厂路径 (start_factory.py → task_listener.py)

### 3.1 start_factory.py 多进程编排

`start_factory.py` 是本地 "一站式启动器"，它通过 **subprocess.Popen** 同时启动 3 个进程：

```python
# start_factory.py:195-263
# 1. API Gateway 进程
gateway_proc = subprocess.Popen(
    [sys.executable, API_GATEWAY_SCRIPT],  # → core/api_gateway.py
    stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
    cwd=PROJECT_ROOT, text=True, bufsize=1
)

# 2. Task Listener 进程
listener_proc = subprocess.Popen(
    [sys.executable, TASK_LISTENER_SCRIPT],  # → core/task_listener.py
    stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
    cwd=PROJECT_ROOT, text=True, bufsize=1
)

# 3. Tunnel 进程 (可选)
tunnel_proc = subprocess.Popen(
    [sys.executable, TUNNEL_SCRIPT],  # → scripts/start_tunnel.py
    stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
    cwd=PROJECT_ROOT, text=True, bufsize=1
)
```

**进程间通信**：start_factory.py 读取每个子进程的 stdout，通过 `readline()` 逐行打印到主进程的终端。进程间 **没有数据交互**，仅共享文件系统（task_queue/、logs/）。

### 3.2 进程清理机制

```python
# start_factory.py:294-321
def cleanup(processes):
    for name, proc in processes:
        if proc.poll() is None:
            if sys.platform == "win32":
                # PID-based killing — NEVER use image-name based killing
                subprocess.run(
                    ["taskkill", "/F", "/T", "/PID", str(proc.pid)],
                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
                )
            else:
                os.kill(proc.pid, signal.SIGTERM)
```

**安全设计**：使用 PID 精确杀死进程，绝不使用 `taskkill /F /IM node.exe` 等镜像名终止 — 避免误杀 VS Code 扩展宿主进程。

### 3.3 task_listener.py 三阶段执行管道

`task_listener.py` 的 `process_task()` 实现了 **HQ → Worker → Safety** 三阶段管道：

```python
# task_listener.py:117-221
# Phase 1: RiskManager 安全检查
rm = RiskManager()
is_safe, message = rm.evaluate_task(goal)

# Phase 2: HQCommander 生成执行计划 (Claude API)
hq = HQCommander()
plan = hq.generate_plan(goal)

# Phase 3: WorkerExecutor 执行 (DeepSeek API + CircuitBreaker)
breaker = CircuitBreaker()
executor = WorkerExecutor(circuit_breaker=breaker)
result = executor.execute_plan(plan)
```

---

## 4. 路径 C：ECC 编排路径 (ecc_core.py)

### 4.1 执行流程

ECCEngine 的核心方法是 `orchestrate()`（77-209 行），执行流程：

```
orchestrate(task_description, task_value, task_category, ...)
  │
  ├── _broadcast_event("task_started")
  ├── decompose() → [analyze, plan, execute, verify] 四步
  ├── _broadcast_event("ecc_decompose")
  ├── build_context() → 构建执行上下文
  ├── for each step:
  │     ├── _broadcast_event("agent_thinking")
  │     └── run_step() → {step, action, status:"completed", timestamp}
  ├── if task_value > 0 and Clearing Engine available:
  │     └── clearing_engine.process_completed_task()
  ├── _broadcast_event("settlement")
  ├── _broadcast_event("task_completed")
  └── update_board_member() → 更新 app.py 的 _board_state
```

### 4.2 与 app.py 的双向集成

ECC 通过两种方式与 app.py 通信：

**方式 1 — HTTP 广播**（ECC → Web UI）：
```python
# ecc_core.py:217-224
def _broadcast_event(self, event_type, data):
    import httpx
    with httpx.Client(timeout=2.0) as client:
        client.post("http://localhost:8000/api/broadcast", json=data)
```

**方式 2 — 直接内存操作**（ECC → board state）：
```python
# ecc_core.py:185-207
from app import update_board_member, get_board_summary
update_board_member(model_key, 
    status="idle",
    completed=lambda b: b.get("completed", 0) + 1,
    revenue=lambda b: b.get("revenue", 0) + task_value,
)
```
如果 `from app import` 失败，fallback 直接访问 `app._board_state` 字典。

---

## 5. 路径 D：独立任务执行器路径 (run_task.py)

### 5.1 机制

`run_task.py` 是最简单的执行路径 — 一个只依赖 `commands.json` 和 `subprocess` 的独立脚本：

```python
# run_task.py:103-141
registry = load_registry()             # 读取 commands.json
task = get_task_command(registry, task_name)
command = task["command"]
timeout = task.get("timeout", 300)
result = execute_command(command, timeout=timeout)
```

### 5.2 commands.json 注册表

系统任务注册表包含 13 个任务，分为两类引擎：

| 引擎 | 任务 |
|------|------|
| **openclaw** | deploy, build, test, start, bridge, worker |
| **ecc** | analyze, scan, report, orchestrate, settle, report-success, metrics |

每个任务有 4 个字段：`description`, `command`, `engine`, `timeout`

---

## 6. HQ — Worker — Safety 三部门架构

这是 Maneki-AI Phase 5 引入的核心执行架构，基于 **ClawWork** 的部门制模式。

### 6.1 HQCommander (hq/commander.py)

**角色**: 使用 Claude API 将用户目标转换为结构化执行计划

**核心机制**：

```python
# HQCommander — 三种计划生成模式:

# 模式 1: Claude API 真实调用
resp = client.messages.create(
    model="claude-3-5-sonnet-20241022",
    system=PLAN_SYSTEM_PROMPT,  # 强制 4 步以上规划
    messages=[{"role": "user", "content": goal}],
)

# 模式 2: Mock 规则引擎 (API 不可用时)
if is_dev:
    steps = [
        define_requirements → design_architecture →
        design_ui_ux → write_code
    ]
else:
    steps = [analyze_market / generate_content / review]

# 模式 3: 错误计划 (API 调用失败)
return {"status": "error", "steps": []}
```

**计划输出格式**：
```json
{
  "task_id": "FAC-XXXXXXXX",
  "goal": "用户目标",
  "steps": [
    {"step": 1, "action": "define_requirements", "input": {...}, "description": "..."}
  ],
  "model": "claude-3-5-sonnet-20241022",
  "generated_by": "claude_api"  // 或 "mock_rules" 或 "error"
}
```

生成的计划保存到 `plans/plan_{task_id}.json`。

### 6.2 WorkerExecutor (worker/executor.py)

**角色**: 读取 Plan → 逐步执行 Actions → 调用 DeepSeek API

**三阶段执行模式**：

```python
# worker/executor.py:40-164
for step in steps:
    # Phase 1: Action (执行)
    step_result = self._breaker.run_with_protection(
        self._execute_action, action_name, action_input
    )

    # Phase 2: Grip (验证)
    is_valid, grip_confidence, grip_issues = self._verifier.verify_action_result(
        action_name, action_input, step_result, step
    )
    if not is_valid:
        if grip_confidence < 0.3:     # → ROLLBACK
        elif grip_confidence < 0.7:   # → AUTO-CORRECT (最多 3 次)

    # Phase 3: Commit (提交)
    if step_result.get("status") == "success":
        # 保存结果 → deliveries/
```

**执行日志输出**：
- `logs/task_{task_id}_execution.json` — 完整执行日志
- `deliveries/delivery_{task_id}.json` — 最终交付物
- `logs/grip_audit.jsonl` — Grip 验证审计日志

---

## 7. Grip 验证闭环机制

### 7.1 三重验证策略

```python
# worker/grip.py:67-124
def verify_action_result(action_name, action_input, action_output, plan_step):
    # 验证 1: 结构检查 — JSON Schema 验证
    schema = ACTION_SCHEMAS.get(action_name)  # worker/schemas.py
    validate(instance=output_data, schema=schema)

    # 验证 2: 语义一致性 — DeepSeek API 检查
    # 判断 output 是否语义匹配 input
    DeepSeek: "你是质量检查员。判断 Action 输出是否语义匹配输入。"

    # 验证 3: HQ 符合度 — 检查 output 是否满足 Plan step 目标
    required_fields = {
        "analyze_market": ["analysis", "trends"],
        "write_code": ["code", "filename"],
        "generate_content": ["content", "title"],
        "review": ["approved", "feedback"],
    }
```

### 7.2 自适应处理策略

| 置信度 | 策略 | 行为 |
|--------|------|------|
| ≥ 0.7 | 通过 | 直接 Commit |
| 0.3 ~ 0.7 | 自动修正 | 调用 DeepSeek API 重新生成（最多 3 次） |
| < 0.3 | 回滚 | 标记 ROLLED_BACK，记录审计日志 |

### 7.3 JSON Schema 验证实现

`worker/schemas.py` 定义了 4 个 Action 的输出 Schema，使用 `jsonschema` 库进行验证：

```python
WRITE_CODE_SCHEMA = {
    "type": "object",
    "required": ["code", "filename", "language", "dependencies"],
    "properties": {
        "code": {"type": "string", "minLength": 20},
        "filename": {"type": "string", "pattern": r"^[\w\-\.]+\.(py|js|ts|java|html|css)$"},
        "language": {"type": "string", "enum": ["python", "javascript", "typescript", "java", "html", "css"]},
        "dependencies": {"type": "array", "items": {"type": "string"}},
    },
}
```

---

## 8. CircuitBreaker 防卡死机制

### 8.1 五条防护规则

基于 `Cline-anti-freeze/.clinerules` 协议实现：

| 规则 | 机制 | 代码位置 |
|------|------|----------|
| **规则 1: 超时熔断** | 任何操作 120 秒未返回则中断 | `_call_with_timeout()` L137-196 |
| **规则 2: 循环检测** | 连续 3 次相同错误/空结果则停止重试 | `_check_loop_detection()` L198-214 |
| **规则 3: 上下文保护** | N/A（Python 进程级） | 声明 |
| **规则 4: 心跳检查** | 每 5 步输出 [治理心跳] | `run_with_protection()` L86-87 |
| **规则 5: 异常退出** | 60 秒无有效输出则终止 | `_call_with_timeout()` L176-179 |

### 8.2 线程级超时实现

```python
# safety/circuit_breaker.py:137-196
def _call_with_timeout(self, func, *args, **kwargs):
    def _runner():
        result_holder["value"] = func(*args, **kwargs)

    thread = threading.Thread(target=_runner, daemon=True)
    thread.start()

    while thread.is_alive():
        elapsed = time.time() - start_time
        if elapsed > self.timeout:        # Rule 1: 120s
            raise TimeoutError(...)
        if time.time() - self._last_activity > self.deadlock_timeout:  # Rule 5: 60s
            raise TimeoutError("Deadlock detected")
        thread.join(timeout=0.1)
```

**注意**：Python 无法强制杀死线程，因此超时后函数仍在后台运行，但调用方已收到 `TimeoutError`。

### 8.3 循环检测实现

```python
# safety/circuit_breaker.py:198-214
def _check_loop_detection(self, error_key):
    self._error_history.append(error_key)
    if len(self._error_history) >= self.max_retries:  # 3
        if len(set(self._error_history[-3:])) == 1:    # 连续 3 次相同
            return False  # CIRCUIT OPEN — 停止重试
    return True  # 可以重试
```

---

## 9. Action 注册表与 DeepSeek 调用机制

### 9.1 注册表模式

```python
# worker/actions.py:290-295
ACTIONS_REGISTRY = {
    "analyze_market": AnalyzeMarketAction(),
    "write_code": WriteCodeAction(),
    "generate_content": GenerateContentAction(),
    "review": ReviewAction(),
}
```

### 9.2 BaseAction 抽象

```python
class BaseAction(ABC):
    @property
    @abstractmethod
    def name(self) -> str: ...

    @property
    @abstractmethod
    def description(self) -> str: ...

    @property
    def expected_schema(self) -> dict:
        return ACTION_SCHEMAS.get(self.name, {})

    @abstractmethod
    def execute(self, input_data: dict) -> dict: ...
```

### 9.3 DeepSeek API 调用

所有 Worker Actions 通过 OpenAI 兼容客户端调用 DeepSeek：

```python
# worker/actions.py:61-82
def _deepseek_chat(prompt):
    client = OpenAI(
        api_key=DEEPSEEK_API_KEY,           # os.getenv("DEEPSEEK_API_KEY")
        base_url=DEEPSEEK_BASE_URL,         # "https://api.deepseek.com/v1"
    )
    response = client.chat.completions.create(
        model="deepseek-chat",
        messages=[{"role": "user", "content": prompt}],
        max_tokens=4096,
        temperature=0.3,
    )
```

### 9.4 双模式降级

```python
# worker/actions.py:85-92
def _mock_or_api(prompt, fallback):
    if DEEPSEEK_API_KEY and OPENAI_AVAILABLE:
        result = _deepseek_chat(prompt)
        if result:
            return result
    return fallback  # 使用 mock 数据
```

每个 Action 都内置了 mock 输出作为 fallback，确保即使在无 API 环境下也能运行。

---

## 10. 双 API 网关共存机制

### 10.1 两套网关对比

| 特性 | app.py (FastAPI) | core/api_gateway.py (stdlib) |
|------|-----------------|-----------------------------|
| 框架 | FastAPI | http.server.HTTPServer |
| 依赖 | fastapi, uvicorn, jinja2 | 纯标准库 |
| 前端支持 | HTML 页面 + WebSocket + 静态文件 | 仅 JSON API |
| WebSocket | ✅ | ❌ |
| 任务注入 | POST /api/router | POST /api/task + POST /api/submit-task |
| 任务查询 | GET /api/tasks/{id} | GET /api/tasks + GET /api/tasks/{id} |
| 启动方式 | uvicorn app:app | python core/api_gateway.py |
| 实际使用 | Render Cloud | 本地 (start_factory.py) |

### 10.2 为什么有两套？

1. **历史演进**：`core/api_gateway.py` 是 Phase 3 的实现，使用纯标准库最大化兼容性
2. **功能升级**：`app.py` 是 Phase 4/5 的升级版，引入 FastAPI 获得 WebSocket、模板引擎、静态文件服务等现代特性
3. **本地留存**：`start_factory.py` 仍启动旧网关，形成本地双端口（旧网关:8000 + app.py:8000 冲突风险）

---

## 11. GitHub Gist 隧道公告板机制

### 11.1 问题

Render Cloud 只暴露单一端口，本地工厂无法被 Render 托管的 Web UI 直接访问。

### 11.2 解决方案

```python
# start_factory.py:52-131
# 1. localtunnel 在本地创建 HTTPS 隧道
# 2. 隧道的公开 URL 写入 GitHub Gist（"cloud bulletin board"）
# 3. Render 上的 app 从 Gist 读取隧道 URL → 动态发现本地工厂

GIST_API_BASE = "https://api.github.com/gists"
GIST_FILENAME = "maneki_tunnel_url.json"

def publish_tunnel_url_to_gist(tunnel_url):
    if GIST_ID:
        # PATCH 更新已有 Gist
        req = Request(f"{GIST_API_BASE}/{GIST_ID}", method="PATCH")
    else:
        # POST 创建新 Gist
        req = Request(GIST_API_BASE, method="POST")
```

**Gist 内容格式**：
```json
{
  "tunnel_url": "https://xxx.loca.lt",
  "updated_at": "2026-06-05T05:00:00Z"
}
```

### 11.3 隧道 URL 捕获

```python
# start_factory.py:161-192
def capture_tunnel_url(tunnel_proc, url_holder, stop_event):
    url_pattern = re.compile(r'(?:your url is|Public URL):\s*(https?://[^\s]+)')
    while not stop_event.is_set():
        line = tunnel_proc.stdout.readline()
        match = url_pattern.search(line)
        if match:
            url_holder["url"] = match.group(1).strip()
            url_holder["ready"] = True
```

---

## 12. 扩展模块实现细节

### 12.1 军师智能体 (analyst/)

```python
# analyst/base.py — 抽象基类
class BaseAgent(ABC):
    name = "base_agent"
    @abstractmethod
    def analyze(self, raw_data): pass

# analyst/strategist_agent.py — 实现类
class StrategistAgent(BaseAgent):
    name = "军师"
    def analyze(self, raw_data):
        return {"score": 0.8, "recommendation": "建议进入数字市场"}
```

当前为 **桩实现**，返回固定分数，预留大模型调用接口。

### 12.2 Tavily 搜索 (radar/)

```python
# radar/tavily_client.py
def tavily_search(query, max_results=5):
    api_key = os.getenv("TAVILY_API_KEY")
    if not api_key:
        return [{"title": f"模拟结果: {query}", "content": "模拟内容", "score": 0.8}]
    client = TavilyClient(api_key=api_key)
    return client.search(query, max_results=max_results).get("results", [])

# radar/synthesizer.py — 多源融合
def fuse_radar_data(tavily_results, trendradar_hits, github_trending):
    all_items = [{"source": "tavily", **item} for item in tavily_results]
    all_items.sort(key=lambda x: x.get("score", 0), reverse=True)
    return all_items[:20]
```

### 12.3 报告生成器 (warroom/)

```python
# warroom/report_generator.py
def generate_markdown_report(opportunities, output_dir="./reports"):
    filename = f"{output_dir}/opp_brief_{now}.md"
    for opp in opportunities:
        content += f"## {idx}. {opp.get('title')}\n"
        content += f"- 来源: {opp.get('source')}\n"
        content += f"- 置信度: {opp.get('score')}\n"
```

输出到 `reports/opp_brief_{timestamp}.md`。

### 12.4 AI 总监编排器 (agents/)

```python
# agents/orchestrator.py — 独立的文件系统任务处理循环
def main():
    while True:
        for p in list(TASK_DIR.glob('*.json')):
            process_task(p)   # 读取 → 创建交付物 → 删除
        time.sleep(2)
```

使用独立的任务目录 `tasks/queue/`（非 task_queue/），输出到 `deliveries/`。当前产生 mock 交付物（logo.png 占位符 + manifest.json + delivery_note.txt）。

### 12.5 GitHub Issue 客户端

```python
# github_issue.py
def create_issue(title, body):
    repo = "winsentrobot008/DevDirector-Tasks"
    url = f"https://api.github.com/repos/{repo}/issues"
    resp = requests.post(url, headers={"Authorization": f"token {token}"}, json={"title": title, "body": body})
```

这是双平面架构的消息总线写入端，将任务作为 GitHub Issue 发布到 DevDirector-Tasks 仓库。

### 12.6 RiskManager

```python
# risk_manager.py
class RiskManager:
    blacklisted_keywords = ["rm -rf", "drop table", "private_key", "transfer_all"]
    def evaluate_task(self, task_description):
        for word in self.blacklisted_keywords:
            if word in description_lower:
                return False, f"BLOCKED: Task contains high-risk keyword '{word}'."
        if "transfer" in description_lower or "pay" in description_lower:
            return False, "BLOCKED: Financial transactions require explicit manual multi-sig approval."
        return True, "Task Passed Risk Assessment."
```

在任务分发（`POST /api/dispatch`）和执行（`task_listener.py` Phase 1）两处调用。

---

## 13. 完整文件依赖关系图

```
                    ┌──────────────────────────────────────┐
                    │          Render Cloud (Render)        │
                    │          uvicorn app:app              │
                    └──────────────┬───────────────────────┘
                                   │
                    ┌──────────────▼───────────────────────┐
                    │  app.py (FastAPI 控制中心)            │
                    │  ├── import main.TaskDispatcher       │
                    │  ├── import risk_manager.RiskManager  │
                    │  ├── from core.task_listener import   │──── daemon thread
                    │  └── from clearing_engine.core import │
                    └──────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────┐
│  main.py                      risk_manager.py                │
│  ├── TaskDispatcher            └── RiskManager               │
│  └── AIModel enum                                             │
└──────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────┐
│  core/                                                        │
│  ├── api_gateway.py (stdlib HTTP server — Phase 3)            │
│  └── task_listener.py (5s 轮询 + HQ/Worker/Safety 管道)      │
│       ├── from hq.commander import HQCommander  ──────────┐  │
│       ├── from safety.circuit_breaker import CircuitBreaker│  │
│       └── from worker.executor import WorkerExecutor ──────┤  │
└──────────────────────────────────────────────────────────────┘
                                                              │
┌──────────────────────────────────────────────────────────────┐
│  hq/commander.py (Claude API → Plan.json)                    │
│  ├── anthropic.Anthropic                                     │
│  └── 三种模式: Claude API / Mock 规则 / Error                 │
└──────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────┐
│  worker/                                                      │
│  ├── executor.py (WorkerExecutor)                             │
│  │    └── from .actions import ACTIONS_REGISTRY               │
│  │    └── from .grip import GripVerifier                      │
│  ├── actions.py (4 Actions: analyze_market/write_code/        │
│  │              generate_content/review)                       │
│  │    └── openai.OpenAI → DeepSeek API                        │
│  ├── grip.py (GripVerifier — 三重验证 + 自动修正)             │
│  │    ├── jsonschema.validate → 结构验证                      │
│  │    ├── DeepSeek API → 语义验证                             │
│  │    └── required_fields → HQ 符合度                         │
│  └── schemas.py (4 JSON Schemas)                              │
└──────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────┐
│  safety/circuit_breaker.py                                    │
│  ├── threading.Thread → 超时控制                              │
│  ├── 循环检测 → 错误历史去重                                  │
│  └── 心跳 → 每 5 步日志                                       │
└──────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────┐
│  workshop/                                                    │
│  ├── ecc_core.py (ECCEngine)                                  │
│  │    ├── integrate with clearing_engine.core                 │
│  │    └── integrate with app.py _board_state                  │
│  ├── openclaw_core.py (OpenClawExecutor)                      │
│  │    └── subprocess.run → CLI 命令执行                       │
│  └── factory_integration_map.json                             │
└──────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────┐
│  clearing_engine/                                             │
│  ├── core.py (FinancialClearingEngine)                        │
│  ├── models.py (TaskValuation, ProfitSplit, ServiceFee...)    │
│  ├── tracker.py (ValueTracker)                                │
│  └── dashboard.py (Streamlit 仪表板)                          │
└──────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────┐
│  agent_engine/                                                │
│  ├── bridge.py (Flask :5005 — 代理间桥接)                     │
│  ├── cline_daemon.py (守护进程)                               │
│  └── cline_worker.py (浏览器自动化)                           │
└──────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────┐
│  扩展模块 (桩实现 / 待集成)                                   │
│  ├── analyst/base.py → BaseAgent ABC                          │
│  ├── analyst/strategist_agent.py → 军师                      │
│  ├── radar/tavily_client.py → Tavily 搜索                    │
│  ├── radar/synthesizer.py → 数据融合                         │
│  ├── warroom/report_generator.py → Markdown 报告              │
│  └── agents/orchestrator.py → 独立文件系统编排器              │
└──────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────┐
│  工具 / 入口                                                  │
│  ├── start_factory.py → subprocess 三进程编排                 │
│  ├── run_task.py → commands.json + subprocess                 │
│  ├── github_issue.py → GitHub Issues API                     │
│  └── commands.json → 13 个注册任务的 CLI 映射                  │
└──────────────────────────────────────────────────────────────┘
```

---

> **分析完成**
> *Maneki-AI Mechanism & Architecture Analysis — 基于全源码遍历的深度分析*