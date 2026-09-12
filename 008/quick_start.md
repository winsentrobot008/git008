# 008 视频生产 · 快速上手（RTX 3060 12G）

> 本地只做苦力活（渲染 / 编码），云端 API 做脑力活（文案 / 脚本）。
> 红线：不要碰 `wan2.1-14b` / `hunyuan-1.5` —— 必爆显存，代码已硬拦截。

## 0. 环境现状（2026-09-11 本机实测）

| 组件 | 路径 / 版本 | 状态 |
| --- | --- | --- |
| ffmpeg（主力） | `C:\ffmpeg\bin\ffmpeg.exe`（N-118197, 2024-12-31, gpl） | NVENC 可用 |
| ffmpeg（备用） | `C:\ffmpeg-9.0.1-full\bin\ffmpeg.exe` | 能解 animated webp，NVENC 不可用 |
| ComfyUI | `C:\ComfyUI`，`python_embeded` 3.12.10 | 端口 8188 |
| PyTorch | `2.13.0+cu126` | `cuda_available: True` |
| 显卡 | NVIDIA GeForce RTX 3060 12G，驱动 560.94 | LOW_VRAM 模式 |

模型位置（注意：**不是** `C:\ComfyUI\models`）：

| 用途 | 路径 | 大小 |
| --- | --- | --- |
| SVD 图生视频 | `C:\ComfyUI\ComfyUI\models\checkpoints\svd_xt.safetensors` | 9.1 GB |
| SD1.5 底模（AnimateDiff 用） | `C:\ComfyUI\ComfyUI\models\checkpoints\v1-5-pruned-emaonly.safetensors` | 4.1 GB |
| AnimateDiff 运动模块 | `C:\ComfyUI\ComfyUI\models\animatediff\mm_sd_v15_v2.ckpt` | 1.7 GB |

自检（30 秒）：

```powershell
ffmpeg -version
ffmpeg -encoders | findstr nvenc      # 必须看到 h264_nvenc / hevc_nvenc
```

> 注意：`-encoders` 里有 `h264_nvenc` **只代表 ffmpeg 带这个编码器**，不代表驱动支持。
> 驱动太旧时编码会在开编器阶段报 `Driver does not support the required nvenc API version`，
> 此时项目代码会自动回退 `libx264`（见 `src/core/ffmpeg.py`）。当前驱动 560.94 配
> `C:\ffmpeg` 这个 build 是**实测可编**的。

## 1. 启动 ComfyUI

一键（推荐）：双击 `008\start_local_pipeline.bat` —— 起服务、等 30 秒、激活 venv、做可达性检查。

手动：

1. 双击 `C:\ComfyUI\run_nvidia_gpu.bat`（已带 `--lowvram --preview-method auto`）。
2. 浏览器打开 http://127.0.0.1:8188
3. 命令行验证：

```powershell
curl.exe http://127.0.0.1:8188/system_stats
```

## 2. 用 SVD 跑通第一张老照片复活

工作流：`products/RoastBro/tools/_comfyui/workflows/svd_img2vid.json`

```
ImageOnlyCheckpointLoader(1) ──┬─> SVD_img2vid_Conditioning(3) ─+
                               │                                 ├─> KSampler(5) -> VAEDecode(6) ─┬─> SaveAnimatedWEBP(7)
LoadImage(2) ──────────────────┘   VideoLinearCFGGuidance(4) ────+                                 └─> CreateVideo(8) -> SaveVideo(9)  [MP4]
```

3060 12G 安全参数（**实测值**）：

| 参数 | 建议值 | 说明 |
| --- | --- | --- |
| 分辨率 | `576x1024` | 竖屏；再大就爆显存 |
| 帧数 | `14` | 配 fps 7 ≈ 2 秒 |
| fps | `7` | |
| `motion_bucket_id` | **`40` ~ `80`** | 实测 `127` 会把人脸/背景**融化**，人像复活请用 60 |
| `augmentation_level` | `0.0` | |
| `steps` | `20` | 3060 上约 125~155 秒/条 |

> 实测：`motion_bucket_id=127` 画面大面积糊化；改成 `60` 后背景几乎不动、只有轻微呼吸/转头。
> 想更稳就继续往下调（`40`），想要明显动作再往上加。

命令行一条龙（推荐，自动上传 + 注入参数 + 下载）：

```powershell
.\.venv\Scripts\python.exe 008\run_svd.py "C:\path\to\old_photo.jpg" --motion 60
# 默认出 MP4 -> 008\out\svd_<时间戳>.mp4
# 想出 webp：加 --output webp
```

## 3. 用 FFmpeg NVENC 压缩输出

