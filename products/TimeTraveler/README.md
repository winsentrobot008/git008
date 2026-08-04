# TimeTraveler — AI 私密 4D 情绪空间系统

> Local Privacy + Cloud Compute

将你的视频转换为可进入的 4D 世界，在绝对私密的房间中与 AI 进行情绪互动。

## 项目结构

```
TimeTraveler/
│
├── app/                  # 前端应用
│   ├── ui/               # 用户界面组件
│   ├── core/             # 核心逻辑
│   ├── room/             # 房间管理
│   ├── ai/               # AI 交互
│   └── assets/           # 静态资源
│
├── backend/              # 后端服务
│   ├── api/              # REST/GraphQL API
│   ├── gs_4d/            # 4D Gaussian Splatting
│   ├── feature_pack/     # 特征包处理
│   └── auth/             # 认证授权
│
├── cloud/                # 云端服务
│   ├── gs_engine/        # GS 加速引擎
│   ├── ai_engine/        # AI 推理引擎
│   ├── billing/          # 计费系统
│   └── queue/            # 任务队列
│
├── docs/                 # 文档
│   ├── project_overview.md   # 项目概览
│   ├── architecture.md       # 系统架构
│   ├── roadmap.md            # 开发路线图
│   └── room_system.md        # 私密房间系统
│
├── room_system/          # 房间系统
│   ├── encryption/       # 加密模块
│   ├── storage_local/    # 本地存储
│   └── room_api/         # 房间 API
│
├── ai/                   # AI 模块
│   ├── character_core/   # 角色核心
│   ├── dialogue_engine/  # 对话引擎
│   └── emotion_model/    # 情绪模型
│
├── 4d_engine/            # 4D 渲染引擎
│   ├── training/         # GS 训练
│   ├── optimization/     # 优化
│   └── rendering/        # 渲染
│
├── marketing/            # 市场
│   ├── youtube/          # 视频内容
│   ├── branding/         # 品牌
│   └── assets/           # 素材
│
└── README.md
```

## 核心特性

- 🔒 **绝对隐私** — 视频本地预处理，云端仅接收匿名化特征包
- 🌌 **4D 空间化** — 2D 视频 → 可漫游的 4D 情绪场景
- 🤖 **AI 情感陪伴** — 基于情绪状态动态调整的 AI 角色互动
- 🏠 **私密房间** — 端到端加密，数据完全隔离
- ⚡ **渐进式算力** — 本地轻量 + 云端加速，按需付费

## 三层算力架构

```
本地预处理 (隐私优先) → 云端加速 (4D GS + AI) → 本地渲染 (实时互动)
```

详见 [docs/architecture.md](docs/architecture.md)

## 开发路线图

| Phase | 时间 | 目标 |
|-------|------|------|
| 1 | 2026 Q3 | 基础架构搭建 |
| 2 | 2026 Q4 | 4D 场景引擎 |
| 3 | 2027 Q1 | AI 角色系统 |
| 4 | 2027 Q2 | 私密房间系统 |
| 5 | 2027 Q3 | 用户界面 & 商业化 |

详见 [docs/roadmap.md](docs/roadmap.md)

## 快速开始

```bash
# 克隆项目
git clone https://github.com/your-org/TimeTraveler.git
cd TimeTraveler

# 安装依赖
pip install -r backend/requirements.txt
npm install

# 启动开发服务器
# (待补充)
```

## 许可证

MIT License

---

## 🏭 工厂巡检归档（2026-08-01 · ZOO 无人值守巡检）

### 完成度
- 🔴 **5% — 规划/骨架阶段**（仅目录结构 + `docs/*.md`，无代码可构建/可服务）

### 详细技术栈
| 层级 | 技术 |
|------|------|
| **前端** | 规划中（`app/`：ui / room / core） |
| **后端** | 规划中（`backend/`：api / gs_4d / feature_pack / auth） |
| **媒体处理** | 规划中（4D Gaussian Splatting 训练/渲染） |
| **部署** | 规划中（Local Privacy + Cloud Compute） |

### 本次巡检自愈记录
| 项 | 结果 |
|------|------|
| 语法/Build | ⏭ 无代码（README 启动方式标注"待补充"） |
| 冒烟 | ⏭ 无 HTTP 服务可启动 |
| QA E2E | ⏭ 未达巡检条件 |
| 自愈修复 | 无（需先进入开发阶段方可纳入巡检流水线） |
