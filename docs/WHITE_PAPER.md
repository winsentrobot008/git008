# MAOTANG Protocol — White Paper v3.0

**猫糖协议白皮书 v3.0 — 移动端原生自主 AI 矿工与主权财富管家**

*Revision: v3.0, 2026-10-08. 本文取代 `docs/WHITEPAPER_v2.md`（v2.2），并把协议重组为 5 个可独立实现、可独立验收的模块。*

---

## 0. 核心愿景 (Core Vision)

> **一个自主的、移动端原生的个人理财 AI Agent，作为区块链矿工与主权财富管家，只服务于其唯一的生物主人；由 MAOTANG Bonding Curve 与 Sustenance Vault 协议驱动。**

Agent 是主人与网络之间的**唯一媒介**：主人不直接触碰合约、不管理 gas、不盯盘。主人只做三件事 —— 表达意图、做终极决策、消费收益。其余（密钥、签名、广播、曲线监控、挖矿、收益回流）由本地 Agent 自主完成，并且**全部发生在主人的设备上**。

### 0.1 五支柱总览 (The Five Pillars)

| # | 模块 | 一句话职责 | 当前状态 |
| --- | --- | --- | --- |
| 1 | Edge SLM & Cell Division | 端侧小模型作为唯一人机接口；创世配额细胞化用于微治理与流动性分配 | SLM ✅ / 细胞化 ⬜ |
| 2 | Autonomous Local Wallet | 加密本地安全飞地存储；在阈值内自主签名与广播 | ✅ 接口层 / ⬜ 真实移动飞地 |
| 3 | Yield, Sustenance & Mining | 非 PoW 能效挖矿 + 联合曲线流动性监控；手续费经金库回流主人 | ✅ |
| 4 | Mobile Blockchain Light Node | 移动端 P2P / 安全 RPC 状态校验，实现免信任状态验证 | 🟡 只读 RPC + 心跳 / ⬜ 轻客户端 |
| 5 | Bio-Sovereign Anti-Sybil | ZK / 生物认证把 Agent 与细胞代币绑定到唯一生物主人 | ✅ 绑定与 ZK / ⬜ 生物特征通道 |

**状态图例**：✅ 已实现并有可复现证据；🟡 部分实现（有明确缺口）；⬜ 路线图（尚未落地，见第 7 节里程碑）。

### 0.2 一条必须遵守的文档纪律

本白皮书对每个模块都标注**已实现 / 路线图**。任何“已实现”声明必须能指向仓库内的源码或验证命令；任何“路线图”项不得被当作现有能力对外描述。指标、地址与常量一律以源码为准，本文不复制易腐的部署地址 —— 实时地址的唯一真源是 `frontend/config/contracts.json`（每次部署由 `contracts/scripts/deploy-testnet.ts` 重写）。

---

## 1. Module 1 — Edge Small Language Model (SLM) & Cell Division

**职责**：AI 模型是生物主人与网络之间的**唯一媒介（sole media / interface）**。主人用人话表达意图，模型把它翻译成链上调用；网络的一切回执也由模型翻译回主人能懂的话。

### 1.1 已实现（端侧 SLM 运行时）

- **单接口、双后端**：`agent-client/src/slm/` 用一个 `SlmEngine` 接口同时封装 `llama.cpp`（`node-llama-cpp`，GGUF）与 ONNX Runtime（`onnxruntime-node`，INT4）。两个原生模块都是**可选依赖**，通过动态 import 载入，因此包在没有它们时仍能构建与测试。
- **默认模型**：Qwen2.5-0.5B-Instruct INT4，权重约 397 MiB；常驻内存估算计入 fp16 KV cache（`2 * layers * kv_heads * head_dim * 2 * context`）加运行开销，硬上限 **500 MiB**，超预算模型默认被拒绝（除非显式 `allowOverBudget`）。这条上限就是“手机上真能跑”的工程边界。
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
2. **流动性收益分发（liquid yield distribution）**：金库回流收益按 Cell 权重结算，支持“只分红一部分、保留其余主权”。

