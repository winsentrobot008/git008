# MAOTANG Protocol — Architecture: The 5 Pillars

**移动端原生自主 AI 矿工与主权财富管家 —— 五支柱模块架构与交付切分**

*Revision: 2026-10-08. 配套文档：`docs/WHITE_PAPER.md`（愿景与真值表）、`docs/MAOTANG_ARCHITECTURE.md`（实现级规格 §3–§15）、`docs/GAP_ANALYSIS.md`（合规差距）。*

---

## 0. 本文目的

把协议切成 **5 个可以并行开工、可以独立验收** 的模块，明确每个模块**拥有什么、对外暴露什么、消费什么、禁止碰什么**，从而：

- 降低单点实现难度：每个模块都能被一个开发者在一个里程碑内完成并验收；
- 消除跨模块耦合：模块之间只通过下表的接口通信，改动一侧不需要另一侧同步重构；
- 让“已实现 / 路线图”可被机械核对（每节都有验收命令）。

状态标记沿用白皮书：**✅ 已实现**、**🟡 部分实现**、**⬜ 路线图**。

### 0.1 分层视图

```text
┌─────────────────────────────────────────────────────────────────────────┐
│ L5  主人 (Biological Owner)  —— 只表达意图、做终极决策、消费收益          │
└──────────────────────────────┬──────────────────────────────────────────┘
                               │ 生物门禁 (FaceID/指纹) ⬜ M3
┌──────────────────────────────▼──────────────────────────────────────────┐
│ L4  Mobile Terminal (设备内)                                             │
│  ┌─ Module 1  Edge SLM  ──────────┐  ┌─ Module 2  Local Wallet ────────┐ │
│  │ SlmEngine (llama.cpp / ONNX)   │  │ Secure-Enclave signer (注入)    │ │
│  │ intents: claim / swap          │  │ 阈值策略引擎 ⬜                 │ │
│  └────────────────┬───────────────┘  └───────────────┬─────────────────┘ │
│                   │ AgentClient (A2A 握手 + intent)   │                   │
│  ┌────────────────▼───────────────────────────────────▼─────────────────┐ │
│  │ Module 4  Light Node / RPC 校验  ✅只读RPC 🟡 / 轻客户端 ⬜            │ │
│  └────────────────────────────────┬─────────────────────────────────────┘ │
└───────────────────────────────────┼──────────────────────────────────────┘
                                    │ HTTPS JSON-RPC (方法级护栏 + CORS)
┌───────────────────────────────────▼──────────────────────────────────────┐
│ L3  Edge Transport                                                       │
│  scripts/rpc-guard.mjs (拒绝 anvil_*/evm_*/eth_accounts/...)              │
│  Cloudflare tunnel rpc.008ai.online → 本地 EVM 节点                       │
└───────────────────────────────────┬──────────────────────────────────────┘
                                    │ eth_call / eth_sendRawTransaction
┌───────────────────────────────────▼──────────────────────────────────────┐
│ L2  MAOTANG Contracts                                                    │
│  Module 5  Bio-Sovereign: Groth16Verifier · AIAgentRegistry · HumanToken  │
│  Module 3  Yield/Mining:  BondingCurve · SustenanceVault · Dripper ·      │
│                           Mining · SustenanceVaultSpoke                   │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 1. 模块边界与接口契约

| 模块 | 拥有（owns） | 对外暴露（exposes） | 消费（consumes） | 禁止（must not） |
| --- | --- | --- | --- | --- |
| **M1 Edge SLM & Cell** | `agent-client/src/slm/`、`agent-client/src/intents/`、`mobile-agent/slm/`（移动端离线引擎 + intent 翻译，✅ 接口层）、`contracts/src/HumanToken.sol`（配额语义） | `SlmEngine`、`LocalSlmEngineAdapter`、`IntentTranslator`、`assertNoCloudDependencies()`、`parseToolCall()`、工具 `claim_mhuman_quota` / `swap_micro_human`、`HUMAN_QUOTA` | 链上注册状态（只读）、人格证明（M5） | 引入任何云端 LLM 端点；绕过 `parseToolCall` / `IntentTranslator` 校验直接把模型参数送到钱包 |
| **M2 Local Wallet** | `mobile-agent/signer/`（阈值策略与唯一签名路径，✅ 接口层）、`agent-manager/src/mining/transport.mjs`、签名器注入契约 | 注入式 signer 接口、`eth_sendRawTransaction` 广播、fail-closed egress guard | M1 的已校验 intent、M4 的 RPC 通道 | 在应用层持有明文私钥；复用部署密钥作为节点密钥；静默降级为“无护栏发送” |
| **M3 Yield / Sustenance / Mining** | `contracts/src/{MaoTangBondingCurve,MaoTangSustenanceVault,MaoTangSustenanceDripper,MaoTangMining,SustenanceVaultSpoke}.sol`、`sdk/src/curve-math.ts`、`agent-manager/src/mining/` | 曲线报价/买卖、`submitMiningProof`、`claimMiningRewards`、金库入账与滴灌、刹车与出流上限 | M5 的 `requireAuthorizedAgent` 闸门 | 增发奖励（奖励只能 `transferFrom` 注资）；绕过 `AgentGated` 开新入口 |
| **M4 Light Node / RPC** | `agent-client/src/telemetry.ts`、`scripts/rpc-guard.mjs`、`scripts/cloudflare-waf.ps1`、`frontend/src/lib/{chain,protocol,hooks}.ts`、`frontend/next.config.ts` | 心跳报文与能力广播、受护栏的 JSON-RPC、看板只读读取、地址 manifest | 链上只读方法（`eth_call`/`eth_getProof`） | 转发管理方法（`anvil_*`/`evm_*`/解锁账户签名）；在看板里签名（`write()` 必须抛错） |
| **M5 Bio-Sovereign** | `contracts/src/{Groth16Verifier,AIAgentRegistry,HumanToken}.sol`、`mobile-agent/bio-auth/`（生物授权通道与硬件 nullifier，✅ 接口层） | `verifyProof`、`registerAgent`、`claimHumanQuota`、`requireAuthorizedAgent`、`lockVerificationKey` | 电路 ceremony key（运维注入） | 在 verifier 中硬编码 key；开后门跳过 nullifier 一次性消费 |

> **接口即契约**：上表“对外暴露”列出的符号是跨模块唯一允许的耦合点。任何新符号进入该列，都必须在本文件登记，并在同一变更里补上验收命令。

---

## 2. Module 1 — Edge SLM & Cell Division

**状态**：SLM 运行时（`agent-client/src/slm`）✅ / 移动端 M1（`mobile-agent/slm/`：离线引擎 + intent 翻译）✅ 接口层 / Cell 化 ⬜（M6）

**目录归属**：`agent-client/src/slm/`、`agent-client/src/intents/`、`agent-client/test/local-agent.test.ts`、`mobile-agent/slm/`（移动端 M1，本次新增）、`contracts/src/HumanToken.sol`（配额语义）

**接口**

- `SlmEngine` —— 单一接口，两个可选后端：`llama.cpp`（`node-llama-cpp`，GGUF）与 ONNX Runtime（`onnxruntime-node`，INT4）。两者都是**动态 import 的可选依赖**，缺失时包仍可构建。
- 默认模型 Qwen2.5-0.5B-Instruct INT4（权重约 397 MiB）；常驻内存估算含 fp16 KV cache 与运行开销，**硬上限 500 MiB**，超预算默认拒绝（`allowOverBudget` 显式豁免）。
- `assertNoCloudDependencies()` —— 本地性是断言而非承诺；`mode: "native"` 失败时**大声报错**。
- **移动端 M1 引擎（本次新增，接口层 ✅）**：`mobile-agent/slm/slm-engine.ts` 是 `agent-client/src/slm` 的移动端姊妹实现，**零运行时依赖**。`LocalSlmEngineAdapter` 只接受**进程内**后端（`llama.cpp` / `onnxruntime-mobile` / `mlc` / `coreml` / `tflite`），并叠加两层本地性强制：(a) `assertNoCloudDependencies(descriptor)` 拒绝端点、凭据、URI、云 SDK 名与 **loopback 模型服务器**（`ollama` 也拒绝——HTTP 一跳就是把 socket 放进签名路径）；(b) 每次推理期间把 `fetch` / `XMLHttpRequest` / `WebSocket` / `EventSource` 换成抛错哨兵并在 `finally` 还原，**试图联网的后端会失败而不是成功**，且没有关闭开关。未注入后端时 `infer` 抛 `SlmUnavailableError`，绝不降级到托管模型。
- **移动端 intent 翻译（本次新增）**：`mobile-agent/slm/intent-translator.ts` 把模型文本变成 `TransactionIntent`——先做**单对象**抽取（0 个或 ≥2 个顶层对象一律拒绝；歧义正是 prompt injection 的形状），再做**闭合** schema 校验（action 白名单、`valueWei` 必须是规范整数字符串 wei 且在 `limits.maxValueWeiPerIntent` 内、未知字段拒绝、`chainId` 必须等于注入清单），最后由**本模块**用与 Foundry 逐字节对齐的 encoder 生成 calldata，目标地址来自注入的部署清单——**模型从不提供地址、chain、calldata 或 proof**。模型自述的 `reason` 只作备注，绝不进入授权提示文案。
- 两个严格工具：`claim_mhuman_quota`、`swap_micro_human`；`parseToolCall()` 抽取、拒绝未知工具、校验每个参数后才允许触达钱包。

**数据契约**：ChatML system prompt → **恰好一次** tool call JSON → 校验通过 → 结构化 intent（`AgentClient.executeIntent`）。

**失败语义**：原生运行时缺失 = 明确失败（绝不静默降级到 simulated）；参数非法 = 拒绝且不产生任何链上调用。

**缺口**：合约层**没有 Cell 类型**。当前创世是“1 个已验证的活体人类 → 1,000,000 $mHUMAN 配额（`decimals = 6`）”，即单一 ERC-20 余额。细胞化（1 份配额细分为 1,000,000 个可寻址单元）需先出 ADR：记账视图 / 独立 ERC-20 / NFT 家族三选一，对 gas、可组合性与反女巫边界影响不同。

**验收**：`cd D:\git008\agent-client; npm test`；`cd D:\git008\mobile-agent; npm run typecheck; npm test`（144 条断言，含 M1 离线隔离与 intent 拒绝路径、M1→M5→M2 端到端）

**难度**：SLM 接口固化 = S（已完成）；移动端 M1 接口层 = S（已完成）；Cell 化 = L（含 ADR）。详见 `docs/MOBILE_AGENT_M2_M5.md`。

---

## 3. Module 2 — Autonomous Local Wallet

**状态**：接口层 ✅ / 真实移动飞地 ⬜（M3）。阈值策略引擎与签名路径的**接口层已落地**于 `mobile-agent/signer/`（含 110 条断言的测试）

**目录归属**：`mobile-agent/signer/`（本次新增）、`mobile-agent/bio-auth/`（M5 侧的授权通道）、`agent-manager/src/mining/transport.mjs`、`sdk/src/agent-client.ts`

**接口**

- **注入式签名器**：`transport.mjs` 构建交易后交给**注入的 TEE / Secure-Enclave signer** 签名，再经 `eth_sendRawTransaction` 广播。签名器是依赖注入的接口，应用层永远不持有明文私钥。
- **fail-closed 出站护栏**：未配置放行规则时**不发包**，而不是默认放行。
- `AgentClient.agentLogin()` —— 派生 agent 地址、校验链上注册、要求当前账户就是该 agent、验证一次签名挑战（A2A 握手）后才允许 intent 执行。
- **阈值策略引擎（接口层 ✅ 本次落地）**：`mobile-agent/signer/policy.ts` —— 目标地址白名单、selector 白名单、单笔上限、滚动窗口上限、链 ID 绑定，超阈值必须主人生物确认。**缺信息即拒绝**：空白名单拒绝一切、`null` 策略拒绝一切、上限与阈值均含等号（恰好等于上限放行、多 1 wei 拒绝）。执行顺序固定为 策略 → 授权 → 签名 → 记账；任一环拒绝都不消耗窗口额度、也不产生签名。
- **唯一签名路径（接口层 ✅ 本次落地）**：`AutonomousWallet.signIntent()` 是唯一能产出签名的方法（刻意没有旁路 sibling）；intent digest 用 SHA-256 + 领域分隔 + 长度前缀字段（`keccak256` 不在 Node 标准库内，且该 digest 从不上链，故不假装兼容）；`SecureEnclave` 接口**不提供导出私钥的方法**。
- **默认拒绝的飞地**：`createSecureEnclave()` 默认返回 `HardwareEnclave`，每个方法都抛 `EnclaveUnavailableError` 并点名 iOS/Android 平台 API；`DevEnclave` 仅供桌面与测试，且拒绝 `NODE_ENV=production`（除非显式豁免）。
- **原生硬件适配器（本次新增：适配层 ✅ / 真实桥 ⬜）**：`signer/native-enclave.ts` 的 `NativeBridgeEnclave` 实现同一 `SecureEnclave` 接口，委托给宿主注入的 `NativeCryptoProvider`（iOS `SecKeyCreateSignature` + Secure Enclave、Android `Signature` + StrongBox/TEE）。适配器只强制**互操作性**——secp256k1 曲线、SPKI 与未压缩点一致、payload 必须是预哈希、签名**释放前先验签**——不替策略判断 `hardwareBacked`（那由花钱策略裁决）。**本仓库不含 Swift/Kotlin 桥本身**；未注入桥时与 `HardwareEnclave` 一样全部拒绝。

**数据契约**：已签名的 raw transaction 十六进制串；私钥只以**进程环境变量**形式注入子进程，不落盘、不缓存。

**环境键（仅登记键名，不登记值）**：`MAOTANG_AGENT_ID`、`MAOTANG_WORKER_PRIVATE_KEY`、`MAOTANG_HEARTBEAT_URL`、`MAOTANG_TELEMETRY_URL`、`MAOTANG_HEARTBEAT_MS`、`MAOTANG_SLM_MODEL`。

**失败语义**：广播错误 → 记录并排下一次 tick（fail-soft，节点必须继续工作）；护栏未放行 → **不发送**（fail-closed）。两类失败的日志必须可区分。

**已知边界**：worker 私钥必须是**专用节点密钥**；复用部署密钥意味着节点密钥泄露即部署账户被清空。

**验收**：`cd D:\git008\mobile-agent; npm run typecheck; npm test`（144 条断言，含 Foundry `cast` 逐字节 calldata 向量与“拒绝路径”断言）；`cd D:\git008\agent-manager; python test/mining_e2e.py`；`cd D:\git008\agent-client; npm test`

**难度**：接口层（含阈值策略）= S（已完成）；移动端硬件飞地 + 生物门禁后端 = L。详见 `docs/MOBILE_AGENT_M2_M5.md`。

---

## 4. Module 3 — Yield, Sustenance & Mining Engine

**状态**：✅（跨链 spoke 与心跳上链为 ⬜）

**目录归属**：`contracts/src/{MaoTangBondingCurve,MaoTangSustenanceVault,MaoTangSustenanceDripper,MaoTangMining,SustenanceVaultSpoke}.sol`、`contracts/test/`、`sdk/src/curve-math.ts`、`agent-manager/src/mining/{constants,abi,telemetry,transport,background-miner}.mjs`

**接口与常量**

| 层 | 符号 | 说明 |
| --- | --- | --- |
| 曲线 | `calculatePrice()` / `target()` / `token()` / `creator()` / `graduateToMarket()` | 报价、目标、代币、创建者、毕业 |
| 曲线常量 | `VIRTUAL_RESERVE_WEI` 30 ETH · `VIRTUAL_TOKEN_SUPPLY` 1,073,000,000 · `GRADUATION_TARGET_WEI` 5 ETH · `TRADE_FEE_BPS` 50 · `GRADUATION_FEE_BPS` 100 | 与 `sdk/src/curve-math.ts` 逐公式镜像 |
| 工厂 | `launchCount()` / `launchAt(uint256)` / `createMemeToken(string,string)` | 注册表 + 发起 |
| 挖矿 | `submitMiningProof(bytes32,bytes)` / `claimMiningRewards()` / `fundRewardVault` / `pendingMiningRewards[agent]` / `MAX_EPOCH_REWARD` / `PROOF_TYPE_BLE_PING` / `PROOF_TYPE_ZK_COMPUTE` | 非 PoW 的物理+计算工作证明 |
| 金库 | `nativeFeesReceived()` / `availableNative()` / `pause()` / `unpause()` / `setGuardian` / `setNativeOutflowCap(cap, windowSeconds)` / `nativeOutflowRemaining()` | 入账、刹车、出流上限 |
| 滴灌 | `MaoTangSustenanceDripper` 的签名报文与预算记账 | 分批释放，避免一次性外流 |

**必须成立的不变量**

1. 曲线整数除法一律**向池子截断**，因此恒定乘积不变量不会逆向漂移。
2. 挖矿每条证明只计分一次：nullifier `keccak256(abi.encode(proofType, agent, proofData))` 在计分前落盘，重放 revert `ReplayProof`。
3. 奖励**从已注资的奖励金库 `transferFrom` 转出，从不增发** → 挖矿不稀释持有者。
4. `pause()` 只冻结三条出金路径，**不阻断** `receive()` / `depositFee*` / `credit*` / `fundDripBudget*`，因此暂停期间记账继续、恢复后不丢账。
5. `guardian` 单向：只能下闸，不能松开、不能转账。

**跨模块契约（防漂移）**：`agent-manager/src/mining/constants.mjs` 是链上常量的唯一真源；`test/mining_e2e.py` 用 keccak256 向量重新派生每个 selector 并断言 Solidity 与 JS 常量相等 —— 两侧不允许各自漂移。

**已知缺口**：心跳**没有链上通道**（`MaoTangMining` 无能力注册入口），需要新增第三种 proof type 并**单独评审**，不得静默扩展既有形状。

**验收**：`cd D:\git008\contracts; forge test`；`cd D:\git008\agent-manager; python test/mining_e2e.py`

**难度**：已实现；心跳上链 = M；跨链 spoke 路由 = M。

---

## 5. Module 4 — Mobile Blockchain Light Node

**状态**：只读 RPC + 护栏 + CORS ✅ / 心跳 ✅（链下）/ 免信任校验 ⬜（M4–M5）

**目录归属**：`agent-client/src/telemetry.ts`、`agent-client/test/telemetry.test.ts`、`scripts/rpc-guard.mjs`、`scripts/cloudflare-waf.ps1`、`frontend/src/lib/{chain,protocol,hooks}.ts`、`frontend/next.config.ts`、`frontend/config/contracts.json`

**心跳数据契约**

```text
HardwareProfile   = nodeVersion, platform, arch, cpuModel, cpuCount, memoryBytes,
                    gpus[{ vendor, name, vramBytes, nvencCapable, source }],
                    nvenc (实探测，绝不假设), ffmpegPath,
                    slm { id, path, available, bytes, sha256 }
