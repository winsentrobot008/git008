# Second-Brain Digest Report

> **Date**: 2026-07-11
> **Source**: `second-brain/` — git008 第二大脑记忆与知识系统
> **Status**: ✅ Whitelisted asset (READ-only bridge via RoastBro/brain/)

---

## 1. Knowledge Architecture

```
second-brain/ (Whitelisted Core Asset — READ-only from RoastBro)
│
├── knowledge_linker.py     ← 知识流转引擎（1667 行）
│   ├── WhitelistEnforcer   ← Section 6 合规守卫
│   ├── MultiTrackFallback  ← AGI 三叉戟矩阵（GitHub→Groq→OpenRouter）
│   ├── HeartbeatManager    ← 防死锁心跳
│   ├── Watcher             ← 文件监控 + SHA256 去重
│   ├── Classifier          ← Markdown 解析 + 关键词提取
│   └── Linker              ← [[双向链接]] 引擎
│
├── wiki/                   ← 结构化知识库
│   ├── index.md            ← 自动维护的知识索引
│   ├── _wiki_*.md          ← 知识笔记（自动生成）
│   └── .processed_hashes.json  ← SHA256 去重记录
│
├── raw/                    ← 原始未处理笔记
├── logs/                   ← 操作日志
└── .heartbeat              ← 心跳文件
```

---

## 2. Reusable Modules

| Module | Path | Function | Merge Viability |
|--------|------|----------|-----------------|
| Knowledge Linker Engine | `scripts/knowledge_linker.py` | 笔记分类 + 双向链接 + 索引维护 | 🔗 Read-only bridge |
| Whitelist Enforcer | `knowledge_linker.py:134-252` | 宪法执行白名单守卫 | 📖 Reference only |
| MultiTrackFallback | `knowledge_linker.py:514-791` | AGI 多轨熔断引擎 | 🔗 Reusable via brain_api |
| HeartbeatManager | `knowledge_linker.py:800-869` | 防死锁心跳 | 🔗 Reusable |
| Watcher | `knowledge_linker.py:887-1023` | SHA256 去重文件监控 | 🔗 Reusable |
| Classifier | `knowledge_linker.py:1042-1292` | Markdown 解析 + 关键词 | 🔗 Reusable |
| Linker | `knowledge_linker.py:1317-1689` | [[双向链接]] 引擎 | 🔗 Reusable |
| Wiki Index | `wiki/index.md` | 知识索引 | 🔗 Read-only |
| Wiki Notes | `wiki/_wiki_*.md` | 知识笔记 | 🔗 Read-only |

---

## 3. API Surface Design

The RoastBro `brain/` bridge exposes:

```
brain_api.py
├── save_memory(topic, content)    → id    保存内容到 wiki
├── load_memory(topic)             → dict  加载知识笔记
├── search(query)                  → list  语义/关键词搜索
├── semantic_cluster(keywords)     → list  语义聚类
├── get_history(limit)             → list  获取历史活动
├── get_assets()                   → list  获取所有知识资产
└── get_topics()                   → list  获取知识主题
```
