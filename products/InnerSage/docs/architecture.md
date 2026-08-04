# InnerSage 架构文档

## 概述

InnerSage 是一个"东方情绪导师 · 专属技能 AGI"项目。它从视频 / 播客中蒸馏智慧，
构建本地知识库，并通过多 Agent 协作提供个性化情绪支持与成长引导。

## 系统架构

```
┌──────────────────────────────────────────────────┐
│                   用户输入                          │
└──────────┬───────────────────────────────────────┘
           │
           ▼
┌──────────────────────┐     ┌─────────────────────┐
│   EmotionAgent       │     │   MysticAgent       │
│   (情绪感知)          │────▶│   (灵性洞见)         │
└──────────────────────┘     └──────────┬──────────┘
                                        │
           ┌────────────────────────────┘
           ▼
┌──────────────────────┐     ┌─────────────────────┐
│   ScriptGenerator    │◀────│   Knowledge Base    │
│   (对话生成)          │     │   (知识库 / wiki)    │
└──────────┬───────────┘     └─────────────────────┘
           │                           ▲
           ▼                           │
┌──────────────────────┐     ┌─────────────────────┐
│   PersonaVoice       │     │   DistillPipeline   │
│   (口吻适配)          │     │   (内容蒸馏流水线)    │
└──────────┬───────────┘     └─────────────────────┘
           │
           ▼
┌──────────────────────┐
│   GrowthAgent        │
│   (成长追踪)          │
└──────────────────────┘
```

## 目录职责

| 目录 | 职责 |
|------|------|
| `agents/` | Agent 定义：情绪感知、灵性洞见、成长引导 |
| `distillation/` | 内容蒸馏：视频导入、转录、知识抽取、聚类、知识库构建 |
| `knowledge_base/` | 本地知识库（wiki 条目） |
| `generators/` | 内容生成：脚本、课程、社交文案、口吻适配 |
| `pipelines/` | 流水线编排：distill（蒸馏）、generate（生成） |
| `config/` | YAML 配置：心性宪法、视频来源 |
| `tests/` | 单元测试 |
| `data/` | 运行时数据（gitignored） |
| `logs/` | 日志输出（gitignored） |

## 引用 git008 根目录资源

InnerSage 位于 `projects/InnerSage`，可通过相对路径引用根目录其他项目：

```python
# 示例：从 distill_pipeline 引用 OpenMontage 工具
import sys
sys.path.append("../../OpenMontage")
from tools.video.video_ingest import VideoIngest
```

或直接在配置中使用相对路径：

```yaml
reference_sources:
  - "../RoastBro/*"
  - "../OpenMontage/*"
```

## 技术栈

- **语言**: Python 3.10+
- **转录**: Whisper / WhisperX
- **嵌入**: sentence-transformers + faiss-cpu
- **LLM**: OpenAI / Anthropic API
- **视频**: yt-dlp + ffmpeg-python
- **工作流**: LangChain（占位）

## 后续开发建议

1. **Phase 1** — 实现蒸馏流水线（转录 → 抽取 → 聚类 → 入库）
2. **Phase 2** — 实现 Agent 行为（情绪感知 → 洞见生成 → 对话）
3. **Phase 3** — 集成 GrowthAgent 成长追踪与课程生成
4. **Phase 4** — 前端 UI 与多平台部署
