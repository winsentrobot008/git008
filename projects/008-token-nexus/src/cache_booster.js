
/**
 * cache_booster.js — 强制前缀缓存与 Token-Saver 优化引擎
 *
 * 核心职责：
 * 1. 结构化前缀对齐 (Prefix Cache Alignment)：将固定的 System Prompt 与规则置于前部，最大化触发 DeepSeek / Gemini Prompt Caching；
 * 2. 冗余历史裁剪 (History Deduplication & Trimming)：剔除连续重复消息、压缩超长上下文，降低输入 Token 消耗；
 * 3. 极简指令注入 (Token-Saver Directive Injection)：向 System Message 追加简洁性硬约束，压减模型冗长废话输出（节省 Output Token 30-50%）；
 * 4. 统计与指标计算 (Token Savings Metrics)。
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';

/** 轻量级内建 TOML 解析器 */
export function parseToml(raw) {
  const result = {};
  let currentSection = result;
  const lines = raw.split(/\r?\n/);

  for (let line of lines) {
    line = line.trim();
    if (!line || line.startsWith('#')) continue;

    // 处理 section 头部 [a.b.c]
    const sectionMatch = line.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      const keys = sectionMatch[1].split('.');
      let target = result;
      for (const k of keys) {
        if (!target[k] || typeof target[k] !== 'object') {
          target[k] = {};
        }
        target = target[k];
      }
      currentSection = target;
      continue;
    }

    // 处理 key = value
    const kvMatch = line.match(/^([^=]+)=(.*)$/);
    if (kvMatch) {
      const key = kvMatch[1].trim();
      let val = kvMatch[2].trim();

      // 去除行尾注释
      if (val.includes('#') && !val.startsWith('"') && !val.startsWith('[')) {
        val = val.split('#')[0].trim();
      }

      if (val.startsWith('"') && val.endsWith('"')) {
        currentSection[key] = val.slice(1, -1).replace(/\\"/g, '"');
      } else if (val.startsWith('[') && val.endsWith(']')) {
        try {
          currentSection[key] = JSON.parse(val);
        } catch {
          const items = val.slice(1, -1).split(',').map(s => {
            s = s.trim();
            if (s.startsWith('"') && s.endsWith('"')) return s.slice(1, -1);
            if (!isNaN(s)) return Number(s);
            if (s === 'true') return true;
            if (s === 'false') return false;
            return s;
          });
          currentSection[key] = items;
        }
      } else if (val === 'true') {
        currentSection[key] = true;
      } else if (val === 'false') {
        currentSection[key] = false;
      } else if (!isNaN(val)) {
        currentSection[key] = Number(val);
      } else {
        currentSection[key] = val;
      }
    }
  }

  return result;
}

export class CacheBooster {
  constructor(config = {}) {
    this.config = config;
    this.stats = {
      totalRequestsProcessed: 0,
      estimatedInputTokensSaved: 0,
      estimatedOutputTokensSaved: 0,
      cachedPrefixHashes: new Set()
    };
  }

  /** 从 providers.toml 加载配置 */
  static fromConfigFile(filePath) {
    try {
      if (fs.existsSync(filePath)) {
        const raw = fs.readFileSync(filePath, 'utf8');
        const parsed = parseToml(raw);
        return new CacheBooster(parsed);
      }
    } catch (e) {
      console.warn('[CacheBooster] Failed to load config from file, using defaults:', e.message);
    }
    return new CacheBooster();
  }

