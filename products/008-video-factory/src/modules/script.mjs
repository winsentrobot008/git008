/**
 * script — 15 秒短视频 Hook 模板（CalorieAI / 008AI Pass）
 *
 * 每个 target 提供 hook(text?) 与可选 builtin 文案：
 *   - calorie-ai:   拍照即知卡路里（Photo → Calories）
 *   - 008ai-pass:   一次买断全家桶（One Pass. Every AI App.）
 * 返回 [{ text, voice, start_ms, duration_ms, gain_db, pitch }] 供 audio/timeline 消费。
 */

const VOICES = {
  zh: "zh-CN-XiaoxiaoNeural",
  en: "en-US-AriaNeural",
  "en-us": "en-US-AriaNeural",
  "zh-cn": "zh-CN-XiaoxiaoNeural",
  "zh-male": "zh-CN-YunxiNeural",
  "en-male": "en-US-ChristopherNeural",
  "en-gb": "en-GB-SoniaNeural",
};

function line(text, { voice = "zh", start = 0, duration = 3500, gain = 0, pitch = 1 } = {}) {
  const v = voice.toLowerCase();
  const resolved = VOICES[voice] || VOICES[v] || (v.includes("-") ? voice : VOICES.zh);
  return { text, voice: resolved, start_ms: start, duration_ms: duration, gain_db: gain, pitch };
}

const HOOKS = {
  "calorie-ai": {
    title: "CalorieAI — Photo-Based Calorie Recognition",
    keywords: ["food", "calorie", "healthy meal", "diet", "nutrition"],
    lang: "en",
    builtin: [
      "Snap a photo. Know your calories instantly.",
      "CalorieAI recognizes every dish on your plate.",
      "Track meals, hit your goals, feel great.",
      "Try CalorieAI today — your health, one tap away.",
    ],
    hook(text) {
      if (text) {
        return [line(text, { voice: this.lang, duration: 10000 })];
      }
      return [
        line(this.builtin[0], { voice: this.lang, start: 0, duration: 4000 }),
        line(this.builtin[1], { voice: this.lang, start: 4000, duration: 4000 }),
        line(this.builtin[2], { voice: this.lang, start: 8000, duration: 4000 }),
        line(this.builtin[3], { voice: this.lang, start: 12000, duration: 3000 }),
      ];
    },
  },

  "008ai-pass": {
    title: "008AI Pass — One Pass. Every AI App.",
    keywords: ["ai apps", "lifetime pass", "artificial intelligence", "tech", "future"],
    lang: "zh",
    builtin: [
      "一个会员，解锁全部 AI 应用。",
      "CalorieAI 拍照识卡路里，Runify 智能生成路线。",
      "终身买断，一次付费，永久使用。",
      "008AI Pass，限量早鸟 $19.99，手慢无。",
    ],
    hook(text) {
      if (text) {
        return [line(text, { voice: this.lang, duration: 10000 })];
      }
      return [
        line(this.builtin[0], { voice: this.lang, start: 0, duration: 4000 }),
        line(this.builtin[1], { voice: this.lang, start: 4000, duration: 4000 }),
        line(this.builtin[2], { voice: this.lang, start: 8000, duration: 4000 }),
        line(this.builtin[3], { voice: this.lang, start: 12000, duration: 3000 }),
      ];
    },
  },
};

/** 默认 15s 结构（带 CTA 尾帧） */
function defaultHook(text) {
  const duration = 12000;
  if (text) return [line(text, { duration })];
  return [
    line("AI 驱动的内容工厂，15 秒生成一条竖屏短片。", { start: 0, duration: 5000 }),
    line("脚本、配音、素材、合成全自动。", { start: 5000, duration: 5000 }),
    line("008 Video Factory — 让内容生产快十倍。", { start: 10000, duration: 5000 }),
  ];
}

export function getTarget(name) {
  return HOOKS[name] || null;
}

export function listTargets() {
  return Object.keys(HOOKS);
}

/** 默认 A/B 变体（批量 --count / 无配置时使用） */
export function abVariants(target = "calorie-ai", count = 1) {
  const variants = {
    "calorie-ai": [
      {
        id: "ab1",
        lang: "en",
        lines: [
          "Snap a photo. Know your calories instantly.",
          "CalorieAI recognizes every dish on your plate.",
          "Track meals, hit your goals, feel great.",
          "Try CalorieAI today — one tap away.",
        ],
      },
      {
        id: "ab2",
        lang: "en",
        lines: [
          "Your personal calorie camera is here.",
          "Point, shoot, and get real nutrition data.",
          "No more guessing what you eat.",
          "Download CalorieAI and start today.",
        ],
      },
      {
        id: "ab3",
        lang: "en",
        lines: [
          "Meet your AI dietitian in your pocket.",
          "One photo tells you exactly what is on your plate.",
          "Eat smart. Track better. Live healthier.",
          "Start with CalorieAI — it takes seconds.",
        ],
      },
    ],
    "008ai-pass": [
      {
        id: "ab1",
        lang: "zh",
        lines: [
          "一个会员，解锁全部 AI 应用。",
          "CalorieAI 拍照识卡路里，Runify 智能生成路线。",
          "终身买断，一次付费，永久使用。",
          "008AI Pass，限量早鸟 $19.99。",
        ],
      },
      {
        id: "ab2",
        lang: "zh",
        lines: [
          "AI 全家桶，一个 Pass 全带走。",
          "拍照、路线、创作，全部由 AI 完成。",
          "不再为每个应用单独付费。",
          "008AI Pass，今天上车最划算。",
        ],
      },
      {
        id: "ab3",
        lang: "zh",
        lines: [
          "你的下一台 AI 工具箱，已经上线。",
          "CalorieAI 管好每一餐，Runify 规划每条路。",
          "一次买断，终身使用。",
          "008AI Pass，早鸟价最后机会。",
        ],
      },
    ],
  };
  const base = variants[target] || [];
  return base.slice(0, Math.max(1, count));
}

/**
 * 生成脚本：优先 target 内置 hook；传入 text 则单句旁白；未知 target 用默认模板。
 * @param {{target?: string, text?: string, lines?: Array<{text: string, voice?: string, lang?: string}>, lang?: string}} opts
 */
export function generateScript({ target = "calorie-ai", text, lines: customLines, lang } = {}) {
  const hook = HOOKS[target] || { hook: defaultHook, title: target, keywords: ["video", "ai"], lang: "zh" };
  let lines;
  if (Array.isArray(customLines) && customLines.length) {
    // 批量多音色：每行可带 voice / lang 覆盖
    const totalMs = customLines.reduce((acc, l, i) => acc + (Number(l.duration_ms) || 3500), 0);
    let cursor = 0;
    lines = customLines.map((l, i) => {
      const start = Number(l.start_ms) >= 0 ? Number(l.start_ms) : cursor;
      const duration = Number(l.duration_ms) || 3500;
      cursor = start + duration;
      return line(l.text, {
        voice: l.voice || l.lang || lang || "zh",
        start,
        duration,
        gain: l.gain_db || 0,
        pitch: l.pitch || 1,
      });
    });
  } else {
    lines = hook.hook.call(hook, text);
  }
  return {
    target,
    title: hook.title || target,
    keywords: hook.keywords || [],
    lines,
  };
}

/** 供测试/调试：直接查看模板 */
export function _debug() {
  return {
    targets: listTargets(),
    calorieAi: generateScript({ target: "calorie-ai" }),
    pass: generateScript({ target: "008ai-pass" }),
  };
}