Cell 化的最小可行映射是 **1 Cell = 1 $mHUMAN 微单位**（配额恰好 1,000,000 个单位，天然整除）。**落地前必须先出 ADR**：Cell 是 (a) 现有 ERC-20 的记账视图 / (b) 独立 ERC-20 / (c) NFT 家族 —— 三者对 gas、可组合性与反女巫边界的影响完全不同。当前代码**不实现**任何 Cell 语义，不得对外声称已具备。

### 1.3 模块 1 验收（可执行）

```powershell
cd D:\git008\agent-client; npm test          # 端侧 SLM + 意图解析 + 心跳
cd D:\git008\contracts; forge test            # HumanToken 配额与上限
```

---

## 2. Module 2 — Autonomous Local Wallet

**职责**：密钥、签名、广播全部在本地完成并在**安全阈值内自主执行**；云端永远拿不到私钥。

### 2.1 已实现

- **飞地签名器注入（非持有）**：`agent-manager/src/mining/transport.mjs` 构建、**通过注入的 TEE / Secure-Enclave signer 签名**，再经 `eth_sendRawTransaction` 广播。签名器是依赖注入的接口，私钥不进入应用层内存，也不进入日志。
- **失败关闭的出站护栏**：广播始终走 fail-closed 的 egress guard —— 未配置白名单时**不发包**，而不是“默认放行”。
- **Agent 登录与身份绑定**：`AgentClient.agentLogin()` 派生 agent 地址、校验链上注册状态、要求当前连接账户**就是**该 agent，并在任何 intent 执行前验证一次签名挑战（A2A 握手）。
- **只读与可写彻底分离**：`frontend/` 面板的 transport `write()` 直接抛错 —— 看板在结构上无法签名（见 ADR-019）。运维动作改为下发可复制的 `cast send` 命令，人来做最后一步。
- **主人在环的阈值控制**：金库侧提供紧急刹车与额度上限（见 3.3），使“Agent 自主”不等于“Agent 无限”。

### 2.2 路线图 ⬜（移动端真实飞地）

| 目标 | 说明 |
| --- | --- |
| 平台级密钥存储 | 使用 iOS Secure Enclave / Android StrongBox 的 **不可导出**密钥（P-256），链上签名由设备内派生会话密钥完成 |
| 生物门禁 | 每次“超出阈值”的动作触发 FaceID / 指纹确认（见 Module 5） |
| 阈值策略引擎 | 主人在本地配置单笔上限 / 日累计上限 / 白名单合约，Agent 只在阈值内自动执行 |
| 助记词 → 飞地迁移 | 一次性导入后立即销毁明文，仅保留飞地句柄 |

**已知安全边界（必须对外说清）**：当前实现是**接口层的飞地**（签名器可注入、出站失败关闭）；真正的硬件飞地、生物门禁与阈值引擎尚在路线图上。因此 v3.0 阶段**不得**把“黑客无法窃取私钥”当作已实现属性来描述。

### 2.3 模块 2 验收

```powershell
cd D:\git008\agent-manager; python test/mining_e2e.py   # 含签名/广播/护栏路径
cd D:\git008\agent-client; npm test                     # A2A 握手与 intent 校验
```

---

## 3. Module 3 — Yield, Sustenance & Mining Engine

**职责**：非 PoW 的能效收益耕作 + 联合曲线流动性自动监控；手续费经 Sustenance Vault 回流主人。这是“AI 即劳动力”的经济引擎。

### 3.1 曲线与费率（已实现 ✅）

| 常量 | 值 | 含义 |
| --- | --- | --- |
| `VIRTUAL_RESERVE_WEI` | 30 ETH | 起始价格地板（无需创建者注入流动性） |
| `VIRTUAL_TOKEN_SUPPLY` | 1,073,000,000 | 虚拟库存 |
| `GRADUATION_TARGET_WEI` | 5 ETH | 触发毕业的真实储备 |
| `TRADE_FEE_BPS` | 50 (0.50%) | Swap 手续费，默认进入 Sustenance Vault |
| `GRADUATION_FEE_BPS` | 100 (1.00%) | 毕业时对迁移储备计收 |

