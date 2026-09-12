/**
 * failover.js — 429/5xx 智能切流与重试核心调度器
 *
 * 核心职责：
 * 1. 多层级提供商路由优先级排序 (Priority 1: DeepSeek -> Priority 2: Gemini -> Priority 3: OpenRouter -> Priority 4: FCC)；
 * 2. 状态码与故障感知 (429 Rate Limit / 5xx Server Error / Timeout / DNS 失败)；
 * 3. 指数退避与熔断保护 (Circuit Breaker & Exponential Backoff)；
 * 4. 全链路透明支持 Streaming (SSE) 与标准 JSON 返回。
 */

import { parseToml } from './cache_booster.js';
import fs from 'node:fs';

export class FailoverEngine {
  constructor(config = {}) {
    this.config = config;
    this.providers = this.loadProviders();
    this.circuitBreakers = new Map(); // providerName -> { failureCount, nextTryTime }
    this.stats = {
      totalRequests: 0,
      successfulRequests: 0,
      failoverEvents: 0,
      providerHits: {}
    };
  }

  static fromConfigFile(filePath) {
    try {
      if (fs.existsSync(filePath)) {
        const raw = fs.readFileSync(filePath, 'utf8');
        const parsed = parseToml(raw);
        return new FailoverEngine(parsed);
      }
    } catch (e) {
      console.warn('[FailoverEngine] Failed to load config from file:', e.message);
    }
    return new FailoverEngine();
  }

  loadProviders() {
    const rawProviders = this.config.providers || {};
    const list = [];

    for (const [key, conf] of Object.entries(rawProviders)) {
      if (conf.enabled !== false) {
        list.push({
          id: key,
          name: conf.name || key,
          priority: typeof conf.priority === 'number' ? conf.priority : 99,
          baseUrl: conf.base_url || '',
          apiKeyEnv: conf.api_key_env || '',
          defaultModel: conf.default_model || 'gpt-3.5-turbo',
          timeoutMs: conf.timeout_ms || 40000,
          protocol: conf.protocol || 'openai'
        });
      }
    }

    // 按 Priority 从小到大排序 (1 最优先)
    list.sort((a, b) => a.priority - b.priority);
    return list;
  }

  /** 获取有效 API Key */
  getApiKey(provider) {
    if (provider.apiKeyEnv && process.env[provider.apiKeyEnv]) {
      return process.env[provider.apiKeyEnv];
    }
    return '';
  }

  /** 检查熔断器状态 */
  isProviderAvailable(provider) {
    const state = this.circuitBreakers.get(provider.id);
    if (!state) return true;
    if (Date.now() < state.nextTryTime) {
      return false; // 处于熔断冷却中
    }
    return true;
  }

  /** 记录失败并更新熔断状态 */
  recordFailure(provider, status) {
    const cooldownMs = (this.config.failover && this.config.failover.circuit_breaker_cooldown_ms) || 60000;
    const state = this.circuitBreakers.get(provider.id) || { failureCount: 0, nextTryTime: 0 };
    state.failureCount++;
    if (state.failureCount >= 3) {
      state.nextTryTime = Date.now() + cooldownMs;
      console.warn(`[CircuitBreaker] Provider ${provider.name} tripped! Cooldown ${cooldownMs / 1000}s`);
    }
    this.circuitBreakers.set(provider.id, state);
  }

  /** 记录成功 */
  recordSuccess(provider) {
    this.circuitBreakers.delete(provider.id);
  }

