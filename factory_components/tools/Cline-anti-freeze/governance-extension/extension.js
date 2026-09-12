const vscode = require("vscode");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");

// ============================================================
// 路径（v3：直连真实治理目录 factory_components/tools/Cline-anti-freeze）
// ============================================================
function workspaceRoot() {
  const folders = vscode.workspace.workspaceFolders;
  return folders && folders.length ? folders[0].uri.fsPath : "";
}

function governanceDir() {
  const root = workspaceRoot();
  const candidates = [
    path.join(root, "factory_components", "tools", "Cline-anti-freeze"),
    path.join(root, "Cline-anti-freeze"),
  ];
  for (const c of candidates) {
    try {
      if (
        fs.existsSync(path.join(c, "governance_logs", "auto_clear_signal.json")) ||
        fs.existsSync(path.join(c, "global_controls.json"))
      ) {
        return c;
      }
    } catch (_) {}
  }
  return candidates[0];
}

const GOVERNANCE_JSON = () => path.join(workspaceRoot(), ".codex", "governance.json");
const GOV_DIR = () => governanceDir();
const SIGNAL_FILE = () => path.join(GOV_DIR(), "governance_logs", "auto_clear_signal.json");
const EVENTS_FILE = () => path.join(GOV_DIR(), "governance_logs", "auto_clear_events.jsonl");
const CONTROLS_FILE = () => path.join(GOV_DIR(), "global_controls.json");
const BLACKBOX_FILE = () => path.join(GOV_DIR(), "fault_blackbox.json");
const STATE_FILE = () => path.join(workspaceRoot(), "runtime_data", "codex", "codex_metrics.json");
const CODEXIGNORE_FILE = () => path.join(workspaceRoot(), ".codexignore");
const AGENTS_MD = () => path.join(workspaceRoot(), "AGENTS.md");

const POLL_INTERVAL_MS = 3000;

// 成本估算（USD / 百万 Token），与 codex_metrics.py 保持一致
const RATES = {
  input: Number(process.env.CODEX_RATE_INPUT_MTOK || 0.25),
  cached: Number(process.env.CODEX_RATE_CACHED_MTOK || 0.05),
  output: Number(process.env.CODEX_RATE_OUTPUT_MTOK || 1.25),
};

// ============================================================
// 通用 IO
// ============================================================
function fileMeta(p) {
  try {
    const s = fs.statSync(p);
    return { exists: true, mtimeMs: s.mtimeMs, mtimeIso: s.mtime.toISOString() };
  } catch (_) {
    return { exists: false, mtimeMs: 0, mtimeIso: null };
  }
}

function readJsonWithMeta(p) {
  const meta = fileMeta(p);
  let data = null;
  if (meta.exists) {
    try {
      data = JSON.parse(fs.readFileSync(p, "utf-8"));
    } catch (_) {
      data = null;
    }
  }
  return { meta, data };
}

function writeJsonSafe(p, data) {
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(data, null, 2), "utf-8");
    return true;
  } catch (_) {
    return false;
  }
}

function appendEvent(event) {
  try {
    const p = EVENTS_FILE();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    event.ts = event.ts || new Date().toISOString();
    fs.appendFileSync(p, JSON.stringify(event) + "\n", "utf-8");
  } catch (_) {}
}

// ============================================================
// 数据加载：全局配置（governance.json + global_controls.json）
// ============================================================
function loadGovernance() {
  const { data } = readJsonWithMeta(GOVERNANCE_JSON());
  return data || {};
}

function loadControls() {
  const defaults = {
    pause_all_production: false,
    risk_threshold: 0.7,
    heartbeat_timeout_sec: 120,
    auto_self_heal: true,
    alert_broadcast: true,
  };
  const stored = readJsonWithMeta(CONTROLS_FILE()).data;
  if (stored) {
    for (const k of Object.keys(defaults)) if (!(k in stored)) stored[k] = defaults[k];
    return stored;
  }
  return { ...defaults };
}

// ============================================================
// Token-Saver 自动注入（Skill / config.toml / .codexignore）
// ============================================================
function codexHomeDir() {
  return process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
}

const TOKEN_SAVER_SKILL = `# Token-Saver 极致省 Token 模式

强制 tool-first：接到任务立即调用工具。
禁止解释与计划：不写 Preamble、过程说明或总结。
完成后仅返回文件路径或 done。
`;

const TOKEN_SAVER_KEY_PHRASES = ["tool-first", "禁止解释与计划", "文件路径", "done"];

function ensureTokenSaverSkill() {
  const dir = path.join(codexHomeDir(), "skills");
  const file = path.join(dir, "token-saver.md");
  try {
    if (!fs.existsSync(file)) {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(file, TOKEN_SAVER_SKILL, "utf-8");
      return { ok: true, changed: true, reason: "created" };
    }
    const existing = fs.readFileSync(file, "utf-8");
    const matches = TOKEN_SAVER_KEY_PHRASES.every((k) => existing.includes(k));
    if (!matches) {
      fs.writeFileSync(file, TOKEN_SAVER_SKILL, "utf-8");
      return { ok: true, changed: true, reason: "content_mismatch" };
    }
    return { ok: true, changed: false, reason: "ok" };
  } catch (e) {
    return { ok: false, changed: false, reason: "error", error: String((e && e.message) || e) };
  }
}

const REQUIRED_CONFIG_KEYS = [
  { key: "model_reasoning_effort", value: '"low"' },
  { key: "model_reasoning_summary", value: '"none"' },
];

function ensureConfigToml() {
  const file = path.join(codexHomeDir(), "config.toml");
  try {
    let content = "";
    if (!fs.existsSync(file)) {
      content = "# CODEX 治理中心自动生成（Token-Saver）\n";
    } else {
      content = fs.readFileSync(file, "utf-8");
    }
    const lines = content.split(/\r?\n/);
    let firstSection = -1;
    for (let i = 0; i < lines.length; i++) {
      const t = lines[i].trim();
      if (t.startsWith("[") && t.endsWith("]")) {
        firstSection = i;
        break;
      }
    }
    const added = [];
    for (const req of REQUIRED_CONFIG_KEYS) {
      const re = new RegExp("^\\s*" + req.key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*=");
      const idx = lines.findIndex((l) => re.test(l));
      if (idx === -1) {
        const line = req.key + " = " + req.value;
        if (firstSection === -1) {
          if (lines.length && lines[lines.length - 1] === "") lines.splice(lines.length - 1, 0, line);
          else lines.push(line);
        } else {
          lines.splice(firstSection, 0, line);
          firstSection++;
        }
        added.push(line);
      } else {
        const val = lines[idx].split("=").slice(1).join("=").trim();
        if (val !== req.value) {
          lines[idx] = req.key + " = " + req.value;
          added.push(lines[idx]);
        }
      }
    }
    if (added.length) fs.writeFileSync(file, lines.join("\n"), "utf-8");
    return { ok: true, changed: added.length > 0, added };
  } catch (e) {
    return { ok: false, changed: false, error: String((e && e.message) || e) };
  }
}

const REQUIRED_CODEXIGNORE_RULES = ["node_modules/", "dist/", "runtime_data/", "*.log", "*.jsonl"];

function ensureCodexignore() {
  const root = workspaceRoot();
  if (!root) return { ok: false, changed: false, reason: "no_workspace" };
  const file = path.join(root, ".codexignore");
  try {
    let content = "";
    if (!fs.existsSync(file)) {
      content = "# git008 CODEX 拦截规则 — 由治理中心自动维护（Token-Saver）\n";
    } else {
      content = fs.readFileSync(file, "utf-8");
    }
    const lines = content.split(/\r?\n/);
    const existing = new Set(lines.map((l) => l.trim()).filter((l) => l && !l.startsWith("#")));
    const missing = REQUIRED_CODEXIGNORE_RULES.filter((r) => !existing.has(r));
    if (missing.length) {
      const header = "# Token-Saver 自动追加：剔除依赖/产物/运行时与日志大文件";
      if (!lines.some((l) => l.trim() === header)) {
        if (lines.length && lines[lines.length - 1] !== "") lines.push("");
        lines.push(header);
      }
      for (const r of missing) lines.push(r);
      fs.writeFileSync(file, lines.join("\n"), "utf-8");
      return { ok: true, changed: true, added: missing };
    }
    return { ok: true, changed: false, reason: "ok" };
  } catch (e) {
    return { ok: false, changed: false, error: String((e && e.message) || e) };
  }
}

function tokenSaverEnabled(gov) {
  return !!(gov && gov.token_saver && gov.token_saver.enabled);
}

function toggleTokenSaver(enabled) {
  const gov = loadGovernance();
  gov.token_saver = gov.token_saver || {};
  gov.token_saver.enabled = !!enabled;
  writeJsonSafe(GOVERNANCE_JSON(), gov);
  if (enabled) {
    ensureTokenSaverSkill();
    ensureConfigToml();
    ensureCodexignore();
  }
}

const TOKEN_SAVER_DIRECTIVE =
  "/clear\n[System Directive: 严格极简模式，禁止 Preamble/解释/计划，只调工具修改，完成仅回复路径或 done]";

function tokenSaverClearClipboardText(gov) {
  return tokenSaverEnabled(gov) ? TOKEN_SAVER_DIRECTIVE : "/clear";
}

// ============================================================
// Token 大盘（Node 移植 codex_metrics.py：直读 ~/.codex/sessions 最新会话）
// ============================================================
function findLatestSessionFile() {
  const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
  const sessionsDir = path.join(codexHome, "sessions");
  if (!fs.existsSync(sessionsDir)) return null;
  let best = null;
  const stack = [sessionsDir];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (_) {
      continue;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        stack.push(full);
      } else if (e.isFile() && e.name.endsWith(".jsonl")) {
        try {
          const m = fs.statSync(full).mtimeMs;
          if (!best || m > best.mtimeMs) best = { file: full, mtimeMs: m };
        } catch (_) {}
      }
    }
  }
  return best ? best.file : null;
}

