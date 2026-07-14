# InnerSage 🧘 — 东方情绪导师 · 专属技能 AGI

**InnerSage** 是一个面向东方智慧与情绪支持的专属技能 AGI 项目。  
它从视频 / 播客内容中蒸馏灵性知识与哲学洞见，构建本地知识库，
并通过多 Agent 协作体系提供个性化情绪引导与成长建议。

> 项目位于 [`git008/projects/InnerSage`](../InnerSage)，可直接引用根目录 AGI 技术资源
> （[`Cline-anti-freeze`]()、[`RoastBro`](../RoastBro)、[`OpenMontage`](../OpenMontage)、[`second-brain`]()、[`vision-engine`]() 等）。

---

## 目标与范围

| 维度 | 说明 |
|------|------|
| **核心使命** | 将视频 / 播客中的东方哲学智慧蒸馏为可交互的情绪导师 |
| **输入** | YouTube 视频、本地音频/视频、RSS 播客 |
| **处理** | 转录 → 知识抽取 → 主题聚类 → 知识库构建 |
| **输出** | 情绪感知对话、灵性洞见、课程引导、成长追踪 |
| **语言** | 中文（主），英文 / 日文 / 韩文（扩展） |

---

## 快速开始

### 1. 环境准备

```bash
cd projects/InnerSage
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

### 2. 运行蒸馏流水线

```bash
# 从 YouTube 视频蒸馏知识
python -m pipelines.distill_pipeline --source "https://youtube.com/..."

# 本地视频
python -m pipelines.distill_pipeline --source "./data/raw_videos/lecture.mp4"
```

### 3. 运行生成流水线

```bash
# 与 InnerSage 对话
python -m pipelines.generate_pipeline --input "我感到焦虑和迷茫..."
```

---

## 引用 git008 AGI 资源

InnerSage 位于 `projects/InnerSage`，可通过相对路径引用根目录的其他项目：

```python
# Python 相对导入示例
import sys
sys.path.append("../../OpenMontage")
from tools.video.video_ingest import VideoIngest

sys.path.append("../../RoastBro")
# from roastbro import ...
```

```yaml
# YAML 配置引用
reference_sources:
  - "../RoastBro/*"
  - "../OpenMontage/*"
```

---

## 项目结构

```
InnerSage/
├── agents/                  # Agent 定义
│   ├── emotion_agent.py     # 情绪感知
│   ├── mystic_agent.py      # 灵性洞见
│   └── growth_agent.py      # 成长引导
├── distillation/            # 内容蒸馏流水线
│   ├── video_ingest.py      # 视频导入
│   ├── transcript_parser.py # 转录解析
│   ├── knowledge_extractor.py # 知识抽取
│   ├── topic_cluster.py     # 主题聚类
│   └── sage_wiki_builder.py # 知识库构建
├── knowledge_base/          # 本地知识库
│   └── wiki/                # Wiki 条目
├── generators/              # 内容生成
│   ├── script_generator.py  # 对话脚本
│   ├── course_builder.py    # 课程构建
│   ├── social_copy.py       # 社交文案
│   └── persona_voice.py     # 口吻适配
├── pipelines/               # 流水线编排
│   ├── distill_pipeline.py  # 蒸馏流水线
│   └── generate_pipeline.py # 生成流水线
├── config/                  # 配置
│   ├── persona.yaml         # 心性宪法
│   └── sources.yaml         # 视频来源
├── tests/                   # 测试
├── docs/                    # 文档
├── data/                    # 运行时数据 (gitignored)
├── logs/                    # 日志 (gitignored)
├── .gitignore
└── requirements.txt
```

---

## 项目负责人

- **项目经理**: aoogoost
- **实现引擎**: ZOO（自动提交规范）

---

## 贡献流程

> 由 ZOO 自动执行，遵循以下规范：

1. 模块骨架 → 空方法标注 `raise NotImplementedError("由 ZOO 实现")`
2. 实现阶段 → 逐模块填充细节
3. 提交规范 → `git commit -m "feat(module): description"`

---

## 依赖

详见 [`requirements.txt`](requirements.txt)。主要技术栈：

- Python 3.10+
- Whisper / WhisperX（转录）
- sentence-transformers + faiss-cpu（语义搜索）
- OpenAI / Anthropic API（LLM）
- yt-dlp + ffmpeg-python（视频处理）
- LangChain（工作流编排）

---

## 许可证

本项目为 git008 子项目，遵循根仓库许可证。
