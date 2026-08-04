# RoastBro 🔥 — AI 自动化跨平台反讽吐槽内容工厂 v2.0

> **工业级内容流水线** — 自动狩猎 → 合规检查 → 槽点分析 → 脚本生成 → 视频渲染 → 多平台发布

---

## 工业流水线架构

```
┌──────────────────────────────────────────────────────────────────┐
│                     CEO Dashboard (Streamlit)                     │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────────┐ │
│  │ 实时车间  │  │ 视频审批  │  │ 爆款狩猎  │  │   系统运维       │ │
│  │ Pipeline │  │ Preview  │  │ AutoHunt │  │   System Ops     │ │
│  └──────────┘  └──────────┘  └──────────┘  └──────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
                                    │
                    ┌───────────────┴───────────────┐
                    ▼                               ▼
        ┌────────────────────┐          ┌────────────────────┐
        │  24/7 Auto-Scout   │          │   AutoHunter       │
        │  (APScheduler 4h)  │          │  (Daily 00:00)     │
        │  Scout→Analyze→Q   │          │  Fetch→Rank→Queue  │
        └────────┬───────────┘          └────────┬───────────┘
                 │                                │
                 └────────────┬───────────────────┘
                              ▼
              ┌─────────────────────────────┐
              │     Candidate Pool          │
              │  data/autoscout/candidates  │
              └─────────────┬───────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Orchestrator                                │
│  (调度引擎 — 控制全流水线编排与数据流转)                         │
└──┬───┬───┬───┬───┬───┬───┬───┬───┬───┬───┬───┬────────────────┘
   │   │   │   │   │   │   │   │   │   │   │   │
┌──▼┐ ┌▼──┐ ┌▼──┐ ┌▼──┐ ┌▼──┐ ┌▼──┐ ┌▼──┐ ┌▼──┐ ┌▼──┐ ┌▼──┐ ┌───┐
│S  │ │V  │ │R  │ │C  │ │R  │ │E  │ │V  │ │P  │ │C  │ │B  │ │D  │
│C  │ │i  │ │o  │ │o  │ │o  │ │d  │ │o  │ │u  │ │o  │ │r  │ │a  │
│R  │ │d  │ │a  │ │m  │ │a  │ │i  │ │i  │ │b  │ │m  │ │a  │ │t  │
│A  │ │e  │ │s  │ │p  │ │s  │ │t  │ │c  │ │l  │ │p  │ │i  │ │a  │
│P  │ │o  │ │t  │ │l  │ │t  │ │o  │ │e  │ │i  │ │l  │ │n  │ │   │
│E  │ │A  │ │P  │ │i  │ │S  │ │r  │ │   │ │s  │ │i  │ │   │ │   │
│R  │ │n  │ │o  │ │a  │ │c  │ │   │ │   │ │h  │ │a  │ │   │ │   │
│   │ │a  │ │i  │ │n  │ │r  │ │   │ │   │ │e  │ │n  │ │   │ │   │
│   │ │l  │ │n  │ │c  │ │i  │ │   │ │   │ │r  │ │c  │ │   │ │   │
│   │ │y  │ │t  │ │e  │ │p  │ │   │ │   │ │   │ │e  │ │   │ │   │
│   │ │z  │ │s  │ │   │ │t  │ │   │ │   │ │   │ │   │ │   │ │   │
│   │ │e  │ │   │ │   │ │   │ │   │ │   │ │   │ │   │ │   │ │   │
│   │ │r  │ │   │ │   │ │   │ │   │ │   │ │   │ │   │ │   │ │   │
└───┘ └───┘ └───┘ └───┘ └───┘ └───┘ └───┘ └───┘ └───┘ └───┘ └───┘
```

### 闭环链路: Scraper → Compliance → Analyze → Render

| 阶段 | 模块 | 功能 |
|------|------|------|
| 🕷️ **狩猎** | [`scrapers/auto_scout.py`](scrapers/auto_scout.py) | 24/7 巡航，yt-dlp 抓取 TikTok 标签视频，Top 10% 互动率过滤 |
| 🎯 **预筛** | [`analyzer/scout_analyzer.py`](analyzer/scout_analyzer.py) | 轻量级槽点潜力评估，5 类信号词检测，自动标记 High_Potential |
| 🧠 **分析** | [`analyzer/`](analyzer/) | Whisper 语音识别 + LLaVA 视频帧理解 + 场景/行为/情绪识别 |
| 🎯 **槽点** | [`roastpoints/`](roastpoints/) | 6 维度槽点评分（逻辑/行为/情绪/夸张/尴尬/反常识） |
| ✍️ **脚本** | [`scripts/`](scripts/) | 谷阿莫 + Captainpig 风格蒸馏，反讽句式生成 |
| 🎬 **渲染** | [`editor/`](editor/) | 自动剪辑、字幕、旁白、音效、背景音乐合成 |
| 🛡️ **合规** | [`compliance/`](compliance/) | 版权/名誉/平台政策检测，高风险词过滤 |
| 📤 **发布** | [`publisher/`](publisher/) | 自动上传 YouTube/Shorts/B站，标题/描述/标签自动生成 |
| 📊 **控制台** | [`dashboard/`](dashboard/) | Streamlit 全功能 CEO 控制台 |

---

## 如何启动全自动狩猎模式

### 1. 一键启动 Dashboard

```bash
cd RoastBro
pip install -r requirements.txt
streamlit run dashboard/app.py
```

### 2. 启动自动狩猎调度器

