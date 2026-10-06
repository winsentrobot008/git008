# 008 Video Factory Studio — 前端架构与 API 契约

> 状态：v1（零构建，Python 可验证）· 目标部署 `video.008ai.online` 或 `008ai.online/video-factory`

## 1. 架构决策

| 决策 | 选择 | 理由 |
|------|------|------|
| 运行时 | 浏览器原生 ES Modules + 无构建 | 本机无 Node.js（`node` 不在 PATH），Next.js 无法执行 `next build` / `tsc --noEmit`，任何 React 产物都无法验证 |
| 样式 | Tailwind Play CDN + `css/app.css` 设计令牌 | 无需 npm 即可得到 Tailwind 工具类；后续接 Tailwind CLI 时工具类零改动 |
| i18n | 自研 30 行 i18n 核心（API 对齐 `react-i18next` 的 `t()`） | 只有 `t(key, vars)` / `setLang()` / 插值 / 复数占位；迁移到 react-i18next 时字典与调用点可原样保留 |
| 后端 | FastAPI（已装 0.142.2）+ WebSocket | 直接复用 `modules/video_factory` 的 Python 管线，无需跨语言 IPC |
| 进度推送 | WebSocket `/ws/jobs/{id}`，按行流式回传子进程 stdout | 复用 FFmpeg/CLI 逐行日志，天然映射到阶段机 |
| 状态与重绘 | `store.set()` 向订阅者传 `(state, prev)`，组件按引用比对决定是否重绘；输入框使用 `bindCommittedInput` | 守卫依赖 `prev`，不传则退化为“每次全量重绘”；重绘会替换聚焦中的输入节点，直接中断中文 IME 合成 |

**为何不用 Next.js 直接落地**：`products/008ai-landing` 的门禁是 `npx tsc --noEmit`（AGENTS.md 强制、必须在该子项目目录内执行）。无 Node 时该门禁无法运行，交付无法验证的 TSX 等于交付未测试代码。因此本阶段先交付**可运行、可测试**的零构建版本，并把结构做成「1:1 可迁移」形态（见 §6）。

## 2. 目录结构

```
products/008-video-factory/
├─ server/                     # FastAPI 服务（新增）
│  ├─ app.py                   # 应用装配、路由、静态挂载
│  ├─ jobs.py                  # 作业注册表 + 线程执行 + 日志环形缓冲
│  ├─ pipeline_runner.py       # 调 modules/video_factory（brain），解析阶段
│  └─ sysmon.py                # GPU / ComfyUI / FFmpeg 状态探测
├─ web/                        # 前端（新增，零构建）
│  ├─ index.html               # 单页外壳：顶栏 / 灵感区 / 分镜画布 / 质检面板
│  ├─ css/app.css              # 设计令牌 + 组件类
│  ├─ locales/{zh,en}.json     # 双语字典（命名空间与 008ai-landing 对齐）
│  ├─ js/i18n.js               # i18n 核心
│  ├─ js/api.js                # API 客户端（fetch + WS 重连）
│  ├─ js/store.js              # 极简响应式 store
│  ├─ js/app.js                # 引导
│  └─ js/components/{topbar,inspiration,storyboard,inspector}.js
├─ tools/check_i18n.py         # 双语完整性门禁（对齐 check-i18n-integrity.mjs）
├─ scripts/serve_web.py        # 一键启动 Web 服务（装配 VF_HOST/PORT/BASE_PATH）
├─ scripts/setup_tunnel.ps1    # 授权后一键：建隧道 + 绑 DNS + 生成本机配置
├─ start_web.bat               # 双击启动 Web Studio（优先使用 .agent-reach-venv）
├─ deploy/cloudflared.video-factory.yml  # Cloudflare Tunnel ingress 模板
├─ tests/test_server_api.py    # REST + WebSocket 集成测试（39 项）
├─ tests/test_web_ui.py        # 真实浏览器端到端测试（29 项）
├─ tests/test_base_path.py     # 子路径部署回归（15 项，含真实浏览器）
├─ tests/test_ime_input.py     # 中文 IME 输入回归（18 项，CDP 真实合成）
└─ docs/FRONTEND_ARCHITECTURE.md
```

## 3. 界面分区

1. **监控顶栏 `topbar.js`** — GPU 名称/显存占用条/利用率、ComfyUI 心跳灯、自适应路由结论（`comfyui` / `ffmpeg`）、语言切换、连接状态。
2. **灵感 / 热点区 `inspiration.js`** — 创意文本域、风格（短剧/漫剧）、时长、镜头数、LLM 网关（auto/offline）；Agent-Reach 取材（路由 auto/github/v2ex/rss/web）一键回填创意。
3. **可视化分镜画布 `storyboard.js`** — 逐镜头卡片：序号、镜头类型徽章、文本、时长；**资产锁定图标**（🔒 锁定 / 自由取材）、**轴线方位**（L/R/Neutral 色标）、镜头尺寸与运镜；轴线违规标红。
4. **播放与质检面板 `inspector.js`** — HTML5 播放器、封面预览、`ffprobe` 明细表（分辨率/帧率/音画同步/黑屏/静音 ✅❌）、后端徽章、下载。

## 4. API 契约（`/api/v1` 前缀可通过环境变量关闭）