function extractUsage(event) {
  if (event && typeof event.usage === "object" && event.usage !== null) return event.usage;
  const payload = event && event.payload;
  if (payload && typeof payload.usage === "object" && payload.usage !== null) return payload.usage;
  const found = {};
  function walk(node) {
    if (!node || typeof node !== "object") return false;
    if (Array.isArray(node)) {
      for (const v of node) if (walk(v)) return true;
      return false;
    }
    if (typeof node.input_tokens === "number") {
      Object.assign(found, node);
      return true;
    }
    for (const v of Object.values(node)) if (walk(v)) return true;
    return false;
  }
  walk(event);
  return Object.keys(found).length ? found : null;
}

function isUserTurn(evt) {
  const t = evt && evt.type;
  const p = evt && evt.payload;
  const pt = p && p.type;
  if (t === "user_message") return true;
  if (pt === "user_message") return true;
  if (t === "item" && pt === "message" && p.role === "user") return true;
  if (t === "event_msg" && pt === "user_message") return true;
  return false;
}

function computeMetricsFromUsage(usageList) {
  let input = 0, output = 0, cached = 0, total = 0;
  for (const u of usageList) {
    input += Number(u.input_tokens || 0);
    output += Number(u.output_tokens || 0);
    cached += Number(u.cached_input_tokens || 0);
    total += Number(u.total_tokens || 0);
  }
  const cumulative = total || input + output;
  const last = usageList.length ? usageList[usageList.length - 1] : null;
  let context = last ? Number(last.input_tokens || 0) : 0;
  if (!context && last) context = Math.max(0, Number(last.total_tokens || 0) - Number(last.output_tokens || 0));
  const cost =
    ((input - cached) / 1e6) * RATES.input +
    (cached / 1e6) * RATES.cached +
    (output / 1e6) * RATES.output;
  return {
    context_tokens: Math.max(0, context),
    cumulative_tokens: cumulative,
    cumulative_input_tokens: input,
    cumulative_output_tokens: output,
    cached_input_tokens: cached,
    api_calls: usageList.length,
    last_request_tokens: Math.max(0, context),
    estimated_cost_usd: Math.round(cost * 10000) / 10000,
  };
}

function parseSessionFile(p) {
  const usageList = [];
  let rounds = 0, startedAt = null, sessionId = null;
  let content;
  try {
    content = fs.readFileSync(p, "utf-8");
  } catch (_) {
    return { usageList, rounds, startedAt, sessionId };
  }
  for (const line of content.split("\n")) {
    if (!line.trim()) continue;
    let evt;
    try {
      evt = JSON.parse(line);
    } catch (_) {
      continue;
    }
    if (isUserTurn(evt)) rounds++;
    const usage = extractUsage(evt);
    if (usage) usageList.push(usage);
    if (!startedAt) {
      const ts = evt.timestamp || (evt.payload && evt.payload.timestamp);
      if (ts) startedAt = String(ts);
    }
    const sid = evt.session_id || (evt.payload && evt.payload.session_id);
    if (sid) sessionId = String(sid);
  }
  return { usageList, rounds, startedAt, sessionId };
}

function loadStateFileMetrics() {
  const { data } = readJsonWithMeta(STATE_FILE());
  if (!data) return null;
  const usage = [
    {
      input_tokens: data.context_tokens || data.cumulative_input_tokens || 0,
      output_tokens: data.cumulative_output_tokens || 0,
      cached_input_tokens: data.cached_input_tokens || 0,
      total_tokens: data.cumulative_tokens || 0,
    },
  ];
  return {
    metrics: computeMetricsFromUsage(usage),
    rounds: Number(data.rounds || 0),
    source: "state_file",
    note: "无 Codex 会话文件，使用 runtime_data/codex/codex_metrics.json 状态数据",
    session: { file: "codex_metrics.json", id: data.session_id, started_at: data.started_at || data.updated_at },
  };
}

function computeCodexMetrics() {
  const sessionFile = findLatestSessionFile();
  if (sessionFile) {
    try {
      const parsed = parseSessionFile(sessionFile);
      return {
        metrics: computeMetricsFromUsage(parsed.usageList),
        rounds: parsed.rounds,
        source: "session_file",
        note: "",
        session: { file: sessionFile, id: parsed.sessionId, started_at: parsed.startedAt },
      };
    } catch (_) {}
  }
  const fallback = loadStateFileMetrics();
  if (fallback) return fallback;
  return {
    metrics: computeMetricsFromUsage([]),
    rounds: 0,
    source: "none",
    note: "未找到 Codex 会话文件与状态文件",
    session: { file: null, id: null, started_at: null },
  };
}

// ============================================================
// 熔断规则（v3：触发器迁移至扩展进程内，直写信号文件）
// ============================================================
let lastSignalKey = "";

function writeSignal({ severity, reason, context_tokens, rounds, auto_clear_enabled }) {
  const signal = {
    command: severity === "NONE" ? null : "/clear",
    severity: severity,
    reason: reason,
    context_tokens: Number(context_tokens || 0),
    rounds: Number(rounds || 0),
    auto_clear_enabled: !!auto_clear_enabled,
    written_at: new Date().toISOString(),
    source: "cline-governance-extension",
  };
  writeJsonSafe(SIGNAL_FILE(), signal);
  appendEvent({ type: "AUTO_CLEAR_SIGNAL", ...signal });
  return signal;
}

function computeBreach(metrics, rounds, gov) {
  const softCtx = gov.max_context_tokens != null ? Number(gov.max_context_tokens) : 80000;
  const hardCtx =
    gov.token_guardrails && gov.token_guardrails.max_context_tokens != null
      ? Number(gov.token_guardrails.max_context_tokens)
      : 100000;
  const maxTurns =
    gov.max_turns != null
      ? Number(gov.max_turns)
      : gov.token_guardrails && gov.token_guardrails.context_warn_rounds != null
      ? Number(gov.token_guardrails.context_warn_rounds)
      : 5;
  const ctx = metrics ? Number(metrics.context_tokens || 0) : 0;
  const r = Number(rounds || 0);
  const autoClearEnabled = gov.auto_clear_enabled !== false;
  const reasons = [];
  if (ctx >= softCtx) reasons.push("Context " + ctx.toLocaleString("en-US") + " ≥ " + softCtx.toLocaleString("en-US") + " Tokens");
  if (r >= maxTurns) reasons.push("对话轮数 " + r + " ≥ " + maxTurns + " 轮");
  const hard = ctx >= hardCtx;
  const soft = reasons.length > 0 && autoClearEnabled;
  const severity = hard ? "CRITICAL" : soft ? "SOFT" : "NONE";
  const reason = hard ? "circuit_breaker_100k" : soft ? "auto_clear_soft" : "context_recovered";
  return {
    severity,
    reason,
    reasons,
    soft,
    hard,
    triggered: hard || soft,
    softCtx,
    hardCtx,
    maxTurns,
    ctx,
    rounds: r,
    autoClearEnabled,
  };
}

