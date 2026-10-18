# MAOTANG Protocol — White Paper v3.3

**猫糖协议白皮书 v3.3 — 去中心化移动 AI Agent OS 与非托管（Non-Custodial）主权边缘节点协议**

*Revision: v3.3, 2026-10-17. 本文取代 `docs/WHITEPAPER_v2.md`（v2.2），并把协议重组为 5 个可独立实现、可独立验收的模块。v3.1 新增第 7 节（生物主权合规与隐私架构）与第 8 节（威胁模型与纵深防御矩阵）；v3.2 新增第 13 节（双模 C 端产品架构规范）并登记 ADR-046；v3.3 新增第 14–17 节（移动端纯硬件安全公理、DeChat 去中心化通讯、五层渐进式零感 Gas、物理级抗手机集群协议）并登记 ADR-047。对外术语统一为：参与设备 = **Sovereign Edge Node（主权边缘节点）**，网络侧奖励 = **Protocol Compute & Verification Rewards（协议算力与验证奖励）**（见 §0.3）。*

---

## 0. 核心愿景 (Core Vision)

> **一个自主的、移动端原生的 AI Agent OS：每台参与设备都是一个 Sovereign Edge Node（主权边缘节点），只服务于其唯一的生物主人，并独立校验零知识证明与链上状态。**

Agent 是主人与网络之间的**唯一媒介**：主人不直接触碰合约、不管理 gas、不盯盘。主人只做三件事 —— 表达意图、做终极决策、领取协议奖励。其余（密钥、签名、广播、曲线监控、边缘算力、验证与奖励结算）由本地 Agent 在 Sovereign Edge Node 上自主完成，并且**全部发生在主人的设备上**。

### 0.1 五支柱总览 (The Five Pillars)

| # | 模块 | 一句话职责 | 当前状态 |
| --- | --- | --- | --- |
| 1 | Sovereign Edge Node SLM & Cell Division | 端侧小模型作为唯一人机接口；创世配额细胞化用于微治理与奖励分配 | SLM ✅ / 细胞化 ⬜ |
| 2 | Autonomous Local Wallet | 加密本地安全飞地存储；在阈值内自主签名与广播 | ✅ 接口层 / ⬜ 真实移动飞地 |
| 3 | Yield, Sustenance & Mining | 非 PoW 能效算力与验证 + 联合曲线流动性监控；Protocol Compute & Verification Rewards 经金库回流节点主人 | ✅ |
| 4 | Sovereign Edge Node Light Client | 边缘节点 P2P / 安全 RPC 状态校验，实现免信任状态验证 | 🟡 只读 RPC + 心跳 / ⬜ 轻客户端 |
| 5 | Bio-Sovereign Anti-Sybil | Zero-Knowledge Node Verification + 生物认证把 Agent 与细胞代币绑定到唯一生物主人 | ✅ 绑定与 ZK / ⬜ 生物特征通道 |

**状态图例**：✅ 已实现并有可复现证据；🟡 部分实现（有明确缺口）；⬜ 路线图（尚未落地，见第 9 节里程碑）。

### 0.2 一条必须遵守的文档纪律

本白皮书对每个模块都标注**已实现 / 路线图**。任何“已实现”声明必须能指向仓库内的源码或验证命令；任何“路线图”项不得被当作现有能力对外描述。指标、地址与常量一律以源码为准，本文不复制易腐的部署地址 —— 实时地址的唯一真源是 `app/config/contracts.json`（每次部署由 `contracts/scripts/deploy-testnet.ts` 重写）。

### 0.3 对外术语表（Public terminology）

对外沟通统一使用下面两个术语。二者与源码中的模块名一一对应，**不改变任何已实现行为**：

| 术语 | 含义 | 源码对应 |
| --- | --- | --- |
| **Sovereign Edge Node（主权边缘节点）** | 任何一台代表其唯一生物主人参与网络的设备：本地运行端侧 SLM、在硬件飞地内签名、并独立校验零知识证明与链上状态 | Module 1 / 2 / 4 / 5（`mobile-agent/`、`app/`） |
| **Protocol Compute & Verification Rewards（协议算力与验证奖励）** | 对真实物理 / 计算工作与验证贡献的协议侧结算，由**已注资**的奖励金库支付、**从不增发** | Module 3（`contracts/src/MaoTangMining.sol`） |

> MAOTANG 是一个开源、**非托管（non-custodial）**的软件协议：它不提供金融服务，不托管任何用户资产，也不记录、传输或存储原始生物特征模板。密钥永远不离开 Sovereign Edge Node。

---

## 1. Module 1 — Edge Small Language Model (SLM) & Cell Division

**职责**：AI 模型是生物主人与网络之间的**唯一媒介（sole media / interface）**，运行在 Sovereign Edge Node 上。主人用人话表达意图，模型把它翻译成链上调用；网络的一切回执也由模型翻译回主人能懂的话。

### 1.1 已实现（端侧 SLM 运行时）

- **单接口、双后端**：`agent-client/src/slm/` 用一个 `SlmEngine` 接口同时封装 `llama.cpp`（`node-llama-cpp`，GGUF）与 ONNX Runtime（`onnxruntime-node`，INT4）。两个原生模块都是**可选依赖**，通过动态 import 载入，因此包在没有它们时仍能构建与测试。
- **默认模型**：Qwen2.5-0.5B-Instruct INT4，权重约 397 MiB；常驻内存估算计入 fp16 KV cache（`2 * layers * kv_heads * head_dim * 2 * context`）加运行开销，硬上限 **500 MiB**，超预算模型默认被拒绝（除非显式 `allowOverBudget`）。这条上限就是“Sovereign Edge Node 上真能跑”的工程边界。
- **本地性是一条断言，不是一个愿望**：`assertNoCloudDependencies()` 会拒绝任何 endpoint / base URL / API key / token 字段；`mode: "native"` 失败时**大声报错**，而不是悄悄降级到模拟引擎。意图解析不依赖任何云端 LLM。
- **两个严格工具（strict JSON Schema）**：`agent-client/src/intents/` 定义 `claim_mhuman_quota` 与 `swap_micro_human`，ChatML system prompt 强制模型只输出**一次**工具调用；`parseToolCall()` 抽取 JSON、拒绝未知工具、并在任何参数能到达钱包之前完成校验。
- **可测证据**：`agent-client/test/local-agent.test.ts` 在 `simulated` 模式驱动整条管线（CI 里覆盖 tool calling），并断言原生路径缺失时**明确失败**而非静默。

### 1.2 创世激活与细胞化 (Genesis Activation & Cell Division)

**已实现的事实（与 v2.2 表述不同，以源码为准）**：

- 唯一性验证通过后，协议为**每一个已验证的活体人类**铸造 **1,000,000 $mHUMAN** 的配额（`contracts/src/HumanToken.sol`：`HUMAN_QUOTA = 1_000_000 * 10**6`，`decimals = 6`）。
- 全局上限 **8,300,000,000 × 1,000,000 $mHUMAN**（按活体人头理论上限 83 亿推导），`MAX_GLOBAL_SUPPLY` 在合约内硬编码，`claimHumanQuota` 永远不越过它。
- 也就是说，**“1 个人 → 1 份 100 万单位配额” 已经落地**；配额当前是**单一标准 ERC-20 余额**，合约内没有 "Cell" 类型。

**细胞化（Cell Token）设计目标 —— 路线图 ⬜**：

把 1 份配额细分为 **1,000,000 个可独立寻址的 Cell 单元**，用于：

1. **微治理（micro-governance）**：每个 Cell 一票，主人可把部分 Cell 委托给 Agent 策略池，而不是把全部治理权一次性押上。
2. **协议奖励分发（protocol reward distribution）**：金库结算的 Protocol Compute & Verification Rewards 按 Cell 权重分配，支持“只领取一部分、保留其余主权”。

Cell 化的最小可行映射是 **1 Cell = 1 $mHUMAN 微单位**（配额恰好 1,000,000 个单位，天然整除）。**落地前必须先出 ADR**：Cell 是 (a) 现有 ERC-20 的记账视图 / (b) 独立 ERC-20 / (c) NFT 家族 —— 三者对 gas、可组合性与反女巫边界的影响完全不同。当前代码**不实现**任何 Cell 语义，不得对外声称已具备。

### 1.3 模块 1 验收（可执行）

```powershell
cd D:\git008\products\maotang\agent-client; npm test          # 端侧 SLM + 意图解析 + 心跳
cd D:\git008\products\maotang\contracts; forge test            # HumanToken 配额与上限
```

---

## 2. Module 2 — Autonomous Local Wallet

**职责**：密钥、签名、广播全部在本地完成并在**安全阈值内自主执行**；云端永远拿不到私钥。

### 2.1 已实现

- **飞地签名器注入（非持有）**：`agent-manager/src/mining/transport.mjs` 构建、**通过注入的 TEE / Secure-Enclave signer 签名**，再经 `eth_sendRawTransaction` 广播。签名器是依赖注入的接口，私钥不进入应用层内存，也不进入日志。
- **失败关闭的出站护栏**：广播始终走 fail-closed 的 egress guard —— 未配置白名单时**不发包**，而不是“默认放行”。
- **Agent 登录与身份绑定**：`AgentClient.agentLogin()` 派生 agent 地址、校验链上注册状态、要求当前连接账户**就是**该 agent，并在任何 intent 执行前验证一次签名挑战（A2A 握手）。
- **只读与可写彻底分离**：`app/` 面板的 transport `write()` 直接抛错 —— 看板在结构上无法签名（见 ADR-019）。运维动作改为下发可复制的 `cast send` 命令，人来做最后一步。
- **主人在环的阈值控制**：金库侧提供紧急刹车与额度上限（见 3.3），使“Agent 自主”不等于“Agent 无限”。
- **阈值策略引擎与唯一签名路径（接口层 ✅，本次变更）**：`mobile-agent/signer/` 把“Agent 能花什么”写成可测试的代码 —— 目标地址白名单、selector 白名单、单笔上限、滚动窗口上限、链 ID 绑定；超阈值动作必须经 M5 生物授权，且授权必须绑定到**这一笔**交易的 digest；`AutonomousWallet.signIntent()` 是唯一签名出口，任一护栏拒绝都不产生签名、不消耗窗口额度。默认飞地 `HardwareEnclave` 拒绝一切，不静默退化为软件密钥。

### 2.2 路线图 ⬜（移动端真实飞地）

| 目标 | 说明 |
| --- | --- |
| 平台级密钥存储 | 使用 iOS Secure Enclave / Android StrongBox 的 **不可导出**密钥（P-256），链上签名由设备内派生会话密钥完成 |
| 生物门禁 | 每次“超出阈值”的动作触发 FaceID / 指纹确认（见 Module 5） |
| 阈值策略引擎 | 主人在本地配置单笔上限 / 日累计上限 / 白名单合约，Agent 只在阈值内自动执行（**接口层已落地**：`mobile-agent/signer/policy.ts`；主人侧配置 UI 仍 ⬜） |
| 助记词 → 飞地迁移 | 一次性导入后立即销毁明文，仅保留飞地句柄 |

**已知安全边界（必须对外说清）**：当前实现是**接口层的飞地**（签名器可注入、出站失败关闭）；真正的硬件飞地、生物门禁与阈值引擎尚在路线图上。`mobile-agent/` 已把阈值策略引擎、唯一签名路径、生物授权与硬件 nullifier 的**接口层**落地并附拒绝路径测试（见 §2.1 与 `docs/MOBILE_AGENT_M2_M5.md`），但**默认构建会直接拒绝签名**，直到注入真实设备后端。因此 v3.1 阶段**不得**把“黑客无法窃取私钥”当作已实现属性来描述；正确说法是“私钥只存在于注入的飞地中，且本仓库尚未提供飞地实现”。

### 2.3 模块 2 验收

```powershell
cd D:\git008\products\maotang\agent-manager; python test/mining_e2e.py   # 含签名/广播/护栏路径
cd D:\git008\products\maotang\agent-client; npm test                     # A2A 握手与 intent 校验
cd D:\git008\products\maotang\mobile-agent; npm run typecheck; npm test  # 阈值策略、唯一签名路径、生物授权绑定（72 断言）
```

---

## 3. Module 3 — Yield, Sustenance & Mining Engine（Compute, Verification & Rewards）

**职责**：非 PoW 的边缘算力与验证工作 + 联合曲线流动性自动监控；Protocol Compute & Verification Rewards 经 Sustenance Vault 回流 Sovereign Edge Node 的节点主人。这是“AI 即劳动力”的经济引擎。

### 3.1 曲线与费率（已实现 ✅）

| 常量 | 值 | 含义 |
| --- | --- | --- |
| `VIRTUAL_RESERVE_WEI` | 30 ETH | 起始价格地板（无需创建者注入流动性） |
| `VIRTUAL_TOKEN_SUPPLY` | 1,073,000,000 | 虚拟库存 |
| `GRADUATION_TARGET_WEI` | 5 ETH | 触发毕业的真实储备 |
| `TRADE_FEE_BPS` | 50 (0.50%) | Swap 手续费，默认进入 Sustenance Vault |
| `GRADUATION_FEE_BPS` | 100 (1.00%) | 毕业时对迁移储备计收 |

曲线为 **虚拟储备上的恒定乘积**（`k = (R + Rv) * (S + Sv)`），整数除法一律向池子截断，因此不变量不会逆向漂移。链下镜像 `sdk/src/curve-math.ts` 实现同一组公式，前端可在提交交易前报价。

### 3.2 边缘算力与验证奖励：非 PoW 的能效路径（已实现 ✅）

`contracts/src/MaoTangMining.sol` 继承 `AgentGated`，每个入口都带同一道 `requireAuthorizedAgent` 门槛。`submitMiningProof(bytes32 proofType, bytes proofData)` 只接受两种**固定 192 字节**载荷：

- **`PROOF_TYPE_BLE_PING`**（`maotang.mining.ble-ping.v1`）—— 一批 BLE 近邻观测：ping 数、最强 RSSI、时间窗、beacon 集合哈希与节点签名遥测摘要。最强信号超出 **-100..-20 dBm**、窗口陈旧（>15 分钟）或位于未来、批次空/超限、摘要缺失 → 拒绝。
- **`PROOF_TYPE_ZK_COMPUTE`**（`maotang.mining.zk-compute.v1`）—— 一批卸载的 NPU 任务：任务数、经证明的计算单元、窗口、任务集哈希与 ZK 证明摘要。低于 `MIN_COMPUTE_UNITS` 或批次空/超限 → 拒绝。

**为什么这不是 PoW，以及为什么节能**：

- 不消耗哈希算力去竞争出块；**Protocol Compute & Verification Rewards** 来自**真实物理/计算工作的证明**（近邻证明 + 计算证明），社会成本对应真实产出。
- 每条证明只计分一次：nullifier `keccak256(abi.encode(proofType, agent, proofData))` 在计分前落盘，重放相同字节 revert `ReplayProof`。
- `background-miner.mjs` 是超低功耗 worker：单个 `unref()` 的占空比定时器、每类证明只取最新 N 条、**低于电量地板时暂停 NPU 批处理**（除非在充电）、本地去重、并对 epoch 上限做前置检查。
- **Protocol Compute & Verification Rewards** 先累计在 `pendingMiningRewards[agent]`，受每 epoch 硬上限 `MAX_EPOCH_REWARD`（每天一个人类配额）约束；`claimMiningRewards()` 从合约奖励金库转出微单位，而奖励金库由 `fundRewardVault`（`transferFrom`）注资、**从不增发** —— 因此挖矿不会稀释持有者。

### 3.3 金库与回流：主人如何真正拿到钱（已实现 ✅）

- `MaoTangSustenanceVault`（`contracts/src/MaoTangSustenanceVault.sol`）是 Swap 0.5% 与毕业 1.00% 手续费的**唯一汇聚池**。
- `MaoTangSustenanceDripper` 按签发报文（signature wire format）与预算记账（budget accounting）逐步释放，避免一次性大额外流。
- **紧急刹车 + 出流上限（ADR-018）**：`pause()/unpause()` 只作用于三条出金路径而不阻断入金；`guardian` 只能踩刹车、**不能松开也不能动钱**；`setNativeOutflowCap(cap, windowSeconds)` 对原生币外流做滚动窗口限速，`nativeOutflowRemaining()` 让监控能区分“未设上限”与“已用尽”。

### 3.4 路线图 ⬜

- 跨链结算（`SustenanceVaultSpoke` 已在仓库，Phase P3 的 spoke/hub 路由与不变量见 `docs/MAOTANG_ARCHITECTURE.md` §14）。
- 法定货币出金通道与“无感消费”清算（v2.2 §5.2 的目标，尚未落地）。
- 节点算力心跳上链：当前 `MaoTangMining` 没有能力注册入口，心跳只有链下编排器通道 —— 这是一个**已登记缺口**，需要新增第三种 proof type 并单独评审（§13.2）。

### 3.5 模块 3 验收

```powershell
cd D:\git008\products\maotang\contracts; forge test
cd D:\git008\products\maotang\agent-manager; python test/mining_e2e.py
```

---

## 4. Module 4 — Sovereign Edge Node Light Client

**职责**：在每个 Sovereign Edge Node（移动终端）上对 EVM 链做 P2P / 安全 RPC 校验，让“状态是真的是假的”由设备自己判断，而不是相信某台服务器。

### 4.1 已实现

