# InnerSage 知识库

## 目录结构

```
knowledge_base/
├── README.md          ← 本文件
└── wiki/              ← SageWiki 知识条目（由 sage_wiki_builder 自动生成）
    ├── index.md       ← 全局主题索引
    ├── meditation.md
    ├── stoicism.md
    ├── daoism.md
    └── ...            ← 更多主题
```

## 用途

- **wiki/** 存放蒸馏后的结构化知识，供 MysticAgent 引用
- 每篇条目为独立 Markdown 文件，包含：概念定义、引用来源、相关练习
- 支持增量更新：运行 `distill_pipeline` 后自动追加新条目

## 引用方式

参见根目录 [`README.md`](../README.md) 中"引用 git008 AGI 资源"一节。