function enforcementTick(breach) {
  const key = breach.severity + ":" + breach.reason;
  if (key === lastSignalKey) return false;
  lastSignalKey = key;
  writeSignal({
    severity: breach.severity,
    reason: breach.reason,
    context_tokens: breach.ctx,
    rounds: breach.rounds,
    auto_clear_enabled: breach.autoClearEnabled,
  });
  return true;
}

// ============================================================
// 健康指数（子项目 .governance_entry.py + .heartbeat 直读）
// ============================================================
const SKIP_DIRS = new Set([
  "node_modules", "output", "work", ".git", ".vscode", ".agents", ".codex",
  "dist", "TEMP", "tmp", "cache", ".venv", "venv", "__pycache__",
]);

let projectCache = [];
let projectCacheAt = 0;

function discoverSubprojects(force) {
  const now = Date.now();
  if (!force && projectCache.length && now - projectCacheAt < 20000) return projectCache;
  const root = workspaceRoot();
  const found = [];
  if (root && fs.existsSync(root)) {
    const stack = [{ dir: root, depth: 0 }];
    while (stack.length) {
      const { dir, depth } = stack.pop();
      if (depth > 6) continue;
      let entries;
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch (_) {
        continue;
      }
      for (const e of entries) {
        if (!e.isDirectory() || e.name.startsWith(".") || SKIP_DIRS.has(e.name)) continue;
        const full = path.join(dir, e.name);
        try {
          if (fs.existsSync(path.join(full, ".governance_entry.py"))) {
            found.push({ name: path.relative(root, full).split(path.sep).join("/"), dir: full });
          }
        } catch (_) {}
        stack.push({ dir: full, depth: depth + 1 });
      }
    }
  }
  found.sort((a, b) => a.name.localeCompare(b.name));
  projectCache = found;
  projectCacheAt = now;
  return found;
}

function computeHealthReport() {
  const projects = discoverSubprojects(false);
  const controls = loadControls();
  const blackbox = readJsonWithMeta(BLACKBOX_FILE()).data || { projects: {} };
  const timeout = Number(controls.heartbeat_timeout_sec || 120);
  let totalHealth = 0;
  let hanging = 0;
  const list = projects.map((p) => {
    const hb = path.join(p.dir, ".heartbeat");
    const res = {
      name: p.name,
      status: "UNKNOWN",
      last_heartbeat_ago_sec: null,
      last_heartbeat_ts: null,
      health_score: 0,
    };
    if (fs.existsSync(hb)) {
      try {
        const st = fs.statSync(hb);
        const ago = (Date.now() - st.mtimeMs) / 1000;
        res.last_heartbeat_ago_sec = Math.round(ago * 10) / 10;
        res.last_heartbeat_ts = st.mtime.toISOString();
        res.status = ago > timeout ? "HANG" : "OK";
        res.health_score = Math.max(0, 1 - ago / timeout);
      } catch (_) {}
    }
    const bb = (blackbox.projects || {})[p.name] || {};
    if (bb.status === "HANG") {
      res.status = "HANG";
      res.blackbox_confirmed = true;
      res.detected_hang_at = bb.detected_hang_at || null;
    }
    if (res.status === "HANG") hanging++;
    totalHealth += res.health_score;
    return res;
  });
  const overallHealth = list.length ? Math.round((totalHealth / list.length) * 1000) / 10 : 100;
  return {
    overall_health_score: overallHealth,
    overall_status: hanging > 0 ? "critical" : "healthy",
    project_count: list.length,
    hanging_count: hanging,
    projects: list,
    controls,
  };
}

// ============================================================
// 宪法执行状态 + 数据源新鲜度
// ============================================================
const REQUIRED_IGNORE_RULES = ["output/", "work/", "node_modules/", ".git/", ".env"];

function loadConstitutionStatus() {
  const gov = loadGovernance();
  const constitution = gov.constitution || {};
  const agentsMdLoaded = fs.existsSync(AGENTS_MD());
  let rules = [];
  if (fs.existsSync(CODEXIGNORE_FILE())) {
    try {
      rules = fs
        .readFileSync(CODEXIGNORE_FILE(), "utf-8")
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith("#"));
    } catch (_) {}
  }
  const covered = REQUIRED_IGNORE_RULES.filter((r) => rules.some((rule) => rule.includes(r)));
  return {
    agents_md_loaded: agentsMdLoaded,
    last_synced: constitution.last_synced || null,
    governance_json_active: !!constitution.file,
    codexignore_exists: fs.existsSync(CODEXIGNORE_FILE()),
    codexignore_active: rules.length > 0 && covered.length === REQUIRED_IGNORE_RULES.length,
    required_covered: covered,
    required_missing: REQUIRED_IGNORE_RULES.filter((r) => !covered.includes(r)),
  };
}

function sourceFreshness(p) {
  const meta = fileMeta(p);
  if (!meta.exists) return { name: path.basename(p), exists: false, ageSec: null, mtimeIso: null, fresh: false };
  const ageSec = Math.round((Date.now() - meta.mtimeMs) / 1000);
  return {
    name: path.relative(workspaceRoot(), p).split(path.sep).join("/"),
    exists: true,
    ageSec,
    mtimeIso: meta.mtimeIso,
    fresh: ageSec <= 60,
  };
}

// ============================================================
// 汇总报告
// ============================================================
function buildReport() {
  const govMeta = readJsonWithMeta(GOVERNANCE_JSON());
  const gov = govMeta.data || {};
  const controlsMeta = readJsonWithMeta(CONTROLS_FILE());
  const signalMeta = readJsonWithMeta(SIGNAL_FILE());
  const codex = computeCodexMetrics();
  const health = computeHealthReport();
  const breach = computeBreach(codex.metrics, codex.rounds, gov);
  const constitution = loadConstitutionStatus();
  const tokenSaver = {
    enabled: tokenSaverEnabled(gov),
    skill: ensureTokenSaverSkill(),
    config: ensureConfigToml(),
    codexignore: ensureCodexignore(),
  };

  const sources = [
    sourceFreshness(GOVERNANCE_JSON()),
    sourceFreshness(SIGNAL_FILE()),
    sourceFreshness(CONTROLS_FILE()),
    sourceFreshness(BLACKBOX_FILE()),
    sourceFreshness(EVENTS_FILE()),
  ];
  if (codex.session && codex.session.file) sources.push(sourceFreshness(codex.session.file));

  return {
    timestamp: new Date().toISOString(),
    health,
    metrics: codex.metrics,
    rounds: codex.rounds,
    metricsSource: codex.source,
    metricsNote: codex.note,
    session: codex.session,
    limits: {
      softCtx: breach.softCtx,
      hardCtx: breach.hardCtx,
      maxTurns: breach.maxTurns,
      maxRequest: (gov.token_guardrails && gov.token_guardrails.max_request_tokens) || 80000,
      maxSession: (gov.token_guardrails && gov.token_guardrails.max_session_tokens) || 500000,
      dailyBudget: (gov.token_guardrails && gov.token_guardrails.daily_budget_tokens) || 2000000,
    },
    breach,
    signal: signalMeta.data,
    signalMeta,
    governance: gov,
    governanceMeta: govMeta.meta,
    controlsMeta: controlsMeta.meta,
    constitution,
    tokenSaverEnabled: tokenSaver.enabled,
    token_saver: tokenSaver,
    sources,
  };
}

// ============================================================
// 原生通知（熔断 / 恢复）— v3.1.1: 居中 Modal + 单次告警闩锁
// ============================================================
let lastNotifyBreach = "none";
let lastNotifyTime = 0;
// 告警闩锁：同一轮越限只弹一次；/clear 使 Context 回落后复位，允许下次越限再告警
const ALERT_LATCH = { soft: false, critical: false };