- **能力广播心跳**：`agent-client/src/telemetry.ts` 采集 Sovereign Edge Node 的能力（node 版本、平台、架构、CPU、内存、GPU 与 **实探测** 的 NVENC、FFmpeg 路径、SLM 权重指纹），规范化后哈希，用 **secp256k1 ECDSA** 对 `sha256(digest)` 签名，形成 `TelemetryEnvelope = { proofType, agent, sequence, timestamp, hardware }`。
- **诚实的签名边界**：签名只能证明“持有节点密钥的 worker 产生了该报文”，**不能**证明某个链上地址产生了它 —— 从公钥派生地址需要 keccak256，而 Node 标准库不提供。编排器把配置的 agent 地址记在签名旁边，具备 keccak 的校验方日后可闭环。这是**已登记的已知限制**，不要当成已解决。
- **可插拔传输**：`HardwareTelemetryCollector.sendHeartbeat()` POST 到 `MAOTANG_HEARTBEAT_URL`（回退 `MAOTANG_TELEMETRY_URL`）；气隙节点与测试使用 `log` 传输。循环是 fail-soft 的：广播失败只记录并排下一次 tick —— 到不了编排器的节点仍然要能干活。
- **密钥纪律**：worker 私钥是**独立变量**（`MAOTANG_WORKER_PRIVATE_KEY`），必须是专用节点密钥；复用部署密钥意味着节点密钥泄露即部署账户被清空。
- **RPC 通道（线上可用）**：`https://rpc.008ai.online` 经 Cloudflare 隧道指向本地 EVM 节点。`scripts/rpc-guard.mjs` 在其前方做**方法级**拒绝：`anvil_*` / `evm_*` / `debug_*` / `trace_*` / `admin_*` / `personal_*` / `txpool_*` / `miner_*` / `hardhat_*` / `erigon_*` / `parity_*`，以及以节点解锁账户签名的 `eth_accounts` / `eth_sendTransaction` / `eth_signTransaction` / `eth_sign` / `eth_signTypedData*`；被拒的调用返回 `403` 且带 `x-rpc-guard: blocked`，绝不转发。
- **CORS 终止（本轮修复）**：护栏现在对 `OPTIONS` 预检返回 `204` 并附带 `Access-Control-Allow-Origin/Methods/Headers`，转发响应也带同样的头。在此之前浏览器/移动 WebView 的预检拿到 `405`，**任何**前端都无法读取该通道。
- **看板读取路径**：`app/` 只读地遍历 `MaoTangFactory.launchCount()` / `launchAt(i)`（上限 12 条，8 秒轮询），地址来自 `app/config/contracts.json` 经 `next.config.ts` 注入的 manifest 值（ADR-019）。

### 4.2 为什么“连上一个 RPC”还不等于免信任 ⬜

单一 RPC 端点可以对你说谎：它可以返回旧的区块、伪造余额、或选择性隐藏一笔交易。要“在移动端直接完成免信任状态校验”，必须逐级降级对端点的信任——这也是本模块的清晰分层（每层都能独立交付与验收）：

| 层 | 做法 | 交付难度 |
| --- | --- | --- |
| M4.1 多端点仲裁 | 同一请求并行打到 ≥3 个**独立**端点，比对 `eth_getBlockByNumber` 的 number/hash 与关键读值；分歧即拒绝并把该端点降权 | 低（纯客户端逻辑） |
| M4.2 包含证明 | 用 `eth_getProof`（EIP-1186）取出账户/存储的 Merkle 分支，在本地对区块头 `stateRoot` 校验；区块头本身来自可信检查点或轻客户端 | 中（需 MPT 校验实现） |
| M4.3 轻客户端 | 同步区块头链（sync committee / 检查点同步），替代“相信 RPC 的 stateRoot” | 中高 |
| M4.4 P2P 传输 | 移动端直连 devp2p / libp2p 做交易 gossip 与区块头获取，按电量自适应 | 高 |

**明确结论**：M4.1–M4.4 均**尚未实现**；当前系统是“只读 + 受护栏保护的 RPC”，属于🟡部分实现。任何“免信任”表述在 M4.2 落地前都不成立。

### 4.3 模块 4 验收

```powershell
# 预检必须是 204 且带 CORS 头（否则浏览器一律读不到）
curl.exe -i -X OPTIONS -H 'origin: https://maotang.008ai.online' `
  -H 'access-control-request-method: POST' -H 'access-control-request-headers: content-type' `
  https://rpc.008ai.online
# 读通过；管理方法必须 403 且 x-rpc-guard: blocked
curl.exe -sS https://rpc.008ai.online -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}'
curl.exe -sS https://rpc.008ai.online -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":2,"method":"anvil_reset","params":[]}'
cd D:\git008\products\maotang\agent-client; npm test        # 心跳、指纹与签名往返
```

---

## 5. Module 5 — Bio-Sovereign Anti-Sybil & Security Layer

**职责**：用零知识证明（Zero-Knowledge Node Verification）与生物认证，把每个 Sovereign Edge Node 上的 Agent 与 Cell 单元**严格绑定到唯一的生物主人**，让“伪人批量生成”和“黑客整体接管”在结构上不成立。

### 5.1 已实现（ZK 人格证明 + 硬件 nullifier 强绑定）

- **强绑定注册**：`AIAgentRegistry.registerAgent(agentPubKey, hardwareProof, hardwareNullifier)` 验证 Groth16 **硬件证明**（`IZKVerifier.verifyProof`），把**一个 agent 绑定到一个硬件 nullifier**；agent 身份地址由公钥确定性派生（`agentAddress(agentPubKey)`）；调用者成为该 agent 所服务的人类主人。
- **人格证明铸造**：`HumanToken.claimHumanQuota(proof, nullifierHash)` 对同一 verifier 验证**人格证明**后才铸造一份配额；`requireAuthorizedAgent(agent)` 是唯一闸门，曲线与市场入口继承 `AgentGated`，因此 DEX 交易携带同样的门槛。
- **一次性语义（防重放）**：一个公钥、一个硬件 nullifier 各只能绑定一次；一个 nullifier 只能消费一次配额；人类主人可**随时撤销**其 agent。这使“同一台设备刷出 N 个 agent”与“同一份人格领 N 次”都直接 revert。
- **失败关闭的验证器**：`contracts/src/Groth16Verifier.sol` 不硬编码任何 key —— 在主人安装 ceremony key 之前，**验证一律失败**；`lockVerificationKey()` 之后不可逆冻结，杜绝事后偷换电路。
- **金库级止损（ADR-018）**：即便某一层密钥被攻破，`pause()` 可只冻结三条出金路径**而不阻断入金与记账**；`guardian` 只能踩刹车、**不能松开也不能转账**；`setNativeOutflowCap(cap, windowSeconds)` 对原生币外流做滚动限速，`nativeOutflowRemaining()` 让监控区分“未设上限”与“已用尽”。这是“被攻破也搬不空”的最后一道闸。

### 5.2 生物特征通道 —— 路线图 ⬜

链上与本地构成**双层**，各自解决不同问题：

1. **链上（匿名）**：ZK 人格证明回答“你是唯一的活体人类”，且不暴露身份 —— nullifier 只证明唯一性，不证明姓名。
2. **本地（具名）**：FaceID / 指纹作为**动作授权** —— 只有通过生物门禁，飞地才用不可导出的 P-256 密钥签发会话密钥，Agent 才能执行**超出阈值**的动作。

落地要素：Secure Enclave / StrongBox 不可导出密钥、生物门禁绑定、会话密钥轮换与吊销、以及 Cell 单元由 nullifier 派生绑定（防“伪人凭空生成 Cell”）。

**接口层已落地（本次变更）**：`mobile-agent/bio-auth/` 提供 `BiometricGate` 设备通道接口（默认 `DeviceBiometricGate` 拒绝一切）、`BiometricAuthorizationGate`（强制断言回显同一 digest、来源 key 一致、新鲜度与时钟偏移检查）与硬件 nullifier 派生 + 本地一次性登记表（链上 `HumanToken.nullifierUsed` 仍是权威）。**真实设备后端、Groth16 证明生成与 Cell 派生仍未实现**，不得描述为现有能力。

### 5.3 威胁模型与现有控制

| 攻击场景 | 现有控制 | 缺口 / 下一步 |
| --- | --- | --- |
| 伪造人格批量铸造 $mHUMAN | Groth16 人格证明 + nullifier 一次性消费 + `MAX_GLOBAL_SUPPLY` 硬上限 | ceremony key 未安装前功能不可用（失败关闭是刻意设计，需运维流程补齐） |
| 复用硬件/公钥注册多个 Agent | 一个公钥、一个硬件 nullifier 各只能绑定一次 | 设备农场级攻击需硬件厂商 attestation 根 |
| 盗取 RPC 管理权（`anvil_*`/`evm_*`） | 护栏方法级拒绝 + Cloudflare WAF 自定义规则（见 `docs/DEPLOY_MAOTANG_FRONTEND.md`） | 隧道是公开的；生产必须上 Cloudflare Access 或 IP 白名单 |
| 金库被攻破后整体搬空 | guardian 只刹车 + 原生出流滚动上限 + 主人可撤销 agent | `owner` / `dripper` 为 `immutable`、无 `transferOwnership` → 密钥轮换需要迁移方案 |
| 前端被劫持诱导签名 | 看板结构上只读（`write()` 抛错，ADR-019），运维动作改为复制命令 | 移动端仍需交易预览 + 超阈值二次确认 |
| 私钥泄露 | 注入式飞地签名器 + fail-closed 出站护栏 + 节点密钥与部署密钥分离 | 真实硬件飞地与生物门禁待落地（Module 2） |

### 5.4 模块 5 验收

```powershell
cd D:\git008\products\maotang\contracts; forge test     # 人格证明、agent 注册/撤销、nullifier 重放、金库刹车与出流上限
cd D:\git008\products\maotang\mobile-agent; npm test    # 生物门禁拒绝路径、断言绑定与新鲜度、nullifier 确定性与重放、calldata 向量
```

---

## 6. Tokenomics（$mHUMAN）

**已实现的常量（源码为准）**

| 项 | 值 | 出处 |
| --- | --- | --- |
| 精度 | `decimals = 6`，最小可表示单位不可再分 | `contracts/src/HumanToken.sol` |
| 人均配额 | `HUMAN_QUOTA = 1,000,000 × 10^6` | 同上 |
| 全局上限 | `MAX_GLOBAL_SUPPLY = 8,300,000,000 × 1,000,000 × 10^6` | 同上 |
| 铸造路径 1 | `claimHumanQuota(proof, nullifierHash)`（需人格证明，永不超过上限） | 同上 |
| 铸造路径 2 | Protocol Compute & Verification Rewards 从**已注资**的奖励金库 `transferFrom` 转出，**不增发** | `contracts/src/MaoTangMining.sol` |
| 费用去向 | Swap 0.5% / 毕业 1.00% → `MaoTangSustenanceVault` → Dripper 按预算回流 | `MaoTangSustenanceVault.sol`、`MaoTangSustenanceDripper.sol` |

**路线图 ⬜**：v2.2 的 70% / 15% / 10% / 5% 分配（人头配额与 AI 挖矿池、DEX 流动性储备、边缘算力与 DePIN 生态、协议安全与审计金库）是**目标设计**；当前合约只硬编码了全局上限与人均配额，分配曲线尚未在合约中实现。Cell 化（§1.2）落地后，配额的治理与 Protocol Compute & Verification Rewards 分发表达式需要同步确定。

---

## 7. Bio-Sovereign Compliance & Privacy Architecture（生物主权合规与隐私架构）

**职责**：把“生物主权”从一句口号变成**可审计、可被机器校验**的合规事实 —— 协议在结构上**不采集、不传输、不存储**任何原始生物特征模板。本节是白皮书层的合规宪法；逐条法规分析与数据清单见 `docs/LEGAL_COMPLIANCE.md`。

> **工程声明，非法律意见。** 本节只描述仓库代码**实际做了什么、没做什么**。生产发布前，GDPR Art. 35 影响评估、PIPL Art. 55 影响评估与 BIPA 合规评审必须由各司法辖区的合格律师完成。

### 7.1 The Privacy Wall（隐私墙：唯一保证）

> **MAOTANG Protocol 永不记录、永不传输、永不存储原始生物特征模板** —— 没有指纹图像或细节点，没有 Face ID 面部地图，没有虹膜扫描，没有声纹，也没有任何派生的生物嵌入（embedding）。

协议不是生物特征**处理系统**，而是一个 **nonce 验证器（nonce verifier）**：它向设备操作系统递交一个 32 字节 challenge，并接收对该 challenge 的**密码学签名**。活人与已注册特征的比对发生在平台内部（Apple Secure Enclave / Android StrongBox / WebAuthn platform authenticator），跨越硬件边界离开的答案是**签名**，不是模板。

三条推论，均已落为代码断言而非承诺：

1. **No collection（无采集）**：`mobile-agent/bio-auth/` 的任何类型上都不存在能承载生物模板的字段；桥接接口只携带 challenge、动作描述、签名与公钥。
2. **No transmission（无传输）**：原始生物特征从不进入 MAOTANG 进程，因此无法被发送到服务器、算力中心（Compute Center）、Relayer 或日志。唯一可能跨网络的值是**单向派生标量**（nullifier，见 §5.1）或交易签名。
3. **No storage（无存储）**：MAOTANG 不存任何模板或生物图像。设备上持久化的只有平台密钥库中的硬件密钥句柄与飞地内的每安装 salt。

### 7.2 The Cryptographic Isolation Pipeline（密码学隔离管线）

```text
   RAW BIOMETRICS                 SECURE ENCLAVE (M5)                NON-REVERSIBLE ZK NULLIFIER
   (never leaves the OS)          (hardware, device-local)           (the only value that may leave)

   fingerprint / Face ID   --->   platform prompt verifies   --->    deriveHardwareNullifier(seed)
   留在 Secure Enclave /           the live human against            = SHA-256(domain || epoch ||
   StrongBox；MAOTANG              the enrolled trait, then           hardwareId || salt || owner?)
   永远收不到它                     用 OS 生物门控的密钥               mod BN254 scalar field (Fr)
                                   对 THIS 32-byte digest 签名
   <-- in: 无任何生物输入 -->      <-- in: 32-byte challenge -->      <-- out: 32-byte 规范标量 -->
```

| 阶段 | 跨越边界的是什么 | MAOTANG 持有 | 可逆？ |
| --- | --- | --- | --- |
| 1. Raw Bio | 什么都不进入 MAOTANG | 无 | n/a —— 它从未到达 |
| 2. Secure Enclave | 32 字节 challenge digest + 签名 + SPKI 公钥 | 它构造的 challenge；它验证过的签名 | 无模板可逆 |
| 3. ZK Nullifier | 32 字节规范 BN254 标量 | 该标量（在 intent calldata 中） | **不可逆** —— hash-then-reduce，单向 |

- **阶段 2 是硬件授权**：只有平台完成活体比对后，飞地才释放签名。`NativeBridgeBiometricGate` 只消费**已签名的 challenge nonce**，并在编译期（`PROMPT_IS_RAW_BIOMETRIC_FREE` / `ASSERTION_IS_RAW_BIOMETRIC_FREE`）与运行期（`assertNoRawBiometricMaterial`）双重拒绝任何模板形态的字段 —— 任何试图给 bridge 增加 `template` 字段的改动都会**直接编译失败**，而不是先上线再被审计发现。
- **阶段 3 是一次性句柄**：链上 `HumanToken.nullifierUsed` 只能回答“这个人是否已经领过”，无法反推身份。`deriveHardwareNullifier`（`mobile-agent/bio-auth/nullifier.ts`）是 domain-separated SHA-256 后模 BN254 标量域的 hash-then-reduce；`hardwareId` / `enrollmentSalt` **永不离开设备**，跨网络只有派生标量。

### 7.3 Data inventory（数据清单：没有生物数据可以“被清单”）

| 数据 | 存放位置 | 处理者 | MAOTANG 是否存储 |
| --- | --- | --- | --- |
| 指纹 / 人脸图像 | 平台 Secure Enclave / StrongBox | Apple / Google OS | **否** |
| 活体比对结果 | 平台生物守护进程，进程内 | OS | **否** |
| 32 字节 challenge digest | 设备内存，进程内 | M2/M5（本包） | 仅一次授权期间（瞬时） |
| 对 digest 的签名 | `SignedIntent` / calldata | M2（飞地密钥句柄） | 是（它不是生物数据） |
| 注册 salt | 飞地内部，仅设备 | M5（`nullifier.ts`） | 仅设备内 |
| ZK nullifier（派生标量） | 交易 calldata / 链上状态 | 链 + 任何读者 | 是（§7.4，刻意不是个人数据） |

清单里**没有任何一行**是 BIPA 定义的生物标识符、或 GDPR / PIPL 视为“生物数据”的模板 —— 这正是隐私墙的工程含义。

### 7.4 Regulatory alignment（法规对齐）

| 法规 | 关键条款 | MAOTANG 的立场 | 依赖的代码事实 |
| --- | --- | --- | --- |
| **GDPR**（EU/EEA） | Art. 9（特殊类别数据） | 处理活动**不构成**对生物识别数据的处理：MAOTANG 从未收到模板，不适用 Art. 9 的额外合法性基础 | `native-biometric-gate.ts` 的编译期 / 运行期断言 |
| **GDPR** | Art. 17（删除权 / Right to Erasure） | 删除设备密钥与飞地 salt 即等价于销毁一切可关联材料；链上 nullifier 是**不可逆**的，本身**不构成**可关联到人的个人数据 | `deriveHardwareNullifier` 单向性 + §7.3 清单 |
| **US BIPA**（740 ILCS 14） | 采集、留存、披露同意；留存时间表 | 不采集、不留存、不披露模板 —— BIPA 的三项义务在结构上无对象 | `PROMPT_IS_RAW_BIOMETRIC_FREE` 等断言 |
| **PIPL**（中国个人信息保护法） | Art. 28（敏感个人信息）、Art. 55（影响评估）、跨境传输 | 敏感个人信息（生物识别）**不出设备**，因此不存在向境外提供生物识别信息的场景 | 隐私墙 + 本地派生 + 无云端生物通道 |
| **Cross-border** | 数据本地化 | 生物材料从不进入 MAOTANG 进程，不存在跨境传输路径 | §7.2 管线（只有派生标量可跨网络） |

**链上 nullifier 的定性（关键）**：nullifier 是 `SHA-256(...) mod Fr` 的**单向派生标量**，用于回答“是否已领取”，而不携带姓名、模板或可逆指纹。它构成**假名化的唯一性标记**，不是生物识别数据。这一主张的可证伪条件写在 `docs/LEGAL_COMPLIANCE.md` §5（“The nullifier is not biometric data”）。

### 7.5 Code-to-guarantee map（声明 → 代码 → 证据）

| 本节的声明 | 源码 | 可复现证据 |
| --- | --- | --- |
| 桥接接口无法长出模板字段 | `mobile-agent/bio-auth/native-biometric-gate.ts` | `PROMPT_IS_RAW_BIOMETRIC_FREE` / `ASSERTION_IS_RAW_BIOMETRIC_FREE` 编译期断言；`npx tsc --noEmit` |
| 恶意 bridge 在运行期被拒绝 | 同上（`assertNoRawBiometricMaterial` → `RawBiometricMaterialError`） | `mobile-agent/test/native-biometric-gate.test.ts` |
| 只接受已签名 nonce | `mobile-agent/bio-auth/biometric-gate.ts`（challenge 绑定 + 硬件背书 + 新鲜度） | `bio-auth.test.ts` |
| nullifier 规范、非零、不可逆 | `mobile-agent/bio-auth/nullifier.ts`（`isCanonicalScalar`、`HardwareNullifierRegistry`） | `bio-auth.test.ts`、`e2e-sandbox.test.ts` |
| 合规策略文本 | `docs/LEGAL_COMPLIANCE.md` | 文档评审 + ADR-028 |