| 方法 | 路径 | 请求 | 响应 |
|------|------|------|------|
| GET | `/api/health` | — | `{status, version, uptime_s}` |
| GET | `/api/system` | — | `{comfyui, gpu, ffmpeg, backend}` |
| POST | `/api/topic` | `{query, source}` | `{text, raw_keywords, visual_keywords, source, items}` |
| POST | `/api/idea` | `{idea, style, duration, shots, provider, seed_keywords?}` | `{director_script, storyboard, source, repairs[], warnings[], metrics{locks,axis,shots,duration}}` |
| POST | `/api/validate` | `{director_script}` | `{ok, violations[], warnings[], locks[], axis_trace[]}` |
| POST | `/api/render` | `{director_script, backend, cover, resolution, fps}` | `{job_id}` |
| GET | `/api/jobs/{id}` | — | `{id, state, stage, progress, logs[], result}` |
| WS | `/ws/jobs/{id}` | — | `{type: log\|stage\|done\|error, ...}` |
| GET | `/api/videos` | — | `{items: [{name, url, cover_url, size_mb, mtime}]}` |
| GET | `/media/{name}` · `/covers/{name}` | — | 静态 mp4 / jpg |

**阶段机 `stage`**：`queued → validating → adapting → rendering → inspecting → completed | failed`
（`rendering` 期间若 `backend=comfyui` 追加子阶段 `comfyui`）

**错误契约**：HTTP 4xx/5xx 返回 `{"error": {"code": "...", "message": "...", "detail": {...}}}`；
`code` 取值：`BAD_REQUEST` / `NOT_FOUND` / `PIPELINE_ERROR` / `ASSET_LOCK` / `AXIS_VIOLATION` / `BACKEND_UNAVAILABLE`。
请求体校验失败（422）同样收敛为该契约（`code=BAD_REQUEST`，`detail.fields[]` 给出逐字段原因），不返回 FastAPI 默认的 `{"detail": [...]}`。

## 5. 进度推送模型

- 渲染在独立线程执行 `python src/cli.py video director ... --render`，逐行读取 stdout；
- 每行经阶段正则归类后，`stage` 事件 + `log` 事件写入作业缓冲并广播给所有 WS 订阅者；
- 客户端断线重连后凭 `GET /api/jobs/{id}` 拉全量日志补齐，再继续订阅（无状态续传）。

## 6. Next.js 迁移路径（Node 可用后）

1. `npx create-next-app@16`（App Router + TS + Tailwind v4）落在 `products/008-video-factory/web-next/`；
2. `web/locales/*.json` → `src/i18n/locales/*.json`，接入 `react-i18next`，`t('storyboard.axis.left')` 调用点原样保留；
3. `js/components/*.js` 逐个改写为 `.tsx`：DOM 操作换成 JSX，`store.js` 换成 `useState`/`useSWR`，`api.js` 原样复用（纯 fetch/WS）；
4. 门禁：`cd products/008-video-factory/web-next && npx tsc --noEmit && npm run build`；
5. 部署切到 `vercel.json`（framework: nextjs），后端仍走 FastAPI + Cloudflare Tunnel。

## 7. 部署（Cloudflare Tunnel）

```yaml
# deploy/cloudflared.video-factory.yml
tunnel: 008-video
ingress:
  - hostname: video.008ai.online
    service: http://127.0.0.1:8787
  - service: http_status:404
```

- **已确定（方案 A）**：子域 `video.008ai.online` → `http://127.0.0.1:8787`，零 CORS 摩擦；
- 备选（未采用）：路径 `008ai.online/video-factory`，需 `VF_BASE_PATH=/video-factory`；该模式的资源注入已由 `tests/test_base_path.py` 覆盖，随时可启用。
- 静态资源由 FastAPI 直接托管（`/`、`/css`、`/js`、`/locales`），无需 Nginx。
- 本机启动：`python scripts/serve_web.py`（或双击 `start_web.bat`）；子路径方案追加 `--base-path /video-factory`。
- 隧道路由：宿主机 `cloudflared tunnel login` 授权后，运行 `scripts/setup_tunnel.ps1`：自动建隧道、绑 DNS、生成 `deploy/cloudflared.local.yml`（含 tunnel id，已由 .gitignore 覆盖，不入仓）。
- **已上线实测（2026-10-05）**：隧道 `008-video`（id `8d885dbf-f324-41a0-8355-a9bd44ba6c31`）→ `https://video.008ai.online` 全链路 200：`/`、`/css/app.css`、`/js/app.js`、`/locales/{zh,en}.json`、`/api/health`、`/api/system`、`/api/videos`（14 条）；Chrome 实测引导正常、中英切换正常、无控制台报错。
- 本机排查提示：若本机解析不到该域名（路由器/上游 DNS 缓存了 NXDOMAIN），用 `curl.exe --resolve video.008ai.online:443:<CF_IP>` 验证或把网卡 DNS 换成 `1.1.1.1`；不影响公网访问。
- 环境坑位：本机 `$env:ProgramFiles(x86)` 实际指向 `D:\Program Files (x86)`，而 cloudflared 装在 `C:\Program Files (x86)\cloudflared\`，故 `setup_tunnel.ps1` 以显式绝对路径优先定位。