async function showNativeAlert(report) {
  const now = Date.now();
  const breach = report.breach || {};
  if (!breach.triggered) {
    // Context 已回落（例如执行 /clear）：复位闩锁，避免静默期后无法再次告警
    const wasCritical = lastNotifyBreach === "critical";
    lastNotifyBreach = "none";
    lastNotifyTime = now;
    ALERT_LATCH.soft = false;
    ALERT_LATCH.critical = false;
    if (wasCritical) {
      vscode.window.showInformationMessage("✅ Token 熔断已解除 — Context 已回落至阈值以下", {
        modal: false,
      });
    }
    return;
  }
  const kind = breach.severity === "CRITICAL" ? "critical" : breach.severity === "SOFT" ? "soft" : null;
  if (!kind || ALERT_LATCH[kind]) return; // 已告警过，静默直到 /clear 重置 Token 计数
  ALERT_LATCH[kind] = true;
  lastNotifyBreach = kind;
  lastNotifyTime = now;
  const message =
    kind === "critical"
      ? "⛔ Token 自动熔断（100k CRITICAL）— Context " +
        (report.metrics ? report.metrics.context_tokens.toLocaleString("en-US") : 0) +
        " Tokens，建议输入 /clear"
      : "⚠️ 上下文膨胀（SOFT 预警）— 建议输入 /clear 释放上下文";
  // 居中 Modal：不再遮挡右下角 Chat 输入框
  const selection = await vscode.window.showWarningMessage(message, { modal: true }, "查看治理面板");
  if (selection === "查看治理面板") vscode.commands.executeCommand("cline-governance.panel.focus");
}

// ============================================================
// 动作：阈值 / 开关 / 信号写入
// ============================================================
function saveThreshold(key, value) {
  if (key === "heartbeatTimeoutSec" || key === "riskThreshold") {
    const controls = loadControls();
    controls[key === "heartbeatTimeoutSec" ? "heartbeat_timeout_sec" : "risk_threshold"] = value;
    writeJsonSafe(CONTROLS_FILE(), controls);
    return;
  }
  const gov = loadGovernance();
  switch (key) {
    case "softContextTokens":
      gov.max_context_tokens = value;
      break;
    case "maxTurns":
      gov.max_turns = value;
      break;
    case "cooldownSeconds":
      gov.circuit_breaker = gov.circuit_breaker || {};
      gov.circuit_breaker.cooldown_seconds = value;
      break;
    case "hardContextTokens":
      gov.token_guardrails = gov.token_guardrails || {};
      gov.token_guardrails.max_context_tokens = value;
      break;
    default:
      return;
  }
  writeJsonSafe(GOVERNANCE_JSON(), gov);
}

function toggleAutoClear(enabled) {
  const gov = loadGovernance();
  gov.auto_clear_enabled = !!enabled;
  writeJsonSafe(GOVERNANCE_JSON(), gov);
}

function updateControl(key, value) {
  const controls = loadControls();
  if (key in controls) {
    controls[key] = value;
    writeJsonSafe(CONTROLS_FILE(), controls);
  }
}

// ============================================================
// 动作：强杀 Agent（Node 实现，按需调用，零常驻进程）
// ============================================================
const KILL_NAMES = ["node.exe", "python.exe", "pythonw.exe", "codex.exe", "bun.exe"];
const KILL_MARKERS = ["codex", "git008", "cline-anti-freeze", "sentinel", "executor", "hf_", "fork_"];

function isKillTarget(name, cmdline) {
  const low = String(name || "").toLowerCase();
  if (!KILL_NAMES.some((n) => low.includes(n.toLowerCase()))) return false;
  if (!cmdline) return false;
  const cl = String(cmdline).toLowerCase();
  if (["governance_ui.py", "streamlit", "monitor.py", "codex_metrics.py", "auto_enforce.py"].some((s) => cl.includes(s))) {
    return false;
  }
  return KILL_MARKERS.some((m) => cl.includes(m));
}

function killAgents() {
  return new Promise((resolve) => {
    const psScript =
      "Get-CimInstance Win32_Process | Where-Object { $_.Name -in @('node.exe','python.exe','pythonw.exe','codex.exe','bun.exe') } | Select-Object ProcessId, Name, CommandLine | ConvertTo-Json -Compress";
    execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", psScript], { timeout: 20000 }, (err, stdout) => {
      const result = { terminated: 0, pids_killed: [], errors: [], processes: [] };
      if (err) {
        result.errors.push(String(err.message || err));
        return resolve(result);
      }
      let list = [];
      try {
        const parsed = JSON.parse(stdout);
        list = Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
      } catch (_) {}
      const targets = list.filter((p) => isKillTarget(p.Name, p.CommandLine));
      result.processes = targets.map((p) => ({ name: p.Name, pid: p.ProcessId, command: String(p.CommandLine).slice(0, 200) }));
      let index = 0;
      const killNext = () => {
        if (index >= targets.length) return resolve(result);
        const t = targets[index++];
        const pid = String(t.ProcessId);
        result.pids_killed.push(pid);
        execFile("taskkill", ["/F", "/T", "/PID", pid], { timeout: 15000 }, (kerr) => {
          if (!kerr) result.terminated++;
          else result.errors.push("无法终止 PID " + pid + ": " + String(kerr.message || kerr));
          killNext();
        });
      };
      killNext();
    });
  });
}

// ============================================================
// WebviewView Provider
// ============================================================
class GovernancePanelProvider {
  constructor() {
    this._view = null;
  }

  resolveWebviewView(webviewView) {
    this._view = webviewView;
    currentView = webviewView;
    webviewView.webview.options = { enableScripts: true, localResourceRoots: [] };
    webviewView.webview.html = getHtmlContent();
    webviewView.webview.onDidReceiveMessage((message) => this.handleMessage(message, webviewView));
    this.sendReport(webviewView);
  }

  handleMessage(message, webviewView) {
    switch (message.command) {
      case "refresh":
        this.sendReport(webviewView);
        break;
      case "toggleAutoClear":
        toggleAutoClear(message.enabled);
        lastSignalKey = "";
        this.sendReport(webviewView);
        break;
      case "toggleTokenSaver":
        toggleTokenSaver(message.enabled);
        lastSignalKey = "";
        this.sendReport(webviewView);
        break;
      case "saveThreshold":
        saveThreshold(message.key, message.value);
        lastSignalKey = "";
        this.sendReport(webviewView);
        break;
      case "updateControl":
        updateControl(message.key, message.value);
        this.sendReport(webviewView);
        break;
      case "writeClearSignal": {
        const report = buildReport();
        writeSignal({
          severity: "SOFT",
          reason: "manual_ui",
          context_tokens: report.metrics ? report.metrics.context_tokens : 0,
          rounds: report.rounds || 0,
          auto_clear_enabled: report.governance.auto_clear_enabled !== false,
        });
        lastSignalKey = "SOFT:manual_ui";
        vscode.window.showInformationMessage("⚡ /clear 信号已手动写入 governance_logs/auto_clear_signal.json");
        this.sendReport(webviewView);
        break;
      }
      case "triggerClear": {
        this.triggerOneClickClear(webviewView);
        break;
      }
      case "clearSignal": {
        const report = buildReport();
        writeSignal({
          severity: "NONE",
          reason: "cleared_manually",
          context_tokens: report.metrics ? report.metrics.context_tokens : 0,
          rounds: report.rounds || 0,
          auto_clear_enabled: report.governance.auto_clear_enabled !== false,
        });
        lastSignalKey = "NONE:cleared_manually";
        vscode.window.showInformationMessage("🧹 熔断信号已清除");
        this.sendReport(webviewView);
        break;
      }
      case "clearBlackbox":
        writeJsonSafe(BLACKBOX_FILE(), { version: "1.0", last_updated: null, projects: {} });
        vscode.window.showInformationMessage("🧹 黑盒已清空");
        this.sendReport(webviewView);
        break;
      case "killAgents": {
        vscode.window.showInformationMessage("🔪 正在强制终止匹配的 CODEX/Agent 进程…");
        killAgents().then((result) => {
          const msg =
            "✅ 已强杀 " + result.terminated + " 个进程\nPIDs: " + (result.pids_killed.join(", ") || "无") +
            (result.errors.length ? "\n⚠️ " + result.errors.join("\n") : "");
          vscode.window.showInformationMessage(msg, { modal: false });
          this.sendReport(webviewView);
        });
        break;
      }
      default:
        break;
    }
  }

