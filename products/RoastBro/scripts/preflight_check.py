# -*- coding: utf-8 -*-
"""
RoastBro — 生产线就绪状态一键体检 (Preflight Check)
===================================================
检测 FFmpeg/FFprobe 安装状态、API 密钥配置、目录就绪状态，
输出一份精美的生产线就绪报告。
"""

import os
import shutil
import subprocess
import sys

# Force UTF-8 for Windows
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except AttributeError:
        pass

print("=" * 62)
print("       RoastBro 生产线就绪状态一键体检")
print("=" * 62)

pass_count = 0
warn_count = 0
fail_count = 0


def status_tag(result: str) -> str:
    """Return colored status tag."""
    if result == "pass":
        return "[PASS]"
    elif result == "warn":
        return "[WARN]"
    else:
        return "[FAIL]"


def report(result: str, message: str, detail: str = "") -> None:
    """Print a formatted report line and track counts."""
    global pass_count, warn_count, fail_count
    if result == "pass":
        pass_count += 1
    elif result == "warn":
        warn_count += 1
    else:
        fail_count += 1

    tag = status_tag(result)
    if detail:
        print(f"  {tag} {message}")
        print(f"       {detail}")
    else:
        print(f"  {tag} {message}")


# ==========================================
# 1. 核心渲染引擎检测
# ==========================================
print("\n" + "-" * 62)
print("  [1] 核心渲染引擎检测")
print("-" * 62)

# FFmpeg
ffmpeg_path = shutil.which("ffmpeg")
if ffmpeg_path:
    try:
        ver = subprocess.check_output(
            ["ffmpeg", "-version"], stderr=subprocess.STDOUT, text=True
        ).split("\n")[0]
        report("pass", f"FFmpeg 已就绪", f"路径: {ffmpeg_path}")
        print(f"       版本: {ver}")
    except Exception as e:
        report("warn", f"FFmpeg 存在但无法执行", f"路径: {ffmpeg_path}, 错误: {e}")
else:
    report("fail", "未找到 FFmpeg！",
           "视频总装 (PHASE 4) 将无法运行。请在系统环境中安装 ffmpeg。")

# FFprobe
ffprobe_path = shutil.which("ffprobe")
if ffprobe_path:
    try:
        ver = subprocess.check_output(
            ["ffprobe", "-version"], stderr=subprocess.STDOUT, text=True
        ).split("\n")[0]
        report("pass", f"FFprobe 已就绪", f"路径: {ffprobe_path}")
        print(f"       版本: {ver}")
    except Exception as e:
        report("warn", f"FFprobe 存在但无法执行", f"路径: {ffprobe_path}, 错误: {e}")
else:
    report("fail", "未找到 FFprobe！",
           "视频分析与长宽比校验将受限。")

# npx / Node.js
npx_path = shutil.which("npx")
node_path = shutil.which("node")
if npx_path and node_path:
    try:
        node_ver = subprocess.check_output(
            ["node", "--version"], stderr=subprocess.STDOUT, text=True
        ).strip()
        report("pass", f"Node.js / npx 已就绪", f"Node {node_ver}, npx: {npx_path}")
    except Exception:
        report("warn", "Node.js/npx 存在但版本探测失败")
elif npx_path:
    report("warn", "npx 存在但 node 未找到", "请检查 Node.js 安装")
else:
    report("warn", "npx 未安装",
           "Remotion 渲染需要 Node.js >= 18。若不使用 Remotion 可忽略此警告。")

# Python 版本
python_ver = f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}"
report("pass", f"Python {python_ver}", f"路径: {sys.executable}")


# ==========================================
# 2. 素材搜索引擎 API 密钥检测
# ==========================================
print("\n" + "-" * 62)
print("  [2] 素材搜索引擎 API 密钥检测")
print("-" * 62)

api_keys = {
    "PEXELS_API_KEY": "Pexels (图片+视频)",
    "PIXABAY_API_KEY": "Pixabay (图片+视频)",
}

for env_var, service_name in api_keys.items():
    val = os.getenv(env_var)
    if val:
        # Mask the key for display
        if len(val) > 8:
            masked = val[:4] + "*" * (len(val) - 8) + val[-4:]
        else:
            masked = "***"
        report("pass", f"{service_name} ({env_var})", f"已配置: {masked}")
    else:
        report("warn", f"{service_name} ({env_var})", "未配置")

