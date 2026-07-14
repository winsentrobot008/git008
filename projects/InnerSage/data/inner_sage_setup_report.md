# InnerSage 项目初始化报告

## 创建时间

**2026-07-14 08:04 UTC+2** (CEST)

## 项目路径

```
C:\Users\aoogoost\Desktop\Projekt\git008\projects\InnerSage\
```

## 目录与文件清单

### agents/
| 文件 | 说明 |
|------|------|
| `agents/__init__.py` | Agent 包入口 |
| `agents/emotion_agent.py` | EmotionAgent — 情绪识别与调谐 |
| `agents/mystic_agent.py` | MysticAgent — 灵性洞见与隐喻 |
| `agents/growth_agent.py` | GrowthAgent — 成长建议与追踪 |

### distillation/
| 文件 | 说明 |
|------|------|
| `distillation/__init__.py` | Distillation 包入口 |
| `distillation/video_ingest.py` | 视频导入与下载 |
| `distillation/transcript_parser.py` | 转录文本解析 |
| `distillation/knowledge_extractor.py` | 知识抽取 |
| `distillation/topic_cluster.py` | 主题聚类 |
| `distillation/sage_wiki_builder.py` | 知识库构建 |

### knowledge_base/
| 文件 | 说明 |
|------|------|
| `knowledge_base/README.md` | 知识库说明 |
| `knowledge_base/wiki/` | Wiki 条目存放目录（空） |

### generators/
| 文件 | 说明 |
|------|------|
| `generators/__init__.py` | Generators 包入口 |
| `generators/script_generator.py` | 对话脚本生成 |
| `generators/course_builder.py` | 课程构建 |
| `generators/social_copy.py` | 社交媒体文案 |
| `generators/persona_voice.py` | 人格音色适配 |

### pipelines/
| 文件 | 说明 |
|------|------|
| `pipelines/__init__.py` | Pipelines 包入口 |
| `pipelines/distill_pipeline.py` | 蒸馏流水线编排 |
| `pipelines/generate_pipeline.py` | 生成流水线编排 |

### config/
| 文件 | 说明 |
|------|------|
| `config/persona.yaml` | 心性宪法（核心人格配置） |
| `config/sources.yaml` | 视频来源配置 |

### tests/
| 文件 | 说明 |
|------|------|
| `tests/__init__.py` | Test 包入口 |
| `tests/test_agents.py` | Agent 单元测试占位 |

### docs/
| 文件 | 说明 |
|------|------|
| `docs/architecture.md` | 项目架构文档 |

### 根目录
| 文件 | 说明 |
|------|------|
| `README.md` | 项目总说明 |
| `.gitignore` | Git 忽略规则 |
| `requirements.txt` | 依赖清单（占位） |

### 运行时目录
| 目录 | 说明 |
|------|------|
| `data/` | 运行时数据（gitignored） |
| `logs/` | 日志输出（gitignored） |

## README 摘要

> **InnerSage** 是一个面向东方智慧与情绪支持的专属技能 AGI 项目。它从视频 / 播客内容中蒸馏灵性知识与哲学洞见，构建本地知识库，并通过多 Agent 协作体系提供个性化情绪引导与成长建议。
>
> 项目位于 `git008/projects/InnerSage`，可直接引用根目录 AGI 技术资源（Cline-anti-freeze、RoastBro、OpenMontage、second-brain、vision-engine 等）。

## Git 初始化状态

- **已初始化**: 待执行
- **首 commit**: 将包含全部骨架文件

## 后续建议

由 ZOO 实现模块细化（按优先级排列）：

1. **Phase 1 — 蒸馏流水线实现**
   - [ ] `video_ingest.py`: yt-dlp 集成
   - [ ] `transcript_parser.py`: Whisper/WhisperX 转录
   - [ ] `knowledge_extractor.py`: LLM 摘要与实体抽取
   - [ ] `topic_cluster.py`: sentence-transformers + faiss 聚类
   - [ ] `sage_wiki_builder.py`: 知识条目写入

2. **Phase 2 — Agent 行为实现**
   - [ ] `emotion_agent.py`: 情绪检测与向量输出
   - [ ] `mystic_agent.py`: 灵性洞见生成
   - [ ] `growth_agent.py`: 成长追踪与推荐

3. **Phase 3 — 内容生成实现**
   - [ ] `script_generator.py`: 对话脚本
   - [ ] `persona_voice.py`: 口吻适配
   - [ ] `course_builder.py`: 课程编排
   - [ ] `social_copy.py`: 社交文案

4. **Phase 4 — 集成与部署**
   - [ ] 前端 UI / API 层
   - [ ] 多平台发布
   - [ ] 性能优化与安全审计

---

*报告由 ZOO 自动生成。*