  async triggerOneClickClear(webviewView) {
    const report = buildReport();
    // 1. 直接写入 clear 信号到 governance_logs/auto_clear_signal.json
    writeSignal({
      severity: "SOFT",
      reason: "manual_one_click_clear",
      context_tokens: report.metrics ? report.metrics.context_tokens : 0,
      rounds: report.rounds || 0,
      auto_clear_enabled: report.governance.auto_clear_enabled !== false,
    });
    lastSignalKey = "SOFT:manual_one_click_clear";

    // 2. 仅注入纯文本到剪贴板（writeText，绝不写入图像/富文本）
    //    Token-Saver 开启时附带极简模式 System Directive
    let clipboardReady = false;
    try {
      const clearText = tokenSaverClearClipboardText(report.governance);
      await vscode.env.clipboard.writeText(clearText);
      clipboardReady = true;
    } catch (_) {}
    // 3. 仅聚焦 Chat 输入框；用户随后按 Ctrl+V + Enter 发送 /clear
    try {
      await vscode.commands.executeCommand("workbench.action.chat.focus");
    } catch (_) {}

    const tsOn = tokenSaverEnabled(report.governance);
    const note = clipboardReady
      ? tsOn
        ? "（Token-Saver 极简指令已复制：粘贴到 Chat 输入框后按 Enter 发送）"
        : "（纯文本 /clear 已复制：在 Chat 输入框按 Ctrl+V 后按 Enter 即可发送）"
      : "（剪贴板写入失败，请手动输入 /clear）";
    vscode.window.showInformationMessage("已成功触发 /clear 上下文重置" + note);
    this.sendReport(webviewView);
  }

  sendReport(webviewView) {
    if (!webviewView) webviewView = this._view;
    if (!webviewView) return;
    const report = buildReport();
    webviewView.webview.postMessage({ type: "governanceReport", report });
  }
}

// ============================================================
// 轮询 + 熔断触发器（扩展进程内，无 Python 后端）
// ============================================================
let currentView = null;
let pollTimer = null;

function startPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(async () => {
    if (!currentView) return;
    try {
      const report = buildReport();
      const changed = enforcementTick(report.breach);
      if (changed) {
        // 信号文件已更新 → 立即推送最新报告
        currentView.webview.postMessage({ type: "governanceReport", report: buildReport() });
      } else {
        currentView.webview.postMessage({ type: "governanceReport", report });
      }
      await showNativeAlert(report);
    } catch (_) {}
  }, POLL_INTERVAL_MS);
}

// ============================================================
// 激活
// ============================================================
function activate(context) {
  console.log("🏛️ CODEX 治理中心 v3.1 已激活（Token-Saver 自动注入 · Webview UI Sync）");

  const provider = new GovernancePanelProvider();
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("cline-governance.panel", provider, {
      webviewOptions: { retainContextWhenHidden: true },
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("cline-governance.panel.focus", () => {
      vscode.commands.executeCommand("cline-governance.panel.focus");
    })
  );

  // 启动即巡检一次：若当前上下文健康则清除陈旧信号，解决“显示旧数据”
  setTimeout(() => {
    discoverSubprojects(true);
    try {
      const injected = {
        skill: ensureTokenSaverSkill(),
        config: ensureConfigToml(),
        codexignore: ensureCodexignore(),
      };
      console.log("🧪 Token-Saver 自动注入:", JSON.stringify(injected));
    } catch (_) {}
    try {
      const report = buildReport();
      enforcementTick(report.breach);
    } catch (_) {}
    startPolling();
  }, 1500);
}

function deactivate() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  currentView = null;
}

module.exports = {
  activate,
  deactivate,
  _internal: {
    computeBreach,
    computeCodexMetrics,
    computeHealthReport,
    writeSignal,
    buildReport,
    ensureTokenSaverSkill,
    ensureConfigToml,
    ensureCodexignore,
    toggleTokenSaver,
    tokenSaverEnabled,
    tokenSaverClearClipboardText,
  },
};