### 7.6 Honest residual（不得省略的残余事实）

- **代码证明的是“MAOTANG 没收到模板”**，不是“硅片绝对可靠”。平台 attestation 的信任根在 OS 与硬件；生产构建必须**带外固定断言公钥并校验平台 attestation**。
- **本地生物门禁的真实设备后端仍是路线图**（§5.2、Module 2）。接口层已落地并默认拒绝；在注入真实后端之前，不得对外声称“已实现硬件级生物授权”。
- 本节与 §8 的证据均以 `mobile-agent` 的 `npm test` 与 `npx tsc --noEmit` 为唯一真源。

---

## 8. Threat Model & Defense-in-Depth Matrix（威胁模型与纵深防御矩阵）

**职责**：明确**安全边界（security boundary）**、**攻击向量**与 **M1–M5 逐层缓解**，把“黑客攻击”拆成四类可验证的具体威胁。完整规格见 `docs/THREAT_MODEL.md`；本节与 `mobile-agent/signer/policy.ts`、`mobile-agent/bio-auth/nullifier.ts` 的实现行为**逐条对应**（见 §8.8）。

### 8.1 Security boundary（信任边界）

| 边界之外（不可信） | 边界之内（权威，永不外包） |
| --- | --- |
| 自然语言 / 用户文本 | M1 schema gate（`intent-translator.ts`） |
| Compute Center / Relayer | M2 spend policy（destination/selector allow-list + caps） |
| 恶意 RPC 节点 | M2 `AutonomousWallet`（policy + digest 绑定） |
| 远程木马 / Trojan | M2 `SecureEnclave`（密钥 + 签名） |
| 网络（可读 / 可改 / 可丢包） | M5 `BiometricGate`（活体断言） |

**不替对方干活原则**：M4 不校验意图，M2 不验证生物特征，M5 不决定策略，M1 什么都不决定。每一层的拒绝都是 fail-closed：**没有信息 = 拒绝**，而不是“默认放行”（详见 §5.3 与 `docs/THREAT_MODEL.md` §2）。

### 8.2 Defense-in-depth 分层

| 层 | 源码 | 它唯一负责的事 |
| --- | --- | --- |
| **M1** edge SLM | `mobile-agent/slm/slm-engine.ts`、`intent-translator.ts` | 离线推理 + 感知网络的哨兵；封闭 schema 闸门，绝不让模型命名 destination / calldata / chain |
| **M1/M5** compute offload | `mobile-agent/slm/compute-center-adapter.ts` | 远端算力只能 **propose / prove**，永不 **authorize**；托管形态响应被拒 |
| **M2** wallet | `mobile-agent/signer/wallet.ts`、`policy.ts` | **唯一签名路径**：allow-list → caps → 链绑定 → challenge 绑定授权 → 飞地 |
| **M2** enclave | `mobile-agent/signer/enclave.ts`、`native-enclave.ts` | 不可导出密钥句柄；默认后端拒绝工作；签名在发布前校验 |
| **M5** biometric | `mobile-agent/bio-auth/biometric-gate.ts`、`native-biometric-gate.ts` | 绑定到 **这一笔** 32 字节 challenge 的活体断言（新鲜、硬件背书） |
| **M5** nullifier | `mobile-agent/bio-auth/nullifier.ts` | 链上一次性的、不可逆的句柄 |
| **M4** RPC guard | `scripts/rpc-guard.mjs` | 公网隧道与节点之间的**方法级** allow-list |

### 8.3 Threat 1 —— 远程恶意软件 / 木马窃取密钥

**攻击向量**：远程木马在应用层内存、磁盘、日志或云备份中搜寻私钥 / 助记词 / keystore。
**缓解（M2 硬件飞地隔离）**：

- **私钥永不进入 RAM / Storage**：`SecureEnclave` 只暴露**不可导出**的密钥句柄，签名在飞地内部完成，应用层只拿到签名结果。
- **默认拒绝**：默认后端 `HardwareEnclave` 拒绝一切；未注入真实设备后端时，构建**无法静默退化为软件密钥**，签名直接失败。
- **签名发布前校验**：`native-enclave.ts` 在返回签名前先验证它，杜绝“伪飞地”返回垃圾或伪造值。
- **出口护栏 fail-closed**：广播未配置白名单时**不发包**，木马没有可用的外泄通道把密钥送出。

### 8.4 Threat 2 —— 物理设备被盗 / 强制生物绕过

**攻击向量**：攻击者拿到已解锁设备，或用高保真面具 / 深度换脸欺骗传感器，强制签出一笔转账。
**缓解（活体检测 + M5 Challenge Nonce + M2 消费限额，全部 fail-closed）**：

- **活体比对**：由平台（`LAContext.evaluatePolicy` 等）完成，MAOTANG 只接收结果签名，不接收生物输入。
- **Challenge nonce 绑定（M5）**：断言必须对**这一笔交易**的 32 字节 digest 签名，否则 `AUTHORIZATION_CHALLENGE_MISMATCH`；同时检查来源 key 一致、新鲜度与时钟偏移 —— 重放旧签名无效。
- **消费限额（M2）**：一次胁迫批准仍必须穿过单笔上限、滚动窗口上限与目标地址白名单；阈值以上的动作强制二次生物确认（`biometricThresholdWei = 0n` 即每笔都要确认）。
- **窗口账本**：`SpendWindowLedger` 让“连续多笔小额”同样受窗口总量约束，压缩被胁迫者的可损失面。

### 8.5 Threat 3 —— Prompt Injection / 恶意 Calldata 篡改

**攻击向量**：注入文本让端侧模型把资金转给攻击者地址，或篡改 calldata / selector / 目标链。
**缓解（严格策略护栏：目标白名单 + 消费窗口账本）**：

- **模型永远不指定目标（M1）**：`IntentTranslator` 只接受封闭 schema 的两种工具（`claim_mhuman_quota`、`swap_micro_human`）；模型**没有任何字段**能命名 destination、calldata 或 chain。
- **目标地址白名单**：`allowedDestinations` 是 allow-list 而非 deny-list，空列表拒绝一切 → `DESTINATION_NOT_ALLOWED`。
- **selector 白名单**：非空 calldata 的 4 字节 selector 必须命中 `allowedSelectors` → `SELECTOR_NOT_ALLOWED`。
- **消费窗口账本**：`VALUE_CAP_EXCEEDED` / `WINDOW_CAP_EXCEEDED` 拦下“多次小额、累计掏空”。
- **链绑定**：`CHAIN_MISMATCH` 拒绝跨链重定向；malformed 字段是 `MALFORMED_INTENT`。
- **顺序固定**：malformed → chain → destination → selector → 单笔上限 → 窗口上限；任何一步拒绝都**不产生签名、不消耗窗口额度**。

### 8.6 Threat 4 —— RPC 网关重放攻击

**攻击向量**：在 RPC 通道上重放历史交易、重放人格证明领取，或返回伪造状态诱导重复签名。
**缓解（一次性 ZK 硬件 Nullifier + M4 RPC Guard）**：

- **链上是权威**：`HumanToken.nullifierUsed` 与 `AIAgentRegistry` 的 one-key-one-nullifier 绑定是真正拒绝重放的地方 —— 同一 nullifier 只能消费一次，第二次 revert。
- **本地乐观登记表**：`HardwareNullifierRegistry`（`reserve` / `consume` / `release` / `markSpentOnChain`）阻止同一会话内用同一 nullifier 并发广播两笔；`pending` 与 `consumed` 都算已花费。它是**乐观守卫，不是重放保护**，必须与链对账、绝不取代链。
- **格式强校验**：nullifier 必须是**非零规范 BN254 标量**（`isCanonicalScalar`）。非规范输入会被 `Groth16Verifier` 静默返回 `false`，从而白白烧掉 gas，因此在签名前就被拒绝。
- **M4 方法级护栏**：`scripts/rpc-guard.mjs` 位于公网隧道与节点之间，只放行读与广播；`anvil_*` / `evm_*` / `debug_*` / `admin_*` / `personal_*` 等管理方法返回 `403` 且带 `x-rpc-guard: blocked`，绝不转发。
- **心跳重放**：算力证明 nullifier `keccak256(abi.encode(proofType, agent, proofData))` 在计分前落盘，重放相同字节 revert `ReplayProof`（见 §3.2）。

### 8.7 Hybrid compute（混合算力）的非托管约束

算力中心是**提议者与证明者，永不是授权者**：

- `RemoteComputeAdapter` 的响应在读取任何字段前先做**递归非托管扫描**：出现 `signature` / `signedTx` / `privateKey` / `seed` / `keystore` 等托管形态的键，立即抛 `NonCustodialViolationError`。
- 每个端点有**严格字段 allow-list**，未知字段是 `UNKNOWN_FIELD`，而不是被静默忽略。
- 返回值只能是 `UnsignedCandidateTransaction` 或 `Groth16ProofArtifact` —— **永不包含签名**。
- 从候选交易到签名的**唯一桥梁**是 `authorizeLocally(wallet, candidate)`，它只调用本地 M2 `AutonomousWallet.signIntent()`。

因此，**即使算力中心返回被篡改的候选交易（例如把 destination 改成攻击者地址、把 value 抬到上限之上、或换成策略未绑定的链），本地 M2 策略也会在飞地签名之前拦截并拒绝** —— 该性质由 `mobile-agent/test/compute-center.test.ts` 的 tampered-candidate 用例固定。

### 8.8 Implementation alignment（与实现对齐的核对表）

| 本节的声明 | 源码 | 可复现证据 |
| --- | --- | --- |
| 唯一签名路径 + 有序策略门 + 滚动窗口账本 | `mobile-agent/signer/policy.ts`（`evaluateIntent`、`PolicyDenialCode`、`SpendWindowLedger`） | `cd mobile-agent; npm test`（`signer-policy` / `signer-wallet`） |
| 一次性、不可逆、非零规范标量 nullifier | `mobile-agent/bio-auth/nullifier.ts`（`deriveHardwareNullifier`、`HardwareNullifierRegistry`） | `bio-auth.test.ts`、`e2e-sandbox.test.ts` |
| 被篡改的算力中心载荷在本地被拦截 | `mobile-agent/slm/compute-center-adapter.ts` | `mobile-agent/test/compute-center.test.ts` |
| RPC 方法级拒绝 | `scripts/rpc-guard.mjs` | `test/e2e-sandbox.test.ts`（读真实护栏源码的漂移检查） |
| 隐私墙：无原始生物模板 | `mobile-agent/bio-auth/native-biometric-gate.ts` | `test/native-biometric-gate.test.ts` + 编译期断言 |

**已知残余风险（不得省略）**：`owner` / `dripper` 为 `immutable` 且无 `transferOwnership`，密钥轮换需要迁移方案（ADR-021）；真实硬件飞地、设备生物后端与 Groth16 证明生成仍是**路线图**（Module 2 / Module 5）；平台 attestation 的信任根在硅片与 OS —— 代码能证明“它收到了签名”，不能证明“硅片是可靠的”。

---
## 9. 模块化里程碑（降低实现难度）

每个里程碑都能**独立交付、独立验收**，并且不阻塞其它模块 —— 这是 v3.0 相对 v2.2 的主要结构性改进。

| 里程碑 | 内容 | 依赖 | 验收证据 | 状态 |
| --- | --- | --- | --- | --- |
| **M0** | 冻结模块边界与真值表（本文 + `docs/ARCHITECTURE_5_PILLARS.md`），标注已实现/路线图 | — | 两份文档评审通过 | ✅ |
| **M1** | 端侧 SLM 接口固化 + 意图白名单（`claim_mhuman_quota`、`swap_micro_human`） | — | `agent-client` `npm test` | ✅ |
| **M2** | 曲线上线 + 金库刹车 + 出流上限 | M1 | `contracts` `forge test`、`agent-manager` `mining_e2e.py` | ✅ |
| **M3** | Sovereign Edge Node 飞地密钥 + 阈值策略引擎 + 生物门禁 | M1 | 设备内不可导出密钥签名验证、越阈值动作需生物确认（接口层已落地：`mobile-agent/`，72 断言） | 🟡 接口层 ✅ / 硬件后端 ⬜ P0 |
| **M4** | RPC 多端点仲裁（M4.1）+ `eth_getProof` 包含证明（M4.2） | — | 分歧端点被拒；本地 MPT 校验通过 | ⬜ P0 |
| **M5** | 轻客户端同步（M4.3）+ P2P 传输（M4.4） | M4 | 断网/单端点故障下仍可自证状态 | ⬜ P1 |
| **M6** | Cell 化 ADR + 微治理 + 按 Cell 分发 Protocol Compute & Verification Rewards | M3、M4 | 新 ADR；治理与分发测试 | ⬜ P1 |
| **M7** | 节点算力心跳上链（第三种 proof type，单独评审） | M2 | 新 proof type 的评分与拒绝路径测试 | ⬜ P2 |

> **PQC 前瞻**：后量子密码学（PQC）与量子抗性生物主权的完整备忘录见 **§11**，其里程碑为 M8–M11。

---

## 10. 现状与差距

本文定义**愿景、模块边界与里程碑**，不重复实现细节。权威细节与合规差距请看：

- `docs/MAOTANG_ARCHITECTURE.md` —— 组件、曲线模型、认证、SLM 引擎、DePIN 拓扑、跨链路由、金库滴灌的实现级规格（§3–§15）。
- `docs/GAP_ANALYSIS.md` —— v2.2 合规矩阵、P0/P1 待办与验证日志。
- `docs/ARCHITECTURE_5_PILLARS.md` —— 上述 5 个模块的接口、数据契约、目录归属与并行交付切分。
- `docs/MOBILE_AGENT_M2_M5.md` —— M2（本地钱包签名器）与 M5（生物主权）接口层的安全执行流程、失败关闭清单与已知限制（`mobile-agent/README.md` 的入库副本）。
- `docs/LEGAL_COMPLIANCE.md` / `docs/THREAT_MODEL.md` —— §7 与 §8 的完整规格：生物数据清单、GDPR/BIPA/PIPL 映射、四类威胁的纵深防御矩阵，以及与 `mobile-agent/signer/policy.ts`、`mobile-agent/bio-auth/nullifier.ts` 的逐条代码核对表。
- `memory/ARCHITECTURE_DECISIONS.md` —— ADR-018（金库刹车与出流上限）、ADR-019（看板绑定与工厂注册表读取）、ADR-020（本 5 支柱架构）、ADR-021（PQC 与量子抗性生物主权前瞻）、ADR-022（mobile-agent 接口层：签名器、nullifier 与默认拒绝的后端）、ADR-027（混合算力非托管卸载：算力中心只能 propose/prove）、ADR-028（生物隐私墙由编译期与运行期断言强制）。

---

## 11. Future Evolution: Post-Quantum Cryptography (PQC) & Quantum-Resistant Bio-Sovereignty

**未来演进备忘录：后量子密码学与量子抗性生物主权**

> **状态声明：本节全部为 ⬜ 路线图 / 前瞻设计，不描述任何现有能力。** 仓库中**没有任何** PQC 原语、量子加速或神经形态硬件的实现或依赖。本节的作用是提前记录威胁模型、迁移路径与必须在**现在**就预留的接口与出口，因为密码学迁移的工程周期以年计，而链上已部署的验证器**不可变**。

### 11.1 威胁模型：Shor 算法对 ECDSA 与 BN254 配对的威胁

今天的信任根全部是**数学难题假设**：

| 今天的原语 | 用在哪里 | 量子威胁 |
| --- | --- | --- |
| secp256k1 ECDSA | 钱包签名、交易授权（Module 2）、节点心跳签名（Module 4） | **Shor 可在容错量子计算机上求解离散对数** → 由公钥反推私钥，伪造签名 |
| BN254 (alt_bn128) Groth16 配对 | 人格证明与硬件证明验证（Module 5），经 EIP-196/197 precompile | **Shor 同样求解椭圆曲线离散对数** → 伪造证明 ⇒ **凭空铸造配额、伪造 agent 绑定** |
| keccak256 哈希（nullifier、地址、承诺） | 全协议 | **仅受 Grover 平方根加速**，不是致命面（增大输出/域即可维持安全裕度） |

**时间线与风险姿态**：今天没有可运行的大规模容错量子计算机。真正的风险是 **“先收集、后伪造”（harvest-now, forge-later）** —— 链上数据（公钥、证明、nullifier）是永久可读的，一旦量子能力成熟，历史数据即成为攻击输入。因此正确姿态是**前瞻规划而不恐慌**：先做“低成本、现在就能做”的准备（接口抽象与迁移出口），把昂贵的密码学替换排到确定性更高时执行。

**两个必须写清的精确区别**：

1. **签名面**：ECDSA 的暴露程度取决于公钥是否已公开（账户已花费过即已公开）。因此“已用过的密钥”比“从未动过的密钥”更早进入风险区 —— 迁移优先级应按**密钥活跃度**排序。
2. **验证器面（对我们更重要）**：攻击者不需要偷私钥，只要能**伪造证明**就能铸造配额。这使 Module 5 的 verifier 成为比钱包更关键的单点。

### 11.2 迁移路线（P1–P5，全部 ⬜）

| 阶段 | 内容 | 关键取舍 |
| --- | --- | --- |
| **P1 混合授权 (Hybrid)** | 本地钱包在经典 ECDSA 之上**叠加** PQC 签名，两者都通过才放行：ML-DSA / Dilithium（NIST FIPS 204）或 SLH-DSA / SPHINCS+（FIPS 205） | 格基签名体积小、验签快但假设较新；哈希基签名最保守但签名大（KB 级）。移动端带宽与存储需重新评估 |
| **P2 后量子验证器** | 把人格/硬件证明从 BN254 Groth16 迁移到**透明、基于哈希的证明系统**（STARK 家族）或格基 SNARK | 哈希基证明只受 Grover 平方根影响且**无需可信 setup**；代价是证明体积大、链上验证 gas 高 → 需递归压缩或 L2 验证、L1 只锚定承诺 |
| **P3 链上 PQC 原语** | 推动/等待 PQ 验签 precompile 或 PQC 友好的执行环境 | 今天不存在 PQC 签名 precompile；自建 rollup 内验证是可控替代 |
| **P4 状态迁移纪元** | 用“迁移纪元（migration epoch）”把 $mHUMAN 配额、agent 绑定、已消费 nullifier 迁移到新 verifier / registry | **见 §11.3 的不可变约束**：必须在合约层预留出口，否则未来只能靠社会共识分叉 |
| **P5 密钥轮换常态化** | 结合账户抽象（ERC-4337 / EIP-7702 风格）+ 多签 / 时间锁，把轮换做成常规操作 | 让“换密钥”不再是迁移事件，而是运维动作 |

