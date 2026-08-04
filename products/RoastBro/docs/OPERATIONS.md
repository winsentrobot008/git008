# RoastBro 运维操作手册 (OPERATIONS.md)

> **工业级内容工厂运维指南** — 磁盘管理 · 毒舌调校 · 狩猎调度 · 故障排除

---

## 目录

1. [磁盘空间管理](#1-磁盘空间管理)
2. [毒舌烈度调节指南](#2-毒舌烈度调节指南)
3. [狩猎调度配置](#3-狩猎调度配置)
4. [候选池管理](#4-候选池管理)
5. [性能监控](#5-性能监控)
6. [故障排除](#6-故障排除)
7. [日常运维检查清单](#7-日常运维检查清单)

---

## 1. 磁盘空间管理

### 1.1 目录空间分布

| 目录 | 用途 | 自动清理策略 |
|------|------|-------------|
| `output/video/` | 成品渲染视频 | 手动触发 (一键深度清理) |
| `output/cache/` | 临时缓存文件 | 手动触发 (常规清理) |
| `output/preview/` | 预览视频 | 手动触发 (常规清理) |
| `data/cache/` | TikTok 视频缓存 | 24-72h 自动过期 |
| `data/autohunter/` | 狩猎队列 | 手动管理 |
| `data/autoscout/` | 侦察候选池 | 自动保留最近 500 条 |

### 1.2 一键深度清理 (output/video/)

**Dashboard 路径**: `⚙️ 系统运维` → `🧹 磁盘清理` → `🔥 一键深度清理 output/video/`

**命令行触发**:

```bash
# Python 脚本方式
cd RoastBro
python -c "
from pathlib import Path
import shutil
target = Path('output/video')
if target.exists():
    for f in target.rglob('*'):
        if f.is_file() and f.name not in ('.gitkeep', '.gitignore'):
            f.unlink(missing_ok=True)
    print(f'✅ 已清理 {target}')
else:
    print('📭 目录不存在')
"
```

**效果**:
- 递归删除 `output/video/` 下 **所有文件**
- 保留目录结构（空文件夹 + `.gitkeep`）
- **不可撤销**，请确认已备份必要视频

### 1.3 常规清理 (output/cache/ + output/preview/)

**Dashboard 路径**: `⚙️ 系统运维` → `🧹 磁盘清理` → `🧹 一键清空所有输出文件`

清理范围: `.mp4`, `.webm`, `.mkv`, `.mov`, `.avi`, `.wav`, `.mp3`, `.json`, `.log`, `.srt`, `.vtt`

### 1.4 手动删除单个视频

**Dashboard 路径**: `📺 视频预览审批` → 每个视频卡片 → `❌ 删除视频` → `✅ 确认删除`

每个审批卡片配备独立的 **物理删除按钮**，点击后执行 `os.remove()` 同步删除文件系统上的视频文件及关联的元数据 JSON。

### 1.5 磁盘容量预警

当 `psutil` 可用时，运维看板自动显示:
- 全局磁盘使用率 (%)
- 已用 / 总量 (GB)
- 空闲空间 (GB)

**建议阈值**:
- 🟢 空闲 > 20 GB: 正常
- 🟡 空闲 5-20 GB: 注意清理
- 🔴 空闲 < 5 GB: 立即执行深度清理

---

## 2. 毒舌烈度调节指南

### 2.1 烈度等级映射

Dashboard 侧边栏的 **毒舌烈度** 滑块控制脚本生成器的辛辣程度。

| 等级 | 标签 | 参数值 | RAG 示例 | 典型应用场景 |
|------|------|--------|----------|-------------|
| 1 | 😇 佛系 | `toxicity=1` | "这个视频其实挺有创意的，不过..." | 新手创作者，友好反馈 |
| 2 | 😇 佛系 | `toxicity=2` | "思路不错，但执行上可以优化" | 教育类内容 |
| 3 | 😏 微讽 | `toxicity=3` | "可能只有我觉得这个设计有点..." | 日常吐槽 |
| 4 | 😏 微讽 | `toxicity=4` | "看得出来很努力，但效果嘛..." | 轻度娱乐 |
| 5 | 😈 标准 | `toxicity=5` | **默认值** — "这就是传说中的...？" | 常规内容 |
| 6 | 😈 标准 | `toxicity=6` | "不是我想喷，但这真的太..." | 搞笑视频 |
| 7 | 👿 辛辣 | `toxicity=7` | "我看了三遍才确定这不是在搞笑" | 翻车合集 |
| 8 | 👿 辛辣 | `toxicity=8` | "这是认真的吗？确定不是在演？" | 迷惑行为 |
| 9 | 🔥 狂暴 | `toxicity=9` | "前方高能预警！这操作我服了" | 顶级翻车 |
| 10 | 🔥 狂暴 | `toxicity=10` | 火力全开，无限制模式 | 沙雕视频 |

### 2.2 实现机制

烈度参数通过以下方式影响输出:

```python
# roastpoints/roast_score_engine.py
toxicity_multiplier = toxicity_level / 5.0  # 1-10 → 0.2-2.0

# 槽点权重 = 基础权重 × 毒性乘数
final_score = original_score * toxicity_multiplier

# 脚本生成器根据烈度调整词汇选择
if toxicity_level >= 7:
    use_strong_sarcasm = True
    use_mild_phrases = False
```

### 2.3 建议

- **商业合作内容**: 使用 1-3 级（佛系/微讽）
- **日常娱乐内容**: 使用 4-6 级（标准）
- **高流量翻车视频**: 使用 7-8 级（辛辣）
- **私密测试**: 可使用 9-10 级（狂暴），注意合规风险

---

## 3. 狩猎调度配置

### 3.1 调度器类型

| 调度器 | 触发周期 | 链路 | 启动方式 |
|--------|---------|------|---------|
| **AutoHuntScheduler** | 每日 00:00 | Fetch → Rank → Queue | Dashboard 或 `python -m tasks.daily_task` |
| **ScoutScheduler** | 每 4 小时 | Scout → Analyze → Pool Sync → Queue | Dashboard 或 `python -m tasks.scheduler_service` |

### 3.2 APScheduler vs Threading Fallback

系统自动检测 APScheduler 是否安装:

```python
try:
    from apscheduler.schedulers.background import BackgroundScheduler
    HAS_APSCHEDULER = True  # ✅ 使用专业调度器
except ImportError:
    HAS_APSCHEDULER = False  # ⚠️ 使用 threading 轮询回退
```

**推荐安装 APScheduler**:

```bash
pip install apscheduler
```

### 3.3 狩猎标签配置

默认狩猎标签: `fail`, `cringe`, `wtf`, `funny`, `gonewrong`

可通过 Dashboard 修改:
1. 打开 **🔥 爆款狩猎区** → **⚙️ 调度设置**
2. 修改 **标签列表（逗号分隔）**
3. 点击 **💾 保存配置**

### 3.4 评分门槛说明

| 门槛 | 含义 |
|------|------|
| `score_floor` | 最低吐槽潜力分，低于此分不进队列 |
| `engagement_top_pct` | 互动率 Top 百分比，默认 10% |
| `density_threshold` | 信号词密度阈值，默认 8% → High_Potential |
| `score_threshold` | 综合评分阈值，默认 60 → High_Potential |

---

## 4. 候选池管理

### 4.1 候选池文件位置

```
data/autoscout/candidate_pool.json
```

### 4.2 候选池数据结构

```json
{
  "url": "https://www.tiktok.com/@user/video/12345",
  "title": "Epic fail compilation",
  "video_id": "12345",
  "author": "user",
  "likes": 15000,
  "comments": 1200,
  "shares": 800,
  "views": 500000,
  "engagement_rate": 0.034,
  "is_trending": true,
  "roast_potential": 72.5,
  "high_potential": true,
  "signal_count": 4,
  "signal_density": 0.12,
  "signal_matches": {
    "cringe": ["cringe"],
    "fail": ["fail", "gone wrong"],
    "overconfidence": ["easy"]
  },
  "scouted_at": "2026-07-12T18:00:00"
}
```

### 4.3 自动清理策略

- 候选池自动保留最近 **500 条** 记录
- 超出部分自动截断（FIFO）
- 每条记录包含 `scouted_at` 时间戳

### 4.4 批量生产

Dashboard **🔥 爆款狩猎区** → **📊 今日热点吐槽榜**:

1. 筛选: `仅 High_Potential` / `仅 Trending` / 按潜力分排序
2. 点击 **🏭 批量一键生产** 将所有 High_Potential 视频推入队列
3. 单个视频可点击 **🏭 生产** 或 **📦 加入队列**

---

## 5. 性能监控

### 5.1 监控指标

| 指标 | 来源 | 展示位置 |
|------|------|---------|
| FFmpeg 版本 | `ffmpeg -version` | ⚙️ 系统运维 → 性能监控 |
| CPU 占用率 | `psutil.cpu_percent()` | ⚙️ 系统运维 → 性能监控 |
| 内存使用率 | `psutil.virtual_memory()` | ⚙️ 系统运维 → 性能监控 |
| 磁盘使用率 | `psutil.disk_usage()` | ⚙️ 系统运维 → 性能监控 |
| 目录大小 | `Path.rglob().stat()` | ⚙️ 系统运维 → 磁盘清理 |

### 5.2 安装 psutil 获取完整监控

```bash
pip install psutil
```

未安装时系统自动降级显示基础统计。

### 5.3 FFmpeg 检测

`_check_ffmpeg()` 函数通过子进程调用 `ffmpeg -version` 检测:
- ✅ **可用**: 显示版本号
- ❌ **不可用**: 显示安装指南

---

## 6. 故障排除

### 6.1 yt-dlp 抓取失败

**症状**: `AutoHunter fetch failed` / `yt-dlp extract failed`

**解决方案**:
1. 检查 yt-dlp 版本: `yt-dlp --version`
2. 更新 yt-dlp: `pip install -U yt-dlp`
3. 检查网络连接（TikTok 可能被屏蔽）
4. 系统自动回退到 Mock 数据模式

### 6.2 APScheduler 未安装

**症状**: `APScheduler not installed` 警告

**解决方案**:
```bash
pip install apscheduler
```
系统会自动使用 threading fallback，但建议安装 APScheduler 以获得更可靠的调度。

### 6.3 FFmpeg 未找到

**症状**: 视频渲染失败 / FFmpeg 显示不可用

**解决方案**:
- **Windows**: https://ffmpeg.org/download.html → 解压 → `bin/` 加入 PATH → 重启终端
- **macOS**: `brew install ffmpeg`
- **Linux**: `sudo apt install ffmpeg`

### 6.4 队列文件损坏

**症状**: `production_queue.json` 解析失败

**解决方案**:
```bash
# 备份后重新创建
cd RoastBro
mv data/autohunter/production_queue.json data/autohunter/production_queue.json.bak
echo '[]' > data/autohunter/production_queue.json
```

### 6.5 候选池文件损坏

**症状**: `candidate_pool.json` 解析失败

**解决方案**:
```bash
cd RoastBro
mv data/autoscout/candidate_pool.json data/autoscout/candidate_pool.json.bak
# 下次巡航周期会自动重建
```

---

## 7. 日常运维检查清单

### 每日检查

- [ ] **系统运维** → 检查 FFmpeg 状态
- [ ] **系统运维** → 检查磁盘使用量（建议空闲 > 20 GB）
- [ ] **爆款狩猎区** → 查看今日热点吐槽榜
- [ ] **爆款狩猎区** → 确认候审视频

### 每周检查

- [ ] **系统运维** → 执行常规清理（如需要）
- [ ] **系统运维** → 检查模块健康度
- [ ] **实时生产车间** → 检查候选池增长趋势
- [ ] 检查 `data/autoscout/candidate_pool.json` 大小

### 每月检查

- [ ] **系统运维** → 执行深度清理（如磁盘空间不足）
- [ ] 更新 yt-dlp: `pip install -U yt-dlp`
- [ ] 检查依赖版本: `pip list --outdated`
- [ ] 审查狩猎标签效果，调整标签列表

---

> *RoastBro Operations v2.0 — 工业级运维，一键搞定。*
