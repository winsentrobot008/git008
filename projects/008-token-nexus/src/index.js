/**
 * index.js — 008-TokenNexus 本地高可用代理网关入口
 *
 * 核心特性：
 * 1. 监听端口 8080，完全对齐 OpenAI /v1/chat/completions 规范；
 * 2. 自动集成 cache_booster（前缀对齐、冗余历史裁剪、Token-Saver 指令注入）；
 * 3. 智能 429/5xx 故障切流与重试（DeepSeek -> Gemini -> OpenRouter -> FCC Free）；
 * 4. 实时监控指标端点 (/metrics, /health, /v1/models)。
 */

import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CacheBooster } from './cache_booster.js';
import { FailoverEngine } from './failover.js';

// 自动加载 .env 密钥
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const configPath = path.join(rootDir, 'config', 'providers.toml');

// 初始化引擎
const cacheBooster = CacheBooster.fromConfigFile(configPath);
const failoverEngine = FailoverEngine.fromConfigFile(configPath);

const app = express();

// [TokenNexus] OpenAI Responses SSE Adapter
app.use('/v1/responses', (req, res, next) => {
  req.url = '/v1/chat/completions';

  const origWrite = res.write.bind(res);
  let headerSent = false;

  res.write = function(chunk, encoding, callback) {
    if (!headerSent) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      headerSent = true;
      const initPayload = 
        'event: response.created\ndata: {"response":{"id":"resp_' + Date.now() + '","status":"in_progress"}}\n\n' +
        'event: response.output_item.added\ndata: {"item":{"id":"msg_' + Date.now() + '","type":"message","role":"assistant","content":[]}}\n\n' +
        'event: response.content_part.added\ndata: {"part":{"type":"text","text":""}}\n\n';
      origWrite(initPayload);
    }

    const str = chunk ? chunk.toString() : '';
    let out = '';
    for (let line of str.split('\n')) {
      if (line.startsWith('data: ')) {
        const dataStr = line.slice(6).trim();
        if (dataStr === '[DONE]') {
          out += 'event: response.text.done\ndata: {"text":""}\n\nevent: response.completed\ndata: {"response":{"status":"completed"}}\n\n';
        } else {
          try {
            const json = JSON.parse(dataStr);
            const delta = json.choices?.[0]?.delta;
            const text = delta?.content || delta?.reasoning_content || '';
            if (text) {
              out += event: response.text.delta\ndata: {"delta":}\n\n;
            }
          } catch(e){}
        }
      }
    }
    return out ? origWrite(out, encoding, callback) : true;
  };
  next();
});


  const originalWrite = res.write.bind(res);
  let hasSentHeader = false;

  res.write = function(chunk, encoding, callback) {
    if (!hasSentHeader) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      hasSentHeader = true;
      const initEvents = 
        'event: response.created\ndata: {"response":{"id":"resp_' + Date.now() + '","status":"in_progress"}}\n\n' +
        'event: response.output_item.added\ndata: {"item":{"id":"msg_' + Date.now() + '","type":"message","role":"assistant","content":[]}}\n\n' +
        'event: response.content_part.added\ndata: {"part":{"type":"text","text":""}}\n\n';
      originalWrite(initEvents);
    }

    const str = chunk.toString();
    const lines = str.split('\n');
    let out = '';

    for (let line of lines) {
      if (line.startsWith('data: ')) {
        const dataStr = line.slice(6).trim();
        if (dataStr === '[DONE]') {
          out += 'event: response.text.done\ndata: {"text":""}\n\nevent: response.completed\ndata: {"response":{"status":"completed"}}\n\n';
          continue;
        }
        try {
          const json = JSON.parse(dataStr);
          const delta = json.choices?.[0]?.delta;
          if (delta) {
            let text = delta.content || delta.reasoning_content || '';
            if (text) {
              out += event: response.text.delta\ndata: {"delta":}\n\n;
            }
          }
        } catch (e) {}
      }
    }

    if (out) {
      return originalWrite(out, encoding, callback);
    }
    return true;
  };

  next();
});


const PORT = Number(process.env.PORT || (cacheBooster.config.server && cacheBooster.config.server.port) || 8080);
const HOST = process.env.HOST || (cacheBooster.config.server && cacheBooster.config.server.host) || '0.0.0.0';

// 中间件
app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

// 请求日志跟踪中间件
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    if (req.path.startsWith('/v1/')) {
      console.log(`[${new Date().toISOString()}] ${req.method} ${req.path} ${res.statusCode} -${duration}ms`);
    }
  });
  next();
});

/**
 * POST /v1/chat/completions
 * OpenAI 标准兼容对话接口
 */