曲线为 **虚拟储备上的恒定乘积**（`k = (R + Rv) * (S + Sv)`），整数除法一律向池子截断，因此不变量不会逆向漂移。链下镜像 `sdk/src/curve-math.ts` 实现同一组公式，前端可在提交交易前报价。

### 3.2 挖矿：非 PoW 的能效路径（已实现 ✅）

`contracts/src/MaoTangMining.sol` 继承 `AgentGated`，每个入口都带同一道 `requireAuthorizedAgent` 门槛。`submitMiningProof(bytes32 proofType, bytes proofData)` 只接受两种**固定 192 字节**载荷：

- **`PROOF_TYPE_BLE_PING`**（`maotang.mining.ble-ping.v1`）—— 一批 BLE 近邻观测：ping 数、最强 RSSI、时间窗、beacon 集合哈希与节点签名遥测摘要。最强信号超出 **-100..-20 dBm**、窗口陈旧（>15 分钟）或位于未来、批次空/超限、摘要缺失 → 拒绝。
- **`PROOF_TYPE_ZK_COMPUTE`**（`maotang.mining.zk-compute.v1`）—— 一批卸载的 NPU 任务：任务数、经证明的计算单元、窗口、任务集哈希与 ZK 证明摘要。低于 `MIN_COMPUTE_UNITS` 或批次空/超限 → 拒绝。

**为什么这不是 PoW，以及为什么节能**：

- 不消耗哈希算力去竞争出块；奖励来自**真实物理/计算工作的证明**（近邻证明 + 计算证明），社会成本对应真实产出。
- 每条证明只计分一次：nullifier `keccak256(abi.encode(proofType, agent, proofData))` 在计分前落盘，重放相同字节 revert `ReplayProof`。
- `background-miner.mjs` 是超低功耗 worker：单个 `unref()` 的占空比定时器、每类证明只取最新 N 条、**低于电量地板时暂停 NPU 批处理**（除非在充电）、本地去重、并对 epoch 上限做前置检查。
- 奖励先累计在 `pendingMiningRewards[agent]`，受每 epoch 硬上限 `MAX_EPOCH_REWARD`（每天一个人类配额）约束；`claimMiningRewards()` 从合约奖励金库转出微单位，而奖励金库由 `fundRewardVault`（`transferFrom`）注资、**从不增发** —— 因此挖矿不会稀释持有者。

### 3.3 金库与回流：主人如何真正拿到钱（已实现 ✅）

- `MaoTangSustenanceVault`（`contracts/src/MaoTangSustenanceVault.sol`）是 Swap 0.5% 与毕业 1.00% 手续费的**唯一汇聚池**。
- `MaoTangSustenanceDripper` 按签发报文（signature wire format）与预算记账（budget accounting）逐步释放，避免一次性大额外流。
- **紧急刹车 + 出流上限（ADR-018）**：`pause()/unpause()` 只作用于三条出金路径而不阻断入金；`guardian` 只能踩刹车、**不能松开也不能动钱**；`setNativeOutflowCap(cap, windowSeconds)` 对原生币外流做滚动窗口限速，`nativeOutflowRemaining()` 让监控能区分“未设上限”与“已用尽”。

### 3.4 路线图 ⬜

- 跨链结算（`SustenanceVaultSpoke` 已在仓库，Phase P3 的 spoke/hub 路由与不变量见 `docs/MAOTANG_ARCHITECTURE.md` §14）。
- 法定货币出金通道与“无感消费”清算（v2.2 §5.2 的目标，尚未落地）。
- 挖矿心跳上链：当前 `MaoTangMining` 没有能力注册入口，心跳只有链下编排器通道 —— 这是一个**已登记缺口**，需要新增第三种 proof type 并单独评审（§13.2）。