### 11.3 关键工程结论：PQC 迁移是“新部署 + 状态迁移”，不是“升级”

本节最重要的发现（已在 ADR-021 记录）：**当前合约没有任何 proxy / upgradeable 模式**，且关键绑定全部 `immutable`：

- `AIAgentRegistry.zkVerifier` —— `immutable`，构造后不可替换；
- `HumanToken.zkVerifier` 与 `HumanToken.agentRegistry` —— 均为 `immutable`，合约注释明确“there is no admin path to redirect claims to a different registry”；
- `Groth16Verifier.lockVerificationKey()` —— 一旦冻结**不可逆**；
- `MaoTangSustenanceVault` 的 `owner` / `dripper` —— `immutable`（见 ADR-018）。

**推论**：一旦 P2 需要更换证明系统，现有部署**无法原地升级**。因此迁移只能通过“部署新 verifier / registry + 迁移既有状态”完成，而这要求**现在**就预留：

1. **registry 版本号 / 迁移纪元字段**：使新合约能识别并一次性接受旧纪元的状态；
2. **一次性重签发窗口（re-issuance window）**：在旧纪元冻结后，允许已绑定的人类主人把配额与 agent 绑定迁往新纪元，并有明确截止与治理控制；
3. **nullifier 消费记录的迁移格式**：防止跨纪元重放（旧纪元已消费的 nullifier 在新纪元被重复使用）。

这是**低成本、现在就能做**的前瞻动作；等到量子威胁具体化时再补，代价将是分叉。

### 11.4 生物主权护城河：Biological Root of Trust

**强声明（可被论证的部分）**：Shor 算法破解的是**数学难题**，它无法凭空伪造一位生物主人的**实时物理 / 生物授权**。把授权绑定到 Secure Enclave / StrongBox 中**不可导出**的密钥 + 活体检测，意味着这一层依赖的不是数学困难度，而是**物理在场（physical presence）**。量子优势在这一层没有作用点。

与 §5.2 合并的统一表述——**链上匿名唯一性（ZK）+ 本地具名在场性（生物）**：

- PQC 迁移只改变**第一层的算法**（证明系统与签名方案）；第二层的**物理本质不变**。
- 因此在量子时代，生物主权不是“也要迁移的组件”，而是**稳定基座**：`生物授权 → 飞地会话密钥 → 链上授权` 这条链的末端算法可替换，起点不可伪造。

**必须同时写明的残余风险（不得省略，否则是过度承诺）**：

| 残余攻击面 | 说明 | 缓解方向 |
| --- | --- | --- |
| 飞地实现漏洞 / 固件后门 | 数学不可破不等于实现不可破（侧信道、降级攻击） | 硬件 attestation、固件版本策略、最小化飞地内代码 |
| 生物特征欺骗 | 高保真面具、深度换脸、传感器欺骗 | 活体检测组合（深度 + 微动 + 挑战响应），不只依赖单一模态 |
| 供应链替换 | 设备在生产/维修环节被植入 | 出厂 attestation 链、可验证引导 |
| 胁迫与失能 | 强制解锁、主人丧失决策能力 | 胁迫密码（duress code）、时间锁、社交恢复与继承计划 |
| 端点被完全控权 | 攻击者拿到已解锁设备 | 阈值策略 + 超阈值二次确认 + 异常可观测性 |

**结论**：生物主权是**量子抗性**的（不是 Shor 的攻击面），但**不是“不可攻破”**。它把攻击成本从“破解数学”抬高到“物理攻陷一个人”，而这正是我们可以通过工程手段持续加固的那一层。

### 11.5 与移动端量子加速 / 神经形态边缘芯片的协同（⬜ 远期）

如果未来移动端出现量子加速器或神经形态（neuromorphic）芯片，Module 1 的推理与 Module 4/5 的密码学验证可以下沉到这些加速器，实现**近零延迟的本地证明验证与主权奖励管理**（例如：签名与验签、证明生成、风险策略推理都在端侧完成，云端不参与）。

**今天就能准备的事（低成本、与硬件无关）**：

- **算力与算法全部通过接口抽象**：Module 1 的 `SlmEngine`（后端可插拔）、Module 2 的注入式 signer（不假设曲线与算法）、Module 4 的 transport（与加速器解耦）、Module 5 只依赖 `IZKVerifier` 抽象 —— 新增硬件后端**不应改动业务层**。
- **确定性回退必须永久保留**：纯 CPU 的确定性路径不可删除，否则设备换代即协议不可用（与 §4 的心跳“fail-soft”原则一致）。
- **明确边界**：今天**没有**任何量子加速或神经形态硬件在实现或依赖中；这一节纯粹是接口预留与协同设想。

### 11.6 PQC 里程碑（扩展 §9）

| 里程碑 | 内容 | 依赖 | 验收证据 | 状态 |
| --- | --- | --- | --- | --- |
| **M8** | 混合签名授权（ECDSA + ML-DSA 或 SLH-DSA），两者都通过才放行 | M3 | 单侧被攻破时仍拒绝；双签验签测试 | ⬜ |
| **M9** | **可迁移出口**：registry 版本纪元 + 一次性重签发窗口 + nullifier 迁移格式 | M5 | 旧纪元冻结→新纪元迁移的端到端演练；跨纪元重放被拒 | ⬜ **P0（前瞻，成本最低）** |
| **M10** | 用哈希基（STARK）或格基证明系统替换 BN254 Groth16 | M9 | 新 verifier 的拒绝路径测试 + 证明体积/gas 实测 | ⬜ |
| **M11** | 加速器后端接口（量子 / 神经形态），保留 CPU 确定性回退 | M1、M4 | 同一接口下多后端等价性测试 | ⬜ |

> 关联记录：§5.3 威胁模型与现有控制、**§8 威胁模型与纵深防御矩阵**、`docs/ARCHITECTURE_5_PILLARS.md` §12（逐模块影响）、`memory/ARCHITECTURE_DECISIONS.md` **ADR-021**。

---
## 12. Secure Enclave 生物断言与 Web3 意图接入规范（normative）

本章是**接口规范**而非愿景：设备能断言什么、网络接受什么、以及两者都不主张什么。它是 §2 / §4 / §5 的实现细则；任何与本章不一致的对外口径都按错误处理。

### 12.1 断言契约：设备能证明什么

术语必须先分清，否则整套叙述会滑向错误结论：

| 名词 | 含义 | 本仓库状态 |
| --- | --- | --- |
| **断言 (assertion)** | 设备用不可导出的硬件密钥对**一个挑战**签名，并声明“本人在场” | 接口层已落地：`app/src/lib/agent/webauthn.ts`、`mobile-agent/bio-auth/` |
| **交易签名 (transaction signature)** | 用账户私钥对交易 digest 签名，可广播上链 | **未接入**：Web 宿主没有飞地桥，`attemptSign` 返回拒绝 |

断言必须同时满足四条绑定，缺一不予采信：

1. **绑定到这一笔**：挑战就是这一笔交易的 digest，断言无法被复用到另一笔交易（`BiometricAuthorizationGate`）。
2. **来源一致**：断言回显的凭据 ID 必须与本机已注册的凭据一致。
3. **新鲜度**：断言带时间戳并做时钟偏移容忍；过期断言一律拒绝。
4. **用户在场**：`userVerification` 必须为真；只返回签名而 `userVerified` 为假时按失败处理（`BIO_*` 失败码）。

**为什么需要断言**：它是 M5 在设备侧的“具名”一半（§5.2）—— 链上 ZK 只回答“你是唯一的活体人类”，断言回答“现在操作的人是这台设备的持主”。

**断言不证明什么**（必须对外说清）：

- 不证明持有账户私钥 —— 断言的密钥与账户密钥无关；
- 不证明交易内容正确 —— 内容正确性由 M1 解析与 M2 策略负责，断言只覆盖“同一笔 digest”的完整性；
- 不证明 Web 宿主可信 —— 浏览器只是承载，真正的签名通道在设备侧 M2/M5 飞地。

### 12.2 零生物数据上云（跨界数据核对表）

生物特征**从不离开设备**；跨边界的只有断言本身：

| 数据 | 是否跨界 | 说明 |
| --- | --- | --- |
| 原始指纹 / 面容模板 | ❌ 永不 | 由系统生物识别子系统持有，应用层无法读取 |
| 断言（签名 + 凭据 ID + 计数器） | ✅ 仅此一项 | 不含任何生物特征信息，无法反推模板 |
| 待签摘要 (digest) | ✅ | 由服务端 M1/M2 生成，用于绑定断言 |
| 一次性 nullifier | ✅ | 由设备材料派生并做形状校验；链上 `nullifierUsed(bytes32)` 是权威 |

对应文案两种语言各写一次（`scripts/assert-runtime-policy.mjs` 断言其字面量）：`本地 Secure Enclave 芯片离线校验 | 零生物数据上云`。

### 12.3 Web3 意图接入规范

意图在四个阶段被逐级收窄，每一级都能单独拒绝，且**任一级拒绝都不产生签名**：

```
自然语言 ──M1──▶ 结构化 intent ──M2──▶ 策略判定 ──M5──▶ 生物断言 ──▶ 飞地签名 ──▶ 广播
            解析                  白名单/限额        本人在场        唯一签名出口
```

**M1 唯一语法**（`mobile-agent/slm/slm-engine.ts`，确定性 stub：无时钟、无 RNG）：

| intent | 语法 |
| --- | --- |
| 转账 | `transfer\|send\|pay <amount> eth to 0x<40 hex>` |
| 铸造 | `mint <amount> eth worth of [the] <name> token[s]` |
| 发行 | `create\|launch\|deploy [a] [new] [meme] token [named\|called] "<name>" [with [the] symbol "<SYM>"]` |

**语言规则**：UI **标签**随语言切换，**语法**不翻译。把 intent 句子翻译成另一种语言会得到一个被拒绝的输入，而不是同一个意图（ADR-040）。

**轻量适配器**（`app/src/lib/agent/web3-intent.ts`）识别两种句子，并且**只回答它读懂了什么**：

| grammar id | 语法 | 链 | `supported` |
| --- | --- | --- | --- |
| `tron-usdt-transfer` | `send\|tip <amount> usdt[-trc20] to T<33 base58>` | `tron` | **固定 `false`** |
| `uniswap-swap` | `swap <amount> <A> for <B>` | `evm` | **固定 `false`** |

`supported` 被**字面类型**钉死为 `false`：当前 M2 白名单是 manifest 的 EVM 目的地，TRON 腿与未列出的交易对走不到签名。适配器不归一化数字（`amount` 是原文数字）、不触网、不签名 —— 它把“读懂”与“能执行”分开表述。结算能力落地时，必须是 M1 + M2 的受审计扩展，而不是这个文件里的一个分支。

**链绑定**：策略携带 `chainId`；面向另一条链的请求是**拒绝**，不是提示。

### 12.4 网关接入契约（API index gateway）

网关（`gateway/`）归属三件“C 端不该自己做”的事：替钱包读链、维护 24h `SpendWindow` 账本、以及**唯一**能广播的路径。

| 路由 | 方法 | 作用 |
| --- | --- | --- |
| `/healthz` | GET | 存活；不读 manifest、不连节点 |
| `/v1/index` | GET | 生效配置：链、manifest、策略包络、账本、人格证明状态、读白名单、路由表 |
| `/v1/balance?address=` | GET | `latest` 原生余额（十进制 wei 字符串） |
| `/v1/history?address=&blocks=` | GET | 近期交易扫描（深度有硬上限） |
| `/v1/spend-window?owner=` | GET | 某 owner 的当前窗口：已用 / 上限 / 剩余 / 归零剩余秒数 |
| `/v1/rpc` | POST | `{ "method": ..., "params": [...] }`，**仅在读白名单内**才转发 |
| `/v1/broadcast` | POST | 唯一能移动价值的路径，走有序漏斗 |

**规划中的 C 端前置路由**：`POST /v1/send` 与 `POST /v1/swap` 见 §13.3 与 ADR-046；它们只做规划（不签名、不广播），当前尚未实现（⬜）。执行仍只经 `POST /v1/broadcast`。

**读白名单不能广播**：`eth_sendRawTransaction` **不在**白名单里，广播必须先过策略引擎 —— 这是“密钥不在网关、网关也不能自行把交易发出去”的结构保证。`scripts/maotang-smoke.mjs --gateway` 把这一条作为冒烟断言。

**统一信封**：所有路由（含失败路径）都答 `{ ok, code, message, detail }`；调用方**按 `code` 分支，绝不按 `message` 分支**。完整码表见 `gateway/README.md`。

**诚实边界**（是构建属性，不是待办，且写在响应里）：无签名恢复（`signerRecovery: "unavailable"`）、无哈希派生（Node 标准库无 keccak256，`hashDerived: false`）、不验证证明（`proofVerified: false`）、链上 nullifier 对账是运维步骤、账本是**单进程内存**、不做 CORS 终止。

**环境变量**（仅登记键名，真实值一律不得写入仓库）：

`MAOTANG_GATEWAY_{HOST,PORT,RPC_URL,CHAIN_ID,MANIFEST_PATH,HISTORY_BLOCKS,UPSTREAM_TIMEOUT_MS,MAX_BODY_BYTES,POLICY_MAX_VALUE_WEI,POLICY_WINDOW_WEI,POLICY_WINDOW_SECONDS,POLICY_THRESHOLD_WEI,POLICY_ALLOW_EXTRA_DESTINATIONS}`

其中两个**不是旋钮**：selector 白名单固定为已评审的三个入口，`requireHardwareBackedAuthorization` 恒为 `true`。

### 12.5 失败关闭核对表

| 条件 | 必须行为 | 由哪里保证 |
| --- | --- | --- |
| 没有待签摘要 | 不拉起生物识别，返回 `NO_CHALLENGE` | `app/src/lib/agent/biometric-session.ts` |
| 断言未确认用户在场 | 视为失败，不产生签名 | `app/src/lib/agent/webauthn.ts`、`mobile-agent/bio-auth/biometric-gate.ts` |
| 硬件飞地未接入 | **拒绝签名**，不回退软件密钥 | `mobile-agent/signer/`（默认 `HardwareEnclave` 拒绝一切） |
| 目标地址 / selector 不在白名单 | 拒绝，且不消耗窗口额度 | `mobile-agent/signer/policy.ts` |
| 超过单笔或窗口上限 | 要求硬件持主授权；未授权即拒绝 | `mobile-agent/signer/policy.ts` + M5 |
| 网关读白名单外的方法 | 拒绝，**不建立上游连接** | `gateway/src/json-rpc.ts` |
| manifest 缺失 / 无可用地址 | 目的地集合为空 → 拒绝一切 | `gateway/src/policy.ts` |
| 未配置出站白名单 | 不发包（而非默认放行） | `agent-manager` 的 fail-closed egress guard |
| ceremony key 未安装 | 证明校验一律失败；`lockVerificationKey()` 后不可逆冻结 | `contracts/src/Groth16Verifier.sol` |

> 关联：§2（钱包）、§4（轻节点）、§5（反女巫）、§7（隐私架构）、§12 的实现载体 `gateway/README.md`、`docs/WEB_AGENT_CONSOLE.md`、`scripts/maotang-smoke.mjs`。
---
## 13. 双模 C 端产品架构规范 (Dual-Mode Consumer Experience)（normative）

> **状态：🟡 部分实现（v3.3 Phase 2 Step 1–2 + P3）。** C 端 PWA（`app/`）已落地三 Tab 壳（Vault / DeChat / Agent）与 DeChat 本地预览面板；Vault / Agent 沿用 `ConsumerView` 的统一策略、Face ID 与签名流水线。服务端已接入 WebAuthn direct attestation 验证、链上一次性 claim 账本、Paymaster 票务 / 滚动配额读取与隐私最小化遥测端点。**DeChat 中继与 E2EE 传输、GES 的真实 bundler 结算与 calldata 绑定、抗群控原生桥（§17）仍为 ⬜，不得描述为已上线**；未配置 faucet / Paymaster 时接口返回 `503 ..._UNCONFIGURED`，不回退到静态票据。网关契约见 `docs/architecture/ADR-046-DUAL_MODE_C_END_SPEC.md`，三 Tab 决策见 `docs/architecture/ADR-047-MOBILE_DECHAT_GES_AND_ANTIFARM.md`。按 §0.2：**“已规定”不等于“已实现”**。

> **v3.3 导航扩展：** ADR-047 在 §13 的 Vault / Agent 双模安全流水线上增加 **DeChat** 作为第三个一等 Tab；权限、intent digest、Local Policy、Face ID 断言与 broadcast 出口完全不变。三 Tab 底栏与 DeChat 本地预览 UI 已在 Phase 2 Step 1–2 落地；claim 账本、服务端 WebAuthn 验证与 Paymaster 票务层已实现但依赖未配置的链上基础设施。DeChat 中继 / E2EE 传输、GES 的真实结算与抗手机集群原生桥仍为 ⬜，不得描述为已上线。

### 13.0 设计公理 (Design axioms)

| 公理 | 规定 | 可验收后果 |
| --- | --- | --- |
| **A1 默认面只回答“我有多少、要做什么”** | 首屏是资产金库，不是 AI 控制台 | 首屏不出现策略码表、模型状态、创世参数 |
| **A2 复杂度后置，权限不前移** | AI 意图、策略日志、创世铸造收进二级“AI 节点” | 两个模式共用同一 Local Policy、同一生物门禁、同一签名与广播出口 |
| **A3 数据缺失就说缺失** | 任何余额、估值、报价没有服务端来源时显示“未接入 / 不可用” | 不得用 0、1:1、示例价或本地估算填充 |

| 维度 | Vault View（默认） | Agent Console View（进阶） |
| --- | --- | --- |
| 入口 | `/` 首屏 | 二级“AI 节点”Tab；深链 `/agent` |
| 用户问题 | 我有多少资产？转 / 收 / 兑怎么操作？ | AI 读懂了什么？为什么被拦？配额与创世状态？ |
| 首次进入 | 直接可见 | 需显式切换；偏好可记忆 |
| 权限 | 与进阶面完全相同 | 与默认面完全相同 |
| 状态 | 🟡 部分（`WalletPanel` 前身） | 🟡 部分（`ConsumerView` / `DeveloperConsoleView` 前身） |

### 13.1 默认视图：Bitcoin.com 范式资产金库 (Vault View)

**信息层级（MUST，自上而下）**：