app.post('/v1/chat/completions', async (req, res) => {
  const startTime = Date.now();
  try {
    if (!req.body || !Array.isArray(req.body.messages)) {
      return res.status(400).json({
        error: {
          message: 'Invalid request: messages array is required in request body.',
          type: 'invalid_request_error',
          code: 'MISSING_MESSAGES'
        }
      });
    }

    // 1. 执行 Cache Booster 优化
    const { optimizedBody, meta } = cacheBooster.optimize(req.body);

    // 2. 执行 Smart Failover 转发
    const { response, provider, attempts, isStream } = await failoverEngine.executeChatCompletion(optimizedBody);

    // 设置统一追踪 Header
    res.setHeader('X-TokenNexus-Provider', provider.name);
    res.setHeader('X-TokenNexus-Priority', String(provider.priority));
    res.setHeader('X-TokenNexus-Attempts', String(attempts.length));
    res.setHeader('X-TokenNexus-Prefix-Hash', meta.prefixHash);
    res.setHeader('X-TokenNexus-Tokens-Saved', String(meta.estimatedInputTokensSaved));

    // 3. 处理流式输出 (SSE stream)
    if (isStream) {
      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      if (!response.body) {
        throw new Error('Stream response body is empty from upstream provider.');
      }

      // 将 upstream stream pipe 到 client
      const reader = response.body.getReader();
      const pump = async () => {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) {
              res.end();
              break;
            }
            res.write(Buffer.from(value));
          }
        } catch (streamErr) {
          console.error('[Stream Error]', streamErr.message);
          res.end();
        }
      };
      await pump();
      return;
    }

    // 4. 处理标准 JSON 响应
    const data = await response.json();

    // 附加 TokenNexus 元数据到 usage 或 model 字段
    if (data && typeof data === 'object') {
      data._nexus = {
        provider: provider.name,
        priority: provider.priority,
        latency_ms: Date.now() - startTime,
        attempts: attempts.length,
        prefix_hash: meta.prefixHash,
        estimated_input_tokens_saved: meta.estimatedInputTokensSaved
      };
    }

    return res.status(200).json(data);
  } catch (err) {
    console.error('[TokenNexus Error]', err.message);
    return res.status(502).json({
      error: {
        message: err.message || 'TokenNexus failover exhausted with no available channels.',
        type: 'token_nexus_gateway_error',
        code: 'FAILOVER_EXHAUSTED'
      }
    });
  }
});

/**
 * GET /v1/models
 * OpenAI 标准模型列表查询
 */
app.get('/v1/models', (req, res) => {
  const models = [
    { id: 'deepseek-chat', object: 'model', owned_by: 'deepseek' },
    { id: 'deepseek-reasoner', object: 'model', owned_by: 'deepseek' },
    { id: 'gemini-1.5-flash', object: 'model', owned_by: 'google' },
    { id: 'gemini-1.5-pro', object: 'model', owned_by: 'google' },
    { id: 'openai/gpt-4o-mini', object: 'model', owned_by: 'openrouter' },
    { id: 'auto-best-cost', object: 'model', owned_by: 'token-nexus' }
  ];
  return res.json({ object: 'list', data: models });
});

/**
 * GET /health
 * 健康检查
 */
app.get('/health', (req, res) => {
  const providers = failoverEngine.getMetrics().configuredProviders;
  return res.json({
    status: 'healthy',
    service: '008-TokenNexus',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    providers
  });
});

/**
 * GET /metrics
 * Token 节省与切流监控指标
 */
app.get('/metrics', (req, res) => {
  return res.json({
    cache_booster: cacheBooster.getMetrics(),
    failover: failoverEngine.getMetrics(),
    uptime_seconds: Math.floor(process.uptime())
  });
});

/**
 * 根路径欢迎
 */
app.get('/', (req, res) => {
  return res.json({
    name: '008-TokenNexus Gateway',
    description: 'High-availability LLM API proxy with prefix caching, token-saver optimization, and smart 429/5xx failover',
    endpoints: {
      chat_completions: 'POST /v1/chat/completions',
      models: 'GET /v1/models',
      health: 'GET /health',
      metrics: 'GET /metrics'
    }
  });
});

// 启动监听
app.listen(PORT, HOST, () => {
  console.log(`
════════════════════════════════════════════════════════════════
  🛡️  008-TokenNexus API Gateway is Online!
  📍 Listening: http://${HOST}:${PORT}
  📡 Endpoints:
     - POST http://${HOST}:${PORT}/v1/chat/completions
     - GET  http://${HOST}:${PORT}/v1/models
     - GET  http://${HOST}:${PORT}/health
     - GET  http://${HOST}:${PORT}/metrics
  ⚡ Routing Priority: DeepSeek (1) -> Gemini (2) -> OpenRouter (3) -> FCC (4)
════════════════════════════════════════════════════════════════
  `);
});