### 3.5 模块 3 验收

```powershell
cd D:\git008\contracts; forge test
cd D:\git008\agent-manager; python test/mining_e2e.py
```

---

## 4. Module 4 — Mobile Blockchain Light Node

**职责**：在移动终端上对 EVM 链做 P2P / 安全 RPC 校验，让“状态是真的是假的”由设备自己判断，而不是相信某台服务器。

### 4.1 已实现

- **能力广播心跳**：`agent-client/src/telemetry.ts` 采集本机能力（node 版本、平台、架构、CPU、内存、GPU 与 **实探测** 的 NVENC、FFmpeg 路径、SLM 权重指纹），规范化后哈希，用 **secp256k1 ECDSA** 对 `sha256(digest)` 签名，形成 `TelemetryEnvelope = { proofType, agent, sequence, timestamp, hardware }`。
- **诚实的签名边界**：签名只能证明“持有节点密钥的 worker 产生了该报文”，**不能**证明某个链上地址产生了它 —— 从公钥派生地址需要 keccak256，而 Node 标准库不提供。编排器把配置的 agent 地址记在签名旁边，具备 keccak 的校验方日后可闭环。这是**已登记的已知限制**，不要当成已解决。
- **可插拔传输**：`HardwareTelemetryCollector.sendHeartbeat()` POST 到 `MAOTANG_HEARTBEAT_URL`（回退 `MAOTANG_TELEMETRY_URL`）；气隙节点与测试使用 `log` 传输。循环是 fail-soft 的：广播失败只记录并排下一次 tick —— 到不了编排器的节点仍然要能干活。
- **密钥纪律**：worker 私钥是**独立变量**（`MAOTANG_WORKER_PRIVATE_KEY`），必须是专用节点密钥；复用部署密钥意味着节点密钥泄露即部署账户被清空。
- **RPC 通道（线上可用）**：`https://rpc.008ai.online` 经 Cloudflare 隧道指向本地 EVM 节点。`scripts/rpc-guard.mjs` 在其前方做**方法级**拒绝：`anvil_*` / `evm_*` / `debug_*` / `trace_*` / `admin_*` / `personal_*` / `txpool_*` / `miner_*` / `hardhat_*` / `erigon_*` / `parity_*`，以及以节点解锁账户签名的 `eth_accounts` / `eth_sendTransaction` / `eth_signTransaction` / `eth_sign` / `eth_signTypedData*`；被拒的调用返回 `403` 且带 `x-rpc-guard: blocked`，绝不转发。
- **CORS 终止（本轮修复）**：护栏现在对 `OPTIONS` 预检返回 `204` 并附带 `Access-Control-Allow-Origin/Methods/Headers`，转发响应也带同样的头。在此之前浏览器/移动 WebView 的预检拿到 `405`，**任何**前端都无法读取该通道。
- **看板读取路径**：`frontend/` 只读地遍历 `MaoTangFactory.launchCount()` / `launchAt(i)`（上限 12 条，8 秒轮询），地址来自 `frontend/config/contracts.json` 经 `next.config.ts` 注入的 manifest 值（ADR-019）。

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
cd D:\git008\agent-client; npm test        # 心跳、指纹与签名往返
```

---

## 5. Module 5 — Bio-Sovereign Anti-Sybil & Security Layer

**职责**：用零知识证明与生物认证，把 Agent 与 Cell 单元**严格绑定到唯一的生物主人**，让“伪人批量生成”和“黑客整体接管”在结构上不成立。

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

落地要素：Secure Enclave / StrongBox 不可导出密钥、生物门禁绑定、会话密钥轮换与吊销、以及 Cell 单元由 nullifier 派生绑定（防“伪人凭空生成 Cell”）。**当前均未实现**，不得描述为现有能力。

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
cd D:\git008\contracts; forge test     # 人格证明、agent 注册/撤销、nullifier 重放、金库刹车与出流上限
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
| 铸造路径 2 | 挖矿奖励从**已注资**的奖励金库 `transferFrom` 转出，**不增发** | `contracts/src/MaoTangMining.sol` |
| 费用去向 | Swap 0.5% / 毕业 1.00% → `MaoTangSustenanceVault` → Dripper 按预算回流 | `MaoTangSustenanceVault.sol`、`MaoTangSustenanceDripper.sol` |

**路线图 ⬜**：v2.2 的 70% / 15% / 10% / 5% 分配（人头配额与 AI 挖矿池、DEX 流动性储备、边缘算力与 DePIN 生态、协议安全与审计金库）是**目标设计**；当前合约只硬编码了全局上限与人均配额，分配曲线尚未在合约中实现。Cell 化（§1.2）落地后，配额的治理与收益分发表达式需要同步确定。

---

## 7. 模块化里程碑（降低实现难度）

每个里程碑都能**独立交付、独立验收**，并且不阻塞其它模块 —— 这是 v3.0 相对 v2.2 的主要结构性改进。

| 里程碑 | 内容 | 依赖 | 验收证据 | 状态 |
| --- | --- | --- | --- | --- |
| **M0** | 冻结模块边界与真值表（本文 + `docs/ARCHITECTURE_5_PILLARS.md`），标注已实现/路线图 | — | 两份文档评审通过 | ✅ |
| **M1** | 端侧 SLM 接口固化 + 意图白名单（`claim_mhuman_quota`、`swap_micro_human`） | — | `agent-client` `npm test` | ✅ |
| **M2** | 曲线上线 + 金库刹车 + 出流上限 | M1 | `contracts` `forge test`、`agent-manager` `mining_e2e.py` | ✅ |
| **M3** | 移动端飞地密钥 + 阈值策略引擎 + 生物门禁 | M1 | 设备内不可导出密钥签名验证、越阈值动作需生物确认 | ⬜ P0 |
| **M4** | RPC 多端点仲裁（M4.1）+ `eth_getProof` 包含证明（M4.2） | — | 分歧端点被拒；本地 MPT 校验通过 | ⬜ P0 |
| **M5** | 轻客户端同步（M4.3）+ P2P 传输（M4.4） | M4 | 断网/单端点故障下仍可自证状态 | ⬜ P1 |
| **M6** | Cell 化 ADR + 微治理 + 按 Cell 分发收益 | M3、M4 | 新 ADR；治理与分发测试 | ⬜ P1 |
| **M7** | 挖矿心跳上链（第三种 proof type，单独评审） | M2 | 新 proof type 的评分与拒绝路径测试 | ⬜ P2 |

> **PQC 前瞻**：后量子密码学（PQC）与量子抗性生物主权的完整备忘录见 **§9**，其里程碑为 M8–M11。

---

## 8. 现状与差距

本文定义**愿景、模块边界与里程碑**，不重复实现细节。权威细节与合规差距请看：

- `docs/MAOTANG_ARCHITECTURE.md` —— 组件、曲线模型、认证、SLM 引擎、DePIN 拓扑、跨链路由、金库滴灌的实现级规格（§3–§15）。
- `docs/GAP_ANALYSIS.md` —— v2.2 合规矩阵、P0/P1 待办与验证日志。
- `docs/ARCHITECTURE_5_PILLARS.md` —— 上述 5 个模块的接口、数据契约、目录归属与并行交付切分。
- `memory/ARCHITECTURE_DECISIONS.md` —— ADR-018（金库刹车与出流上限）、ADR-019（看板绑定与工厂注册表读取）、ADR-020（本 5 支柱架构）、ADR-021（PQC 与量子抗性生物主权前瞻）。

---

## 9. Future Evolution: Post-Quantum Cryptography (PQC) & Quantum-Resistant Bio-Sovereignty

**未来演进备忘录：后量子密码学与量子抗性生物主权**

> **状态声明：本节全部为 ⬜ 路线图 / 前瞻设计，不描述任何现有能力。** 仓库中**没有任何** PQC 原语、量子加速或神经形态硬件的实现或依赖。本节的作用是提前记录威胁模型、迁移路径与必须在**现在**就预留的接口与出口，因为密码学迁移的工程周期以年计，而链上已部署的验证器**不可变**。

### 9.1 威胁模型：Shor 算法对 ECDSA 与 BN254 配对的威胁

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

### 9.2 迁移路线（P1–P5，全部 ⬜）

| 阶段 | 内容 | 关键取舍 |
| --- | --- | --- |
| **P1 混合授权 (Hybrid)** | 本地钱包在经典 ECDSA 之上**叠加** PQC 签名，两者都通过才放行：ML-DSA / Dilithium（NIST FIPS 204）或 SLH-DSA / SPHINCS+（FIPS 205） | 格基签名体积小、验签快但假设较新；哈希基签名最保守但签名大（KB 级）。移动端带宽与存储需重新评估 |
| **P2 后量子验证器** | 把人格/硬件证明从 BN254 Groth16 迁移到**透明、基于哈希的证明系统**（STARK 家族）或格基 SNARK | 哈希基证明只受 Grover 平方根影响且**无需可信 setup**；代价是证明体积大、链上验证 gas 高 → 需递归压缩或 L2 验证、L1 只锚定承诺 |
| **P3 链上 PQC 原语** | 推动/等待 PQ 验签 precompile 或 PQC 友好的执行环境 | 今天不存在 PQC 签名 precompile；自建 rollup 内验证是可控替代 |
| **P4 状态迁移纪元** | 用“迁移纪元（migration epoch）”把 $mHUMAN 配额、agent 绑定、已消费 nullifier 迁移到新 verifier / registry | **见 §9.3 的不可变约束**：必须在合约层预留出口，否则未来只能靠社会共识分叉 |
| **P5 密钥轮换常态化** | 结合账户抽象（ERC-4337 / EIP-7702 风格）+ 多签 / 时间锁，把轮换做成常规操作 | 让“换密钥”不再是迁移事件，而是运维动作 |

### 9.3 关键工程结论：PQC 迁移是“新部署 + 状态迁移”，不是“升级”

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

### 9.4 生物主权护城河：Biological Root of Trust

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

### 9.5 与移动端量子加速 / 神经形态边缘芯片的协同（⬜ 远期）

如果未来移动端出现量子加速器或神经形态（neuromorphic）芯片，Module 1 的推理与 Module 4/5 的密码学验证可以下沉到这些加速器，实现**近零延迟的本地证明验证与主权收益管理**（例如：签名与验签、证明生成、风险策略推理都在端侧完成，云端不参与）。

**今天就能准备的事（低成本、与硬件无关）**：

- **算力与算法全部通过接口抽象**：Module 1 的 `SlmEngine`（后端可插拔）、Module 2 的注入式 signer（不假设曲线与算法）、Module 4 的 transport（与加速器解耦）、Module 5 只依赖 `IZKVerifier` 抽象 —— 新增硬件后端**不应改动业务层**。
- **确定性回退必须永久保留**：纯 CPU 的确定性路径不可删除，否则设备换代即协议不可用（与 §4 的心跳“fail-soft”原则一致）。
- **明确边界**：今天**没有**任何量子加速或神经形态硬件在实现或依赖中；这一节纯粹是接口预留与协同设想。

### 9.6 PQC 里程碑（扩展 §7）

| 里程碑 | 内容 | 依赖 | 验收证据 | 状态 |
| --- | --- | --- | --- | --- |
| **M8** | 混合签名授权（ECDSA + ML-DSA 或 SLH-DSA），两者都通过才放行 | M3 | 单侧被攻破时仍拒绝；双签验签测试 | ⬜ |
| **M9** | **可迁移出口**：registry 版本纪元 + 一次性重签发窗口 + nullifier 迁移格式 | M5 | 旧纪元冻结→新纪元迁移的端到端演练；跨纪元重放被拒 | ⬜ **P0（前瞻，成本最低）** |
| **M10** | 用哈希基（STARK）或格基证明系统替换 BN254 Groth16 | M9 | 新 verifier 的拒绝路径测试 + 证明体积/gas 实测 | ⬜ |
| **M11** | 加速器后端接口（量子 / 神经形态），保留 CPU 确定性回退 | M1、M4 | 同一接口下多后端等价性测试 | ⬜ |

> 关联记录：§5.3 威胁模型与现有控制、`docs/ARCHITECTURE_5_PILLARS.md` §12（逐模块影响）、`memory/ARCHITECTURE_DECISIONS.md` **ADR-021**。

---
## Appendix A. 事实来源与复现命令

| 模块 | 主要源码 | 复现命令 |
| --- | --- | --- |
| 1 SLM | `agent-client/src/slm/`、`src/intents/`、`test/local-agent.test.ts` | `cd agent-client; npm test` |
| 2 钱包 | `agent-manager/src/mining/transport.mjs`、`sdk/src/agent-client.ts` | `cd agent-manager; python test/mining_e2e.py` |
| 3 收益/挖矿 | `contracts/src/{MaoTangBondingCurve,MaoTangSustenanceVault,MaoTangSustenanceDripper,MaoTangMining}.sol`、`sdk/src/curve-math.ts` | `cd contracts; forge test` |
| 4 轻节点 | `agent-client/src/telemetry.ts`、`scripts/rpc-guard.mjs`、`frontend/src/lib/chain.ts` | 见 §4.3 的 curl 与 `npm test` |
| 5 反女巫 | `contracts/src/{Groth16Verifier,AIAgentRegistry,HumanToken}.sol` | `cd contracts; forge test` |
| 地址真源 | `frontend/config/contracts.json`（部署时重写） | `cd frontend; npm run build` 注入 manifest |

## Appendix B. Module Summary (English)

1. **Edge SLM & Cell Division** — a local-only intent engine (`SlmEngine`, Qwen2.5-0.5B INT4, 500 MiB ceiling, cloud endpoints rejected by assertion) is the *sole* interface between the biological owner and the network. Genesis activation mints a one-million-unit `$mHUMAN` quota per verified human; subdividing that quota into 1,000,000 addressable **Cell Tokens** for micro-governance and liquid yield distribution is a **roadmap** item requiring its own ADR.
2. **Autonomous Local Wallet** — keys, signatures and broadcasts stay on the device; signing is dependency-injected through a TEE / Secure-Enclave signer behind a fail-closed egress guard. Real hardware enclaves, biometric gating and a threshold policy engine are **roadmap**.
3. **Yield, Sustenance & Mining Engine** — a virtual-reserve constant-product bonding curve (30 ETH virtual reserve, 5 ETH graduation target, 0.50% swap / 1.00% graduation fees) plus **non-PoW** proof-of-physical-work mining (BLE proximity + attested NPU compute, replay-nullifiers, per-epoch cap, non-dilutive reward vault). Fees return to the owner through the Sustenance Vault, now with a payout brake and a rolling native-outflow cap.
4. **Mobile Blockchain Light Node** — a signed hardware heartbeat advertises node capability today, and the board reads live state through a CORS-enabled, admin-method-filtered RPC (`https://rpc.008ai.online`). Trustless verification is staged: multi-endpoint quorum, then EIP-1186 inclusion proofs against the state root, then a header-syncing light client, then P2P. Only the first stage exists as a plan; the current endpoint is *trust-minimised*, not trustless.
5. **Bio-Sovereign Anti-Sybil & Security Layer** — Groth16 personhood and hardware-attestation proofs bind one agent and one hardware nullifier to one human, each spendable once, revocable by the owner, with the verifier failing closed until the ceremony key is installed and irreversibly frozen afterwards. Biometric (FaceID) local authorisation is the **roadmap** half of the design.