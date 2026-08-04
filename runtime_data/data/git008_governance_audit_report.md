# git008 全仓库审计报告 — AGI 工厂版

> **生成时间**: 2026-07-13
> **审计实体**: ZOO（本地开发实例）
> **审计范围**: git008 全仓库 — 所有子项目、治理文件、模块结构
> **宪法依据**: GIT008 AGI 协作宪法

---

## 特别宪法声明

云端高级 AGI 担任设计总监，负责架构设计与任务派发；本地 VSC + ZOOCODE / CLINE 担任程序员（ZOO），负责代码落地。
云端总监通过"一键复制"的代码块下达唯一核心任务，由 CEO 转达给 ZOO 执行。

---

## 1. 全仓库路径与结构规范

*   **项目根路径**: `C:\Users\aoogoost\Desktop\Projekt\git008`
*   **核心产出线**: 所有的生产力子项目均存放在 `projects/` 目录下（如 `RoastBro`, `Confession`, `ViralMint`, `OpenMontage` 等）。
*   **AGI 环境与宪法模块**: 根目录下除 `projects/` 以外的所有其他部分（如 `Cline-anti-freeze/`, `second-brain/`, `scripts/`）均归属为 AGI 运行环境、治理宪法和辅助支持模块。

---

## 2. 审计概览

| 指标 | 数值 |
|--------|-------|
| 扫描的 Python 文件 | 870 |
| 导入语句总数 | 5968 |
| 宪法保护模块数 | 5 |
| 哨兵活跃模块数 | 30 |
| 未受保护执行器模块 | 17 |
| 缺失哨兵的入口点 | 7 |
| 检测到的风险点 | 1513 |
| **系统健康评分** | **0/100** |

---

## 3. 宪法覆盖率

覆盖率：**0.6%**（5/870 模块）

### 已保护模块

| 文件 | 类别 |
|------|----------|
| `_governance_audit.py` | 其他 |
| `Cline-anti-freeze/governance_linker.py` | 治理核心 |
| `Cline-anti-freeze/monitor.py` | 治理核心 |
| `Cline-anti-freeze/constitution/rules.py` | 宪法 |
| `Cline-anti-freeze/executor/init_new_project.py` | 执行器 |

### 未受保护执行器/沙箱模块

| 文件 | 类别 |
|------|----------|
| `Cline-anti-freeze/executor/analyze_fork.py` | 执行器 |
| `Cline-anti-freeze/executor/analyze_server.py` | 执行器 |
| `Cline-anti-freeze/executor/fork_main.py` | 执行器 |
| `Cline-anti-freeze/executor/fork_scheduler_init.py` | 执行器 |
| `Cline-anti-freeze/executor/fork_server.py` | 执行器 |
| `Cline-anti-freeze/executor/hf_app.py` | 执行器 |
| `Cline-anti-freeze/executor/hf_code_exec_sandbox.py` | 执行器 |
| `Cline-anti-freeze/executor/hf_live_agent.py` | 执行器 |
| `Cline-anti-freeze/executor/hf_main.py` | 执行器 |
| `Cline-anti-freeze/executor/hf_server.py` | 执行器 |
| `Cline-anti-freeze/executor/hf_task_scheduler.py` | 执行器 |
| `Cline-anti-freeze/executor/online_agent.py` | 执行器 |
| `Cline-anti-freeze/executor/online_sandbox.py` | 执行器 |
| `Cline-anti-freeze/executor/online_wrapup.py` | 执行器 |
| `Cline-anti-freeze/executor/server.py` | 执行器 |
| `Cline-anti-freeze/executor/_extract_pr.py` | 执行器 |
| `Cline-anti-freeze/sandbox/code_execution_sandbox.py` | 沙箱 |

---

## 4. 哨兵覆盖率

哨兵活跃：30 个模块

### 哨兵保护模块

