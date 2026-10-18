/**
 * The console's bilingual dictionary.
 *
 * Scope: every string the C-end face can put on screen - header, status pill, presets, chat bar, the
 * authorization sheet, the menu drawer, and the biometric toasts/fallbacks both surfaces share - plus the
 * few labels the engineer/audit chrome borrows. `en` is typed against `zh` (`Messages` maps every key of
 * the source dictionary), so a key that exists in one language and not the other fails
 * `npx tsc --noEmit` instead of shipping an empty label.
 *
 * Two rules follow from the security posture of the rest of the app:
 *
 *   - a *label* is translated, the M1 *grammar* is not. The presets are captioned in the active language
 *     but the text they send to `/api/agent/intent` stays the English sentence the deterministic stub
 *     parses (`mobile-agent/slm/slm-engine.ts`), so switching the UI language cannot change what an
 *     intent means.
 *   - the zero-data claim is a statement about this build, so each language writes it once and
 *     `scripts/assert-runtime-policy.mjs` asserts the literal. It is not assembled from fragments at
 *     render time, where a missing piece would silently weaken the claim.
 */

export type Language = "zh" | "en";

/**
 * What the owner picked. `"auto"` follows the browser.
 */
export type LanguagePreference = "auto" | Language;

export const LANGUAGE_STORAGE_KEY = "maotang.console.language";

/** What a browser that is not Chinese gets: English, per the C-end auto-detect rule. */
export const DEFAULT_LANGUAGE: Language = "en";

/**
 * `["zh-CN", "en-US"]` -> `zh`; a list with no `zh*` tag -> `en`.
 *
 * A list that carries any `zh*` tag is served Chinese, wherever it sits in the order; everything else
 * falls back to English, the documented default for "not Zh/zh-CN". `navigator.languages` and the parsed
 * `Accept-Language` both go through here, so the first paint and the hydrated render agree.
 */
export function detectLanguage(tags: readonly string[]): Language {
  for (const tag of tags) {
    if (typeof tag === "string" && tag.toLowerCase().startsWith("zh")) {
      return "zh";
    }
  }
  return DEFAULT_LANGUAGE;
}

/**
 * The `Accept-Language` header in preference order, for the server's first paint.
 *
 * The server cannot see `navigator.language`, so it guesses from this header and the client re-resolves
 * from the browser once running. Both paths apply the same `zh*` rule, so in the common case the client
 * writes back the value that is already on screen and nothing visibly changes.
 */
export function parseAcceptLanguage(header: string | null | undefined): Language {
  if (header === null || header === undefined) {
    return DEFAULT_LANGUAGE;
  }
  const tags = header
    .split(",")
    .map((entry) => (entry.split(";")[0] ?? "").trim())
    .filter((tag) => tag !== "");
  return detectLanguage(tags);
}

export function isLanguagePreference(value: unknown): value is LanguagePreference {
  return value === "auto" || value === "zh" || value === "en";
}

