# VOICE22 🎛️
**单人分饰两角 · 参数化配音导演台**

> **项目类型**: 音频合成工具 (Audio Synthesis Tool)
> **所属生态**: RoastBro / Git008 联邦
> **治理状态**: 🟢 宪法绑定 (GIT008 Compliant)
> **核心引擎**: Qwen3-TTS (待接入) / Parameterized Simulation
> **版本**: v4.0 (Architecture Final)

---

## 📖 项目简介
VOICE22 是一个受 **GIT008 宪法**约束的高级音频自动化工具。它不仅实现了"一人分饰两角"的广播剧效果，更引入了**参数化调音台（Director's Mixer）**概念。用户可以通过 UI 滑块实时调整角色的年龄、音调和情绪，后端将自动将这些参数转化为自然语言指令（Prompt），实现精准的语音克隆与情感控制。

本项目目前处于**"参数化模拟阶段"**，已构建完整的全栈架构，等待 Qwen3-TTS 引擎的最终接入。

## 🚀 快速开始

### 1. 环境依赖
确保已安装 **Python 3.9+** 和 **FFmpeg**。

```bash
pip install -r requirements.txt
```

### 2. 准备素材
将角色参考音频（16kHz Mono WAV）放入 `assets/voices/`：
- `voice_A_ref.wav` — 角色A（老板/正派）
- `voice_B_ref.wav` — 角色B（员工/内心OS）

内置合成测试音（440Hz / 880Hz sine tones）可供快速验证。

### 3. 启动调音台
```bash
python frontend/server.py
# 浏览器打开 http://localhost:8080
```

### 4. 生成音频
在调音台界面调整滑块 → 点击 **"生成音频"** → 输出 MP3 自动加载到播放器。

---

## 🎛️ Director's Mixer 调音台

### 双通道控制

| 通道 | 角色 | 默认预设 |
|------|------|----------|
| **A** | 老板/正派 | 年龄45 · 质感浑厚(0.8) · 情绪激昂(0.9) |
| **B** | 员工/OS | 年龄25 · 质感尖细(0.3) · 情绪低沉(0.2) |

### 三维参数

| 参数 | 范围 | 映射到 Prompt |
|------|------|---------------|
| **Age** | 5-80 | `"{age} years old"` |
| **Tone** | 0.0-1.0 | `<0.4 → "soft"` · `0.4-0.6 → "neutral"` · `>0.6 → "masculine and deep"` |
| **Emotion** | 0.0-1.0 | `<0.3 → "calm"` · `0.3-0.7 → "normal"` · `>0.7 → "high energy"` |

### 实时预览
- 滑块数值即时显示（绿色数字）
- 生成结果自动加载到音频播放器
- 执行终端展示完整指令日志

---

## 🛡️ GIT008 治理集成

本项目严格遵守 GIT008 宪法规定：

| 机制 | 状态 | 说明 |
|------|------|------|
| **anti_freeze_check** | ✅ 已嵌入 | 在管线启动、每段合成、错误处理三个关键点执行宪法检查 |
| **.heartbeat** | ✅ 活跃 | 每次状态变更自动更新心跳文件 |
| **CSP 防火墙** | ✅ 已部署 | Content-Security-Policy 头阻止浏览器插件注入 |
| **熔断保护** | ✅ 就绪 | 异常时自动终止管线并报告 |

宪法检查点分布：
```
generate_audio_v3()
  ├── anti_freeze_check(["start_pipeline"])   ← 管线启动
  ├── for each segment:
  │     ├── anti_freeze_check([f"segment_{i}"]) ← 每段合成
  │     └── synthesize → overlay
  └── except:
        └── anti_freeze_check(["error_handler"]) ← 异常处理
```

---

## 📜 剧本格式规范

```
[MM:SS-MM:SS] [A/B] 台词内容

示例：
[00:00-00:04] [A] 哎，小王，听说你跳槽了？
[00:04-00:08] [B] 是啊老板，新公司离我家只有一脚油门。
[00:08-00:12] [A] 那多不好，以后上班多没劲啊。
[00:12-00:16] [B] （内心OS）没劲？我求之不得！
```