# YouTube/Bing/Web 无需 Key
report("pass", "YouTube 搜索引擎", "无需 API Key (通过 yt-dlp 直接提取)")
report("pass", "Bing / DuckDuckGo 图片搜索", "无需 API Key")
report("pass", "Web 页面截图引擎", "无需 API Key")


# ==========================================
# 3. 硬盘守护检测 (yt-dlp 限制)
# ==========================================
print("\n" + "-" * 62)
print("  [3] 硬盘守护检测 (yt-dlp 下载限制)")
print("-" * 62)

auto_hunter_path = "scrapers/fetcher/auto_hunter.py"
if os.path.exists(auto_hunter_path):
    try:
        with open(auto_hunter_path, "r", encoding="utf-8") as f:
            content = f.read()
        if "max_filesize" in content:
            # Extract the value
            import re
            match = re.search(r"max_filesize['\"]?\s*:\s*(\d+)\s*\*\s*(\d+)\s*\*\s*(\d+)", content)
            if match:
                val = int(match.group(1)) * int(match.group(2)) * int(match.group(3))
                report("pass", "yt-dlp 文件大小限制已启用",
                       f"最大 {val / 1024 / 1024:.0f}MB (定义于 {auto_hunter_path})")
            else:
                report("pass", "yt-dlp 文件大小限制已启用",
                       f"定义于 {auto_hunter_path}")
        else:
            report("fail", "yt-dlp 文件大小限制未启用！",
                   "建议在 auto_hunter.py 中添加 max_filesize 参数")
    except Exception as e:
        report("warn", f"无法读取 {auto_hunter_path}", f"错误: {e}")
else:
    report("fail", f"未找到 {auto_hunter_path}", "自动猎手模块缺失")


# ==========================================
# 4. 物理存储目录检测
# ==========================================
print("\n" + "-" * 62)
print("  [4] 物理存储目录检测")
print("-" * 62)

required_dirs = [
    ("data/temp_assets", "临时素材缓存"),
    ("data/output",      "最终视频输出"),
    ("tools",            "OpenMontage 工具基座"),
    ("scripts",          "流水线脚本"),
]

for dir_path, description in required_dirs:
    if os.path.exists(dir_path):
        report("pass", f"{description} ({dir_path}/)", "已就绪")
    else:
        try:
            os.makedirs(dir_path, exist_ok=True)
            report("pass", f"{description} ({dir_path}/)", "已自动创建")
        except Exception as e:
            report("fail", f"{description} ({dir_path}/)", f"创建失败: {e}")


# ==========================================
# 5. 四大魔改模块状态检测
# ==========================================
print("\n" + "-" * 62)
print("  [5] 四大魔改模块导入检测")
print("-" * 62)

import sys
sys.path.insert(0, os.getcwd())

modules_to_check = [
    ("voice.om_audio.tts_selector",             "TTSSelector",           "语音合成"),
    ("scrapers.fetcher.auto_hunter",             "AutoHunter",            "素材采集"),
    ("analyzer.om_analysis.composition_validator", "CompositionValidator", "视觉质检"),
    ("editor.om_video.video_compose",            "VideoCompose",          "视频渲染"),
]

for mod_path, class_name, description in modules_to_check:
    try:
        mod = __import__(mod_path, fromlist=[class_name])
        cls = getattr(mod, class_name)
        report("pass", f"{description} ({mod_path}.{class_name})", "导入成功")
    except Exception as e:
        report("fail", f"{description} ({mod_path}.{class_name})", f"导入失败: {e}")


# ==========================================
# 总结报告
# ==========================================
print("\n" + "=" * 62)
print("  生产线就绪报告 — 总结")
print("=" * 62)
print()
total = pass_count + warn_count + fail_count
print(f"  总计检测项: {total}")
print(f"  [PASS] 通过: {pass_count}")
print(f"  [WARN] 警告: {warn_count}")
print(f"  [FAIL] 失败: {fail_count}")
print()

if fail_count == 0 and warn_count == 0:
    print("  >>> 生产线完全就绪！可以开始生产。")
elif fail_count == 0:
    print("  >>> 生产线基本就绪。请关注上述警告项。")
else:
    print("  >>> 生产线存在阻塞项。请修复上述失败项后再试。")

print()
print("=" * 62)
print("              体检结束")
print("=" * 62)