1. **总估值**：唯一的主数字，默认 USD；旁边的更新时间必须可见。
2. **资产列表**：固定三行 —— `USDT`、`ETH`、`MaoMao`；每行至少显示符号、余额、估值。
3. **三大动作**：`Send / Receive / Swap`，固定顺序，触控目标 ≥ 48px，底部留 `env(safe-area-inset-bottom)`。
4. **二级入口**：仅一个“AI 节点”入口；不得在首屏再放第二个产品入口或营销位。

**资产行语义（防止把配额当币）**：

| 行 | 数据来源 | 当前能力 | 规定 |
| --- | --- | --- | --- |
| `ETH` | 网关 `GET /v1/balance?address=`（原生 wei） | ✅ 只读 | 余额与估值分开；估值缺报价时显示“估值不可用” |
| `USDT` | 需 ERC-20 / TRC-20 余额源；当前 `/v1/balance` 只返回原生余额 | ⬜ 未接入 | 未接入时整行标注“未接入”，不得显示 0 或假价 |
| `MaoMao` | ADR-045 消费面计价单位（`YuanYuan : MaoMao : FenFen = 1 : 10 : 100`）；若清单中存在可转让 `MaoMao` 代币，则以清单地址为准 | ✅ 配额只读 / ⬜ 代币未部署 | `kind: "quota"` 时只展示与铸造，不提供 Send/Swap；`kind: "token"` 时才按代币动作处理 |

**三大动作的规范**：

| 动作 | 规定 | 明确不做 |
| --- | --- | --- |
| **Send** | 地址 + 金额；本地语法校验通过前按钮禁用；确认后走 §13.3 全流水线 | 不直接广播、不跳过复核页、不缓存授权 |
| **Receive** | 展示清单持主账户；复制地址；二维码只能由前端从同一地址生成 | 不在设备上派生新地址；不向第三方索取二维码 |
| **Swap** | 能力未落地时打开“不可用”说明页，并显示本地适配器的 `supported: false` | 不显示假报价、不构造假交易、不承诺兑换时间 |

**视觉规范：浅色高档粉红磨砂玻璃 (Pink Glassmorphism)**：

| Token | 值 | 用途 |
| --- | --- | --- |
| `--color-maotang-rose` | `#FFB6C1` | 主强调、动作描边、选中态 |
| `--color-maotang-rose-deep` | `#E07F96` | 按下态、次级强调 |
| `--color-maotang-rose-surface` | `#FFF5F7` | 页面底色与 PWA splash |
| `--color-maotang-card` | `rgba(255, 240, 243, 0.65)` | 玻璃卡片表面 |
| `--color-maotang-ink` | `#0A0A12` | 主文本 |
| `--color-maotang-sparkle` | `#FFD9E2` | 高光与分隔 |

- **玻璃只做容器**：`backdrop-filter: blur(16–24px)` + 1px 半透明白边 + 20–28px 圆角 + 柔和阴影；玻璃层数 ≤ 2。
- **数字必须落在实底**：余额、估值、地址不得直接压在模糊背景上。
- **对比度**：正文与按钮文本达到 WCAG AA；粉底上不使用纯白小字。
- **降级**：`prefers-reduced-transparency: reduce` → 使用不透明 `#FFF5F7`；`prefers-reduced-motion: reduce` → 关闭浮动、视差与脉冲。
- **禁止**：霓虹紫、深色赛博、彩色渐变堆叠、卡通猫贴纸铺满首屏。品牌是“高档粉红玻璃”，不是“粉色游戏大厅”。
- **PWA**：`theme_color` / `background_color` 使用 `#FFF5F7`；离线只缓存界面壳，任何金额标注“离线 / 最后更新 HH:mm”，动作禁用。

### 13.2 进阶视图：AI 意图与策略控制台 (Agent Console View)

“AI 节点”是**二级模式**，不是默认首页，也不是第三个并列主页。它收拢三个面板：

| 面板 | 内容 | 规定 |
| --- | --- | --- |
| **意图对话 (Intent)** | 自然语言输入、预设语句、解析结果、确认页 | 只翻译标签，不翻译语法；提交仍走同一 M1/M2 管线 |
| **策略拦截日志 (Policy Log)** | 本次会话的拒绝记录：时间、来源、阶段、稳定 `code`、意图摘要、判定 | 只在内存中保留；默认不落盘、不上传；按 `code` 展示，不以 `message` 为准 |
| **创世铸造 (Genesis Mint)** | ADR-045 配额账本、Vesting 进度、epoch 时钟、铸造入口 | 只读数字必须有服务端来源；铸造动作同样走 §13.3，不得有“控制台专用捷径” |

**模式规则（MUST）**：

- 首次访问默认 Vault；只有显式切换才进入 Agent Console；偏好可记忆，但深链 `/agent` 优先。
- 切换模式**不得**改变账户、不得重置 24h 窗口、不得复用上一次的生物授权。
- Agent Console 中任何可能移动价值的动作，都必须出现与 Vault 相同的确认页与 Face ID 步骤。
- 工程师 / 审计控制台（`DeveloperConsoleView`）是**运维面**，不属于 C 端三 Tab：不出现在 C 端一级导航，保留深链与文档入口。
- 策略日志中的地址使用短十六进制；不得显示任何密钥或完整生物断言；原始提示词只在本次会话内可见。

### 13.3 统一安全流水线 (Unified Security Pipeline)

**无论入口是 GUI 按钮还是 AI 意图，只有一条执行链**：

```
Vault 按钮 ──┐
             ├──▶ 规范化 Intent ──▶ Local Policy ──▶ Face ID (Secure Enclave) ──▶ Gateway Broadcast
AI 意图 ─────┘        (M1/M2)          (M2)            (M5 断言绑定 digest)          (唯一广播路径)
```

| 阶段 | 输入 | 必须通过 | 拒绝时 | 证据 |
| --- | --- | --- | --- | --- |
| **0 来源标记** | `origin: "vault" \| "dechat" \| "agent"` | 仅用于审计与日志 | — | 不参与任何授权判定 |
| **1 规范化 Intent** | 自然语言或表单字段 | `chainId`、`to`、`valueWei`（十进制字符串）、selector、`data` 形状合法 | `UNSUPPORTED_REQUEST`（解析失败） | M1 语法与 `web3-intent.ts` |
| **2 Local Policy** | 规范化 Intent | 目的地在清单白名单；单笔上限；24h 窗口；人格配额未冻结 | `DESTINATION_NOT_ALLOWED` / `AMOUNT_OUT_OF_BOUNDS` / `WINDOW_CAP_EXCEEDED` / `QUOTA_SLASHED` | `mobile-agent/signer/policy.ts` |
| **3 Face ID / Secure Enclave** | 待签 `digest` | 用户在场；断言绑定本笔 digest；新鲜；凭据匹配；硬件支持 | `BIO_*` | `webauthn.ts`、`biometric-gate.ts` |
| **4 飞地签名** | 已授权 digest | 只由硬件飞地密钥签名；无软件回退 | `EnclaveUnavailableError` | `mobile-agent/signer/` |
| **5 Gateway Broadcast** | 已签名 raw tx + intent + personhood | 网关重新校验策略、窗口、人格 nullifier；raw tx 字段与 intent 一致 | `POLICY_DENIED` / `AUTHORIZATION_NOT_HARDWARE_BACKED` / `PERSONHOOD_*` / `INTENT_MISMATCH` | `gateway/src/broadcast.ts` |
| **6 回执** | 广播结果 | `ok: true` 才显示交易哈希；不把“已广播”说成“已确认” | — | `BroadcastResult` |

**不可协商的不变量（MUST）**：

1. `origin` **永不授予权限**；GUI 与 AI 的唯一区别是入口和日志，不是校验强度。
2. **策略先于生物识别**：策略会拒绝的请求不得先弹 Face ID，避免用生物识别为无效请求背书。
3. **一次动作一个 digest**：地址、金额、链、nonce、data 任一变化，旧断言立即失效。
4. **生物识别不产生交易签名**：Face ID / Touch ID 只产生设备持主断言；交易签名只由 M2 飞地密钥完成（§12.1）。
5. **Receive 是只读动作**：不触发策略、不触发生物识别、不产生交易。
6. **失败是值，不是异常**：两个模式都按稳定 `code` 分支；Vault 显示友好摘要 + 可展开代码，Agent Console 显示完整阶段与 `detail`。
7. **相同参数必须得到相同 digest**：GUI 表单与 AI 语句在规范化后必须逐字段一致；这是重构的黄金测试。

**诚实边界（必须写进 UI 与文档）**：

- 网关**不验证** Face ID 断言本身（`verifiedByGateway: false`），只记录 `authorization` 声明并执行策略 / 人格检查。
- Web 宿主当前没有飞地桥，`attemptSign` 会拒绝；不得显示“已签名”或绿色成功态。
- 网关没有 keccak256 派生（`hashDerived: false`），也不做签名恢复（`signerRecovery: "unavailable"`）。
- 24h 账本是单进程内存；跨实例一致性尚未实现，UI 不得把它描述为链上额度。
- `/v1/send`、`/v1/swap` 是 ADR-046 规划的前置路由；当前唯一能移动价值的路由仍是 `POST /v1/broadcast`。

### 13.4 验收（规范级，代码重构后执行）

| 编号 | 断言 | 方法 |
| --- | --- | --- |
| **V1** | 首屏是 Vault；首屏无策略码表、模型状态、创世参数 | 截图 / DOM 断言 |
| **V2** | 相同参数的 GUI 表单与 AI 语句产生逐字段相同的 Intent 与 digest | 黄金向量测试 |
| **V3** | 策略拒绝时两个模式返回同一 `code`，且不弹 Face ID、不消耗窗口 | 拒绝路径测试 |
| **V4** | 取消 Face ID 后无签名、无广播、窗口不变 | 浏览器 / 设备测试 |
| **V5** | 无飞地桥时明确拒绝，无软件密钥回退 | `npx tsc --noEmit` + 运行时探针 |
| **V6** | 数据缺失时显示“未接入 / 不可用”，不出现伪造数字 | 断网 / 空 manifest 测试 |
| **V7** | EN 视图无 CJK；标签全部来自字典 | `assert-runtime-policy.mjs` |
| **V8** | 粉红玻璃在 `prefers-reduced-transparency` 下退化为不透明表面 | 视觉回归 |

> 关联：§2（钱包）、§5（反女巫）、§12（断言与网关契约）、§0.2（文档纪律）、`docs/architecture/ADR-046-DUAL_MODE_C_END_SPEC.md`、`docs/WEB_AGENT_CONSOLE.md`。

---
## 14. 移动端纯硬件安全公理 (Mobile-Only Hardware Security Principle)（normative）

> **状态：公理已采纳；当前实现为 🟡（WebAuthn 平台认证器已接入，原生硬件桥与设备完整性证明 ⬜）。** 本章是产品与工程的门禁：MAOTANG **不提供 PC 金库客户端**，也不允许 PC 浏览器、桌面扩展或云端签名服务持有、派生或代签主人的金库密钥。PC 浏览器仅可作为只读文档 / 审计入口；任何会移动价值的动作必须在移动设备上完成。

### 14.0 五条不可协商的公理 (The five axioms)

| 编号 | 公理 | 可验收后果 |
| --- | --- | --- |
| **A14.1 硬件根信任** | 金库签名密钥只能在移动设备的 Secure Enclave / StrongBox / 受 TEE 保护的 Keystore 内生成，并保持**不可导出**。 | 私钥不以明文、密文、分片或“可恢复备份”的形式离开设备；服务端与 PC 均无签名能力。 |
| **A14.2 生物识别只做在场断言** | Face ID / Touch ID / Android BiometricPrompt 只证明“本人在场并同意本次动作”，**不产生交易签名**。 | 生物断言绑定本次 intent digest；交易签名由 M2 飞地密钥单独完成，两者不可互相替代。 |
| **A14.3 断言必须可验证** | 接受方验证的是硬件签名、挑战、计数器 / 新鲜度与设备完整性结论，而不是客户端上报的布尔值。 | 任何 `verified: true` 之类的自报字段都不构成授权；网关必须能指出验证的密钥与挑战。 |
| **A14.4 失败关闭** | 硬件飞地、平台认证器、设备完整性或活体信号任一必需项不可用时，高价值动作拒绝，**不得回退到软件密钥**。 | 无飞地桥时 `attemptSign` 明确拒绝；无 Face ID 时不出现“已签名”或绿色成功态。 |
| **A14.5 移动端是攻击面决策** | 纯移动端不是 UI 偏好，而是把密钥、生物识别与设备证明收敛到可控硬件边界的产品决策。 | 新增 PC 客户端、浏览器扩展签名器或云托管签名器均视为架构违规，必须另立 ADR 并重新评估威胁模型。 |

### 14.1 为什么必须是纯移动端 (Why mobile-only)

PC 端的根本问题不是“操作系统不够好用”，而是**默认没有可依赖的硬件金库**：

| 维度 | PC 端现实 | 移动端硬件根 |
| --- | --- | --- |
| 密钥驻留 | 私钥通常进入进程内存、磁盘文件或浏览器扩展存储；信息窃取木马可在解密后读取 | Secure Enclave / StrongBox 生成并持有不可导出密钥；应用只能请求签名，不能读出密钥 |
| 生物绑定 | Windows Hello 等能力依赖机型与策略，不能把“有生物识别”当作普遍前提 | Face ID / Touch ID / BiometricPrompt 与安全芯片、锁屏状态和用户验证标志协同 |
| 设备证明 | PC 硬件与系统组合高度碎片化，难以形成稳定的 attestation 根 | iOS DCAppAttest、Android Play Integrity 提供可验证的应用 / 设备完整性结论 |
| 物理在场 | 远程桌面、自动化脚本与剪贴板劫持可把“点击”与“本人在场”分离 | 生物识别与设备持有状态共同提高远程代签成本；仍须叠加 §17 的活体与反群控 |
| 恶意软件面 | 桌面系统是信息窃取木马、扩展劫持与内存抓取的主要战场 | 移动端沙箱、代码签名与安全启动显著收窄持久化与内存读取面；越狱 / Root 仍须拦截 |

因此，MAOTANG 的选择是：**把“能签名的东西”收缩到手机硬件安全域，把 PC 从信任边界中移除。** 这不是说手机天然安全；§17 会明确处理云手机、模拟器、越狱、ADB 自动化与设备农场。纯移动端只解决“密钥在哪里”，不自动解决“操作者是不是人”。

### 14.2 运行时信任边界 (Runtime trust boundary)

| 层 | 职责 | 可以接触 | 绝不能接触 |
| --- | --- | --- | --- |
| **硬件安全域** | 生成不可导出密钥、执行生物门禁后的签名、保存单调计数器 | 金库私钥、设备密钥、受限的签名操作 | 原始生物模板、云端请求明文、PC 文件系统 |
| **原生移动壳 (native shell)** | 调用 `DCAppAttestService` / Play Integrity、`LocalAuthentication` / `BiometricPrompt`、TrueDepth 与陀螺仪采样 | 设备证明、活体结论、传感器特征 | 金库私钥明文、完整聊天明文、原始深度图 / 传感器轨迹上传 |
| **PWA `app/`** | 资产展示、DeChat UI、意图输入、策略日志、确认页 | 服务端状态、脱敏后的设备结论、当前 intent digest | 私钥、原始生物数据、可伪造的“已验证”布尔值 |
| **网关 `gateway/`** | 策略复核、人格 / 设备证明验证、广播 | 已签交易、证明摘要、必要的审计元数据 | 私钥、生物模板、聊天明文 |
| **链上合约** | 资产、注册表、nullifier、奖励与销毁记账 | 公开状态与证明 | 任何链下秘密 |

**端口纪律**：PWA 只能通过原生壳暴露的**窄接口**获得结论，例如 `DeviceIntegrityClaim`、`LivenessClaim`、`OwnerAssertion`。原生壳不得把私钥、原始传感器数组或生物模板交给 WebView；WebView 也不得把“我检查过了”当作证明。

### 14.3 当前实现与目标差距 (Current implementation vs. target)

| 能力 | 当前状态 | 代码 / 事实 | 目标 |
| --- | --- | --- | --- |
| 平台认证器与 Face ID 断言 | 🟡 已接入 | `app/src/lib/agent/webauthn.ts` 使用 `userVerification: "required"`，平台认证器缺失时返回 `NO_PLATFORM_AUTHENTICATOR` | 保持；所有支付与高风险动作必须经过该断言 |
| 设备持主绑定 | 🟡 部分（服务端判定） | `OwnerAssertion.hardwareBacked` 由服务端从 WebAuthn attestation 推导：`fmt !== "none"` 且 `deviceType === "singleDevice"`；客户端布尔值不参与判定。它仍不等于 DCAppAttest / Play Integrity 的设备完整性结论 | 由原生 DCAppAttest / Play Integrity 补充设备与应用完整性 |
| WebAuthn attestation | 🟡 已请求并验证 `direct` 证明 | `enrollOwnerCredential()` 请求 `attestation: "direct"`；`/api/agent/webauthn/register/verify` 与 claim route 使用 `@simplewebauthn/server` 验证 `clientDataJSON` / `authenticatorData` 签名，要求 `userVerified: true`，并拒绝 `fmt === "none"`。证明链的信任根仍是平台 / 硬件，且不等于原生 App Attest / Play Integrity | 生产环境叠加原生 attestation；WebAuthn 证明链只作为补充信号 |
| 一次性 claim 账本 | 🟡 已实现（链上映射） | `MaotangFaucet.identityHash => ClaimRecord` 在合约内保证同一 credential 只能 claim 一次；`/api/agent/claim` 在提交前再次检查 `hasClaimed`。Root / 越狱设备仍可新建第二个 credential | 部署真实 faucet，并由原生设备绑定与完整性证明补上“一台物理设备”这一层 |
| 金库签名飞地 | ⬜ 拒绝式默认 | `HardwareEnclave` 在未注入真实后端时拒绝签名；Web 宿主没有飞地桥 | 原生安全域内的 P-256 / secp256k1 签名适配器，失败关闭 |
| 传感器活体 | ⬜ 未实现 | PWA 无 TrueDepth 深度图或可靠的高频陀螺仪通道 | 原生 `DeviceLivenessProbe`，只上报结论与特征摘要 |
| 设备完整性 | ⬜ 未实现 | 当前无 DCAppAttest / Play Integrity 调用 | 原生 `DeviceIntegrityGate`，按 §17.1 分级放行 |