| 文件 | 类别 | 关键词 |
|------|----------|----------|
| `_governance_audit.py` | 其他 | sentinel, hooks, anti_freeze, guard |
| `Cline-anti-freeze/do_git.py` | 治理核心 | anti_freeze, guard |
| `Cline-anti-freeze/governance_linker.py` | 治理核心 | anti_freeze |
| `Cline-anti-freeze/governance_ui.py` | 治理核心 | sentinel |
| `Cline-anti-freeze/monitor.py` | 治理核心 | sentinel |
| `Cline-anti-freeze/sentinel_ws_client.py` | 治理核心 | sentinel |
| `Cline-anti-freeze/constitution/rules.py` | 宪法 | anti_freeze |
| `Cline-anti-freeze/executor/init_new_project.py` | 执行器 | anti_freeze |
| `projects/OpenMontage/runtime/linly_talker_engine/GPT_SoVITS/AR/utils/initialize.py` | 业务 | guard |
| `projects/OpenMontage/runtime/linly_talker_engine/Musetalk/musetalk/utils/dwpose/default_runtime.py` | 业务 | hooks |
| `projects/OpenMontage/runtime/linly_talker_engine/Musetalk/musetalk/utils/dwpose/rtmpose-l_8xb32-270e_coco-ubody-wholebody-384x288.py` | 业务 | hooks |
| `projects/OpenMontage/runtime/linly_talker_engine/Musetalk/musetalk/whisper/whisper/decoding.py` | 业务 | hooks |
| `projects/OpenMontage/runtime/linly_talker_engine/Musetalk/musetalk/whisper/whisper/model.py` | 业务 | hooks |
| `projects/OpenMontage/tests/backlot/test_state.py` | 业务 | guard |
| `projects/OpenMontage/tests/tools/test_cogvideo_i2v_variant.py` | 业务 | sentinel |
| `projects/OpenMontage/tests/tools/test_mps_device.py` | 业务 | guard |
| `projects/OpenMontage/tests/tools/test_provider_model_defaults.py` | 业务 | guard |
| `projects/OpenMontage/tools/animatediff_lite.py` | 业务 | safety_check |
| `projects/OpenMontage/tools/sd15_fallback.py` | 业务 | safety_check |
| `projects/OpenMontage/tools/sd15_local.py` | 业务 | safety_check |

### 缺失哨兵的入口点

| 文件 | 类别 |
|------|----------|
| `Cline-anti-freeze/executor/analyze_server.py` | 执行器 |
| `Cline-anti-freeze/executor/fork_main.py` | 执行器 |
| `Cline-anti-freeze/executor/fork_server.py` | 执行器 |
| `Cline-anti-freeze/executor/hf_main.py` | 执行器 |
| `Cline-anti-freeze/executor/hf_server.py` | 执行器 |
| `Cline-anti-freeze/executor/online_agent.py` | 执行器 |
| `Cline-anti-freeze/executor/server.py` | 执行器 |

---

## 5. 依赖关系图

```
节点类别：
  business（业务）:       825 个文件，5499 条导入
  constitution（宪法）:     1 个文件，0 条导入
  executor（执行器）:      17 个文件，209 条导入
  governance_core（治理核心）: 12 个文件，148 条导入
  other（其他）:            1 个文件，3 条导入
  protected_asset（保护资产）: 10 个文件，76 条导入
  sandbox（沙箱）:          1 个文件，17 条导入
  scripts（脚本）:          3 个文件，16 条导入
```

完整关系图：[`data/governance_dependency_graph.md`](data/governance_dependency_graph.md)

---

## 6. 风险点

总计：**1513**