  /** 睡眠函数 */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 执行带智能切流的转发请求
   * @param {Object} reqBody 优化的请求体
   * @param {Object} options 请求头等附加选项
   * @returns {Promise<{ response: Response, provider: Object, attempts: Array }>}
   */
  async executeChatCompletion(reqBody, options = {}) {
    this.stats.totalRequests++;
    const retryStatus = (this.config.failover && this.config.failover.retry_on_status) || [429, 500, 502, 503, 504];
    const maxRetriesPerProvider = (this.config.failover && this.config.failover.max_retries_per_provider) || 2;
    const backoffBaseMs = (this.config.failover && this.config.failover.backoff_base_ms) || 400;

    const isStream = Boolean(reqBody.stream);
    const attempts = [];
    let lastError = null;

    // 过滤出当前可用的提供商（有 API Key 或属于免 Key 公共通道）
    const candidateProviders = this.providers.filter(p => {
      const key = this.getApiKey(p);
      const isAvailable = this.isProviderAvailable(p);
      return (key || p.id === 'fcc_free') && isAvailable;
    });

    if (candidateProviders.length === 0) {
      // 兜底：如果所有提供商都被熔断，重置熔断以求生
      console.warn('[FailoverEngine] All providers currently tripped or missing keys. Forcing retry on all configured providers.');
      this.circuitBreakers.clear();
      candidateProviders.push(...this.providers.filter(p => this.getApiKey(p) || p.id === 'fcc_free'));
    }

    if (candidateProviders.length === 0) {
      throw new Error('NO_AVAILABLE_PROVIDERS: No API keys configured in environment variables for any provider.');
    }

    for (let pIndex = 0; pIndex < candidateProviders.length; pIndex++) {
      const provider = candidateProviders[pIndex];
      const apiKey = this.getApiKey(provider);
      const isFallback = pIndex > 0;

      if (isFallback) {
        this.stats.failoverEvents++;
        console.warn(`[Failover] Switching to ${provider.name} (Priority ${provider.priority})...`);
      }

      for (let attempt = 1; attempt <= maxRetriesPerProvider; attempt++) {
        const attemptRecord = {
          provider: provider.name,
          priority: provider.priority,
          attempt,
          timestamp: new Date().toISOString()
        };

        try {
          const targetModel = reqBody.model || provider.defaultModel;
          const payload = {
            ...reqBody,
            model: targetModel
          };

          const endpoint = `${provider.baseUrl.replace(/\/+$/, '')}/chat/completions`;
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), provider.timeoutMs);

          const headers = {
            'Content-Type': 'application/json',
            ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
            ...(provider.id === 'openrouter' ? { 'HTTP-Referer': 'https://git008.nexus', 'X-Title': '008-TokenNexus' } : {})
          };

          const res = await fetch(endpoint, {
            method: 'POST',
            headers,
            body: JSON.stringify(payload),
            signal: controller.signal
          });

          clearTimeout(timeoutId);
          attemptRecord.status = res.status;

          // 成功响应 2xx
          if (res.ok) {
            this.recordSuccess(provider);
            this.stats.successfulRequests++;
            this.stats.providerHits[provider.id] = (this.stats.providerHits[provider.id] || 0) + 1;
            attempts.push(attemptRecord);
            return {
              response: res,
              provider,
              attempts,
              isStream
            };
          }

          // 遇到可重试状态码（如 429、500、502、503 等）
          if (retryStatus.includes(res.status)) {
            const errText = await res.text().catch(() => '');
            attemptRecord.error = `HTTP ${res.status}: ${errText.slice(0, 120)}`;
            console.warn(`[FailoverEngine] ${provider.name} attempt ${attempt} returned HTTP ${res.status}. Error: ${attemptRecord.error}`);

            // 如果是 429 且配置了退避时间，等待后重试当前提供商；否则直接切流
            if (attempt < maxRetriesPerProvider) {
              const backoff = backoffBaseMs * Math.pow(2, attempt - 1) + Math.random() * 200;
              await this.sleep(backoff);
              attempts.push(attemptRecord);
              continue;
            } else {
              this.recordFailure(provider, res.status);
              attempts.push(attemptRecord);
              break; // 切换至下一个 Provider
            }
          } else {
            // 不可重试的客户端 4xx 错误（如 400 Bad Request、401 Invalid Key）
            const errText = await res.text().catch(() => '');
            attemptRecord.error = `HTTP ${res.status}: ${errText.slice(0, 150)}`;
            this.recordFailure(provider, res.status);
            attempts.push(attemptRecord);
            break; // 切换下一个提供商尝试
          }
        } catch (err) {
          const isAbort = err.name === 'AbortError';
          attemptRecord.error = isAbort ? `Timeout (${provider.timeoutMs}ms)` : err.message;
          console.warn(`[FailoverEngine] ${provider.name} exception on attempt ${attempt}: ${attemptRecord.error}`);
          lastError = err;
          attempts.push(attemptRecord);

          if (attempt < maxRetriesPerProvider) {
            await this.sleep(backoffBaseMs);
          } else {
            this.recordFailure(provider, 0);
          }
        }
      }
    }

    throw new Error(`ALL_PROVIDERS_FAILED: Exhausted all fallback channels. Trail: ${JSON.stringify(attempts)}`);
  }

  getMetrics() {
    return {
      ...this.stats,
      configuredProviders: this.providers.map(p => ({
        id: p.id,
        name: p.name,
        priority: p.priority,
        available: this.isProviderAvailable(p)
      }))
    };
  }
}