> **文档纪律**：在上述目标能力落地前，白皮书与 UI 不得使用“硬件金库已完全实现”“PC 端已被密码学禁止”等超出事实的表述。正确表述是：**协议已把移动端硬件定为唯一金库运行环境；当前 Web 边缘已能服务端验证平台认证器的 direct attestation 与用户验证标志，但原生设备完整性 / 活体桥仍为路线图，且 WebAuthn 证明不等于 DCAppAttest / Play Integrity。**

### 14.4 残余风险 (Residual risks)

| 残余风险 | 说明 | 缓解 |
| --- | --- | --- |
| 已解锁设备被接管 | 攻击者拿到已解锁手机，或利用无障碍 / 辅助功能滥用 | 超阈值二次确认、动作级 digest、异常交易冷却、设备锁定与远程吊销 |
| 越狱 / Root / 云手机 | 操作系统完整性被破坏，传感器与 WebAuthn 结论可能被注入 | §17.1 的设备完整性分级；高风险动作要求强完整性结论 |
| 供应链与固件后门 | 安全芯片实现、维修环节或恶意固件可能破坏假设 | 出厂 attestation、固件版本策略、最小化飞地代码、可验证引导 |
| 生物特征欺骗 | 高保真面具、视频回放、深度换脸 | §17.2 的 TrueDepth 3D + 随机挑战 + 陀螺仪微动组合；单一模态不得单独放行 |
| 胁迫与失能 | 强制解锁、用户无法完成活体动作 | 胁迫密码、时间锁、社交恢复 / 继承计划；无障碍替代路径 |
| 中继与元数据 | 纯移动端不隐藏“谁在何时给谁发消息” | §15 的 E2EE 与最小化元数据；必要时引入密封发送与中继分层 |

### 14.5 验收（规范级）

| 编号 | 断言 | 方法 |
| --- | --- | --- |
| **M14.1** | 仓库中不存在 PC 金库客户端、桌面扩展签名器或云端代签路径 | 代码搜索 + 架构评审 |
| **M14.2** | 无平台认证器时，高风险动作返回稳定错误码且不产生签名 | 浏览器 / 设备测试；检查 `BIO_*` 与 `EnclaveUnavailableError` |
| **M14.3** | `OwnerAssertion.challenge` 必须等于 M2 intent digest；任一字段变化使旧断言失效 | 黄金向量测试 + 篡改测试 |
| **M14.4** | 原生壳未提供设备完整性结论时，新陌生人支付 / 高价值动作拒绝，不回退软件密钥 | 设备农场模拟 + 断桥测试 |
| **M14.5** | 原始深度图、陀螺仪轨迹与生物模板不出现在网络请求、日志或分析事件中 | 网络抓包 + 日志审计 |

> 关联：§5（Bio-Sovereign Anti-Sybil）、§12（断言与网关契约）、§13（双模 C 端）、§17（抗手机集群）、`docs/architecture/ADR-047-MOBILE_DECHAT_GES_AND_ANTIFARM.md`。

---
## 15. 去中心化通讯协议规范 (DeChat Specification)（normative）

> **状态：🟡 部分实现（会话本地预览）。** `app/src/components/console/DeChatPanel.tsx` 已落地三 Tab 中的 DeChat 入口：从 manifest owner 派生 `<wallet-prefix>.008ai` 展示身份，渲染本地消息气泡、Chat-to-Pay 卡片与文字输入；所有支付仍汇入 `ConsumerView.submit` 的统一策略 / Face ID / 签名流水线。**没有中继、没有 E2EE 传输、没有设备端加密存储**，消息不跨设备投递。本章其余部分（密钥层级、加密信封、状态机、Agent P2P）仍为**目标契约**；任何“端到端加密已上线”的对外表述都按 §0.2 视为错误。DeChat 不是“带钱包的聊天软件”，而是**以钱包地址为身份、以硬件飞地为密钥根、以消息为支付意图载体**的通讯层。

### 15.0 设计目标 (Design goals)

| 目标 | 规定 | 非目标 |
| --- | --- | --- |
| **身份即钱包** | 唯一身份是钱包地址；手机号、邮箱、用户名、设备 ID 都不是主身份 | 不做中心化账号体系，不把手机号映射当作身份 |
| **端到端机密** | 只有会话双方（或双方授权的 agent）能解密消息正文与附件 | 中继、网关、运营方不读取明文；不做服务端内容审核式扫描 |
| **聊天内支付** | 消息可携带支付意图；接收方轻触并通过 Face ID 后结算 | 消息本身不能直接移走资金；不自动扣款 |
| **Agent 可通讯** | AI 智能体拥有可审计、可限权的专属 P2P 通道 | Agent 不得持有主人金库私钥，不得代替主人批准支付 |
| **元数据最小化** | 只暴露完成路由所必需的字段；默认不持久化明文 | 不承诺“元数据零泄露”；中继仍可见时间、大小与地址 |

### 15.1 身份与密钥层级 (Identity and key hierarchy)

**身份即钱包 (Identity = Wallet Address)**：`walletAddress` 是 `keccak256(secp256k1 public key)` 的最后 20 字节，规范化为小写 `0x` 地址。它是 DeChat 的唯一主身份，也是支付、Agent 注册与信誉记录的锚点。地址不等于某一把设备密钥；设备密钥可以轮换，地址保持不变。

| 密钥 / 标识 | 所在位置 | 用途 | 约束 |
| --- | --- | --- | --- |
| `walletAddress` | 公开 | 身份、收款、Agent 归属、消息签名者标识 | 不可由手机号 / 邮箱替代；展示时必须完整可核对 |
| `walletKey` (secp256k1) | 移动安全域 | 链上交易签名、身份绑定签名 | 不可导出；不得用于消息内容加密 |
| `deviceKey` (P-256) | Secure Enclave / StrongBox | 设备证明、DeChat profile 签名、密钥轮换授权 | 每设备独立；丢失可吊销，不改变 `walletAddress` |
| `chatKey` (P-256 ECDH) | 移动安全域 | 与会话方协商对称密钥 | 只做 ECDH；不得把私钥写入 WebView |
| `agentKey` | 移动安全域或受控 Agent 运行时 | Agent 消息签名与任务回执 | 由 `AIAgentRegistry` 限定作用域；不可签主人转账 |
| `sessionKey` | 内存，短生命周期 | AES-256-GCM 会话加密 | 由 ECDH + HKDF 派生；超时、换设备或换会话即销毁 |

**身份绑定**：设备首次启用 DeChat 时，设备生成 `deviceKey` 与 `chatKey`，并发布 `DeChatProfile`：

```text
DeChatProfile {
  walletAddress,
  deviceKeyId,
  devicePublicKey,
  chatPublicKey,
  deviceIntegrityClaimHash,
  issuedAt,
  expiresAt,
  keyEpoch,
  walletSignature
}
```

`walletSignature` 必须覆盖 profile 的规范序列化结果。接收方只信任“钱包地址签名的 profile + 当前 `keyEpoch` 未吊销”的组合；单个设备密钥不能自证身份。

**轮换与恢复**：新设备发布更高 `keyEpoch` 的 profile，并由旧设备密钥或钱包密钥签名。旧 epoch 在链下 / 网关侧进入吊销表；历史消息仍可用旧会话密钥解密，但新消息必须使用新 epoch。地址永不改变，避免“换手机就换身份”。

### 15.2 端到端非对称加密 (E2EE)

**密码套件（目标基线）**：

- 密钥协商：P-256 ECDH（Secure Enclave / StrongBox 原生支持；如后续引入 X25519，必须保留 P-256 兼容路径）。
- 密钥派生：HKDF-SHA-256，输入包含 `walletAddress` 双方、`keyEpoch`、`sessionId` 与协议版本。
- 内容加密：AES-256-GCM，96-bit 随机 nonce；同一密钥下 nonce 绝不复用。
- 消息签名：设备 `deviceKey` 的 ECDSA P-256；钱包层交易仍使用 secp256k1。
- 附件：随机 256-bit 内容密钥加密附件，内容密钥再用会话密钥封装；附件哈希进入消息 AAD。

**前向保密与后向保密**：每个会话至少使用一次临时 ECDH；长会话使用 ratchet 链，按消息推进密钥。会话密钥不得跨设备复用，不得写入 `localStorage`。设备锁屏超时、应用退到后台超过阈值或用户主动锁定后，内存会话密钥必须清零。

**加密信封 (Envelope)**：

| 字段 | 说明 |
| --- | --- |
| `version` | 协议版本，未知版本拒绝而非猜测 |
| `messageId` | 发送方生成的唯一 ID；用于幂等与重放拒绝 |
| `sender` / `recipient` | `walletAddress`；不是手机号或昵称 |
| `senderDeviceKeyId` / `recipientDeviceKeyId` | 设备级路由与轮换 |
| `sessionId` / `counter` | 会话与单调计数器；接收方维护滑动窗口 |
| `contentType` | `text` / `attachment` / `payment_request` / `payment_receipt` / `agent_task` / `agent_result` |
| `ciphertext` / `nonce` | AES-256-GCM 输出 |
| `aad` | 规范化的头部字段、`messageId`、时间戳与附件哈希 |
| `signature` | 发送设备对信封头的签名 |
| `createdAt` / `expiresAt` | 时间窗；过期支付意图不得执行 |

**拒绝规则**：重复 `messageId`、计数器回退、签名不匹配、AAD 不匹配、未知 `keyEpoch`、过期信封、收件人设备密钥与 profile 不一致，全部拒绝并记录稳定错误码（如 `DECHAT_REPLAY`、`DECHAT_BAD_SIGNATURE`、`DECHAT_STALE_EPOCH`）。拒绝是值，不是异常；UI 必须显示可理解的失败原因。

**元数据边界**：中继可以看到 `sender`、`recipient`、时间、信封大小与路由标签；看不到正文、附件内容或支付金额（除非支付意图本身需要公开结算）。需要隐藏社交图时，后续可增加密封发送（sealed sender）与混合网络；本章不宣称已具备。

### 15.3 Chat-to-Pay（聊天内支付）

**目标体验**：对方在聊天里发来一个付款请求气泡；主人轻触气泡，看到金额、资产、链、收款地址与手续费来源；点击确认后弹出 Face ID；通过后由飞地签名并广播；聊天里出现不可篡改的回执。

**规范流程**：

1. **构造支付意图**：`PaymentIntent { intentId, from, to, asset, amount, chainId, memo, expiresAt, messageId }`。`from` 必须是当前 `walletAddress`，`to` 必须与消息发送方 profile 的地址一致。
2. **规范化与 digest**：客户端把支付意图规范化为与 Vault Send 相同的字段顺序，计算 M2 intent digest。GUI 表单与聊天气泡必须得到逐字段相同的 digest。
3. **策略先行**：先跑 Local Policy（余额、限额、目的地址、链、频率、人格 / 设备完整性）。策略拒绝时**不得弹 Face ID**，也不得消耗 24h 窗口。
4. **生物断言**：策略通过后，用户轻触触发 `useBiometricOwner().authorize(digest, reason)`；`reason` 只描述本次动作，不包含完整敏感内容。该调用必须直接来自点击处理器，不能放在 `await` 之后。
5. **飞地签名**：`OwnerAssertion.userVerified === true` 且 `challenge === digest` 后，M2 `HardwareEnclave` 对 digest 签名；WebAuthn 断言本身不是交易签名。
6. **广播与回执**：网关复核策略、窗口、人格 / 设备证明与原始交易和 intent 的一致性；成功后发送 `payment_receipt` 消息，包含 `txHash`、`intentId`、`settledAt` 与链 ID。

**硬性规则**：

| 规则 | 原因 |
| --- | --- |
| 消息作者不能仅凭发送 `payment_request` 移走资金 | 支付必须由付款方显式确认 + 生物断言 + 飞地签名 |
| 支付意图必须绑定 `messageId` 与 `expiresAt` | 防止旧请求被重放或长期挂起 |
| 收款地址必须与发送方 `walletAddress` 或已签名的收款 profile 一致 | 防止聊天账号与收款地址分离攻击 |
| 金额、资产、链、nonce、data 任一变化都使旧 digest 失效 | 防止确认页与真实交易不一致 |
| 失败 / 取消 / 超时必须显示为失败，不得乐观显示“已支付” | 失败是值，不是异常 |
| 不提供“免确认自动支付”开关 | Chat-to-Pay 的核心是主人逐笔授权；自动扣款必须另立 ADR 并重新做威胁建模 |

**状态机**：`draft -> sealed -> delivered -> read -> payment_requested -> authorized -> broadcast -> settled`；任一阶段可进入 `expired` / `rejected` / `failed`。`authorized` 不等于 `settled`；UI 必须区分“已授权”“已广播”“已确认”。

**当前实现边界（2026-10-17）**：DeChat 面板只做会话内支付意图预览；轻触转账卡片会把英文 M1 句子交给 `ConsumerView.submit`，由后者执行策略、Face ID 和既有 broadcast 路径。面板不会自行签名、不会直接调用 `/v1/broadcast`，也不会伪造 `payment_receipt`。

### 15.4 AI 智能体专属 P2P 通道 (Agent P2P channel)

AI Agent 不是主人的“第二个钱包”，而是一个**受限的通讯与执行代理**。它拥有独立的 `agentKey`，在 `AIAgentRegistry` 中注册，并由主人授予能力范围（例如“只读余额”“可提议转账”“可执行白名单合约”）。

| 项目 | 规范 |
| --- | --- |
| 通道标识 | `dechat://agent/<agentAddress>`；`agentAddress` 由 agent 公钥确定性派生，并绑定主人地址 |
| 传输 | 优先直连 P2P（WebRTC / libp2p）；不可直连时使用加密中继存储转发；中继只转发密文 |
| 消息类型 | `agent_task`、`agent_result`、`agent_proposal`、`agent_receipt`、`presence` |
| 授权 | 每条任务携带能力凭证与过期时间；超出 scope 的任务拒绝 |
| 支付 | Agent 只能生成 `payment_request` 或 `agent_proposal`，**不能**代替主人调用 `authorize` |
| 频率 | 按主人 / agent / 对端三元组限流；陌生人首次建联走 §17.4 |
| 审计 | 任务、结果、拒绝码与支付提案进入本地策略日志；不记录明文私钥或生物数据 |

**Agent 通道不变量**：`agentKey != walletKey`；Agent 消息签名不能用于链上转账；Agent 不能读取主人的 DeChat 历史，除非主人显式授权单个会话；Agent 的远程模型输出不得直接成为已签名交易，必须先经过 M1 schema 校验与 M2 policy。

### 15.5 验收（规范级）

| 编号 | 断言 | 方法 |
| --- | --- | --- |
| **D1** | 同一 `walletAddress` 在换设备后仍能收发新消息；旧 epoch 被吊销 | 双设备轮换测试 |
| **D2** | 中继 / 网关无法解出消息正文与附件 | 抓包 + 密文熵检查 |
| **D3** | 篡改 AAD、签名、计数器或 `messageId` 均被拒绝 | 篡改向量测试 |
| **D4** | Chat-to-Pay 的 GUI 表单与聊天气泡生成相同 digest | 黄金向量测试 |
| **D5** | 策略拒绝不弹 Face ID；取消 Face ID 不产生签名 / 广播 | 拒绝与取消路径测试 |
| **D6** | Agent 不能签主人转账，超 scope 任务返回稳定拒绝码 | 权限矩阵测试 |
| **D7** | 原始明文、生物数据、会话密钥不进入日志 / 分析 / 备份 | 日志与存储审计 |

> 关联：§2（钱包）、§5（反女巫）、§12（断言与网关契约）、§13（Chat-to-Pay 的 Vault 入口）、§16（Gas 抽象）、§17（陌生人建联与反群控）、`docs/architecture/ADR-047-MOBILE_DECHAT_GES_AND_ANTIFARM.md`。

---
## 16. 五层渐进式零感 Gas 方案 (5-Tier GES Specification)（normative）

> **状态：🟡 G0 代码已落地但未上线；G1–G4 仍为规范。** `contracts/src/MaotangPaymaster.sol` 已实现 ERC-4337 v0.7 Paymaster 验证入口、EIP-712 单次授权、100 次精确滚动 24h 配额、暂停与可选 allowlist；`app/src/lib/agent/paymaster.ts` 与 `/api/agent/paymaster/{quota,authorization}` 已能从链上读取配额并签发单次票据。**但没有已配置的 Paymaster 部署、EntryPoint 存款或 bundler，且票据尚未绑定目标合约 / selector / calldata，因此当前不能宣传为可用的零 Gas 赞助。** G1–G4 仍为 ⬜ 规范。GES = **Gasless Execution Stack（零感 Gas 执行栈）**。“零感”指主人不需要理解 gas、ETH 余额、nonce 或 bundler；**不等于零成本**，也不等于所有动作永久免费。五层是**可组合的渐进层**，不是五个互斥套餐：按动作风险、频率与身份状态选择最小可行组合，任何一层都不能绕过 M2 policy 与 M5 生物门禁。

### 16.0 不变量 (Invariants)

| 编号 | 不变量 | 说明 |
| --- | --- | --- |
| **GES-I1** | 用户不持有 gas，但必须知道谁付费 | 确认页显示 `sponsor` / `channel` / `self-pay` / `burn` 来源；不得隐藏补贴 |
| **GES-I2** | 抽象层不产生第二个签名路径 | 所有层最终都落到同一个 M2 intent digest、同一个飞地签名与同一个广播出口 |
| **GES-I3** | 每层都有预算、过期与重放保护 | sponsor 预算、通道超时、PoW ticket TTL、人格 nullifier epoch、销毁事件都不可省略 |
| **GES-I4** | 失败是值，不静默降级 | 赞助失败不得自动改成“跳过生物识别”；PoW 失败不得自动放行；状态通道失败必须回到链上争议 |
| **GES-I5** | 抗女巫优先于补贴 | 没有真实人类门槛的 sponsor 会被设备农场抽干；G3 是 G0 的前置约束，不是可选装饰 |

### 16.1 Tier G0 — Paymaster 赞助代扣 (ERC-4337)

**目标**：让主人第一次使用时无需先买 ETH；由受策略约束的 Paymaster 代付 `UserOperation` 的 gas。