| 文件 | 行号 | 风险类型 | 代码 |
|------|------|------|------|
| `_governance_audit.py` | 33 | 动态代码执行（eval） | `('eval(', 'Dynamic code execution (eval)'),` |
| `_governance_audit.py` | 34 | 动态代码执行（exec） | `('exec(', 'Dynamic code execution (exec)'),` |
| `_governance_audit.py` | 9 | 动态导入 | `sys.stdout = __import__('io').TextIOWrapper(sys.stdout.buffe` |
| `_governance_audit.py` | 35 | 动态导入 | `('__import__', 'Dynamic import'),` |
| `_governance_audit.py` | 36 | 动态导入 | `('importlib', 'Dynamic import'),` |
| `_governance_audit.py` | 37 | 直接系统调用 | `('os.system', 'Direct system call'),` |
| `_governance_audit.py` | 38 | 子进程执行 | `('subprocess.', 'Subprocess execution'),` |
| `_governance_audit.py` | 39 | 直接文件系统访问 | `('open(', 'Direct filesystem access'),` |
| `_governance_audit.py` | 92 | 直接文件系统访问 | `with open(fp, 'r', encoding='utf-8', errors='ignore') as f:` |
| `_governance_audit.py` | 159 | 直接文件系统访问 | `with open(out, 'w', encoding='utf-8') as f:` |
| `_governance_audit.py` | 217 | 直接文件系统访问 | `with open(out, 'w', encoding='utf-8') as f:` |
| `_governance_audit.py` | 268 | 直接文件系统访问 | `with open(out, 'w', encoding='utf-8') as f:` |
| `_governance_audit.py` | 323 | 直接文件系统访问 | `with open(out_json, 'w', encoding='utf-8') as f:` |
| `_governance_audit.py` | 358 | 直接文件系统访问 | `with open(out_md, 'w', encoding='utf-8') as f:` |
| `_governance_audit.py` | 424 | 直接文件系统访问 | `with open(out, 'w', encoding='utf-8') as f:` |
| `_governance_audit.py` | 446 | 直接文件系统访问 | `with open(fp, 'r', encoding='utf-8', errors='ignore') as f:` |
| `_governance_audit.py` | 470 | 直接文件系统访问 | `with open(out, 'w', encoding='utf-8') as f:` |
| `_governance_audit.py` | 646 | 直接文件系统访问 | `with open(out, 'w', encoding='utf-8') as f:` |
| `_governance_audit.py` | 40 | 文件系统操作 | `('shutil.', 'Filesystem operation'),` |
| `_governance_audit.py` | 41 | HTTP 请求 | `('requests.', 'HTTP request'),` |
| `_governance_audit.py` | 42 | HTTP 请求 | `('urllib.request', 'HTTP request'),` |
| `_governance_audit.py` | 43 | 原始套接字 | `('socket.', 'Raw socket'),` |
| `Cline-anti-freeze/.governance_entry.py` | 41 | 子进程执行 | `result = subprocess.run(` |
| `Cline-anti-freeze/.governance_entry.py` | 47 | 子进程执行 | `except (subprocess.TimeoutExpired, FileNotFoundError):` |
| `Cline-anti-freeze/auto_enforce.py` | 361 | 动态导入 | `__import__(module)` |
| `Cline-anti-freeze/auto_enforce.py` | 57 | 子进程执行 | `result = subprocess.run(` |
| `Cline-anti-freeze/auto_enforce.py` | 154 | 子进程执行 | `subprocess.Popen(` |
| `Cline-anti-freeze/auto_enforce.py` | 156 | 子进程执行 | `creationflags=subprocess.CREATE_NO_WINDOW if hasattr(subproc` |
| `Cline-anti-freeze/auto_enforce.py` | 172 | 子进程执行 | `subprocess.Popen(` |
| `Cline-anti-freeze/auto_enforce.py` | 174 | 子进程执行 | `creationflags=subprocess.CREATE_NO_WINDOW if hasattr(subproc` |
| ... | ... | （剩余 1483 项） | ... |

完整风险数据：[`data/governance_risk_points.json`](data/governance_risk_points.json)

---

## 7. 模块覆盖汇总

| 类别 | 总计 | 宪法保护 | 哨兵保护 |
|----------|-------|----------------------|-------------------|
| business（业务） | 825 | 0 | 21 |
| constitution（宪法） | 1 | 1 | 1 |
| executor（执行器） | 17 | 1 | 1 |
| governance_core（治理核心） | 12 | 2 | 5 |
| other（其他） | 1 | 1 | 1 |
| protected_asset（保护资产） | 10 | 0 | 1 |
| sandbox（沙箱） | 1 | 0 | 0 |
| scripts（脚本） | 3 | 0 | 0 |

---

## 8. 系统健康评估

**评分**: 0/100

### ❌ 严重

大多数模块缺乏治理保护。需立即采取措施。

### 建议措施

- 向 17 个未受保护执行器模块添加宪法导入
- 向 7 个入口点添加哨兵钩子
- 审查 1513 个风险点（eval、exec、直接文件系统/网络访问）