/** The source dictionary. Its keys are the contract; `en` has to answer all of them. */
const ZH = {
  "brand": "MAOTANG Protocol",

  "consumer.title": "猫糖个人 AI 节点",
  "consumer.subtitle": "说出你的意图，本地先过一遍策略，再由生物特征确认。",

  "pill.walletAlias": "钱包别名",
  "pill.account": "账户",
  "pill.balance": "余额",
  "pill.availableToday": "今日可用:",

  "footer.enclave": "安全隔区：",
  "footer.enclaveActive": "已启用（硬件 TEE）",
  "footer.enclaveStandby": "待机（未接入设备隔区）",
  "footer.processing": "本地处理：",
  "footer.processingConfirmed": "已确认",
  "footer.processingPending": "待硬件确认",
  "footer.biometrics": "生物特征：",
  "footer.biometricsNever": "从不存储",
  "status.ledgerNotReady": "本地策略账本未就绪：",
  "status.biometrics": "设备生物识别：",
  "status.detecting": "检测中…",
  "status.enrolled": " · 已注册本机凭据",
  "status.notEnrolled": " · 尚未在本机注册凭据",
  "status.scope":
    "本页只调用 /api/agent/*；短语翻译、策略判定与摘要都发生在服务端的 M1/M2，浏览器不参与任何签名计算。原始指纹 / 面容数据不会离开设备。",

  "refusal.explainer": "这条请求在本地被拦下了，没有生成交易，也没有要求你签名。",
  "toast.policyBlocked": "已被本地策略拦截：{code}（未生成交易）",
  "toast.enrolled": "本机凭据已注册，可以开始刷脸 / 生物特征确认。",

  "ledger.notConnected":
    "今日节点状态：本版本尚未接入链上节点收益账本，因此这里不显示任何未经验证的数字。",
  "ledger.summary":
    "可验证的本地账本：滚动窗口 {window} 内已用 {spent} / {cap} ETH，剩余 {left} ETH。",
  "ledger.pending": "本地策略账本还没读回来，稍后再试。",

  "preset.mint": "铸造 0.05 ETH 的猫糖代币",
  "preset.transfer": "给白名单地址转账 0.05 ETH",
  "preset.ledger": "查看今日节点状态",
  "preset.activate": "激活节点（本机硬件校验）",
  "preset.hardware": "本机硬件校验",

  "compute.title": "算力配额 · 线性 Vesting",
  "compute.tier": "等级 {tier}",
  "compute.state.locked": "创世锁定",
  "compute.state.vesting": "Vesting 进行中",
  "compute.state.vested": "已完全 Vesting",
  "compute.state.slashed": "已失效（Sybil 拦截）",
  "compute.ratio": "YuanYuan : MaoMao : FenFen = 1 : 10 : 100",
  "compute.nominal": "名义配额",
  "compute.unit.yuanYuan": "YuanYuan",
  "compute.unit.maoMao": "MaoMao",
  "compute.unit.fenFen": "FenFen",
  "compute.unlocked": "已解锁",
  "compute.available": "可用算力",
  "compute.vesting": "累计 Vesting 进度",
  "compute.vestingProgress":
    "每 epoch +{daily} YuanYuan，已完成 {epochs}/{days} 个 epoch。",
  "compute.epoch": "当前 epoch",
  "compute.epochProgress": "本 epoch 已进行 {percent}%，距下一段解锁 {remaining}。",
  "compute.slashed":
    "本地 Fail-Closed：配额已作废（{code}），仅硬件持主授权可恢复。",
  "compute.unavailable": "算力账本未就绪，本页不显示未经核验的数字。",

  "view.vault": "资产金库",
  "view.dechat": "去中心化通讯",
  "view.agent": "AI 节点",

  "tab.vault": "金库",
  "tab.dechat": "通讯",
  "tab.agent": "智能体",
  "tabs.label": "移动端主导航",

  "vault.title": "资产金库",
  "vault.subtitle": "总估值、24h 额度与三大动作，一屏直达。",
  "vault.total": "总估值",
  "vault.totalUnavailable": "估值不可用",
  "vault.totalSource": "当前构建没有经审计的报价源，总估值保持空白，不用 0 或示例价填充。",
  "vault.updated": "更新于 {time}",
  "vault.updatedPending": "等待服务器更新",
  "vault.spendWindow": "{window} SpendWindow 可用额度",
  "vault.assets": "资产",
  "vault.column.asset": "资产",
  "vault.column.balance": "余额",
  "vault.column.value": "估值",
  "vault.asset.usdt": "USDT",
  "vault.asset.eth": "ETH · 原生资产",
  "vault.asset.yuanYuan": "YuanYuan · 创世卡",
  "vault.asset.maoMao": "MaoMao · 配额",
  "vault.asset.genesis": "创世卡配额",
  "vault.asset.quota": "算力配额",
  "vault.asset.tokenPending": "代币未部署",
  "vault.asset.notConnected": "未接入",
  "vault.asset.valueUnavailable": "估值不可用",
  "vault.asset.quotaValue": "配额计价",
  "vault.openAgent": "进入 AI 节点",
  "vault.openAgentHint": "AI 意图、策略日志与创世铸造",

  "agent.title": "AI 节点",
  "agent.subtitle": "检查意图、拦截原因与创世铸造状态。",
  "agent.back": "返回资产金库",
  "agent.tab.intent": "意图",
  "agent.tab.policy": "策略日志",
  "agent.tab.mint": "创世铸造",
  "agent.previewReady": "交易预览已生成，等待 Face ID / Touch ID 确认。",

  "dechat.title": "DeChat",
  "dechat.subtitle": "去中心化通讯界面：身份即钱包，转账在聊天中完成；传输层尚未接入，当前仅本地预览。",
  "dechat.identityLabel": "去中心化通讯 ID",
  "dechat.identityValue": "{alias}.008ai",
  "dechat.identityPending": "等待钱包地址",
  "dechat.identityNote": "由清单中的钱包地址派生；本构建不查询任何名称注册表。",
  "dechat.localOnly": "仅本机会话",
  "dechat.security.verified": "Secure Enclave Verified",
  "dechat.security.ready": "生物识别就绪",
  "dechat.security.pending": "注册本机生物识别",
  "dechat.security.unavailable": "硬件验证不可用",
  "dechat.security.busy": "正在检查设备",
  "dechat.security.hint": "仅在平台生物识别验证成功后显示；每笔转账仍会先经过策略预览与设备签名门禁。",
  "dechat.preview.badge": "本地预览",
  "dechat.preview.body": "本构建尚未接入中继节点。消息只保存在当前标签页内存中，不会上传。",
  "dechat.messages.empty": "还没有消息。先发一条文字，或打开 Chat-to-Pay 卡片。",
  "dechat.message.you": "你",
  "dechat.message.peer": "对方",
  "dechat.input.label": "消息内容",
  "dechat.input.placeholder": "输入一条消息…",
  "dechat.input.send": "发送",
  "dechat.input.pay": "发起转账",
  "dechat.pay.title": "Chat-to-Pay",
  "dechat.pay.subtitle": "聊天内嵌转账申请：先由本地策略校验，再由 Face ID 确认真实摘要。",
  "dechat.pay.to": "收款地址（服务器白名单）",
  "dechat.pay.amount": "金额（ETH）",
  "dechat.pay.amountInvalid": "请输入非负十进制金额。",
  "dechat.pay.noDestination": "服务器白名单尚未返回可用地址；本构建不会凭空生成收款地址。",
  "dechat.pay.oneTap": "一键转账",
  "dechat.pay.message": "转账申请：{amount} ETH → {to}",
  "dechat.pay.hint": "点击后打开策略确认单；在你确认之前不会签名，也不会广播。",
  "dechat.pay.close": "收起",

  "paymaster.title": "零 Gas 配额",
  "paymaster.quota": "24h 免费 Gas 配额：{remaining}/{limit} 笔交易",
  "paymaster.zkVerified": "ZK-Personhood 已验证",
  "paymaster.zkPending": "ZK-Personhood 待验证",
  "paymaster.note":
    "此处显示产品配额与本机硬件断言状态；实际赞助交易由服务端 Paymaster 记账，本组件不宣称任何交易已完成结算。",
  "paymaster.loading": "正在读取 Paymaster 配额…",
  "paymaster.unconfigured": "Paymaster 尚未配置",
  "paymaster.quotaUnavailable": "Paymaster 配额暂不可用",
  "paymaster.unconfiguredHint": "本部署未配置 Paymaster 合约；配额显示为不可用，而不是默认 100/100。",
  "paymaster.refresh": "刷新人物证明",
  "paymaster.refreshing": "正在验证人物证明…",
  "paymaster.refreshHint": "先等待服务器签发挑战，再点击刷新",

  "claim.badge": "Web3 社交名片",
  "claim.title": "领取 10 MAOTANG 体验金",
  "claim.subtitle": "扫码或分享链接即可拉起 PWA；无需注册，Face ID 确认后提交领取申请。",
  "claim.supplyCap": "83 亿枚硬顶 · 人类币（MAOTANG Token）",
  "claim.amount": "10 MAOTANG",
  "claim.referral": "来自 {ref} 的邀请",
  "claim.qrPending": "正在生成名片二维码…",
  "claim.qrLabel": "分享此 Web3 社交名片的二维码",
  "claim.identityLabel": "我的 .008ai 身份",
  "claim.identityPending": "等待节点身份",
  "claim.identityNote": "由清单中的钱包地址派生；本构建不注册名称，也不会凭空生成地址。",
  "claim.copied": "已复制链接",
  "claim.copy": "复制分享链接",
  "claim.share": "分享名片",
  "claim.shareTitle": "MAOTANG 社交名片",
  "claim.shareText": "{alias} 邀请你领取 10 MAOTANG 体验金",
  "claim.rewardLabel": "体验奖励",
  "claim.previewNote": "领取请求需服务端结算；本构建未配置 MAOTANG 水龙头。",
  "claim.error": "领取请求失败：{code}",
  "claim.requested": "领取申请已提交",
  "claim.ticket": "申请编号：{ticket}",
  "claim.pendingSettlement": "链上结算待配置水龙头后处理；这不是已到账余额。",
  "claim.enroll": "先用 Face ID 创建本机凭据",
  "claim.claim": "Face ID 领取 10 MAOTANG",
  "claim.checking": "正在检查设备生物识别…",
  "claim.noPlatform": "此浏览器未提供平台生物识别；领取需要硬件验证。",
  "claim.authorizing": "等待 Face ID 确认…",
  "claim.settling": "正在提交领取申请…",
  "claim.preparing": "正在准备设备验证，请稍后重试。",
  "claim.chain.pending": "链上交易待确认",
  "claim.chain.confirmed": "链上交易已确认",
  "claim.chain.failed": "链上交易失败",
  "claim.chainNote": "交易哈希与确认状态来自水龙头 RPC；未确认前不视为到账。",
  "claim.txHash": "交易哈希",
  "claim.rewardSettled": "已结算 {reward} {symbol}",
  "claim.viewExplorer": "在区块浏览器查看",

  "referral.title": "KOL 推荐看板",
  "referral.refresh": "刷新",
  "referral.error": "读取失败：{code}",
  "referral.invites": "下游邀请",
  "referral.conversions": "转化",
  "referral.genesis": "Genesis Points",
  "referral.gas": "Gas 奖励",
  "referral.unknown": "未知",
  "referral.unconfigured": "本部署尚未配置持久化归因存储。",
  "referral.loading": "正在读取归因数据…",
  "referral.note": "没有持久化归因存储时，所有总数显示为未知，而不是虚构为零。",

  "policy.empty": "本次会话还没有策略事件。",
  "policy.memoryOnly": "日志仅保存在本次会话内存中；不落盘、不上传。",
  "policy.count": "{count} 条",
  "policy.allowed": "通过",
  "policy.denied": "拦截",
  "policy.origin.vault": "金库",
  "policy.origin.dechat": "去中心化通讯",
  "policy.origin.agent": "AI 节点",
  "policy.stage.intent": "意图解析",
  "policy.stage.policy": "本地策略",
  "policy.stage.biometric": "生物识别",
  "policy.stage.sign": "飞地签名",
  "policy.stage.broadcast": "网关广播",

  "toast.nodeActivated": "节点已激活：算力配额开始按 epoch 线性 Vesting。",
  "toast.hardwareChecked": "本机硬件通道就绪：设备已注册硬件凭据。",
  "toast.personhoodRefreshed": "人物证明已更新：服务器已重新验证真机断言。",
  "toast.personhoodRefreshFailed": "人物证明刷新失败：{code}",

  "chat.placeholder": "说出你的意图…",
  "chat.label": "告诉猫糖助理你想做什么",
  "chat.grammarHint": "示例语句：Mint 0.05 ETH worth of Mao Tang token（M1 只解析这一固定语法）",
  "chat.send": "发送",
  "chat.thinking": "思考中…",

  "sheet.title": "确认这笔交易",
  "sheet.action": "操作",
  "sheet.to": "接收地址",
  "sheet.amount": "金额",
  "sheet.chain": "链",
  "sheet.remaining": "本窗口剩余",
  "sheet.digest": "待签摘要",
  "sheet.yes": "是",
  "sheet.no": "否",
  "sheet.verifiedAt": "设备已在 {time} 完成验证",
  "sheet.userVerified": "用户已验证：{verified} · 硬件凭据：{hardware}",
  "sheet.signRefusal": "硬件签名通道未接入",
  "sheet.signed": "已签名",
  "sheet.paymasterSigned": "Paymaster 授权已签名（尚未结算）",
  "sheet.paymasterSigning": "正在申请 Paymaster 授权…",
  "sheet.paymasterNote":
    "这是单次 ERC-4337 Paymaster 授权票据；提交给 bundler 并上链后才算赞助完成。",
  "sheet.paymasterUnavailable": "Paymaster 授权不可用",
  "sheet.confirm": "确认意图（Face / Touch）",
  "sheet.confirmBusy": "等待设备确认…",
  "sheet.confirmDisabled": "先在本机注册指纹 / 面容，或改用支持 WebAuthn 的浏览器打开",
  "sheet.enroll": "先在本机注册指纹 / 面容",
  "sheet.enrollBusy": "正在注册…",
  "sheet.cancel": "取消",
  "sheet.privacy":
    "生物识别只在设备内部完成，不上传任何原始指纹 / 面容数据；摘要一旦确认即绑定这笔交易，无法被复用到另一笔。Web 主机没有安全飞地，因此这里只证明“你本人在场”，真正的私钥签名需要设备侧的 M2/M5 飞地。",

  "compliance.badge": "零数据合规",
  "compliance.claim": "本地 Secure Enclave 芯片离线校验 | 零生物数据上云",

  "menu.open": "打开菜单",
  "menu.title": "菜单",
  "menu.close": "关闭菜单",
  "menu.language": "语言",
  "menu.languageHint": "默认跟随系统语言；也可手动选择中文或 English 呈现整个控制台。",
  "menu.languageAuto": "跟随系统",
  "menu.languageZh": "中文",
  "menu.languageEn": "English",
  "menu.console": "控制台",
  "menu.consumer": "用户视图",
  "menu.developer": "工程师 / 审计控制台",
  "menu.compliance": "系统状态与合规",
  "menu.zeroData": "零生物数据上云",
  "menu.zeroDataDetail": "生物识别在设备内部完成，服务端只收到一次性签名断言；没有原始指纹 / 面容数据被上传或存储。",
  "menu.enclaveTitle": "Secure Enclave",
  "menu.enclaveMode": "模式：{mode}",
  "menu.enclaveHardware": "硬件飞地",
  "menu.enclaveDev": "开发占位",
  "menu.enclaveKeyAlias": "密钥别名：{alias}",
  "menu.enclaveReachable": "已接入设备侧签名通道",
  "menu.enclaveUnreachable": "未接入（不会回退软件密钥）",
  "menu.enclaveRequired": "硬件飞地必需：未接入设备侧飞地时，本构建拒绝签名，也不会回退软件密钥。",

  "dev.title": "Web Agent OS",
  "dev.back": "切换到 用户视图",

  "biometric.promptNotice": "已请求硬件验证：请在系统弹窗中完成 Face ID / Touch ID。",
  "biometric.shellFallback": "内置浏览器",
  "biometric.fallbackWebview":
    "当前在 {shell} 内打开，系统级 Face ID / Touch ID 可能被限制。请用 Safari 或 Chrome 打开本页后重试。",
  "biometric.fallbackUnsupported": "当前环境没有可用的 WebAuthn，无法调起系统生物识别。",
  "biometric.fallbackInsecure": "请用 HTTPS（或 localhost）打开本页，浏览器才允许调用生物识别。",
  "biometric.fallbackNoAuthenticator": "本机未检测到可用的 Face ID / Touch ID，请先在系统设置中录入指纹或面容。",
  "biometric.failureCancelled": "已取消生物识别验证，没有任何交易被签名。",
  "biometric.failureNoCredential": "本机还没有注册凭据，请先点“注册本机指纹 / 面容”。",
  "biometric.failureWebview": "内置浏览器限制了系统生物识别，请改用 Safari / Chrome 打开本页。",
  "biometric.failureNoPlatformAuthenticator": "本机未启用 Face ID / Touch ID，请先在系统设置中录入。",
  "biometric.failureNotSecureContext": "当前不是安全上下文（HTTPS / localhost），浏览器拒绝调用生物识别。",
  "biometric.failureNoChallenge": "还没有待签摘要，先让助理生成一笔交易再验证。",
  "biometric.failureGeneric": "生物识别未完成：{code}",
  "biometric.successUnverified": "设备返回了签名，但未确认“用户已验证”，请重新验证。",
  "biometric.success": "硬件验证通过：本机凭据签署了待签摘要，未上传任何原始指纹 / 面容数据。",
  "control.title": "控制中心",
  "control.subtitle": "金库、社区与节点动作，一块屏幕读完。",
  "compute.vault.title": "安全金库",
  "compute.vault.genesis": "创世金库",
  "compute.vault.points": "Genesis Points",
  "compute.vault.maomao": "毛毛",
  "compute.vault.fenfen": "分分",
  "compute.vault.nominal": "名义份额",
  "compute.vault.available": "可动用",
  "compute.vault.bound": "硬件绑定金库（安全隔区保护）",
  "compute.vault.oneCard": "一人一卡：地址由本机安全隔区派生，私钥不出芯片。",
  "compute.vault.unavailable": "尚未拿到金库账本，本卡不填造数字。",
  "matrix.title": "社区矩阵",
  "matrix.maomao": "毛毛",
  "matrix.fenfen": "分分",
  "matrix.microTips": "社区分分",
  "matrix.recent": "最近活动",
  "matrix.notOpen": "社区打赏账本尚未接入：本卡不显示未经服务器证实的流水。",
  "node.title": "节点操作",
  "node.dailyEnergy": "每日能量充能",
  "node.dailyEnergyHint": "把今天的 epoch 充进 Vesting 队列。",
  "node.secureTip": "安全打赏",
  "node.secureTipHint": "用待签摘要拉起生物识别确认。",
  "node.migrate": "节点迁移 · 更换设备",
  "node.migrateHint": "把创世金库绑定迁移到新设备。",
  "node.migratePending": "迁移流程尚未开放：需要新旧设备双方的隔区证明，本卡不提供按钮以免误导。",
  "adapter.title": "链上意图适配器",
  "adapter.tron": "TRON-USDT 转账",
  "adapter.uniswap": "Uniswap 兑换",
  "adapter.hint": "本地解析，不签名、不广播。",
  "adapter.unsupported": "M2 白名单尚未开放该链，解析结果仅供预览。",

  "wallet.title": "资产面板",
  "wallet.total": "总资产",
  "wallet.action.send": "转账",
  "wallet.action.receive": "收款",
  "wallet.action.swap": "兑换",
  "wallet.action.sendHint":
    "填好地址与金额，交给 M1 解析、M2 判定，再由本机生物特征确认。",
  "wallet.action.receiveHint":
    "这是清单里的持主账户；本构建不在设备上派生地址，也不生成二维码。",
  "wallet.action.swapHint":
    "本构建的 M2 白名单只有清单里的 EVM 目的地，兑换只能预览，走不到签名。",
  "wallet.asset.native": "原生资产 · ETH",
  "wallet.asset.quota": "算力配额",
  "wallet.asset.unavailable": "未就绪",
  "wallet.windowNote": "本滚动窗口剩余额度：",
  "wallet.send.to": "接收地址",
  "wallet.send.amount": "金额（ETH）",
  "wallet.send.invalidTo": "地址需要是 0x 开头的 40 位十六进制。",
  "wallet.send.invalidAmount": "金额需要是不小于 0 的十进制数字。",
  "wallet.send.grammar": "待发送语句：{sentence}",
  "wallet.send.review": "交给本地策略复核",
  "wallet.receive.address": "持主账户（来自清单）",
  "wallet.receive.unavailable": "尚未读到",
  "wallet.receive.copy": "复制地址",
  "wallet.receive.copied": "已复制",
  "wallet.receive.note":
    "本构建不在设备上派生地址、不生成二维码；地址来自服务器清单，复制的是同一个账户。",
  "wallet.swap.example": "示例语句：{sentence}",
  "wallet.swap.preview": "预览解析结果",
  "wallet.swap.note":
    "兑换不会生成交易：本地适配器固定返回 supported: false，M2 白名单也没有该链。",
  "wallet.close": "收起",
} as const;