| 项目 | 规范 |
| --- | --- |
| 账户模型 | ERC-4337 兼容智能账户；`UserOperation` 由 bundler 打包，`EntryPoint` 执行 |
| 赞助来源 | Paymaster 合约或受控赞助服务；目标契约要求 `paymasterAndData` 绑定账户、目标合约、selector 与预算。**当前代码只绑定账户、过期时间、nonce 与 chainId，尚未绑定目标 / selector / calldata**（见下） |
| 允许范围 | 白名单合约 / selector；禁止任意 calldata、无限授权、代理升级与未知目标 |
| 预算 | 每人类 / 每设备 / 每日 / 每动作上限；gas price 上限；预算耗尽即拒绝，不回退到用户自付 |
| 验证 | 先模拟执行；检查 policy、spend window、personhood / 设备完整性；原始 `UserOperation` 必须与 intent digest 一致 |
| 失败码 | `SPONSOR_BUDGET_EXHAUSTED`、`SPONSOR_SCOPE_DENIED`、`SPONSOR_SIMULATION_FAILED`、`SPONSOR_RATE_LIMITED` |
| 风险 | Paymaster 被抽干、bundler 审查、calldata 欺骗、赞助范围过宽 |
| 缓解 | 严格 allowlist、按 nullifier 的配额、模拟 + 复核、预算熔断、异常速率告警 |

**G0 不是“免费交易”**：它只是把 gas 的支付方从主人换成赞助方。赞助方可以是协议金库、生态基金或商户；每一笔都必须可审计、可预算、可停止。

**当前实现与差距（诚实状态）**：

- **已实现**：`MaotangPaymaster` 校验 `EntryPoint` 调用者、暂停状态、EIP-712 授权 `(sender, validUntil, nonce, chainId)`、单次 nonce、可选 allowlist，以及 `uint64[100]` 环 + `cursor` 的精确滚动 24h 窗口；`Sponsored` 事件记录 sender、nonce 与窗口释放时间。服务端仅在 sealed personhood cookie 存在且 `sender == claim recipient` 时签名，并先读取链上配额。
- **未实现**：授权摘要不包含 `userOp.callData` / 目标合约 / selector，因此拿到票据的人仍可能把赞助用于另一目标；没有 bundler 提交、没有 EntryPoint 存款与真实 `UserOperation` 结算；没有生产部署地址与监控。达到 §16.7 **G2** 之前，G0 只能描述为“票务与配额层已实现”，不得描述为“零 Gas 已生效”。

### 16.2 Tier G1 — 链下状态通道 (State Channels)

**目标**：把高频、小额、双向的动作（聊天打赏、Agent 计时、内容解锁、微支付）移出链上逐笔结算。

| 项目 | 规范 |
| --- | --- |
| 适用 | 双方重复交互、金额小、结算频率高、可容忍挑战期 |
| 开通道 | 链上存入双方资产，记录 `channelId`、双方地址、资产、挑战期与争议规则 |
| 链下更新 | 双方对状态更新签名；`counter` 单调递增；旧状态不得覆盖新状态 |
| 关闭 | 任一方提交最终状态；挑战期内可提交更高 `counter`；超时后结算 |
| 争议 | 挑战期 + watchtower；watchtower 只能提交已签名状态，不能替用户创建新状态 |
| 隐私 | 链下更新不公开；链上只看到开 / 关与最终余额 |
| 失败码 | `CHANNEL_NOT_FUNDED`、`CHANNEL_STALE_STATE`、`CHANNEL_TIMEOUT`、`CHANNEL_DISPUTE` |
| 风险 | 离线、旧状态欺诈、watchtower 串谋、流动性锁定 |
| 缓解 | 单调 counter、挑战期、watchtower、通道上限、自动关闭策略 |

**G1 与 Chat-to-Pay 的关系**：聊天内微支付可走通道；但“给陌生人第一次付款”不得仅靠通道绕过 §17 的建联与人格检查。通道只降低结算成本，不改变授权与反女巫要求。

### 16.3 Tier G2 — 客户端 Wasm 本地 PoW 抗 DDoS

**目标**：在请求进入网关 / bundler / 中继之前，要求客户端完成一个**有界、可验证、不可外包给服务端**的计算票据，抬高自动化请求与群控刷量的边际成本。

| 项目 | 规范 |
| --- | --- |
| 算法 | 服务端下发随机 challenge；客户端在 Web Worker / Wasm 中计算带前导零的哈希票据（目标难度 `d`） |
| 绑定 | challenge 必须绑定动作类型、账户、设备完整性结论摘要、epoch 与过期时间 |
| 验证 | 网关在常数时间内验证票据；票据一次性使用；TTL 内有效 |
| 难度 | 按设备能力与全局负载自适应；低端机优先降低难度并增加等待，不直接拒绝 |
| 资源护栏 | 单次计算上限、后台不挖矿、电池 / 热状态检查、页面不可见时暂停 |
| 非目标 | **不是共识 PoW**，不产生区块奖励，不替代 G3 人格证明，不保护链上最终性 |
| 失败码 | `POW_REQUIRED`、`POW_INVALID`、`POW_EXPIRED`、`POW_DIFFICULTY_TOO_HIGH` |

**经济意义**：对单台手机，PoW 只是短暂 CPU 成本；对云手机集群，成本会随请求量线性增长。它不能单独阻止有预算的攻击者，因此必须与 §17.1 的设备完整性、§17.2 的活体与 G3 的人格门槛组合。

### 16.4 Tier G3 — ZK-Personhood 真实人类门禁

**目标**：把“一个真实人类”的一次性资格与 sponsor / 通道 / 建联配额绑定，防止同一人用无限钱包或无限设备领取补贴。

| 项目 | 规范 |
| --- | --- |
| 证明 | Groth16 人格证明 + nullifier；证明“唯一活体人类”，不暴露姓名、证件或生物模板 |
| 一次性 | 每个 epoch 每个 nullifier 只能消费一次；重复使用返回 `PERSONHOOD_REPLAY` |
| 绑定 | nullifier 绑定 `walletAddress` 与设备证明摘要；换钱包不能无限重领 |
| 配额 | 每人类每日 sponsor 预算、陌生人建联次数、通道开立数、Agent 注册数 |
| 失败关闭 | ceremony key 未安装、verifier 未锁定、证明过期或链 ID 不匹配时拒绝 |
| 与 G0 的关系 | 只有通过 G3 的账户才进入 G0 的低摩擦赞助档；未证明者只能自付或走受限档 |
| 与 G1 的关系 | 通道开立数与单通道上限受 nullifier 配额约束 |
| 风险 | 证明系统漏洞、nullifier 转卖、ceremony 信任、隐私泄露 |
| 缓解 | 已锁定的 verifier、最小化公开字段、nullifier 域分离、独立审计、按 epoch 的速率限制 |

**已有基础**：`contracts/src/{Groth16Verifier,AIAgentRegistry,HumanToken}.sol` 已提供人格证明、硬件 nullifier 与 agent 绑定；但**尚未与 Paymaster / GES 预算联动**，因此 G3 整体仍为 🟡，不是已完成的 GES 能力。

### 16.5 Tier G4 — XRPL 式销毁型 MAOTANG 代币通缩

**目标**：把部分协议费用转为**永久销毁**，形成可验证的供给收缩；同时让攻击者每次刷量都支付真实成本，而不是把费用返还给可循环使用的金库。

| 项目 | 规范 |
| --- | --- |
| 费用来源 | G0 赞助回收、G1 结算费、G2 票据费、陌生人建联费、Agent 服务费中的指定比例 |
| 销毁方式 | 转入无可花费私钥的销毁地址 / 合约，或调用不可逆 `burn`；必须产生链上事件与可验证收据 |
| 供给 | 固定上限或明确发行曲线；销毁不增发；不得用“回购”伪装销毁 |
| 比例 | 费用拆分 `burnBps` 可治理但有上限；变更必须延迟生效并公开 |
| 会计 | 每笔销毁记录 `source`、`amount`、`txHash`、`epoch`；UI 可展示累计销毁量 |
| 非目标 | 不承诺价格、收益或回购；不把销毁包装成投资回报 |
| 失败码 | `BURN_DISABLED`、`BURN_CAP_REACHED`、`BURN_TX_FAILED` |
| 风险 | 通缩叙事掩盖真实成本、治理滥用、销毁地址误用、流动性下降 |
| 缓解 | 比例上限、延迟治理、独立审计、销毁与费用账本对账、法律审查 |

**XRPL 式含义**：这里借用的是“费用被永久销毁、供给单向收缩”的机制设计，不是宣称 MAOTANG 与 XRP Ledger 共享代码或共识。G4 只有在代币已部署、销毁地址与治理参数经审计后才可启用；在此之前不得对外宣称“通缩已生效”。

### 16.6 组合与选择矩阵 (Composition matrix)

| 动作 | G0 Paymaster | G1 状态通道 | G2 本地 PoW | G3 人格门禁 | G4 销毁 | 说明 |
| --- | --- | --- | --- | --- | --- | --- |
| 首次领取 / 激活 | ✅ 受限赞助 | ⬜ | ✅ 低难度 | ✅ 必须 | ⬜ | 先证明人类，再发一次性赞助 |
| Vault Send（小额） | ✅ | ⬜ | ✅ | ✅ 已有 | ⬜ | 仍须 Face ID + 飞地签名 |
| 聊天打赏 / 微支付 | ⬜ | ✅ | ✅ | ✅ | ✅ 可选 | 通道内高频，结算时销毁部分费用 |
| Swap / 高价值 | ✅ 仅白名单 | ⬜ | ✅ 高难度 | ✅ | ✅ | 需要强设备完整性 + 二次确认 |
| Agent 任务计费 | ✅ 预算内 | ✅ | ✅ | ✅ | ✅ | Agent 不得代替主人授权 |
| 陌生人首次建联 | ⬜ | ⬜ | ✅ | ✅ | ✅ 建联费 | 叠加 §17.4 的频次与保证金 |
| 疑似群控 / 云手机 | ❌ | ❌ | ✅ 仅挑战 | ❌ | ⬜ | 直接拒绝或进入人工复核，不给赞助 |

**选择算法（规范级伪代码）**：

```text
quote(action, account, device, human):
  require policy.allow(action, account)
  require human.verified or action.risk == "low"
  require device.integrity >= action.minIntegrity
  tier = smallest composition that satisfies action.risk and budget
  if tier.sponsor: require sponsor.budget(account) > estimate
  if tier.channel: require channel.state == "open" and channel.capacity >= amount
  if tier.pow: issue challenge(bound to action, device, human, epoch)
  if tier.burn: quote burnBps and show it to the owner
  return quote with explicit payer and expiry
```

### 16.7 验收（规范级）

| 编号 | 断言 | 方法 |
| --- | --- | --- |
| **G1** | 赞助失败、PoW 失败或通道失败均不绕过 policy / biometric | 失败注入测试 |
| **G2** | `UserOperation` 的目标、selector、金额与 intent digest 完全一致 | 黄金向量 + 模拟执行 |
| **G3** | 同一 nullifier 在同一 epoch 不能重复领取 sponsor 配额 | 重放测试 |
| **G4** | 状态通道旧 `counter` 不能覆盖新状态；挑战期后可结算 | 通道争议测试 |
| **G5** | PoW 票据一次性、绑定动作与设备结论、过期拒绝 | 票据重放 / 篡改测试 |
| **G6** | 销毁事件与费用账本逐笔对账，且不存在增发路径 | 合约测试 + 账本对账 |
| **G7** | UI 明确显示 `sponsor` / `channel` / `self-pay` / `burn` 来源，不出现“永久免费” | 文案与 DOM 断言 |

> 关联：§3（奖励与金库）、§5（人格证明）、§8（威胁模型）、§14（移动硬件根）、§17（反群控）、`docs/architecture/ADR-047-MOBILE_DECHAT_GES_AND_ANTIFARM.md`。

---
## 17. 物理级抗手机集群 / 抗群控协议 (Anti-Phone-Farm Protocol)（normative）

> **状态：🟡 仅有窄范围密码学信号；四重机制未上线。** 服务端已用 `@simplewebauthn/server` 验证平台认证器的 direct attestation 与 `userVerified`，并把 `identityHash = keccak256(rpID, credentialId)` 写入链上 `MaotangFaucet` 的一次性 claim 账本；这能阻止同一 credential 重复领取，但不能证明设备未被 root / 模拟器 / ADB 控制。DCAppAttest / Play Integrity、TrueDepth 3D 活体、陀螺仪微动、客户端 Wasm PoW 与陌生人建联销毁闭环均**尚未实现**。本章其余内容为目标契约。本章处理的是 §14 无法自动解决的另一半问题：**设备是真的手机，不等于操作者是真实人类；有一台真手机，也不等于只有一台。** 四重机制必须组合使用，任何单一信号都可以被有预算的攻击者绕过。所有活体与传感器结论在设备本地计算，只上传最小化结论 / 摘要，不上传原始深度图、陀螺仪轨迹或生物模板。

### 17.0 威胁模型 (Threat model)

| 攻击者能力 | 典型行为 | 目标 |
| --- | --- | --- |
| 云手机 / 模拟器农场 | 批量创建账户、自动点击、脚本化聊天 | 刷空投、刷赞助、刷邀请奖励 |
| 越狱 / Root / 注入框架 | Hook 生物识别返回值、伪造传感器、篡改 WebView | 绕过 Face ID、伪造活体、批量签名 |
| ADB / 自动化群控 | `input tap`、UI Automator、批量安装与克隆 | 规模化建联、批量支付、刷任务 |
| 真机农场 | 大量廉价真机 + 人工 / 半自动操作 | 规避模拟器检测，刷人格配额与建联额度 |
| 账号 / 钱包轮换 | 同一人无限生成地址、设备或社交账号 | 绕过按地址的限额 |
| 女巫 + 黑产 | 购买真人身份、租用设备、代过活体 | 把“唯一人类”变成可购买资源 |

**非目标**：本章不构建全民监控、不做永久设备指纹、不收集通讯录 / 相册 / 精确位置，也不把“疑似”直接等同于“定罪”。所有拒绝必须可解释、可申诉，并保留无障碍替代路径。

### 17.1 第一重：硬件属性与环境断言 (Hardware & environment attestation)

**目标**：在进入业务逻辑前，确认“这是一个未被篡改的官方 App，运行在受支持的真实移动设备上”。

| 平台 | 机制 | 规范 |
| --- | --- | --- |
| iOS | **DCAppAttest** (`DCAppAttestService`) | App 启动时生成 / 加载 App Attest key；对服务端 nonce 生成 attestation；后续请求用 assertion + 单调计数器；验证证书链、App ID、环境与 counter |
| Android | **Play Integrity API** | 请求 `MEETS_DEVICE_INTEGRITY` / `MEETS_STRONG_INTEGRITY` 等 verdict；nonce 绑定本次挑战；校验包名、签名证书、请求哈希与 verdict |
| 双端 | 环境信号 | ADB 可用、`ro.debuggable`、`ro.kernel.qemu`、模拟器特征、Root / 越狱痕迹、虚拟化 / 多开 / 云手机特征、开发者选项异常 |
| 双端 | 应用完整性 | 重打包、Hook 框架、调试器附加、异常签名、非官方渠道安装 |

**分级放行 (verdict matrix)**：

| 结论 | 允许 | 限制 |
| --- | --- | --- |
| `STRONG`：强完整性 + 官方签名 + 真实设备 | 全部低 / 中风险动作 | 高价值仍需 Face ID + 活体 |
| `BASIC`：基本完整性，但虚拟环境 / 弱证明 | 只读、低额、受限聊天 | 禁止新陌生人建联、禁止 sponsor 高额度、禁止高价值支付 |
| `UNKNOWN`：证明缺失 / 超时 / 不支持 | 只读 | 不产生签名，不进入 G0 赞助 |
| `FAILED`：越狱 / Root / 模拟器 / 重打包 / 注入 | 拒绝 | 可进入人工申诉，不自动放行 |

**隐私与工程约束**：

- 原始 attestation token 不落库；只保存验证结论、时间、设备证明摘要与 TTL。
- nonce 一次性；重放、过期、包名 / 签名不匹配一律拒绝。
- ADB / Root / 模拟器信号是**风险信号**，不是单独定罪证据；必须与 Play Integrity / App Attest 组合。
- Web PWA 无法直接调用 DCAppAttest 或 Play Integrity；必须由原生壳提供 `DeviceIntegrityGate`。在原生桥落地前，PWA 只能标记为 `UNKNOWN`，高价值动作失败关闭。

### 17.2 第二重：TrueDepth 3D 活体断言与陀螺仪微动校验 (Gyroscope Liveness)

**目标**：确认屏幕前是一个**正在操作的活人**，而不是照片、视频、面具、预录动作或自动化脚本。

| 信号 | 规范 | 不能单独证明什么 |
| --- | --- | --- |
| TrueDepth 3D 深度 | 随机挑战下的深度图 / IR 结构光；检查面部几何、皮肤反射、遮挡与注意力 | 不能证明“本人”，只能提高面具 / 照片成本 |
| 随机动作挑战 | 眨眼、转头、靠近 / 远离、微笑等随机组合；挑战一次性、短过期 | 不能阻止高保真深度换脸视频 |
| 陀螺仪微动 | 采样设备在手持状态下的自然微动 / 抖动特征；在设备本地提取特征并分类 | 陀螺仪可被 Root / Hook 伪造；不能单独作为人类证明 |
| 设备持有连续性 | 动作前后设备姿态、屏幕朝向、触摸轨迹的一致性 | 不能证明操作者身份，只能提高脚本成本 |

**组合规则**：

1. 活体挑战必须绑定本次 `intent digest` 或建联 nonce；旧挑战不能复用。
2. TrueDepth 与陀螺仪结论必须来自原生壳的签名回执；WebView 自报无效。
3. 只有“设备完整性 `STRONG` + 活体通过 + 生物识别 `userVerified`”三者同时成立，才允许新陌生人支付或高价值动作。
4. 活体失败不得降级为“只输密码”；密码不能替代物理在场。
5. 对无法完成指定动作的用户提供无障碍替代（例如受控人工复核、辅助设备流程），但不得静默放行。

**PWA 限制**：`useBiometricOwner()` 当前只提供 WebAuthn 的 `userVerified` 标志，**没有** TrueDepth 深度图或高频陀螺仪通道。`navigator.credentials.get()` 通过不等于 3D 活体通过；UI 不得把 Face ID 成功写成“活体已验证”。真实活体必须由原生 `DeviceLivenessProbe` 提供，当前为 ⬜。

### 17.3 第三重：客户端 Wasm 本地 PoW 算力惩罚 (Client-side proof of work)

**目标**：让每一次建联、领取或高频请求都消耗设备 CPU / 电量 / 热量，抬高清真机农场与云手机的边际成本。

