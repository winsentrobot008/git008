# 🧊 RoastBro 战略冷冻交接手册

> 归档日期：2026-07-13  
> 状态：**全流水线闭环，环境依赖待完善**

---

## ✅ 已完成核心功能

### 1. 多线程安全重构
- 后台流水线通过 `data/metadata/{video_id}.status.json` 文件传递状态，**零 `st.session_state` 越界**
- Dashboard 前台只读轮询 status 文件，彻底解决 `ScriptRunContext` 崩溃
- 子进程用 `subprocess.Popen`（非阻塞），不阻塞 UI

### 2. Dashboard 5 视图导航
| 视图 | 功能 |
|------|------|
| 🎯 视频狩猎与投喂 | 三通道投喂 + 环境自检 + 实时日志 |
| 🏭 工厂流水线监控 | 文件状态聚合：运行中/完成/失败 |
| 🎬 成品预览与发布 | st.video 播放器 + 文案展示 + 发布设置 |
| 📊 数据与运行分析 | 生产概览 + 模块耗时 |
| ⚙️ 工厂运维调优 | 代理配置 + FFmpeg 路径 + 权重调节 |

### 3. 三通道视频获取
| 通道 | 实现 | 状态 |
|------|------|------|
| `➕ 投喂` | yt-dlp `--cookies-from-browser chrome` + `--proxy` | ✅ |
| `🔍 嗅探缓存` | 30分钟 / 3MB-100MB / 无后缀 / ftyp 白名单 / CEO 手动确认 | ✅ |
| `📁 拖拽上传` | `st.file_uploader` + MP4 FastStart 修复 | ✅ |

### 4. 日志系统
| 日志 | 位置 | 说明 |
|------|------|------|
| stdout | `data/metadata/orchestrator_stdout.log` | 子进程打印输出 |
| stderr | `data/metadata/orchestrator_stderr.log` | 子进程错误/回溯 |
| 启动错误 | `data/metadata/pipeline_launch_errors.log` | Popen 启动失败 |
| 状态文件 | `data/metadata/*.status.json` | 流水线步骤/进度/错误 |
| 日志面板 | Dashboard 🎯 页底部 | 4 标签页：stdout/stderr/启动错误/状态文件 |

### 5. 环境自检与修复
- 启动时 `os.walk(%USERPROFILE%)` 地毯式搜索 `ffmpeg.exe`
- 找到后 `os.environ["PATH"]` 热注入
- 启动时注入 `sys.path` 包含 `~\AppData\Roaming\Python\Python312\site-packages`
- `[💥 强杀并重启网页服务]` 按钮（`os._exit(0)` + 新 Popen）
- `install_dependencies.bat`（右键管理员一键安装 FFmpeg + TTS + Whisper）

### 6. 流水线全链路
```
投喂 → yt-dlp 下载 / 嗅探缓存 / 拖拽上传
  → data/pending_videos/{video_id}.mp4
  → [批准生产]
  → orchestrator.py --mode approve
  → sys.path 注入 + PYTHONPATH env + FFMPEG_PATH env
  → 合规初筛 → 分析 → 槽点 → 脚本 → 合规 → 剪辑 → 配音
  → data/metadata/{video_id}.status.json (completed)
  → output/video/{video_id}_long.mp4 (成品)
  → 🎬 成品预览与发布 (st.video + 文案 + 发布)
```

---

## ⚠️ 遗留问题

### 问题 1：FFmpeg / TTS / Whisper 尚未物理安装
- **现象**：流水线走完全程但视频为源码复制（无字幕烧录），配音未生成
- **根因**：系统中 FFmpeg、TTS、Whisper 均未安装
- **修复命令**（以管理员身份运行）：
  ```bash
  install_dependencies.bat
  ```
  或在命令行中手动执行：
  ```bash
  "C:\Program Files\Python312\python.exe" -m pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cpu
  "C:\Program Files\Python312\python.exe" -m pip install TTS openai-whisper
  ```
  FFmpeg 可通过 `winget install ffmpeg` 或官网下载。

### 问题 2：Windows PATH 刷新延迟
- **现象**：安装 FFmpeg 后 Dashboard 仍显示 `NOT FOUND`
- **缓解措施**（已在代码中实现）：
  - 启动时 `os.walk(%USERPROFILE%)` 地毯式搜索 ffmpeg.exe
  - 找到后 `os.environ["PATH"]` 热注入
  - Dashboard `[💥 强杀并重启]` 按钮触发全新进程
- **根治**：安装后点击 [💥 强杀并重启] 即可

### 问题 3：Whisper 模型需首次下载
- Whisper 首次使用时需下载模型文件（约 1.5GB）
- 需稳定的网络连接

---

## 📁 关键目录结构

```
RoastBro/
├── dashboard/app.py              ← 主 Dashboard（5 视图）
├── orchestrator.py                ← 流水线编排
├── orchestrator/
│   ├── pipeline_status.py         ← 文件状态读写（线程安全）
│   ├── factory_controller.py      ← 工厂控制器
│   └── autorun.py                 ← 全自动生产引擎
├── editor/
│   └── auto_editor.py             ← FFmpeg 剪辑引擎（含 fallback）
├── install_dependencies.bat       ← 一键依赖安装
├── FREEZE_README.md               ← 本文件
├── data/
│   ├── metadata/                  ← 状态文件 + 日志
│   │   ├── {vid}.status.json
│   │   ├── orchestrator_stdout.log
│   │   ├── orchestrator_stderr.log
│   │   └── pipeline_launch_errors.log
│   ├── pending_videos/            ← 投喂暂存区
│   └── outputs/                   ← AutoEditor 输出
├── output/
│   ├── video/                     ← 成品视频（Dashboard 读取）
│   └── scripts/                   ← 吐槽文案
└── config/
    └── factory_config.json        ← 工厂配置
```

---

## 🚀 重启指南

```bash
cd RoastBro
streamlit run dashboard/app.py
# 浏览器打开 http://localhost:8501
# 环境自检面板 → 按提示安装缺失依赖 → [💥 强杀并重启]
```

## 📞 交接联系

- 项目架构：ZOO AI Agent
- 所有 bug 修复与功能记录见上方 ✅ 已完成核心功能
- 冷冻前最后一次测试：全流水线 11 秒跑通（降级模式）