// ============================================================
// Webview HTML（原生渲染，无 iframe / 无 HTTP / 无 WebSocket）
// ============================================================
function getHtmlContent() {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>🏛️ 治理中心 v3</title>
<style>
  :root {
    --bg: var(--vscode-sideBar-background, #1e1e2e);
    --fg: var(--vscode-sideBar-foreground, #cdd6f4);
    --border: var(--vscode-sideBar-border, #313244);
    --accent: var(--vscode-activityBar-activeBorder, #89b4fa);
    --green: #a6e3a1;
    --red: #f38ba8;
    --orange: #fab387;
    --card-bg: var(--vscode-editor-background, #181825);
    --dim: var(--vscode-descriptionForeground, #6c7086);
    /* v3.1 高对比度：自动适配主题前景色，缺省回退深色 #1e1e1e */
    --strong-fg: var(--vscode-foreground, #1e1e1e);
    --btn-bg: var(--vscode-button-background, #2d7ff9);
    --btn-fg: var(--vscode-button-foreground, #1e1e1e);
    --btn-border: var(--vscode-button-border, #1f5fb8);
    --input-bg: var(--vscode-input-background, #ffffff);
    --input-fg: var(--vscode-input-foreground, #1e1e1e);
    --input-border: var(--vscode-input-border, #555555);
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: var(--vscode-font-family);
    font-size: 13px;
    color: var(--fg);
    background: var(--bg);
    user-select: none;
    overflow-x: hidden;
  }
  .panel-header {
    padding: 10px 12px;
    display: flex;
    align-items: center;
    gap: 8px;
    border-bottom: 1px solid var(--border);
    position: sticky;
    top: 0;
    background: var(--bg);
    z-index: 10;
  }
  .panel-header .title { font-weight: 700; font-size: 1.02em; flex: 1; color: var(--strong-fg) !important; }
  .status-badge {
    font-size: 0.68em; font-weight: 700; padding: 2px 8px;
    border-radius: 10px; text-transform: uppercase;
  }
  .status-badge.healthy { background: #1a3a1a; color: var(--green); }
  .status-badge.soft { background: #3a2c0a; color: var(--orange); }
  .status-badge.critical { background: #3a1a1a; color: var(--red); animation: pulse 1.5s infinite; }
  @keyframes pulse { 50% { opacity: 0.55; } }

  .section { padding: 10px 12px; border-bottom: 1px solid var(--border); }
  .section-title {
    font-size: 0.76em; font-weight: 700; color: var(--strong-fg) !important;
    text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px;
  }

  .kpi-row { display: flex; gap: 8px; margin-bottom: 8px; }
  .kpi-card {
    flex: 1; background: var(--card-bg); border-radius: 6px;
    padding: 8px 10px; text-align: center; border: 1px solid var(--border);
  }
  .kpi-value { font-size: 1.4em; font-weight: 700; }
  .kpi-label { font-size: 0.64em; font-weight: 700; color: var(--strong-fg) !important; margin-top: 2px; }
  .kpi-value.green { color: var(--green); }
  .kpi-value.red { color: var(--red); }
  .kpi-value.orange { color: var(--orange); }

  .breaker-card {
    background: var(--card-bg); border: 1px solid var(--border);
    border-radius: 6px; padding: 10px 12px; margin-bottom: 8px;
  }
  .breaker-card.critical { border-color: var(--red); background: #2a1015; }
  .breaker-card.soft { border-color: var(--orange); background: #2a2208; }
  .breaker-row { display: flex; justify-content: space-between; align-items: center; }
  .breaker-title { font-weight: 700; font-size: 0.92em; color: var(--strong-fg) !important; }
  .breaker-badge {
    font-size: 0.7em; font-weight: 700; padding: 2px 8px; border-radius: 8px;
  }
  .breaker-badge.NONE { background: #1a3a1a; color: var(--green); }
  .breaker-badge.SOFT { background: #3a2c0a; color: var(--orange); }
  .breaker-badge.CRITICAL { background: #3a1a1a; color: var(--red); animation: pulse 1.2s infinite; }
  .breaker-meta { font-size: 0.74em; color: var(--dim); margin-top: 6px; line-height: 1.5; }

  .metric-label {
    font-size: 0.74em; color: var(--dim); margin-bottom: 5px;
    display: flex; justify-content: space-between;
  }
  .context-value { font-size: 1.35em; font-weight: 700; font-variant-numeric: tabular-nums; }
  .context-value .max { color: var(--dim); font-size: 0.68em; font-weight: normal; }
  .progress {
    position: relative; height: 9px; border-radius: 5px;
    background: #21262d; margin-top: 8px; overflow: hidden;
  }
  .progress-fill { height: 100%; border-radius: 5px; transition: width 0.5s, background 0.5s; }
  .progress-fill.ok { background: linear-gradient(90deg, #00c853, #4ade80); }
  .progress-fill.warn { background: linear-gradient(90deg, #f97316, #eab308); }
  .progress-fill.critical { background: linear-gradient(90deg, #dc2626, #ef4444); }
  .progress-tick {
    position: absolute; top: 0; bottom: 0; width: 2px; background: #fff; opacity: 0.75;
  }
  .context-legend {
    display: flex; justify-content: space-between;
    font-size: 0.7em; color: var(--dim); margin-top: 4px;
  }
  .metric-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 8px; }
  .grid-cell { background: var(--card-bg); border: 1px solid var(--border); border-radius: 6px; padding: 8px 10px; }
  .grid-cell .label { font-size: 0.68em; font-weight: 700; color: var(--strong-fg) !important; }
  .grid-cell .value { font-size: 1.05em; font-weight: 700; margin-top: 2px; }

  .control-row { display: flex; align-items: center; justify-content: space-between; padding: 5px 0; }
  .control-label { font-size: 0.88em; font-weight: 700; color: var(--strong-fg) !important; }
  .toggle-switch { position: relative; width: 36px; height: 20px; flex-shrink: 0; }
  .toggle-switch input { opacity: 0; width: 0; height: 0; }
  .toggle-slider {
    position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0;
    background: #4c4f69; border-radius: 20px; transition: 0.2s;
  }
  .toggle-slider::before {
    content: ""; position: absolute; height: 14px; width: 14px;
    left: 3px; bottom: 3px; background: #fff; border-radius: 50%; transition: 0.2s;
  }
  input:checked + .toggle-slider { background: var(--accent); }
  input:checked + .toggle-slider::before { transform: translateX(16px); }

  .num-row { display: flex; align-items: center; gap: 8px; padding: 4px 0; }
  .num-row .nlabel { font-size: 0.82em; width: 128px; flex-shrink: 0; font-weight: 700; color: var(--strong-fg) !important; }
  .num-row input[type="number"] {
    flex: 1; min-width: 0; background: var(--input-bg); color: var(--input-fg) !important;
    border: 1.5px solid var(--input-border); border-radius: 4px; padding: 4px 6px;
    font-size: 0.82em; font-family: inherit; font-weight: 700;
  }
  .num-row input[type="number"]:focus { outline: 1px solid var(--accent); }
  .num-row .nunit { font-size: 0.72em; color: var(--dim); width: 24px; }

  .action-row { display: flex; gap: 6px; padding: 5px 0; flex-wrap: wrap; }
  .btn {
    flex: 1; min-width: 90px; padding: 6px 8px; border: 1.5px solid var(--btn-border);
    border-radius: 4px; background: var(--btn-bg); color: var(--btn-fg) !important;
    cursor: pointer; font-size: 0.78em; font-weight: 700; text-align: center;
    transition: background 0.15s, filter 0.15s;
  }
  .btn:hover { filter: brightness(1.15); }
  .btn.danger { background: #b91c1c; border-color: #7f1d1d; color: #ffffff !important; }
  .btn.ok { background: #15803d; border-color: #14532d; color: #ffffff !important; }
  .btn.primary {
    flex-basis: 100%; min-height: 34px; font-size: 0.92em; font-weight: 800;
    background: #2563eb; border-color: #1d4ed8; color: #ffffff !important;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.25);
  }
  #kill-result { margin-top: 6px; font-size: 0.7em; color: var(--dim); white-space: pre-wrap; word-break: break-all; max-height: 90px; overflow-y: auto; }

  .project-card {
    background: var(--card-bg); border: 1px solid var(--border);
    border-radius: 6px; padding: 7px 10px; margin-bottom: 6px;
  }
  .project-card.hang { border-color: var(--red); background: #2a1015; }
  .proj-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 3px; }
  .proj-name { font-weight: 700; font-size: 0.86em; color: var(--strong-fg) !important; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .proj-status { font-size: 0.66em; font-weight: 700; padding: 1px 6px; border-radius: 8px; flex-shrink: 0; }
  .proj-status.ok { background: #1a3a1a; color: var(--green); }
  .proj-status.hang { background: #2a0000; color: var(--red); }
  .proj-status.unknown { background: #2a1a00; color: var(--orange); }
  .proj-meta { font-size: 0.68em; color: var(--dim); display: flex; justify-content: space-between; }
  .health-bar { height: 4px; border-radius: 2px; background: #313244; margin-top: 4px; overflow: hidden; }
  .health-bar-fill { height: 100%; border-radius: 2px; transition: width 0.5s; }
  .health-bar-fill.good { background: var(--green); }
  .health-bar-fill.warn { background: var(--orange); }
  .health-bar-fill.critical { background: var(--red); }

  .src-row {
    display: flex; justify-content: space-between; align-items: center;
    font-size: 0.7em; color: var(--dim); padding: 3px 0;
  }
  .src-row .dot { width: 7px; height: 7px; border-radius: 50%; display: inline-block; margin-right: 5px; }
  .dot.fresh { background: var(--green); }
  .dot.stale { background: var(--orange); }
  .dot.missing { background: var(--red); }
  .src-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 60%; }

  .constitution-row {
    display: flex; justify-content: space-between; align-items: center;
    background: var(--card-bg); border: 1px solid var(--border);
    border-radius: 6px; padding: 6px 10px; margin-bottom: 6px; font-size: 0.82em;
  }
  .state.ok { color: var(--green); font-weight: 700; }
  .state.warn { color: var(--orange); font-weight: 700; }
  .state.bad { color: var(--red); font-weight: 700; }

  .panel-footer {
    padding: 8px 12px; font-size: 0.68em; color: var(--dim);
    display: flex; justify-content: space-between;
  }
  .dim { color: var(--dim); }
</style>
</head>
<body>
<div class="panel-header">
  <span style="font-size: 1.15em;">🏛️</span>
  <span class="title">治理中心</span>
  <span class="status-badge healthy" id="global-badge">HEALTHY</span>
</div>

<div class="section">
  <div class="section-title">⛔ 熔断状态 · Auto-Clear</div>
  <div class="breaker-card" id="breaker-card">
    <div class="breaker-row">
      <span class="breaker-title">自动熔断器</span>
      <span class="breaker-badge NONE" id="breaker-badge">NONE</span>
    </div>
    <div class="breaker-meta" id="breaker-meta">等待数据…</div>
  </div>
  <div class="control-row">
    <span class="control-label">⚡ Auto-Clear 自动清理</span>
    <label class="toggle-switch">
      <input type="checkbox" id="ctrl-autoclear" onchange="toggleAutoClear(this.checked)">
      <span class="toggle-slider"></span>
    </label>
  </div>
  <div class="control-row">
    <span class="control-label">⚡ 极致省 Token 模式 (Token-Saver Active)</span>
    <label class="toggle-switch">
      <input type="checkbox" id="ctrl-tokensaver" onchange="toggleTokenSaver(this.checked)">
      <span class="toggle-slider"></span>
    </label>
  </div>
  <div class="breaker-meta" id="ts-meta">Token-Saver 未开启</div>
  <div class="action-row">
    <button class="btn ok" onclick="writeClearSignal()">✍️ 写入 /clear</button>
    <button class="btn" onclick="clearSignal()">🧹 清除信号</button>
  </div>
</div>

<div class="section">
  <div class="section-title">⚡ CODEX 实时 Token 大盘</div>
  <div class="metric-label"><span>当前会话 Context</span><span id="metrics-source">--</span></div>
  <div class="context-value">
    <span id="ctx-used">0</span>
    <span class="max">/ <span id="ctx-max-soft">80,000</span> Tokens (软) · <span id="ctx-max-hard">100,000</span> (硬)</span>
  </div>
  <div class="progress" id="ctx-progress">
    <div class="progress-fill ok" id="ctx-bar" style="width:0%"></div>
    <div class="progress-tick" id="tick-soft" style="left:0%"></div>
    <div class="progress-tick" id="tick-hard" style="left:0%"></div>
  </div>
  <div class="context-legend">
    <span>已用 <span id="ctx-pct">0</span>%</span>
    <span>软线 <span id="ctx-soft-val">80k</span> · 硬线 <span id="ctx-hard-val">100k</span></span>
  </div>
  <div class="metric-grid">
    <div class="grid-cell"><div class="label">累计 Token 耗费</div><div class="value" id="cum-tokens">0</div></div>
    <div class="grid-cell"><div class="label">估算成本 (USD)</div><div class="value" id="cum-usd">$0.00</div></div>
    <div class="grid-cell"><div class="label">单次请求</div><div class="value" id="last-req">0</div></div>
    <div class="grid-cell"><div class="label">对话轮数</div><div class="value" id="rounds">0</div></div>
  </div>
</div>

<div class="section">
  <div class="section-title">🎚️ 容忍阈值 / 超时设置</div>
  <div class="num-row">
    <span class="nlabel">软阈值 Context</span>
    <input type="number" id="th-soft" min="10000" max="90000" step="5000" onchange="saveThreshold('softContextTokens', Number(this.value))">
    <span class="nunit">tok</span>
  </div>
  <div class="num-row">
    <span class="nlabel">硬熔断线 (100k)</span>
    <input type="number" id="th-hard" min="50000" max="1000000" step="5000" onchange="saveThreshold('hardContextTokens', Number(this.value))">
    <span class="nunit">tok</span>
  </div>
  <div class="num-row">
    <span class="nlabel">轮数预警线</span>
    <input type="number" id="th-turns" min="1" max="50" step="1" onchange="saveThreshold('maxTurns', Number(this.value))">
    <span class="nunit">轮</span>
  </div>
  <div class="num-row">
    <span class="nlabel">熔断冷却</span>
    <input type="number" id="th-cooldown" min="0" max="3600" step="10" onchange="saveThreshold('cooldownSeconds', Number(this.value))">
    <span class="nunit">s</span>
  </div>
  <div class="num-row">
    <span class="nlabel">心跳超时</span>
    <input type="number" id="th-timeout" min="30" max="600" step="10" onchange="saveThreshold('heartbeatTimeoutSec', Number(this.value))">
    <span class="nunit">s</span>
  </div>
  <div class="num-row">
    <span class="nlabel">风险容忍阈值</span>
    <input type="number" id="th-risk" min="0" max="1" step="0.05" onchange="saveThreshold('riskThreshold', Number(this.value))">
    <span class="nunit"></span>
  </div>
  <div class="control-row">
    <span class="control-label">🛑 暂停所有生产</span>
    <label class="toggle-switch">
      <input type="checkbox" id="ctrl-pause" onchange="updateControl('pause_all_production', this.checked)">
      <span class="toggle-slider"></span>
    </label>
  </div>
  <div class="control-row">
    <span class="control-label">🔄 自动自愈</span>
    <label class="toggle-switch">
      <input type="checkbox" id="ctrl-selfheal" onchange="updateControl('auto_self_heal', this.checked)">
      <span class="toggle-slider"></span>
    </label>
  </div>
  <div class="control-row">
    <span class="control-label">📡 告警广播</span>
    <label class="toggle-switch">
      <input type="checkbox" id="ctrl-broadcast" onchange="updateControl('alert_broadcast', this.checked)">
      <span class="toggle-slider"></span>
    </label>
  </div>
</div>

<div class="section">
  <div class="section-title">🎬 治理操作</div>
  <div class="action-row">
    <button class="btn primary" onclick="triggerOneClickClear()">🧹 一键 /clear 重置上下文</button>
  </div>
  <div class="action-row">
    <button class="btn" onclick="refresh()">🔄 刷新</button>
    <button class="btn" onclick="clearBlackbox()">🧹 清空黑盒</button>
  </div>
  <div class="action-row">
    <button class="btn danger" onclick="killAgents()">🔪 强制终止 Agent</button>
  </div>
  <div id="kill-result"></div>
</div>

<div class="section">
  <div class="section-title">📊 健康指数</div>
  <div class="kpi-row">
    <div class="kpi-card"><div class="kpi-value green" id="kpi-health">--%</div><div class="kpi-label">健康指数</div></div>
    <div class="kpi-card"><div class="kpi-value" id="kpi-projects">0</div><div class="kpi-label">活跃项目</div></div>
    <div class="kpi-card"><div class="kpi-value red" id="kpi-hanging">0</div><div class="kpi-label">卡死</div></div>
  </div>
  <div id="projects-list"><div style="color: var(--dim); text-align: center; padding: 12px;">扫描中…</div></div>
</div>

<div class="section">
  <div class="section-title">📜 宪法执行状态</div>
  <div class="constitution-row">
    <span>AGENTS.md 宪法</span>
    <span class="state" id="agents-state">检测中</span>
  </div>
  <div class="constitution-row">
    <span>.codexignore 拦截规则</span>
    <span class="state" id="codexignore-state">检测中</span>
  </div>
</div>

<div class="section">
  <div class="section-title">🗂️ 数据源（实时直读）</div>
  <div id="src-list"><div style="color: var(--dim);">加载中…</div></div>
</div>

<div class="panel-footer">
  <span id="poll-time">--</span>
  <span>治理 v3.1 · 高对比度 UI + 一键 /clear</span>
</div>

<script>
  const vscode = acquireVsCodeApi();

  function refresh() { vscode.postMessage({ command: "refresh" }); }
  function toggleAutoClear(enabled) { vscode.postMessage({ command: "toggleAutoClear", enabled: enabled }); }
  function toggleTokenSaver(enabled) { vscode.postMessage({ command: "toggleTokenSaver", enabled: enabled }); }
  function updateControl(key, value) { vscode.postMessage({ command: "updateControl", key: key, value: value }); }
  function saveThreshold(key, value) { vscode.postMessage({ command: "saveThreshold", key: key, value: value }); }
  function writeClearSignal() { vscode.postMessage({ command: "writeClearSignal" }); }
  function clearSignal() { vscode.postMessage({ command: "clearSignal" }); }
  function clearBlackbox() { vscode.postMessage({ command: "clearBlackbox" }); }
  function triggerOneClickClear() { vscode.postMessage({ command: "triggerClear" }); }
  function killAgents() {
    if (window.confirm("确定强制终止所有匹配的 CODEX/Agent 进程？此操作不可撤销。")) {
      vscode.postMessage({ command: "killAgents" });
    }
  }

  function fmt(n) { return (n == null ? 0 : Number(n)).toLocaleString("en-US"); }

  window.addEventListener("message", function (event) {
    const msg = event.data;
    if (msg && msg.type === "governanceReport") render(msg.report);
  });

  function render(r) {
    if (!r) return;
    const health = r.health || {};
    const m = r.metrics || {};
    const lim = r.limits || {};
    const breach = r.breach || {};
    const gov = r.governance || {};
    const constitution = r.constitution || {};

    // 全局状态徽章
    const badge = document.getElementById("global-badge");
    if (breach.severity === "CRITICAL") {
      badge.textContent = "CRITICAL";
      badge.className = "status-badge critical";
    } else if (breach.severity === "SOFT") {
      badge.textContent = "WARN";
      badge.className = "status-badge soft";
    } else if (health.overall_status === "critical") {
      badge.textContent = "HANG";
      badge.className = "status-badge critical";
    } else {
      badge.textContent = "HEALTHY";
      badge.className = "status-badge healthy";
    }

    // 熔断卡片
    const card = document.getElementById("breaker-card");
    card.className = "breaker-card" + (breach.severity === "CRITICAL" ? " critical" : breach.severity === "SOFT" ? " soft" : "");
    const bBadge = document.getElementById("breaker-badge");
    bBadge.textContent = breach.severity || "NONE";
    bBadge.className = "breaker-badge " + (breach.severity || "NONE");
    const meta = document.getElementById("breaker-meta");
    if (breach.triggered) {
      meta.textContent = "触发原因: " + (breach.reason || "?") + " | Context " + fmt(m.context_tokens) +
        " Tokens · " + fmt(r.rounds) + " 轮" + (breach.reasons && breach.reasons.length ? "\n" + breach.reasons.join(" · ") : "");
    } else {
      meta.textContent = "当前无熔断 · Context " + fmt(m.context_tokens) + " Tokens 低于软线 " + fmt(lim.softCtx);
    }

    // Auto-Clear 开关
    document.getElementById("ctrl-autoclear").checked = gov.auto_clear_enabled !== false;

    // Token-Saver 开关 + 注入状态
    const ts = r.token_saver || {};
    const tsBox = document.getElementById("ctrl-tokensaver");
    if (tsBox) tsBox.checked = !!r.tokenSaverEnabled;
    const tsMeta = document.getElementById("ts-meta");
    if (tsMeta) {
      const skillOk = ts.skill && ts.skill.ok;
      const configOk = ts.config && ts.config.ok;
      const ciOk = ts.codexignore && ts.codexignore.ok;
      const state =
        skillOk && configOk && ciOk
          ? "✅ Skill/Config/.codexignore 已注入"
          : "⚠️ 部分注入（Skill:" + (skillOk ? "✅" : "❌") + " Config:" + (configOk ? "✅" : "❌") + " Ignore:" + (ciOk ? "✅" : "❌") + "）";
      tsMeta.textContent = (r.tokenSaverEnabled ? "Token-Saver Active · " : "Token-Saver 未开启 · ") + state;
    }

    // Token 大盘
    const softCtx = lim.softCtx || 80000;
    const hardCtx = lim.hardCtx || 100000;
    const ctx = m.context_tokens || 0;
    const pct = Math.min(100, (ctx / hardCtx) * 100);
    document.getElementById("ctx-used").textContent = fmt(ctx);
    document.getElementById("ctx-max-soft").textContent = fmt(softCtx);
    document.getElementById("ctx-max-hard").textContent = fmt(hardCtx);
    document.getElementById("ctx-pct").textContent = pct.toFixed(1);
    document.getElementById("ctx-soft-val").textContent = Math.round(softCtx / 1000) + "k";
    document.getElementById("ctx-hard-val").textContent = Math.round(hardCtx / 1000) + "k";
    document.getElementById("ctx-soft-val").parentNode.style.color = "var(--vscode-charts-orange, var(--orange))";
    document.getElementById("ctx-hard-val").parentNode.style.color = "var(--vscode-charts-red, var(--red))";
    const bar = document.getElementById("ctx-bar");
    bar.style.width = pct.toFixed(1) + "%";
    bar.className = "progress-fill " + (ctx >= hardCtx ? "critical" : ctx >= softCtx ? "warn" : "ok");
    document.getElementById("tick-soft").style.left = Math.min(100, (softCtx / hardCtx) * 100) + "%";
    document.getElementById("tick-hard").style.left = "100%";
    document.getElementById("cum-tokens").textContent = fmt(m.cumulative_tokens);
    document.getElementById("cum-usd").textContent = "$" + (m.estimated_cost_usd || 0).toFixed(4);
    document.getElementById("last-req").textContent = fmt(m.last_request_tokens);
    document.getElementById("rounds").textContent = fmt(r.rounds) + " / " + fmt(lim.maxTurns);
    document.getElementById("metrics-source").textContent = r.metricsSource === "session_file" ? "会话文件" : (r.metricsSource === "state_file" ? "状态文件" : "无数据");

    // 阈值输入框
    document.getElementById("th-soft").value = softCtx;
    document.getElementById("th-hard").value = hardCtx;
    document.getElementById("th-turns").value = lim.maxTurns || 5;
    const cb = gov.circuit_breaker || {};
    document.getElementById("th-cooldown").value = cb.cooldown_seconds != null ? cb.cooldown_seconds : 120;
    const controls = health.controls || {};
    document.getElementById("th-timeout").value = controls.heartbeat_timeout_sec || 120;
    document.getElementById("th-risk").value = controls.risk_threshold != null ? controls.risk_threshold : 0.7;
    document.getElementById("ctrl-pause").checked = !!controls.pause_all_production;
    document.getElementById("ctrl-selfheal").checked = controls.auto_self_heal !== false;
    document.getElementById("ctrl-broadcast").checked = controls.alert_broadcast !== false;

    // 健康指数
    const h = health.overall_health_score || 0;
    const hp = document.getElementById("kpi-health");
    hp.textContent = h.toFixed(1) + "%";
    hp.className = "kpi-value " + (h >= 70 ? "green" : h >= 40 ? "orange" : "red");
    document.getElementById("kpi-projects").textContent = health.project_count || 0;
    document.getElementById("kpi-hanging").textContent = health.hanging_count || 0;
    const list = document.getElementById("projects-list");
    const projects = health.projects || [];
    if (!projects.length) {
      list.innerHTML = '<div style="color: var(--dim); text-align: center; padding: 12px;">无已注册项目</div>';
    } else {
      let html = "";
      for (let i = 0; i < projects.length; i++) {
        const p = projects[i];
        const score = (p.health_score || 0) * 100;
        const st = p.status || "UNKNOWN";
        const label = st === "OK" ? "正常" : st === "HANG" ? "卡死" : "未知";
        const cls = st === "OK" ? "ok" : st === "HANG" ? "hang" : "unknown";
        const barCls = score >= 70 ? "good" : score >= 30 ? "warn" : "critical";
        const ago = p.last_heartbeat_ago_sec != null ? p.last_heartbeat_ago_sec + "s" : "N/A";
        const emoji = st === "OK" ? "💚" : st === "HANG" ? "💀" : "❓";
        html += '<div class="project-card' + (st === "HANG" ? " hang" : "") + '">' +
          '<div class="proj-header"><span class="proj-name">' + emoji + " " + p.name + "</span>" +
          '<span class="proj-status ' + cls + '">' + label + "</span></div>" +
          '<div class="proj-meta"><span>心跳: ' + ago + "</span><span>健康: " + score.toFixed(0) + "%</span></div>" +
          '<div class="health-bar"><div class="health-bar-fill ' + barCls + '" style="width:' + Math.min(100, score).toFixed(0) + '%"></div></div></div>';
      }
      list.innerHTML = html;
    }

    // 宪法
    const agentsState = document.getElementById("agents-state");
    agentsState.className = "state " + (constitution.agents_md_loaded ? "ok" : "bad");
    agentsState.textContent = constitution.agents_md_loaded ? "✅ 已加载" : "❌ 未加载";
    const ciState = document.getElementById("codexignore-state");
    ciState.className = "state " + (constitution.codexignore_active ? "ok" : constitution.codexignore_exists ? "warn" : "bad");
    ciState.textContent = constitution.codexignore_active ? "✅ 生效" : constitution.codexignore_exists ? "⚠️ 部分" : "❌ 缺失";

    // 数据源新鲜度
    const srcList = document.getElementById("src-list");
    const sources = r.sources || [];
    if (!sources.length) {
      srcList.innerHTML = '<div style="color: var(--dim);">无数据源</div>';
    } else {
      let html = "";
      for (let i = 0; i < sources.length; i++) {
        const s = sources[i];
        const dot = s.exists ? (s.fresh ? "fresh" : "stale") : "missing";
        const age = s.exists ? (s.ageSec < 60 ? s.ageSec + "s" : Math.floor(s.ageSec / 60) + "m" + (s.ageSec % 60) + "s") : "缺失";
        html += '<div class="src-row"><span class="src-name"><span class="dot ' + dot + '"></span>' + s.name + "</span><span>" + age + "</span></div>";
      }
      srcList.innerHTML = html;
    }

    document.getElementById("poll-time").textContent = new Date().toLocaleTimeString();
  }

  // 占位初始渲染
  render({
    health: {}, metrics: {}, limits: { softCtx: 80000, hardCtx: 100000, maxTurns: 5 },
    breach: { severity: "NONE", triggered: false },
    governance: {}, rounds: 0, sources: [],
  });
</script>
</body>
</html>`;
}