TelemetryEnvelope = { proofType, agent, sequence, timestamp, hardware }
digest            = sha256("maotang-node-telemetry-v1" + "\n" + canonicalize(envelope))
signature         = secp256k1 ECDSA over sha256(digest)，DER 编码
proofType         = ASCII "maotang.telemetry.node.v1" 右填充至 32 字节
```

- `sequence` 是每进程单调计数器，**干跑不递增** —— 节点无法用“构建了但没发送”的心跳让编排器失步。
- `slm.sha256` 是权重文件的流式哈希；未配置或文件缺失时报告 `available: false`，**不编造哈希**。
- 规范化函数与 `video-worker.ts` 的内容证明**共用同一实现**，两个独立实现不会对“哈希背后的字节”产生分歧。

**已登记的诚实限制**：签名证明的是“持有节点密钥的 worker 产生该报文”，**不是**某个链上地址 —— 从公钥派生地址需要 keccak256，Node 标准库不提供。编排器把配置的 agent 地址记在签名旁，具备 keccak 的校验方日后可闭环。

**RPC 通道契约**

| 行为 | 结果 |
| --- | --- |
| 允许的读（`eth_call`、`eth_chainId`、`eth_getBalance`、`eth_getProof`、`eth_sendRawTransaction`…） | 原样转发，响应带 `x-rpc-guard: forwarded` 与 CORS 头 |
| 拒绝的管理方法（`anvil_*`/`evm_*`/`debug_*`/`trace_*`/`admin_*`/`personal_*`/`txpool_*`/`miner_*`/`hardhat_*`/`erigon_*`/`parity_*`、`eth_accounts`、`eth_sendTransaction`、`eth_signTransaction`、`eth_sign`、`eth_signTypedData*`） | `403` + JSON-RPC `-32601` + 调用方自己的 `id` + `x-rpc-guard: blocked`，**绝不转发**；批量请求整体拒绝 |
| `OPTIONS` 预检 | `204` + `Access-Control-Allow-Origin/Methods/Headers`（缺此项浏览器一律读不到） |
| `GET /healthz` | `200 {"status":"ok"}` |

**看板读取契约**：`frontend/src/lib/protocol.ts` 的 `CONTRACT_READS` 是**选择器登记表**（名称 → selector + 返回类型 + 元数）。transport 只认登记表，**未登记的函数直接抛错**而不是猜编码。`fetchLaunches()` 走 `launchCount()` / `launchAt(i)`，新到旧、上限 12 条、8 秒轮询；地址来自 `next.config.ts` 注入的 `NEXT_PUBLIC_MANIFEST_*`（源 = `frontend/config/contracts.json`），显式 `NEXT_PUBLIC_MAOTANG_*` 变量优先。

**信任分层（⬜ 全部未实现，见白皮书 §4.2）**：M4.1 多端点仲裁（S）→ M4.2 `eth_getProof` 包含证明（M）→ M4.3 轻客户端同步（L）→ M4.4 P2P 传输（L）。**在 M4.2 落地前，不得声称“免信任状态验证”。**

**验收**：见白皮书 §4.3（curl 预检 204、`eth_chainId` 通过、`anvil_reset` 被 403、`agent-client` `npm test`）。

---

## 6. Module 5 — Bio-Sovereign Anti-Sybil & Security Layer

**状态**：ZK 绑定 ✅ / 生物特征通道（接口层 ✅ 本次落地于 `mobile-agent/bio-auth/`）/ 真实设备后端（Secure Enclave、FaceID/WebAuthn）⬜（M3）

**目录归属**：`contracts/src/{Groth16Verifier,AIAgentRegistry,HumanToken}.sol`、`contracts/src/interfaces/IZKVerifier.sol`、`contracts/test/`、`mobile-agent/bio-auth/`（本次新增）

**接口**

- `IZKVerifier.verifyProof(...)` / `Groth16Verifier`
- `AIAgentRegistry.registerAgent(agentPubKey, hardwareProof, hardwareNullifier)`、`agentAddress(agentPubKey)`、`requireAuthorizedAgent(agent)`
- `HumanToken.claimHumanQuota(proof, nullifierHash)`、`HUMAN_QUOTA`、`MAX_GLOBAL_SUPPLY`、`decimals()`
- `lockVerificationKey()`

**必须成立的不变量**

1. 一个公钥只能绑定一次；一个硬件 nullifier 只能绑定一次。
2. 一个 nullifier 只能消费一次配额（`claimHumanQuota` 幂等拒绝重放）。
3. 人类主人可**随时撤销**其 agent。
4. verifier 在主人安装 ceremony key 之前**失败关闭**；`lockVerificationKey()` 之后**不可逆冻结**。
5. `totalSupply` 永远不超过 `MAX_GLOBAL_SUPPLY`。
6. 曲线、市场与挖矿入口继承 `AgentGated` → **M3 的每个写入口都经过同一道门**。

**生物通道（⬜ M3）**：链上匿名（ZK 人格证明只证明唯一性，不暴露身份）+ 本地具名（FaceID/指纹通过后，飞地才用不可导出 P-256 密钥签发会话密钥，允许执行**超阈值**动作）。Cell 单元由 nullifier 派生绑定，防止“伪人凭空生成 Cell”。

**已落地的接口层（本次变更）**

- `biometric-gate.ts`：`DeviceBiometricGate`（默认实现，全部方法抛 `BiometricUnavailableError` 并点名 `LAContext` / `BiometricPrompt` / WebAuthn API）与 `SimulatedBiometricGate`（必须显式 `{ enabled: true }` 才工作；`hardwareBacked` **恒为 `false`**，因此永远无法满足 `requireHardwareBackedAuthorization`）。
- `BiometricAuthorizationGate`：把设备断言适配到 M2 的 `AuthorizationGate`。强制三件事：断言必须**回显同一个 digest**（防止把 A 交易的指纹按到 B 交易上）、来源 key 必须一致、`grantedAt` 必须新鲜（默认 120s，含等号边界）且不得来自未来（容忍 5s 时钟偏移）。
- `nullifier.ts`：硬件 nullifier 派生（SHA-256 + 领域分隔 + 长度前缀字段，末尾对 `SCALAR_FIELD` 取模并拒绝 0）+ 本地一次性登记表（`reserve` / `consume` / `release` / `markSpentOnChain`）。**链上 `HumanToken.nullifierUsed` 才是权威**，本地表只是乐观守卫，进程重启即为空。
- `native-biometric-gate.ts`（本次新增：适配层 ✅ / 真实桥 ⬜）：`NativeBridgeBiometricGate` 包一层 `NativeBiometricProvider`（`LAContext` / `BiometricPrompt` / WebAuthn），**由适配器自身验证**平台返回的挑战签名，验签通过才报 `hardwareBacked: true`；支持 `pinnedAssertionPublicKey` 绑定主人登记的断言公钥。
- **未做实的事**：没有生成 Groth16 证明（只按给定 proof blob 编码 calldata），没有 Swift/Kotlin 原生桥与平台密钥证明链校验（Android `x5c` / iOS `SecKey` attestation，适配层与契约已就位），没有 PQC。

**验收**：`cd D:\git008\contracts; forge test`；`cd D:\git008\mobile-agent; npm test`（生物门禁拒绝路径、断言绑定/新鲜度、nullifier 确定性与重放断言）

**难度**：ZK 绑定 = ✅；生物门禁与 nullifier 接口层 = ✅（接口层）；移动端真实生物/飞地后端 = L。详见 `docs/MOBILE_AGENT_M2_M5.md`。

---

## 7. 并行交付切分

写集（write set）互斥即可并行。**共享文件 = 必须串行或先协商接口**。

| 并行对 | 互斥？ | 说明 |
| --- | --- | --- |
| M1 × M3 | ✅ 可并行 | 目录不相交（`agent-client/` vs `contracts/`+`agent-manager/src/mining/`） |
| M1 × M4 | ✅ 可并行 | 除 `agent-client/src/telemetry.ts` 与 `src/slm/` 同属 `agent-client/` → 同仓不同目录，注意 lint/测试一起跑 |
| M3 × M4 | ✅ 可并行 | `contracts/` vs `frontend/`+`scripts/` |
| M4 × M5 | ✅ 可并行 | 除 `contracts/src/Groth16Verifier.sol`（只读引用） |
| M1 × M5 | ⚠️ 需协商 | 共享 `contracts/src/HumanToken.sol`（配额语义 vs 证明语义） |
| M1 × M2 | ⚠️ 串行 | 共享 `sdk/src/agent-client.ts`（A2A 握手 + intent 执行） |
| M2 × M3 | ⚠️ 串行 | 共享 `agent-manager/src/mining/transport.mjs`（签名与广播） |

**建议的并行节奏**：M4（多端点仲裁）与 M3（心跳上链评审）可同时开工，因为两者写集完全不相交；M5 的生物通道依赖 M2 的飞地接口，**必须先冻结 `signer` 接口再并行**。

---

## 8. 里程碑与依赖

| 里程碑 | 交付物 | 依赖 | 难度 | 可并行 |
| --- | --- | --- | --- | --- |
| M0 冻结边界 | 本文 + `docs/WHITE_PAPER.md` | — | S | ✅ 已完成 |
| M1 SLM + 意图 | `agent-client/src/slm`、`src/intents` | — | S | ✅ 已完成 |
| M2 曲线 + 金库刹车 | `contracts/src/*` | M1 | M | ✅ 已完成 |
| M3 移动端飞地 + 阈值 + 生物门禁 | 新 `signer` 接口（✅ 接口层：`mobile-agent/signer/`）+ 平台密钥存储（⬜） | M1 | L | 🟡 接口层已冻结，硬件后端待实现 |
| M4 免信任读取 | 多端点仲裁（S）→ `eth_getProof` 包含证明（M） | — | S→M | ✅ 与 M3 并行 |
| M5 轻客户端 + P2P | 区块头链同步 + P2P 传输 | M4 | L | ⬜ |
| M6 Cell 化 + 微治理 | ADR + 合约/记账 + 按 Cell 分发 | M3、M4 | L | ⬜ |
| M7 心跳上链 | 第三种 proof type（单独评审） | M2 | M | ✅ 与 M4 并行 |

---

## 9. 变更纪律（Change Discipline）

1. **新增只读方法**：必须在同一次变更里登记到 `frontend/src/lib/protocol.ts` 的 `CONTRACT_READS`（名称 + selector + 返回类型 + 元数）。transport 对未登记函数**抛错**，不猜。
2. **新增挖矿 proof type**：不得静默扩展 `submitMiningProof` 的既有形状；第三种类型需要自己的评分规则与单独评审（`docs/MAOTANG_ARCHITECTURE.md` §13.2）。
3. **`sdk/src` 改动**：必须在同一次变更内重建 `sdk/dist`（前端消费的是构建产物，`dist/` 不入库）。
4. **门禁在目标子项目目录内跑**：`contracts` 用 `forge test`，`frontend` 用 `npx tsc --noEmit`，`agent-client` / `agent-manager` 用各自测试；禁止在根目录代跑。
5. **README.md 不得进入提交**（`pre-commit` 钩子直接拒绝）。
6. **隧道纪律**：绝不把 `rpc.008ai.online` 指向持有真实资产的链；管理方法必须留在护栏与 WAF 之后（见 `docs/DEPLOY_MAOTANG_FRONTEND.md`）。
7. **“已实现”双向同步**：任何新的已实现声明，必须在 `docs/WHITE_PAPER.md` 的模块状态列同步更新；任何路线图项不得写成现有能力。
8. **安全相关改动**（金库出口、verifier、签名路径）必须同时给出拒绝路径的测试，而不只是 happy path。
9. **密码学原语替换**：任何签名方案、哈希函数或证明系统的替换，必须走 ADR + 密码学评审 + 拒绝路径测试，并同一次变更内同步 `docs/WHITE_PAPER.md` 的状态列。**禁止“顺手替换”**（例如把 Groth16 换成另一个 setup 而不记录信任假设的变化）。PQC 相关的前瞻与出口设计见 §12。

---

## 10. 与现有规格的映射

| 本文模块 | `docs/MAOTANG_ARCHITECTURE.md` | 说明 |
| --- | --- | --- |
| M1 Edge SLM & Cell | §11 本地 SLM 引擎、§10 认证 | 运行时细节在 §11；配额语义在 §10 |
| M2 Local Wallet | §15.2 签名报文、§12 transport | 滴灌签名格式可复用于 Agent 授权 |
| M3 Yield / Sustenance / Mining | §4 曲线模型、§5 生命周期、§12 挖矿、§15 滴灌与治理 | 常量与公式的权威来源 |
| M4 Light Node / RPC | §13 多节点拓扑、§13.1 心跳、§13.2 传输限制、§14 跨链路由 | 免信任分层为本文新增 |
| M5 Bio-Sovereign | §10 AI-agent 原生认证、§8 安全考量 | ZK 与 nullifier 语义的权威来源 |
| 合规差距 | `docs/GAP_ANALYSIS.md` | P0/P1 待办与验证日志 |

---

## 11. 未决问题（按模块）

- **M1**：Cell 采用记账视图 / 独立 ERC-20 / NFT 家族？影响 gas、可组合性与反女巫边界（需 ADR）。
- **M3**：曲线储备资产最终只支持原生 ETH，还是开放 ERC-20 白名单？（`MAOTANG_ARCHITECTURE.md` §9 未决）
- **M3**：毕业后的市场是固定 AMM 交易对，还是可配置的 venue adapter？（同上）
- **M4**：“独立端点”的判定标准（不同运营方 / 不同 IP / 不同国家）？多端点仲裁的阈值与降权策略。
- **M5**：硬件 attestation 的信任根取厂商 CA 还是协议自有 ceremony？撤销与轮换流程如何编排。

---

## 12. 未来演进：PQC 与量子抗性生物主权（逐模块影响）

> **纯前瞻，无任何实现。** 完整备忘录见 `docs/WHITE_PAPER.md` §9；决策记录见 `memory/ARCHITECTURE_DECISIONS.md` **ADR-021**。仓库中没有任何 PQC 原语、量子加速或神经形态硬件的实现或依赖。

### 12.1 逐模块影响

| 模块 | 今天的原语 | 量子威胁 | 迁移目标 | 难度 |
| --- | --- | --- | --- | --- |
| M1 Edge SLM & Cell | 无链上密码学；权重完整性用 SHA-256 指纹 | Grover 平方根（抗碰撞强度减半，非致命） | 按需提升哈希输出或换 SHA-3；模型与加速器后端经 `SlmEngine` 抽象接入 | S |
| M2 Local Wallet | secp256k1 ECDSA（Shor 可解） | 由公钥反推私钥 ⇒ 伪造交易授权 | 混合签名：ECDSA + ML-DSA（FIPS 204）或 SLH-DSA（FIPS 205），两者都过才放行 | M |
| M3 Yield / Mining / Vault | 授权路径依赖 ECDSA；合约内的曲线与记账数学不依赖签名难度 | 授权被伪造（而非合约逻辑被破解） | 由 M2 与账户抽象承担；`immutable` owner/dripper 需迁移出口 | S–M |
| M4 Light Node / RPC | 心跳用 secp256k1；状态完整性最终依赖底层共识签名 | 心跳签名可伪造 ⇒ 唯一性绑定失效 | 心跳迁移到混合/PQ 签名；轻客户端需 PQ 友好的共识验证 | M |
| M5 Bio-Sovereign | **BN254 Groth16 配对**（Shor 可解）+ keccak256 nullifier | **伪造证明 ⇒ 凭空铸造配额、伪造 agent 绑定** | 透明哈希基证明（STARK 家族）或格基 SNARK；`IZKVerifier` 抽象已具备 | L |

**威胁优先级：M5 > M2 > M4 > M3 > M1。** 因为 M5 的攻击者**不需要偷任何密钥** —— 只要能伪造一份证明就能增发配额与伪造身份；M2 需要目标密钥的公钥已暴露（即该账户已花费过）。

### 12.2 不可变绑定带来的迁移约束（本次记录的最重要发现）

`rg -ni "proxy|UUPS|ERC1967|upgradeable|delegatecall|initialize\(" contracts/src` **无匹配** ⇒ 仓库内**没有**任何代理 / 可升级模式。同时：

- `AIAgentRegistry.zkVerifier` —— `immutable`，构造后不可替换；
- `HumanToken.zkVerifier`、`HumanToken.agentRegistry` —— `immutable`，合约注释明确 “no admin path to redirect claims to a different registry”；
- `Groth16Verifier.lockVerificationKey()` —— 不可逆冻结；
- `MaoTangSustenanceVault.owner` / `dripper` —— `immutable`（ADR-018）。

⇒ **PQC 迁移 = 新部署 + 状态迁移，而不是原地升级。** 必须在**现在**预留 exit ramp：

1. registry 的**版本纪元（epoch）** 字段，使新合约能一次性接受旧纪元的状态；
2. **一次性重签发窗口**：旧纪元冻结后，已绑定的人类主人可把配额与 agent 绑定迁往新纪元（带截止时间与治理控制）；
3. **nullifier 消费记录的迁移格式**，防止跨纪元重放。

这是**低成本、现在就能做**的前瞻动作；等到威胁具体化再补，代价是链分叉。

### 12.3 已具备的接口预留（今天零成本，未来省一次重构）

| 预留点 | 现状 | 为什么关键 |
| --- | --- | --- |
| `IZKVerifier` 抽象 | **已具备**（`contracts/src/interfaces/IZKVerifier.sol`） | 换证明系统时，消费方（registry / HumanToken）只认接口，业务逻辑不动 |
| 注入式 signer（M2） | **已具备**（`agent-manager/src/mining/transport.mjs` 依赖注入） | 叠加 PQC / 混合签名不触碰业务层 |
| `SlmEngine` 后端可插拔（M1） | **已具备**（可选动态 import） | 未来加速器后端按同一接口接入 |
| `CONTRACT_READS` 选择器登记表（M4） | **已具备**（`frontend/src/lib/protocol.ts`） | 新 verifier 的只读方法必须显式登记，天然防止“猜编码”造成的静默错读 |
| 可迁移出口（M5） | **⬜ 缺失** | 本节要求补的**唯一结构性缺口**：现在零成本，事后等于分叉 |

### 12.4 生物主权在量子时代的定位

链路是 `生物授权 → 飞地会话密钥 → 链上授权`：**末端算法（签名 / 证明）可替换，起点（物理在场）不可被 Shor 伪造**。因此生物主权是量子时代的**稳定基座**，把攻击成本从“破解数学”抬高到“物理攻陷一个人”。

但**不等于“不可攻破”**。残余攻击面（飞地实现漏洞与固件后门、生物特征欺骗、供应链替换、胁迫与失能、端点被完全控权）及其缓解方向见 `docs/WHITE_PAPER.md` §9.4 —— 这些**不得在文档里被省略**，否则就是把前瞻写成过度承诺。

### 12.5 PQC 未决问题

1. 第一层签名选 **ML-DSA（格基，体积小、假设较新）** 还是 **SLH-DSA（哈希基，最保守、签名 KB 级）**？移动端存储与带宽预算如何约束？
2. 证明系统选 **哈希基 STARK（透明、无需可信 setup、证明大）** 还是 **格基 SNARK（证明小）**？链上验证 gas 与证明体积如何折中（递归压缩 / L2 验证 / L1 只锚定承诺）？
3. 迁移纪元由谁触发 —— owner 多签 / 治理投票 / 时间锁？如何避免迁移窗口本身成为新的攻击面？
4. 生物认证失败（设备丢失、受伤、丧失决策能力）时的恢复与继承流程如何设计，且不引入可被滥用的后门？
5. 混合签名“两边都通过才放行”在移动端是否带来不可接受的延迟？是否需要分级：**高价值动作双签、低价值动作单签**？
