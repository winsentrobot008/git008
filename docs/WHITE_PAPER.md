# MAOTANG Protocol — White Paper v3.1

**猫糖协议白皮书 v3.1 — 移动端原生自主 AI 矿工与主权财富管家**

*Revision: v3.1, 2026-10-09. 本文取代 `docs/WHITEPAPER_v2.md`（v2.2），并把协议重组为 5 个可独立实现、可独立验收的模块。v3.1 新增第 7 节（生物主权合规与隐私架构）与第 8 节（威胁模型与纵深防御矩阵），把合规与安全从散落的 §5.3 升级为独立、可审计的一等公民。*

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

**状态图例**：✅ 已实现并有可复现证据；🟡 部分实现（有明确缺口）；⬜ 路线图（尚未落地，见第 9 节里程碑）。

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
cd D:\git008\agent-manager; python test/mining_e2e.py   # 含签名/广播/护栏路径
cd D:\git008\agent-client; npm test                     # A2A 握手与 intent 校验
cd D:\git008\mobile-agent; npm run typecheck; npm test  # 阈值策略、唯一签名路径、生物授权绑定（72 断言）
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
cd D:\git008\contracts; forge test     # 人格证明、agent 注册/撤销、nullifier 重放、金库刹车与出流上限
cd D:\git008\mobile-agent; npm test    # 生物门禁拒绝路径、断言绑定与新鲜度、nullifier 确定性与重放、calldata 向量
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
- **心跳重放**：挖矿证明 nullifier `keccak256(abi.encode(proofType, agent, proofData))` 在计分前落盘，重放相同字节 revert `ReplayProof`（见 §3.2）。

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
| **M3** | 移动端飞地密钥 + 阈值策略引擎 + 生物门禁 | M1 | 设备内不可导出密钥签名验证、越阈值动作需生物确认（接口层已落地：`mobile-agent/`，72 断言） | 🟡 接口层 ✅ / 硬件后端 ⬜ P0 |
| **M4** | RPC 多端点仲裁（M4.1）+ `eth_getProof` 包含证明（M4.2） | — | 分歧端点被拒；本地 MPT 校验通过 | ⬜ P0 |
| **M5** | 轻客户端同步（M4.3）+ P2P 传输（M4.4） | M4 | 断网/单端点故障下仍可自证状态 | ⬜ P1 |
| **M6** | Cell 化 ADR + 微治理 + 按 Cell 分发收益 | M3、M4 | 新 ADR；治理与分发测试 | ⬜ P1 |
| **M7** | 挖矿心跳上链（第三种 proof type，单独评审） | M2 | 新 proof type 的评分与拒绝路径测试 | ⬜ P2 |

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

如果未来移动端出现量子加速器或神经形态（neuromorphic）芯片，Module 1 的推理与 Module 4/5 的密码学验证可以下沉到这些加速器，实现**近零延迟的本地证明验证与主权收益管理**（例如：签名与验签、证明生成、风险策略推理都在端侧完成，云端不参与）。

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
2. **Autonomous Local Wallet** — keys, signatures and broadcasts stay on the device; signing is dependency-injected through a TEE / Secure-Enclave signer behind a fail-closed egress guard. The threshold policy engine, the single signing path and the biometric/nullifier seams now exist as reviewed interface layers in `mobile-agent/` - and they refuse to sign until a device backend is injected, so an unconfigured build cannot silently fall back to a software key. Real hardware enclaves and device biometric backends remain **roadmap**.
3. **Yield, Sustenance & Mining Engine** — a virtual-reserve constant-product bonding curve (30 ETH virtual reserve, 5 ETH graduation target, 0.50% swap / 1.00% graduation fees) plus **non-PoW** proof-of-physical-work mining (BLE proximity + attested NPU compute, replay-nullifiers, per-epoch cap, non-dilutive reward vault). Fees return to the owner through the Sustenance Vault, now with a payout brake and a rolling native-outflow cap.
4. **Mobile Blockchain Light Node** — a signed hardware heartbeat advertises node capability today, and the board reads live state through a CORS-enabled, admin-method-filtered RPC (`https://rpc.008ai.online`). Trustless verification is staged: multi-endpoint quorum, then EIP-1186 inclusion proofs against the state root, then a header-syncing light client, then P2P. Only the first stage exists as a plan; the current endpoint is *trust-minimised*, not trustless.
5. **Bio-Sovereign Anti-Sybil & Security Layer** — Groth16 personhood and hardware-attestation proofs bind one agent and one hardware nullifier to one human, each spendable once, revocable by the owner, with the verifier failing closed until the ceremony key is installed and irreversibly frozen afterwards. Local biometric authorisation now has its interface layer in `mobile-agent/bio-auth/` (a refusing device gate, an assertion-binding adapter, and a one-shot hardware-nullifier registry that derives from device material and defers to the chain); a real device backend and proof generation remain the **roadmap** half of the design.