```powershell
C:\ffmpeg\bin\ffmpeg.exe -y -hwaccel cuda -i "008\out\svd_xxx.mp4" `
  -c:v h264_nvenc -preset p4 -rc vbr -cq 21 -b:v 0 -pix_fmt yuv420p -movflags +faststart `
  ".\laozhaopian_01.mp4"
```

- `-hwaccel cuda` 硬解码，`-cq 21` 恒定质量（越小越清晰，18~23 够用）。
- 交付目标：3~5 秒竖屏、体积小、能直接发 Messenger / Tradera。
- 项目代码默认 NVENC 优先、`libx264` 自动回退（`src/core/ffmpeg.py`、`products/RoastBro/editor/auto_editor.py`）。
- 强制软编排查：设 `FFMPEG_DISABLE_NVENC=1`。

## 4. 交付前 10 秒自检

```powershell
C:\ffmpeg\bin\ffprobe.exe -v error -select_streams v:0 `
  -show_entries stream=codec_name,width,height,nb_frames -show_entries format=duration,size `
  -of default=noprint_wrappers=1 ".\laozhaopian_01.mp4"
```

看到 `width=576 height=1024 nb_frames=14 duration=2.0` 即合格。
不要接超过 5 秒的高清长视频单：12G 显存抽卡成本太高。

本地并发已用文件锁串行化，同一时刻只有 1 个进程占用显卡
（锁文件 `%TEMP%\008_comfyui_gpu.lock`，等锁超时 `COMFYUI_LOCK_TIMEOUT` 秒）。

## 5. 工作流的 API 调用示例

```python
from pathlib import Path
import sys

sys.path.insert(0, "products/RoastBro")            # 让 tools.* 可被导入
from tools._comfyui.client import ComfyUIClient    # noqa: E402

client = ComfyUIClient()                            # 默认 http://127.0.0.1:8188
assert client.is_available(), client.unavailable_reason()

wf = ComfyUIClient.load_workflow(
    Path("products/RoastBro/tools/_comfyui/workflows/svd_img2vid.json")
)

# 1) 上传老照片，拿服务端文件名
uploaded = client.upload_image(Path("old_photo.jpg"), "old_photo.png")

# 2) 注入图片与 3060 12G 安全参数
wf = ComfyUIClient.patch_workflow(wf, {
    "2": {"image": uploaded},                                    # LoadImage
    "3": {"width": 576, "height": 1024, "video_frames": 14,       # SVD 条件
          "fps": 7, "motion_bucket_id": 60, "augmentation_level": 0.0},
    "5": {"seed": ComfyUIClient.random_seed()},                   # KSampler
    "7": {"fps": 7},                                             # SaveAnimatedWEBP
    "8": {"fps": 7},                                             # CreateVideo
})

# 3) 提交 -> 轮询 -> 下载（内部有文件锁，不会和其他进程抢显存）
paths = client.generate(wf, output_node="9", dest=Path("old_photo_revived.mp4"))
print("输出:", paths)
```

要点：

- `output_node="9"` 拿 MP4（`SaveVideo`），`output_node="7"` 拿 animated WebP（`SaveAnimatedWEBP`）。
- `generate()` 内部走文件锁，重复启动多个脚本不会同时抢显存；等锁超时可调 `COMFYUI_LOCK_TIMEOUT`。
- 想接 `VHS_VideoCombine`：需另装 ComfyUI-VHS 插件，其余节点不动（本机已用内置 `SaveVideo` 达成同样效果，无需插件）。

## 6. 验收命令

```powershell
C:\ffmpeg\bin\ffmpeg.exe -encoders | findstr nvenc
C:\ComfyUI\python_embeded\python.exe -c "import torch; print(torch.cuda.is_available())"
.\.venv\Scripts\python.exe -c "from products.RoastBro.tools._comfyui.client import ComfyUIClient; c=ComfyUIClient(); print('ComfyUI reachable:', c.is_available())"
curl.exe http://127.0.0.1:8188/system_stats
```

## 7. 已知坑

1. 模型必须放 `C:\ComfyUI\ComfyUI\models\...`（两层 ComfyUI），放 `C:\ComfyUI\models` 服务端**看不到**。
2. 不要用 `C:\ComfyUI\run_cpu.bat`，3060 上慢到不可用。
3. animated WebP 只有 `C:\ffmpeg-9.0.1-full` 那个 build 能解；主力 build 解不了，所以优先出 MP4。
4. 驱动 560.94 偏旧：ComfyUI 启动日志会抱怨建议升级到 cu130；升级驱动后
   `C:\ffmpeg`（9.0.1）也能直接用 NVENC，届时可只留一套 ffmpeg。
5. Piper TTS 模型还没装（`C:\Users\aoogoost\models\piper\`），需要手动下载。