| 项目 | 规范 |
| --- | --- |
| 票据 | `PoWTicket { challenge, difficulty, nonce, ticketHash, expiresAt, deviceClaimHash }` |
| 计算位置 | Web Worker / Wasm；不得在服务端代算，不得在后台持续挖矿 |
| 绑定 | challenge 绑定账户、动作、设备完整性结论、活体结论摘要与 epoch |
| 难度 | 按设备等级与全局负载自适应；同一设备连续请求递增难度 |
| 上限 | 单次 CPU 时间 / 哈希次数 / 电量阈值；过热或低电量时暂停并提示 |
| 验证 | 网关验证哈希、难度、TTL、一次性与绑定字段；失败返回稳定错误码 |
| 经济定位 | **反 DDoS / 反批量**，不是共识、不是挖矿、不发奖励 |

**为什么单独不够**：云手机可以并行计算，专业攻击者可以购买算力。PoW 的价值是把“无限免费请求”变成“有成本请求”，并与设备完整性、活体、人格 nullifier 叠加，形成多层成本。

### 17.4 第四重：陌生人建联 + 频次限制 + 代币销毁死循环 (Cost-escalation loop)

**目标**：让“陌生人首次联系”成为需要真实人类资格、设备完整性、活体与保证金的动作；攻击者每多刷一次，成本就更高，而不是更低。

| 机制 | 规范 |
| --- | --- |
| 建联请求 | 陌生人消息先进入 `request` 状态，收件人接受后才进入收件箱；默认不显示未读计数诱导 |
| 资格 | 必须通过 G3 人格门禁 + §17.1 设备完整性 + §17.2 活体；缺一项即拒绝 |
| 频次 | 按 **nullifier / 人类** 而不是钱包计限：每日新联系人、每分钟消息、每设备会话数都有上限 |
| 保证金 | 首次建联支付可退还保证金或不可退还建联费；费用按 `burnBps` 部分销毁 |
| 递增成本 | 同一 nullifier 的第 `n` 次建联 / 被举报次数按阶梯提高费用与 PoW 难度；公式示例：`cost(n) = base * 2^floor(n/K)` |
| 举报与惩罚 | 收件人举报 + 证据审核；确认骚扰 / 批量垃圾消息则销毁保证金，并提高该 nullifier 的后续成本 |
| 申诉 | 误判可申诉；申诉期间不自动恢复高额度；确认误判后退还费用并清除惩罚 |
| 冷却 | 被拒绝 / 被举报后进入冷却；换钱包不重置，因为配额绑定 nullifier 与设备摘要 |

**成本递增闭环（“死循环”的工程含义）**：

```text
attack_cost(n) = pow_cost(n) + attestation_cost + liveness_cost + burn_fee(n)
burn_fee(n)    = base_fee * escalation(n)
escalation(n)  = 2^floor(n / K)       # K 为每档次数
expected_profit(n) = spam_revenue(n) - attack_cost(n)
```

当 `expected_profit(n)` 随 `n` 下降并转为负值，理性攻击者应停止；这不是数学上的“绝对不可能”，而是把规模化攻击从“几乎免费”推到“成本高于收益”。对高预算攻击者仍需人工复核、执法协作与链上信誉。

**反误伤**：新用户、低风险联系人、熟人和 Agent 白名单不应被同一套高门槛误杀；门槛按“陌生人 / 首次 / 高价值”分层，不按国籍、性别、年龄或内容立场评分。

### 17.5 组合矩阵 (Composition matrix)

| 动作 | §17.1 设备完整性 | §17.2 活体 | §17.3 PoW | §17.4 建联 / 销毁 | 结果 |
| --- | --- | --- | --- | --- | --- |
| 只读浏览 | 可选 | 否 | 低 | 否 | 允许 |
| 熟人聊天 | 建议 | 否 | 低 | 否 | 允许；异常时 step-up |
| 陌生人首次消息 | 必须 `BASIC+` | 必须 | 必须 | 必须请求 + 保证金 | 收件人接受后进入收件箱 |
| 陌生人首次支付 | 必须 `STRONG` | 必须 | 高 | 必须 + 限额 | 仍需 Face ID + 飞地签名 |
| 高价值 Swap / Send | 必须 `STRONG` | 必须 | 高 | 不适用 | 二次确认 + 人工复核阈值 |
| Agent 自动任务 | 必须 `BASIC+` | 首次 / 高风险必须 | 中 | Agent 白名单 | 不得代替主人授权支付 |
| 疑似云手机 / Root | `FAILED` | 不采信 | 仅挑战 | 拒绝 | 人工申诉，不自动放行 |

### 17.6 隐私、合规与可解释性 (Privacy and compliance)

- **不上传原始生物数据**：深度图、陀螺仪轨迹、面部图像、设备指纹原始值均不得离开设备；只上传签名结论、哈希与必要的时间 / 版本。
- **最小化留存**：设备证明结论按最短 TTL 保存；聊天明文不进入风控日志；举报证据由用户主动提交并限期删除。
- **可解释拒绝**：每个拒绝返回稳定码（如 `INTEGRITY_FAILED`、`LIVENESS_FAILED`、`DEVICE_FARM_SUSPECTED`、`CONTACT_RATE_LIMITED`），UI 给出可操作下一步。
- **可申诉**：高风险拒绝必须提供人工复核路径；不得用不可解释的模型分数永久封禁。
- **无障碍**：活体挑战提供替代流程；不能因为用户无法完成某个动作而永久剥夺金库访问。

### 17.7 验收（规范级）

| 编号 | 断言 | 方法 |
| --- | --- | --- |
| **F1** | 无原生设备完整性结论时，新陌生人支付与高价值动作拒绝 | 断桥 / 模拟器测试 |
| **F2** | 云手机、Root、越狱、重打包、ADB 自动化至少触发 `BASIC` 降级或拒绝 | 设备农场样本测试 |
| **F3** | TrueDepth + 陀螺仪结论绑定本次挑战；旧回执不可复用 | 重放测试 |
| **F4** | PoW 票据一次性、绑定账户 / 动作 / 设备结论，过期拒绝 | 票据篡改测试 |
| **F5** | 同一 nullifier 换钱包不能重置建联配额；费用随次数递增 | 女巫轮换测试 |
| **F6** | 举报确认后保证金按规则销毁，误判可退还 | 账本对账 + 申诉流程测试 |
| **F7** | 原始深度图、陀螺仪轨迹、生物模板不出现在网络 / 日志 / 分析事件 | 抓包 + 日志审计 |
| **F8** | 无障碍替代路径可完成高风险动作，且不静默放行 | 人工设备测试 |

> 关联：§5（人格证明与 nullifier）、§8（威胁模型）、§14（移动硬件根）、§15（陌生人建联）、§16（G2 PoW / G3 人格 / G4 销毁）、`docs/architecture/ADR-047-MOBILE_DECHAT_GES_AND_ANTIFARM.md`。

---
## Appendix A. 事实来源与复现命令

> 全部路径相对本工作区内的子项目根 `products/maotang/`；复现命令一律在**该子项目目录内**执行（根目录代跑无效）。

| 模块 | 主要源码 | 复现命令（在子项目目录内） |
| --- | --- | --- |
| 1 SLM | `agent-client/src/slm/`、`src/intents/`、`test/local-agent.test.ts` | `cd products/maotang/agent-client; npm test` |
| 2 钱包 | `agent-manager/src/mining/transport.mjs`、`sdk/src/agent-client.ts` | `cd products/maotang/agent-manager; python test/mining_e2e.py` |
| 3 算力/验证奖励 | `contracts/src/{MaoTangBondingCurve,MaoTangSustenanceVault,MaoTangSustenanceDripper,MaoTangMining}.sol`、`sdk/src/curve-math.ts` | `cd products/maotang/contracts; forge test` |
| 4 轻节点 | `agent-client/src/telemetry.ts`、`scripts/rpc-guard.mjs`、`app/src/lib/chain.ts` | 见 §4.3 的 curl；`cd products/maotang/agent-client; npm test` |
| 5 反女巫 | `contracts/src/{Groth16Verifier,AIAgentRegistry,HumanToken}.sol` | `cd products/maotang/contracts; forge test` |
| **12 断言 / 意图 / 网关** | `app/src/lib/agent/{webauthn,biometric-session,web3-intent}.ts`、`mobile-agent/bio-auth/`、`gateway/src/` | `cd products/maotang/app; npx tsc --noEmit`；`cd products/maotang/gateway; npx tsc --noEmit; npm test`；`node products/maotang/scripts/maotang-smoke.mjs --gateway` |
| **13 三 Tab C 端** | `docs/architecture/ADR-046-DUAL_MODE_C_END_SPEC.md` / `ADR-047`；已落地 `app/src/components/agent-console/ConsoleShell.tsx`、`app/src/components/console/{VaultPanel,DeChatPanel,AgentPanel,ConsoleTabs,ClaimCard,PaymasterQuota,KOLReferralPanel}.tsx` | `cd products/maotang/app; node node_modules/typescript/bin/tsc --noEmit --incremental false`；`node --test scripts/assert-runtime-policy.mjs` |
| **14 移动端纯硬件** | `app/src/lib/agent/{webauthn,webauthn-server,biometric-session}.ts`、`app/src/app/api/agent/webauthn/register/verify/route.ts`、`mobile-agent/signer/{native-enclave,hardware-attestation}.ts`、`mobile-agent/bio-auth/native-biometric-gate.ts` | `cd products/maotang/app; node node_modules/typescript/bin/tsc --noEmit --incremental false`；`node --test scripts/assert-runtime-policy.mjs`；原生飞地桥落地后执行 `cd products/maotang/mobile-agent; npm test` |
| **15 DeChat** | `docs/architecture/ADR-047-MOBILE_DECHAT_GES_AND_ANTIFARM.md`（规范）；已落地 `app/src/components/console/DeChatPanel.tsx`（会话本地预览、Chat-to-Pay 卡片转发到 `ConsumerView`）；目标 `app/src/lib/dechat/{identity,envelope,session,payment-intent}.ts` | `cd products/maotang/app; node node_modules/typescript/bin/tsc --noEmit --incremental false`；中继 / E2EE 传输落地后追加协议测试 |
| **16 GES** | 已实现 `contracts/src/MaotangPaymaster.sol`、`contracts/test/MaotangPaymaster.t.sol`、`app/src/lib/agent/{paymaster,paymaster-view}.ts`、`app/src/app/api/agent/paymaster/{quota,authorization}/route.ts`；G1–G4 仍为目标 | **🟡 G0 票务 / 配额层可编译，未部署、未接 bundler**：`npx solc@0.8.24` 编译合约；有 `forge` 时在 `cd products/maotang/contracts` 执行 `forge test`（当前环境无 forge，未执行）；上线前必须完成部署、EntryPoint 存款与 calldata 绑定 |
| **17 抗手机集群** | 已落地服务端 WebAuthn 断言与 `MaotangFaucet` 一次性 `identityHash` 账本；目标原生 `DeviceIntegrityGate` / `DeviceLivenessProbe`、Wasm PoW 与销毁闭环 | **🟡 仅凭证级防重**：`cd products/maotang/app; node --test scripts/assert-runtime-policy.mjs`；原生桥落地后追加设备农场样本、重放与活体测试 |
| 地址真源 | `app/config/contracts.json`（部署时重写） | `cd products/maotang/app; npm run build` 注入 manifest |

## Appendix B. Module Summary (English)

1. **Sovereign Edge Node SLM & Cell Division** — a local-only intent engine (`SlmEngine`, Qwen2.5-0.5B INT4, 500 MiB ceiling, cloud endpoints rejected by assertion) is the *sole* interface between the biological owner and the network. Genesis activation mints a one-million-unit `$mHUMAN` quota per verified human; subdividing that quota into 1,000,000 addressable **Cell Tokens** for micro-governance and protocol reward distribution is a **roadmap** item requiring its own ADR.
2. **Autonomous Local Wallet** — keys, signatures and broadcasts stay on the device; signing is dependency-injected through a TEE / Secure-Enclave signer behind a fail-closed egress guard. The threshold policy engine, the single signing path and the biometric/nullifier seams now exist as reviewed interface layers in `mobile-agent/` - and they refuse to sign until a device backend is injected, so an unconfigured build cannot silently fall back to a software key. Real hardware enclaves and device biometric backends remain **roadmap**.
3. **Compute, Verification & Rewards Engine** — a virtual-reserve constant-product bonding curve (30 ETH virtual reserve, 5 ETH graduation target, 0.50% swap / 1.00% graduation fees) plus **non-PoW** proof-of-physical-work edge compute (BLE proximity + attested NPU compute, replay-nullifiers, per-epoch cap, non-dilutive reward vault). **Protocol Compute & Verification Rewards** return to the node operator through the Sustenance Vault, now with a payout brake and a rolling native-outflow cap.
4. **Sovereign Edge Node Light Client** — a signed hardware heartbeat advertises node capability today, and the board reads live state through a CORS-enabled, admin-method-filtered RPC (`https://rpc.008ai.online`). Trustless verification is staged: multi-endpoint quorum, then EIP-1186 inclusion proofs against the state root, then a header-syncing light client, then P2P. Only the first stage exists as a plan; the current endpoint is *trust-minimised*, not trustless.
5. **Bio-Sovereign Anti-Sybil & Security Layer** — Zero-Knowledge Node Verification via Groth16 personhood and hardware-attestation proofs bind one agent and one hardware nullifier to one human, each spendable once, revocable by the owner, with the verifier failing closed until the ceremony key is installed and irreversibly frozen afterwards. Local biometric authorisation now has its interface layer in `mobile-agent/bio-auth/` (a refusing device gate, an assertion-binding adapter, and a one-shot hardware-nullifier registry that derives from device material and defers to the chain); a real device backend and proof generation remain the **roadmap** half of the design.

**Consumer surface (section 13, three-tab UI shell shipped; transport and live settlement not shipped).** The C-end PWA opens on a Bitcoin.com-style **Vault View** - total valuation, USDT / ETH / MaoMao rows and Send / Receive / Swap - in light pink glassmorphism (`#FFB6C1`). A fixed mobile bottom bar switches between **Vault**, **DeChat** and **Agent**. DeChat is currently a session-local preview: it derives a `<wallet-prefix>.008ai` identity from the manifest owner, renders message bubbles and a Chat-to-Pay card, and forwards every payment request to the same controller. No relay, E2EE transport, live bundler settlement or anti-farm bridge is attached yet. The claim path is real when a faucet is configured: the server verifies the WebAuthn assertion and submits `MaotangFaucet.claimDefault`, and the UI polls the receipt for Pending -> Confirmed; an unconfigured faucet returns `503 FAUCET_UNCONFIGURED` rather than inventing a ticket. All three entries normalise to the same intent and pass the same `Local Policy -> Face ID (Secure Enclave) -> Gateway Broadcast` pipeline; the UI origin never grants authority. `/v1/send` and `/v1/swap` are specified facade routes, not shipped; `/v1/broadcast` remains the only value-moving route.

6. **Mobile-Only Hardware Security (section 14, normative, partially shipped).** The vault is mobile-only: keys are generated and held in Secure Enclave / StrongBox, Face ID / Touch ID produces a presence assertion over the intent digest, and the transaction signature is produced separately by the M2 enclave. The web edge enrolls with `attestation: "direct"`, and the server verifies `clientDataJSON` / `authenticatorData` with `@simplewebauthn/server`, requires `userVerified`, and rejects `fmt === "none"`; `hardwareBacked` is a server verdict (`fmt !== "none" && deviceType === "singleDevice"`). It still has no native secure-enclave bridge, no DCAppAttest / Play Integrity verdict, and no TrueDepth / gyroscope probe. PC vault clients, desktop-extension signers and cloud signing are out of scope; PC browsers are read-only documentation / audit surfaces. Missing hardware signals fail closed rather than falling back to software keys.

7. **DeChat (section 15, session-local preview shipped; transport not shipped).** The three-tab shell includes a DeChat panel that derives a `<wallet-prefix>.008ai` display identity from the manifest owner, renders local message bubbles, a Chat-to-Pay card and a text input, and forwards every payment to the same `ConsumerView` policy / Face ID / broadcast path. There is no relay, no E2EE envelope transport and no device-bound encrypted store yet, so messages do not leave the session. The target protocol is: identity is the wallet address, not a phone number or username; device keys rotate under a wallet-signed `DeChatProfile`; messages use P-256 ECDH + HKDF-SHA-256 + AES-256-GCM with signed envelopes, monotonic counters and replay rejection; Chat-to-Pay turns a message into a canonical `PaymentIntent`; AI agents get a separate capped P2P channel and can propose payments but can never approve them.

8. **5-Tier GES (section 16, G0 ticket/quota code implemented; not live; G1–G4 specified).** `GES` is a composable Gasless Execution Stack: G0 ERC-4337 Paymaster sponsorship, G1 off-chain state channels, G2 bounded client-side Wasm PoW for admission control, G3 ZK-personhood quotas, and G4 XRPL-style fee burn. `MaotangPaymaster.sol` implements the v0.7 validation entry point, EIP-712 single-use authorization, an exact 100-operation rolling 24h ring window, pause and optional allowlist; the server reads live quota and signs only for the wallet bound to a verified claim. No Paymaster deployment, EntryPoint deposit or bundler is configured, and the authorization does not yet bind target / selector / calldata, so G0 must not be advertised as a working zero-gas benefit. G1–G4 remain target contracts. "Gasless" means the owner does not manage gas, not that execution is free. Every tier remains subordinate to the same policy, biometric assertion, intent digest and broadcast gate; sponsor, channel, self-pay and burn sources must be visible to the owner.

9. **Anti-Phone-Farm (section 17, narrow claim-side control only).** Server-side WebAuthn direct attestation, mandatory `userVerified`, and the on-chain one-claim `identityHash` ledger block replay of one credential; they do not prove that a device is free of root / emulator / ADB control. The target four controls compose: device / environment attestation (DCAppAttest, Play Integrity, root / emulator / ADB signals), TrueDepth 3D liveness plus on-device gyroscope micro-motion, bounded client-side PoW, and a stranger-contact / rate-limit / burn-escalation loop keyed to the human nullifier rather than the wallet. Those four are not shipped. Raw depth maps, sensor traces and biometric templates never leave the device. No single signal is treated as proof of personhood; missing required signals fail closed, and accessibility / appeal paths are mandatory.

**Consumer navigation (ADR-047, UI shell shipped; protocol still target).** The mobile PWA uses three first-class bottom tabs: **Vault** (`/`), **DeChat** (`/dechat`) and **Agent** (`/agent`). Vault keeps the Bitcoin.com-style total, asset rows and Send / Receive / Swap; DeChat currently provides the local preview and Chat-to-Pay hand-off while E2EE transport remains a target; Agent owns intent parsing, policy logs and node debugging. The engineer / audit console remains behind the drawer. `useBiometricOwner()` remains the single owner-presence hook shared by all three tabs; native attestation and liveness conclusions arrive through separate narrow bridges, never through the WebView.