**方式 A：从 Dashboard 启动**
1. 打开 **🔥 爆款狩猎区** → **⚙️ 调度设置**
2. 点击 **▶️ 启动每日调度**（每日 0 点自动狩猎）
3. 点击 **▶️ 启动巡航**（每 4 小时 Scout → Analyze → Queue）

**方式 B：命令行启动**

```bash
# 每日 0 点狩猎
python -m tasks.daily_task

# 24/7 巡航调度器
python -m tasks.scheduler_service
```

### 3. 查看狩猎结果

- **🏭 实时生产车间** — 查看 AutoHunter 实时日志 + 今日候选池
- **🔥 爆款狩猎区** → **📊 今日热点吐槽榜** — 候选视频浏览 + 批量一键生产
- **🔥 爆款狩猎区** → **🎯 狩猎结果** — 手动狩猎 + 评分排序
- **🔥 爆款狩猎区** → **🏭 待确认队列** — 确认视频进入工厂流水线

### 4. 配置狩猎参数

| 参数 | 默认值 | 说明 |
|------|--------|------|
| 狩猎标签 | `fail, cringe, wtf, funny, gonewrong` | 逗号分隔的 TikTok 标签 |
| 评分门槛 | 30.0 | 仅保留高于此分的视频 |
| 巡航间隔 | 4 小时 | APScheduler 自动触发 |
| 互动率 Top | 10% | `is_trending()` 过滤阈值 |

---

## 毒舌烈度控制

Dashboard 侧边栏提供 1-10 级毒舌烈度滑块：

| 等级 | 范围 | 风格 |
|------|------|------|
| 1-2 | 😇 佛系 | 温和建议，友好提醒 |
| 3-4 | 😏 微讽 | 轻微调侃，略带讽刺 |
| 5-6 | 😈 标准 | 正常吐槽模式 |
| 7-8 | 👿 辛辣 | 辛辣讽刺，火力全开 |
| 9-10 | 🔥 狂暴 | 无限制狂暴吐槽模式 |

---

## 环境依赖

| 依赖 | 版本要求 | 必需 | 说明 |
|------|----------|------|------|
| Python | ≥ 3.10 | ✅ | 运行时环境 |
| streamlit | ≥ 1.28 | ✅ | CEO Dashboard |
| yt-dlp | ≥ 2026.7.4 | ✅ | TikTok 视频抓取 |
| FFmpeg | ≥ 4.4 | ✅ | 视频渲染引擎（需加入 PATH） |
| playwright | ≥ 1.40 | ✅ | 浏览器自动化 |
| apscheduler | ≥ 3.10 | ✅ | 定时任务调度 |
| moviepy | ≥ 1.0.3 | ✅ | 视频处理 |
| opencv-python | ≥ 4.8.0 | ✅ | 图像处理 |
| torch | ≥ 2.1.0 | ⚠️ | AI 模型推理 |
| whisper | latest | ⚠️ | 语音识别 |
| TTS | ≥ 0.20.0 | ⚠️ | 语音合成 |
| psutil | ≥ 5.9 | ⚠️ | 系统性能监控 |

> **FFmpeg 安装指南**：
> - **Windows**: 下载 https://ffmpeg.org/download.html → 解压 → 将 `bin/` 目录加入系统 PATH
> - **macOS**: `brew install ffmpeg`
> - **Linux**: `sudo apt install ffmpeg`

---

## 数据目录结构

```
RoastBro/
├── scrapers/           # 爬虫模块 (TikTok/YouTube/B站)
│   ├── auto_scout.py   #   ← 24/7 AI 侦察兵 (新增)
│   └── auto_hunter.py  #   ← 每日自动狩猎
├── analyzer/           # 视频分析
│   └── scout_analyzer.py  # ← 槽点潜力预筛 (新增)
├── roastpoints/        # 槽点评分引擎
├── scripts/            # 反讽脚本生成
├── editor/             # 自动剪辑
├── voice/              # 语音合成
├── compliance/         # 合规检查
├── publisher/          # 自动发布
├── dashboard/          # Streamlit 控制台
├── tasks/              # 后台定时任务
│   ├── daily_task.py       # 每日 0 点狩猎
│   └── scheduler_service.py # 24/7 巡航调度 (新增)
├── data/
│   ├── autohunter/     # AutoHunter 队列
│   └── autoscout/      # AutoScout 候选池 (新增)
├── output/
│   ├── video/          # 成品视频
│   ├── cache/          # 临时缓存
│   └── preview/        # 预览视频
└── config/             # 配置文件
```

---

## 快速开始

```bash
# 1. 安装依赖
cd RoastBro
pip install -r requirements.txt

# 2. 安装额外依赖
pip install apscheduler psutil  # 调度器 + 性能监控

# 3. 启动 CEO Dashboard
streamlit run dashboard/app.py

# 4. 打开浏览器访问
open http://localhost:8501

# 5. 启动自动化调度
python -m tasks.scheduler_service  # 24/7 巡航
```

---

## 核心价值

| 维度 | 说明 |
|------|------|
| 🤖 内容自动化生产 | AI 完成 90% 内容工作 |
| 🎭 反讽风格可控 | 蒸馏谷阿莫 + Captainpig 文案结构 |
| 👁️ 生态观察官定位 | 跨平台内容生态观察者 |
| 🛡️ 合规安全边界 | 只吐槽内容，不吐槽真人 |
| 💰 可规模化商业模式 | 广告 + Shorts 奖金 + SaaS |

---

*RoastBro v2.0 — 让 AI 替你喷，你只管数钱。* 🔥