- **时间轴**: `[MM:SS-MM:SS]` — 双时间戳在一个括号内
- **角色**: `[A]` 或 `[B]` — 对应调音台双通道
- **台词**: 自由文本，支持括号注释如 `（内心OS）`

---

## ⚙️ 架构概览

### 核心管线

```
Frontend (index.html)          Backend (server.py)           Engine (generate.py)
┌──────────────────┐          ┌──────────────────┐          ┌──────────────────┐
│  Script Editor    │──POST──→│  /api/script     │          │  anti_freeze_    │
│  Sliders (A/B)    │──POST──→│  /api/generate   │──JSON──→│  check()         │
│  Player           │←──MP3──│  /output/*.mp3   │←─output─│  parse_script()  │
│  Terminal         │←─text──│  stdout/stderr   │          │  synthesize()    │
└──────────────────┘          └──────────────────┘          │  versioned_export│
                                                             └──────────────────┘
```

### 文件结构

```
VOICE22/
├── frontend/               # Web 前端调音台
│   ├── index.html          # Director's Mixer UI
│   ├── server.py           # API 网关 + 静态资源路由 + CSP 防火墙
│   ├── manifest.json       # PWA 清单
│   └── favicon.ico         # 站点图标
├── src/                    # 核心逻辑
│   ├── config.py           # 基础配置 (路径、角色描述、参数)
│   └── generate.py         # V3 参数化生成引擎 + 宪法监控
├── assets/
│   ├── voices/             # 参考音频 (16kHz Mono WAV)
│   └── scripts/            # 剧本文件 (script.txt)
├── output/                 # 生成的 MP3 成品
├── temp/                   # 临时文件 (自动清理)
├── requirements.txt        # Python 依赖
├── .heartbeat              # 治理心跳文件
└── README.md               # ⬅ 本文档
```

---

## 📊 API 接口参考

| 方法 | 端点 | 功能 |
|------|------|------|
| GET | `/` | 前端首页 |
| GET | `/api/script` | 获取剧本内容 |
| POST | `/api/script` | 保存剧本 |
| GET | `/api/list_audio` | 列出已生成 MP3 列表 |
| POST | `/api/generate` | 参数化生成音频 |
| GET | `/output/*.mp3` | 下载生成的音频文件 |

### POST /api/generate 请求体

```json
{
  "script": "[00:00-00:03] [A] 测试台词",
  "voice_profiles": {
    "A": { "age": 45, "gender_tone": 0.8, "emotion": 0.9 },
    "B": { "age": 25, "gender_tone": 0.3, "emotion": 0.2 }
  }
}
```

### 响应示例
```
=== VOICE22 V3 (Governance Bound) ===
[API] 从 input.json 加载配置
处理 2 条对话...
  [A] A masculine and deep voice, 50 years old, speaking with high energy.
  [B] A soft voice, 22 years old, speaking with normal.
[OK] 生成完成: output/roast_1784276021_074791.mp3
```

---

## 🔧 开发指南

### 添加新角色通道
1. 在 `frontend/index.html` 添加新的滑块组（复制 channel 结构）
2. 在 `src/generate.py` 的 `get_voice_instruction()` 中处理新角色
3. 前端 `generateAudio()` 中 `voice_profiles` 加入新角色配置

### 接入真实 TTS
1. 设置 `SIMULATE_MODE = False`（当前在代码顶部）
2. 替换 `AudioSegment.silent()` 为真实 TTS 调用
3. 将 `get_voice_instruction()` 的返回值传入 TTS 的 `instruction` 参数

### 安全加固
- CSP 策略在 `server.py` 的 `_set_headers()` 中配置
- 仅允许 `python` 和 `ffmpeg` 命令通过 API 执行

---

## 🏆 审计状态

| 项目 | 评分 |
|------|------|
| 物理文件完整性 | 40/40 ✅ |
| 宪法监控集成 | 30/30 ✅ |
| 哨兵钩子绑定 | 0/20 ℹ️ (可选) |
| 依赖库就绪 | 10/10 ✅ |
| **综合健康度** | **80/100 🟢** |

---

*由 AGI 工厂系统自动生成 · 版本 v4.0 · 受 GIT008 宪法约束*
