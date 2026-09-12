# 🛡️ 008-TokenNexus — 高可用 API 护城河与 Token 优化代理

> **008-TokenNexus** 是 git008 软件工厂的核心 API 护城河服务：提供 OpenAI 兼容的标准 `/v1/chat/completions` 代理网关，内置 **强制前缀缓存优化 (Prefix Cache Booster)**、**Token-Saver 极简指令注入** 与 **429/5xx 智能自动切流 (Smart Failover)**。

---

## 🌟 核心特性

| 特性 | 说明 |
|------|------|
| ⚡ **端口 8080 本地代理** | 无缝兼容任意 OpenAI SDK、LangChain、Cline、Cursor、Next.js 客户端 |
| 🔀 **429/5xx 智能自动切流** | **DeepSeek (Priority 1) → Google Gemini (Priority 2) → OpenRouter (Priority 3) → FCC Free (Priority 4)**，告别速率限制与单点故障 |
| 🧠 **强制前缀缓存优化** | 自动合并与置顶 System 规则，规范化消息结构，最大化触发 DeepSeek / Gemini Prompt Caching |
| ✂️ **Token-Saver 指令注入** | 自动修剪重复历史，注入直接回答约束，平均节省 **30%~50% 输出 Token 成本** |
| 📊 **实时可观测性指标** | 提供 `/metrics` 与 `/health`，实时掌握节省 Token 数量与切流统计 |

---

## 📂 项目结构

```
projects/008-token-nexus/
├── config/
│   └── providers.toml     # 核心配置：主/备 API Keys 与路由优先级
├── src/
│   ├── index.js          # 本地代理服务主入口 (Express, 监听 8080)
│   ├── cache_booster.js  # 强制前缀缓存与 token-saver 指令注入器
│   └── failover.js       # 429/5xx 智能切流、重试与熔断逻辑
├── package.json
└── README.md
```

---

## 🚀 快速启动

### 1. 安装依赖
```bash
cd projects/008-token-nexus
npm install
```

### 2. 配置环境变量
在工作区根目录或子项目内配置你的提供商 API Key（如无某项密钥会自动跳过）：
```env
DEEPSEEK_API_KEY=sk-your-deepseek-key
GEMINI_API_KEY=AIzaSy-your-gemini-key
OPENROUTER_API_KEY=sk-or-your-openrouter-key
```

### 3. 启动服务
```bash
npm start
# 或者使用监听模式调试:
npm run dev
```

---

## 📡 API 调用示例

### 1. 文本对话 (OpenAI 兼容)
```bash
curl http://127.0.0.1:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "deepseek-chat",
    "messages": [
      {"role": "user", "content": "你好，请用一句话介绍你自己"}
    ]
  }'
```

### 2. 查看健康状态与活跃提供商
```bash
curl http://127.0.0.1:8080/health
```

### 3. 查看 Token 节省统计
```bash
curl http://127.0.0.1:8080/metrics
```

---

## ⚙️ 路由与切流配置 (`config/providers.toml`)

```toml
[server]
port = 8080

[cache_booster]
enable_prefix_cache = true
trim_duplicate_history = true
max_history_turns = 12
inject_token_saver = true

[providers.deepseek]
priority = 1
base_url = "https://api.deepseek.com/v1"
api_key_env = "DEEPSEEK_API_KEY"

[providers.gemini]
priority = 2
base_url = "https://generativelanguage.googleapis.com/v1beta/openai"
api_key_env = "GEMINI_API_KEY"

[providers.openrouter]
priority = 3
base_url = "https://openrouter.ai/api/v1"
api_key_env = "OPENROUTER_API_KEY"
```