  /**
   * 优化请求体：前缀对齐 + 历史瘦身 + 指令注入
   * @param {Object} reqBody 原始 OpenAI 兼容请求体
   * @returns {{ optimizedBody: Object, meta: Object }}
   */
  optimize(reqBody) {
    this.stats.totalRequestsProcessed++;
    const originalMessages = Array.isArray(reqBody.messages) ? reqBody.messages : [];
    const originalLen = JSON.stringify(originalMessages).length;

    const boosterConf = this.config.cache_booster || {};
    const enablePrefixCache = boosterConf.enable_prefix_cache !== false;
    const trimHistory = boosterConf.trim_duplicate_history !== false;
    const maxTurns = boosterConf.max_history_turns || 12;
    const injectTokenSaver = boosterConf.inject_token_saver !== false;
    const tokenSaverPrompt = boosterConf.token_saver_prompt || '[Constraint: Output directly, concise and factual without pleasantries or conversational filler.]';

    let messages = [...originalMessages];

    // 1. 冗余历史剔除与去重 (Trim Duplicate History)
    if (trimHistory && messages.length > 0) {
      messages = this.deduplicateConsecutiveMessages(messages);

      // 如果上下文超过 maxTurns 轮对话，裁剪中间的历史对话，保留 System + 初始输入 + 最近 N 条
      if (messages.length > maxTurns * 2) {
        const systemMsgs = messages.filter(m => m.role === 'system');
        const nonSystemMsgs = messages.filter(m => m.role !== 'system');
        const preservedRecent = nonSystemMsgs.slice(-maxTurns * 2);
        
        // 保留最前 1 轮非 system 对话以维持初始上下文
        const firstTurn = nonSystemMsgs.slice(0, 2);
        const combined = [...firstTurn];
        
        for (const msg of preservedRecent) {
          if (!combined.includes(msg)) {
            combined.push(msg);
          }
        }

        messages = [...systemMsgs, ...combined];
      }
    }

    // 2. 前缀缓存对齐 (Prefix Cache Alignment)
    if (enablePrefixCache) {
      messages = this.alignPrefixMessages(messages);
    }

    // 3. Token-Saver 极简指令注入 (Token-Saver Injection)
    if (injectTokenSaver) {
      messages = this.injectSaverDirective(messages, tokenSaverPrompt);
    }

    // 4. 计算前缀 Hash (用于下游追踪 Prompt Cache 命中率)
    const systemContent = messages
      .filter(m => m.role === 'system')
      .map(m => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)))
      .join('||');
    const prefixHash = createHash('sha256').update(systemContent || 'default-prefix').digest('hex').slice(0, 16);
    this.stats.cachedPrefixHashes.add(prefixHash);

    const optimizedLen = JSON.stringify(messages).length;
    const charsSaved = Math.max(0, originalLen - optimizedLen);
    const estInputTokensSaved = Math.round(charsSaved / 3.5);
    this.stats.estimatedInputTokensSaved += estInputTokensSaved;

    const optimizedBody = {
      ...reqBody,
      messages
    };

    return {
      optimizedBody,
      meta: {
        originalMessagesCount: originalMessages.length,
        optimizedMessagesCount: messages.length,
        prefixHash,
        estimatedInputTokensSaved: estInputTokensSaved,
        tokenSaverInjected: injectTokenSaver
      }
    };
  }

  /** 去除连续重复消息（同角色且内容相同） */
  deduplicateConsecutiveMessages(messages) {
    const deduped = [];
    for (let i = 0; i < messages.length; i++) {
      const curr = messages[i];
      const prev = deduped[deduped.length - 1];
      if (prev && prev.role === curr.role && JSON.stringify(prev.content) === JSON.stringify(curr.content)) {
        continue; // 跳过连续重复
      }
      deduped.push(curr);
    }
    return deduped;
  }

  /** 将 System Messages 置顶并规范化，确保前缀内容恒定以最大化 Prompt Caching */
  alignPrefixMessages(messages) {
    const systems = [];
    const others = [];

    for (const msg of messages) {
      if (msg.role === 'system') {
        systems.push(msg);
      } else {
        others.push(msg);
      }
    }

    // 将多个 system 消息合并为一个规范化的 system 消息，强化缓存命中
    if (systems.length > 1) {
      const mergedContent = systems
        .map(s => (typeof s.content === 'string' ? s.content.trim() : JSON.stringify(s.content)))
        .join('\n\n');
      return [{ role: 'system', content: mergedContent }, ...others];
    } else if (systems.length === 1) {
      return [systems[0], ...others];
    }

    return others;
  }

  /** 注入 Token-Saver 指令 */
  injectSaverDirective(messages, prompt) {
    const hasSystem = messages.some(m => m.role === 'system');
    if (hasSystem) {
      return messages.map(m => {
        if (m.role === 'system') {
          const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
          if (!content.includes(prompt)) {
            return {
              ...m,
              content: content + '\n\n' + prompt
            };
          }
        }
        return m;
      });
    } else {
      // 若无 system 消息，自动插入一个轻量 system 消息
      return [{ role: 'system', content: prompt }, ...messages];
    }
  }

  /** 获取统计指标 */
  getMetrics() {
    return {
      ...this.stats,
      uniquePrefixesCachedCount: this.stats.cachedPrefixHashes.size
    };
  }
}