export type MessageKey = keyof typeof ZH;

/** Both dictionaries answer every key of the source dictionary. */
export type Messages = { readonly [K in MessageKey]: string };

const ZH_DICTIONARY: Messages = ZH;

const EN: Messages = {
  "brand": "MAOTANG Protocol",

  "consumer.title": "MAOTANG PERSONAL AI NODE",
  "consumer.subtitle":
    "Speak your intent. Locally vetted. Biometrically confirmed.",

  "pill.walletAlias": "Wallet alias",
  "pill.account": "Account",
  "pill.balance": "Balance",
  "pill.availableToday": "Available today:",

  "footer.enclave": "Secure Enclave:",
  "footer.enclaveActive": "Active (Hardware TEE)",
  "footer.enclaveStandby": "Standby (no device enclave)",
  "footer.processing": "Local Processing:",
  "footer.processingConfirmed": "Confirmed",
  "footer.processingPending": "Pending",
  "footer.biometrics": "Biometrics:",
  "footer.biometricsNever": "Never Stored",
  "status.ledgerNotReady": "Local policy ledger unavailable:",
  "status.biometrics": "Device biometrics:",
  "status.detecting": "detecting...",
  "status.enrolled": " - credential enrolled on this device",
  "status.notEnrolled": " - no credential enrolled yet",
  "status.scope":
    "This page only calls /api/agent/*; the phrase translation, the policy decision and the digest all happen server-side in M1/M2, and the browser never takes part in signature computation. No raw fingerprint or face data leaves the device.",

  "refusal.explainer":
    "This request was blocked locally: no transaction was built and you were never asked to sign.",
  "toast.policyBlocked": "Blocked by local policy: {code} (no transaction built)",
  "toast.enrolled": "This device's credential is enrolled; Face / fingerprint confirmation is ready.",

  "ledger.notConnected":
    "Today's node status: this build is not yet wired to an on-chain revenue ledger, so no unverified number is shown here.",
  "ledger.summary":
    "Verifiable local ledger: in the rolling {window} window, {spent} / {cap} ETH is spent, {left} ETH remains.",
  "ledger.pending": "The local policy ledger has not loaded yet; try again in a moment.",

  "preset.mint": "Mint 0.05 ETH of Mao Tang token",
  "preset.transfer": "Send 0.05 ETH to a whitelisted address",
  "preset.ledger": "Show today's node status",
  "preset.activate": "Activate node (local hardware check)",
  "preset.hardware": "Local hardware check",

  "compute.title": "Compute quota \u00b7 linear vesting",
  "compute.tier": "Tier {tier}",
  "compute.state.locked": "genesis locked",
  "compute.state.vesting": "vesting",
  "compute.state.vested": "fully vested",
  "compute.state.slashed": "invalidated (sybil block)",
  "compute.ratio": "YuanYuan : MaoMao : FenFen = 1 : 10 : 100",
  "compute.nominal": "Nominal quota",
  "compute.unit.yuanYuan": "YuanYuan",
  "compute.unit.maoMao": "MaoMao",
  "compute.unit.fenFen": "FenFen",
  "compute.unlocked": "Unlocked",
  "compute.available": "Available compute",
  "compute.vesting": "Cumulative vesting",
  "compute.vestingProgress": "+{daily} YuanYuan per epoch; {epochs} of {days} epochs done.",
  "compute.epoch": "Current epoch",
  "compute.epochProgress": "This epoch is {percent}% elapsed; next slice in {remaining}.",
  "compute.slashed":
    "Local fail-closed: the quota is invalidated ({code}); only a hardware owner authorization restores it.",
  "compute.unavailable": "The compute ledger is not available, so this page shows no unverified number.",

  "view.vault": "Vault",
  "view.dechat": "DeChat",
  "view.agent": "AI Node",

  "tab.vault": "Vault",
  "tab.dechat": "DeChat",
  "tab.agent": "Agent",
  "tabs.label": "Mobile primary navigation",

  "vault.title": "Asset Vault",
  "vault.subtitle": "Total value, spend window and three wallet actions, on one screen.",
  "vault.total": "Total value",
  "vault.totalUnavailable": "Valuation unavailable",
  "vault.totalSource": "This build has no audited quote source, so total value stays blank instead of showing zero or an example price.",
  "vault.updated": "Updated {time}",
  "vault.updatedPending": "Waiting for the server",
  "vault.spendWindow": "{window} SpendWindow available",
  "vault.assets": "Assets",
  "vault.column.asset": "Asset",
  "vault.column.balance": "Balance",
  "vault.column.value": "Value",
  "vault.asset.usdt": "USDT",
  "vault.asset.eth": "ETH \u00b7 Native asset",
  "vault.asset.yuanYuan": "YuanYuan \u00b7 Genesis card",
  "vault.asset.maoMao": "MaoMao \u00b7 Quota",
  "vault.asset.genesis": "Genesis card quota",
  "vault.asset.quota": "Compute quota",
  "vault.asset.tokenPending": "token not deployed",
  "vault.asset.notConnected": "Not connected",
  "vault.asset.valueUnavailable": "Valuation unavailable",
  "vault.asset.quotaValue": "Quota-denominated",
  "vault.openAgent": "Open AI Node",
  "vault.openAgentHint": "Intent, policy log and genesis mint",

  "agent.title": "AI Node",
  "agent.subtitle": "Inspect intent, interception reasons and genesis mint state.",
  "agent.back": "Back to Asset Vault",
  "agent.tab.intent": "Intent",
  "agent.tab.policy": "Policy Log",
  "agent.tab.mint": "Genesis Mint",
  "agent.previewReady": "A transaction preview is ready for Face ID / Touch ID confirmation.",

  "dechat.title": "DeChat",
  "dechat.subtitle": "Decentralized messaging surface: identity is the wallet address and payments happen in-chat; the transport layer is not attached yet, so this build is local-preview only.",
  "dechat.identityLabel": "Decentralized comms ID",
  "dechat.identityValue": "{alias}.008ai",
  "dechat.identityPending": "Waiting for a wallet address",
  "dechat.identityNote": "Derived from the manifest wallet address; this build queries no name registry.",
  "dechat.localOnly": "SESSION ONLY",
  "dechat.security.verified": "Secure Enclave Verified",
  "dechat.security.ready": "Biometric Ready",
  "dechat.security.pending": "Enroll This Device",
  "dechat.security.unavailable": "Biometric Unavailable",
  "dechat.security.busy": "Checking Device",
  "dechat.security.hint": "Shown only after platform biometric verification succeeds; every transfer still passes the policy preview and the device signing gate.",
  "dechat.preview.badge": "LOCAL PREVIEW",
  "dechat.preview.body": "No relay is attached in this build. Messages stay in this tab's memory and are never uploaded.",
  "dechat.messages.empty": "No messages yet. Send text or open the Chat-to-Pay card.",
  "dechat.message.you": "You",
  "dechat.message.peer": "Peer",
  "dechat.input.label": "Message",
  "dechat.input.placeholder": "Write a message...",
  "dechat.input.send": "Send",
  "dechat.input.pay": "Request payment",
  "dechat.pay.title": "Chat-to-Pay",
  "dechat.pay.subtitle": "An embedded transfer request: local policy preview first, then Face ID on the exact digest.",
  "dechat.pay.to": "Recipient (server allow-list)",
  "dechat.pay.amount": "Amount (ETH)",
  "dechat.pay.amountInvalid": "Enter a non-negative decimal amount.",
  "dechat.pay.noDestination": "The server allow-list has not reported a destination yet; this build will not invent one.",
  "dechat.pay.oneTap": "One-tap transfer",
  "dechat.pay.message": "Payment request: {amount} ETH to {to}",
  "dechat.pay.hint": "Opens the policy confirmation sheet; nothing is signed or broadcast before you confirm.",
  "dechat.pay.close": "Close",

  "paymaster.title": "ZERO-GAS QUOTA",
  "paymaster.quota": "24h Free Gas Quota: {remaining}/{limit} Transactions",
  "paymaster.zkVerified": "ZK-Personhood Verified",
  "paymaster.zkPending": "ZK-Personhood Pending",
  "paymaster.note":
    "This shows the product entitlement and this device's hardware-assertion state; sponsored transactions settle in the server-side Paymaster, and this component never claims one was settled.",
  "paymaster.loading": "Reading the Paymaster quota...",
  "paymaster.unconfigured": "Paymaster not configured",
  "paymaster.quotaUnavailable": "Paymaster quota unavailable",
  "paymaster.unconfiguredHint":
    "No Paymaster contract is configured for this deployment; the quota is unavailable rather than a default 100/100.",
  "paymaster.refresh": "Refresh personhood",
  "paymaster.refreshing": "Verifying personhood...",
  "paymaster.refreshHint": "Wait for the server-issued challenge before refreshing",

  "claim.badge": "WEB3 SOCIAL CARD",
  "claim.title": "Claim 10 MAOTANG",
  "claim.subtitle": "Scan or share the link to open the PWA; no sign-up, and Face ID confirms the claim request.",
  "claim.supplyCap": "8.3B hard cap · Human Coin (MAOTANG Token)",
  "claim.amount": "10 MAOTANG",
  "claim.referral": "Invited by {ref}",
  "claim.qrPending": "Preparing your card QR...",
  "claim.qrLabel": "QR code for this Web3 social card",
  "claim.identityLabel": "My .008ai identity",
  "claim.identityPending": "Waiting for the node identity",
  "claim.identityNote": "Derived from the manifest wallet address; this build registers no name and invents no address.",
  "claim.copied": "Link copied",
  "claim.copy": "Copy link",
  "claim.share": "Share card",
  "claim.shareTitle": "MAOTANG social card",
  "claim.shareText": "{alias} invites you to claim 10 MAOTANG",
  "claim.rewardLabel": "Welcome reward",
  "claim.previewNote": "The claim needs server-side settlement; no MAOTANG faucet is configured in this build.",
  "claim.error": "Claim request failed: {code}",
  "claim.requested": "Claim request submitted",
  "claim.ticket": "Ticket: {ticket}",
  "claim.pendingSettlement": "On-chain settlement waits for a configured faucet; this is not a credited balance.",
  "claim.enroll": "Create a Face ID credential first",
  "claim.claim": "Claim 10 MAOTANG with Face ID",
  "claim.checking": "Checking device biometrics...",
  "claim.noPlatform": "This browser exposes no platform biometric; a hardware assertion is required.",
  "claim.authorizing": "Waiting for Face ID...",
  "claim.settling": "Submitting claim request...",
  "claim.preparing": "Preparing the device verification; try again in a moment.",
  "claim.chain.pending": "On-chain transaction pending",
  "claim.chain.confirmed": "On-chain transaction confirmed",
  "claim.chain.failed": "On-chain transaction failed",
  "claim.chainNote":
    "The transaction hash and confirmation status come from the faucet RPC; nothing is credited before confirmation.",
  "claim.txHash": "Transaction",
  "claim.rewardSettled": "Settled {reward} {symbol}",
  "claim.viewExplorer": "View on explorer",

  "referral.title": "KOL REFERRAL",
  "referral.refresh": "Refresh",
  "referral.error": "Read failed: {code}",
  "referral.invites": "Downstream invites",
  "referral.conversions": "Conversions",
  "referral.genesis": "Genesis Points",
  "referral.gas": "Gas rewards",
  "referral.unknown": "Unknown",
  "referral.unconfigured": "No durable attribution store is configured for this deployment.",
  "referral.loading": "Reading attribution data...",
  "referral.note": "Without a durable attribution store every total is unknown, never an invented zero.",

  "policy.empty": "No policy event has been recorded in this session.",
  "policy.memoryOnly": "This log lives only in session memory; it is never written to storage or uploaded.",
  "policy.count": "{count} entries",
  "policy.allowed": "Allowed",
  "policy.denied": "Blocked",
  "policy.origin.vault": "Vault",
  "policy.origin.dechat": "DeChat",
  "policy.origin.agent": "AI Node",
  "policy.stage.intent": "Intent",
  "policy.stage.policy": "Local policy",
  "policy.stage.biometric": "Biometric",
  "policy.stage.sign": "Enclave sign",
  "policy.stage.broadcast": "Gateway broadcast",

  "toast.nodeActivated": "Node activated: the compute quota starts vesting linearly by epoch.",
  "toast.hardwareChecked": "Local hardware channel ready: this device has an enrolled hardware credential.",
  "toast.personhoodRefreshed": "Personhood refreshed: the server re-verified this device's assertion.",
  "toast.personhoodRefreshFailed": "Personhood refresh failed: {code}",

  "chat.placeholder": "Speak your intent...",
  "chat.label": "Tell the MAOTANG assistant what to do",
  "chat.grammarHint": "Example: Mint 0.05 ETH worth of Mao Tang token (M1 parses exactly this grammar)",
  "chat.send": "Send",
  "chat.thinking": "Thinking...",

  "sheet.title": "Confirm this transaction",
  "sheet.action": "Action",
  "sheet.to": "Recipient",
  "sheet.amount": "Amount",
  "sheet.chain": "Chain",
  "sheet.remaining": "Left this window",
  "sheet.digest": "Digest to sign",
  "sheet.yes": "yes",
  "sheet.no": "no",
  "sheet.verifiedAt": "Device verified at {time}",
  "sheet.userVerified": "Owner verified: {verified} - hardware credential: {hardware}",
  "sheet.signRefusal": "hardware signing channel not attached",
  "sheet.signed": "Signed",
  "sheet.paymasterSigned": "Paymaster authorization signed (not settled)",
  "sheet.paymasterSigning": "Requesting Paymaster authorization...",
  "sheet.paymasterNote":
    "This is a single-use ERC-4337 Paymaster ticket; sponsorship completes only after a bundler submits it on-chain.",
  "sheet.paymasterUnavailable": "Paymaster authorization unavailable",
  "sheet.confirm": "Confirm Intent (Face/Touch)",
  "sheet.confirmBusy": "Waiting for the device...",
  "sheet.confirmDisabled":
    "Enroll a fingerprint / face on this device first, or open this page in a WebAuthn-capable browser",
  "sheet.enroll": "Enroll fingerprint / face on this device",
  "sheet.enrollBusy": "Enrolling...",
  "sheet.cancel": "Cancel",
  "sheet.privacy":
    "Biometrics happen inside the device and no raw fingerprint or face data is uploaded; once confirmed, the digest is bound to this one transaction and cannot be replayed onto another. A web host has no secure enclave, so this step only proves you are present - the real private-key signature needs the device-side M2/M5 enclave.",

  "compliance.badge": "Zero-data compliance",
  "compliance.claim": "Verified offline by the local Secure Enclave | zero biometric data leaves the device",

  "menu.open": "Open menu",
  "menu.title": "Menu",
  "menu.close": "Close menu",
  "menu.language": "Language",
  "menu.languageHint":
    "Follows your system language by default. Pick Chinese or English to switch the whole console.",
  "menu.languageAuto": "Follow system",
  "menu.languageZh": "Chinese",
  "menu.languageEn": "English",
  "menu.console": "Console",
  "menu.consumer": "Consumer view",
  "menu.developer": "Engineer / audit console",
  "menu.compliance": "System status & compliance",
  "menu.zeroData": "Zero biometric data leaves the device",
  "menu.zeroDataDetail":
    "Biometrics run inside the device and the server receives only a single-use signed assertion; no raw fingerprint or face data is uploaded or stored.",
  "menu.enclaveTitle": "Secure Enclave",
  "menu.enclaveMode": "Mode: {mode}",
  "menu.enclaveHardware": "hardware enclave",
  "menu.enclaveDev": "development placeholder",
  "menu.enclaveKeyAlias": "Key alias: {alias}",
  "menu.enclaveReachable": "device signing channel attached",
  "menu.enclaveUnreachable": "not attached (will not fall back to a software key)",
  "menu.enclaveRequired":
    "A hardware enclave is required: without a device-side enclave this build refuses to sign and never falls back to a software key.",

  "dev.title": "Web Agent OS",
  "dev.back": "Switch to consumer view",

  "biometric.promptNotice": "Hardware verification requested: finish Face ID / Touch ID in the system sheet.",
  "biometric.shellFallback": "an in-app browser",
  "biometric.fallbackWebview":
    "This page is open inside {shell}, where system Face ID / Touch ID may be restricted. Open it in Safari or Chrome and try again.",
  "biometric.fallbackUnsupported":
    "This environment has no WebAuthn, so the system biometric prompt cannot be raised.",
  "biometric.fallbackInsecure":
    "Open this page over HTTPS (or localhost) before the browser will allow biometrics.",
  "biometric.fallbackNoAuthenticator":
    "No Face ID / Touch ID detected on this device; enroll a fingerprint or face in the system settings first.",
  "biometric.failureCancelled": "Biometric verification was cancelled and nothing was signed.",
  "biometric.failureNoCredential":
    "No credential is enrolled on this device yet; enroll a fingerprint / face first.",
  "biometric.failureWebview":
    "The in-app browser restricts system biometrics; open this page in Safari / Chrome instead.",
  "biometric.failureNoPlatformAuthenticator":
    "Face ID / Touch ID is not enabled on this device; enroll it in the system settings first.",
  "biometric.failureNotSecureContext":
    "This is not a secure context (HTTPS / localhost), so the browser refuses to raise biometrics.",
  "biometric.failureNoChallenge":
    "There is no digest to sign yet; ask the assistant for a transaction first.",
  "biometric.failureGeneric": "Biometric verification did not complete: {code}",
  "biometric.successUnverified":
    "The device returned a signature but did not confirm the user-verified flag; please verify again.",
  "biometric.success":
    "Hardware verification passed: this device's credential signed the digest, and no raw fingerprint or face data was uploaded.",
  "control.title": "Control Center",
  "control.subtitle": "Vault, community and node actions on one screen.",
  "compute.vault.title": "Secure Vault",
  "compute.vault.genesis": "Genesis Vault",
  "compute.vault.points": "Genesis Points",
  "compute.vault.maomao": "MaoMao",
  "compute.vault.fenfen": "FenFen",
  "compute.vault.nominal": "Nominal",
  "compute.vault.available": "Available",
  "compute.vault.bound": "Hardware-Bound Vault (Secure Enclave Protected)",
  "compute.vault.oneCard": "One node, one vault: the address is derived inside this device secure enclave, and the key never leaves the chip.",
  "compute.vault.unavailable": "No vault ledger from the server yet; this card does not invent a number.",
  "matrix.title": "Community Matrix",
  "matrix.maomao": "MaoMao",
  "matrix.fenfen": "FenFen",
  "matrix.microTips": "Micro-Tips",
  "matrix.recent": "Recent Activity",
  "matrix.notOpen": "The community tip ledger is not wired up yet: this card shows no flow the server has not reported.",
  "node.title": "Node Action",
  "node.dailyEnergy": "Daily Energy Boost",
  "node.dailyEnergyHint": "Push this epoch into the vesting queue.",
  "node.secureTip": "Secure Tip",
  "node.secureTipHint": "Raise the biometric sheet over the pending digest.",
  "node.migrate": "Migrate Node",
  "node.migrateHint": "Move the genesis vault binding to a new device.",
  "node.migratePending": "Migration is not open yet: it needs enclave proofs from both devices, so this card ships no button rather than a misleading one.",
  "adapter.title": "On-chain intent adapter",
  "adapter.tron": "TRON-USDT transfer",
  "adapter.uniswap": "Uniswap swap",
  "adapter.hint": "Parsed locally. Nothing is signed and nothing is broadcast.",
  "adapter.unsupported": "The M2 allow-list does not carry this chain yet, so the parse is a preview only.",

  "wallet.title": "Asset panel",
  "wallet.total": "Total balance",
  "wallet.action.send": "Send",
  "wallet.action.receive": "Receive",
  "wallet.action.swap": "Swap",
  "wallet.action.sendHint":
    "Fill in an address and an amount; M1 parses it, M2 decides, and this device's biometrics confirm.",
  "wallet.action.receiveHint":
    "The owner account from the manifest; this build derives no address on the device and generates no QR code.",
  "wallet.action.swapHint":
    "The M2 allow-list holds only the manifest's EVM destinations, so a swap is a preview that cannot reach a signature.",
  "wallet.asset.native": "Native asset \u00b7 ETH",
  "wallet.asset.quota": "Compute quota",
  "wallet.asset.unavailable": "Not ready",
  "wallet.windowNote": "Remaining in the rolling window:",
  "wallet.send.to": "Recipient address",
  "wallet.send.amount": "Amount (ETH)",
  "wallet.send.invalidTo": "An address must be 0x followed by 40 hex digits.",
  "wallet.send.invalidAmount": "An amount must be a non-negative decimal number.",
  "wallet.send.grammar": "Sentence to send: {sentence}",
  "wallet.send.review": "Hand to the local policy",
  "wallet.receive.address": "Owner account (from the manifest)",
  "wallet.receive.unavailable": "Not read yet",
  "wallet.receive.copy": "Copy address",
  "wallet.receive.copied": "Copied",
  "wallet.receive.note":
    "This build derives no address on the device and generates no QR code; the address is the same account the server manifest reports.",
  "wallet.swap.example": "Example sentence: {sentence}",
  "wallet.swap.preview": "Preview the parse",
  "wallet.swap.note":
    "A swap builds no transaction: the local adapter pins supported: false, and the M2 allow-list does not carry that chain.",
  "wallet.close": "Close",
};

export const DICTIONARIES: Readonly<Record<Language, Messages>> = {
  zh: ZH_DICTIONARY,
  en: EN,
};

export type MessageVars = Readonly<Record<string, string | number>>;

/** `{window}` / `{code}` substitution. An unknown placeholder is left as written, never blanked. */
function interpolate(template: string, vars?: MessageVars): string {
  if (vars === undefined) {
    return template;
  }
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = vars[name];
    return value === undefined ? match : String(value);
  });
}

/**
 * Translate, with a fallback chain: active language -> the other language -> the key itself.
 *
 * The last two steps are what make a fallback *smooth*: a blank or missing entry degrades to a legible
 * neighbour (`en` fills a gap in `zh` and vice versa) and, failing that, to the key, so the element the
 * caller sized with `min-h-*` never collapses to nothing. The return value is never `""`.
 */
export function translate(language: Language, key: MessageKey, vars?: MessageVars): string {
  const other: Language = language === "zh" ? "en" : "zh";
  const template = DICTIONARIES[language]?.[key] || DICTIONARIES[other]?.[key] || key;
  return interpolate(template, vars);
}
