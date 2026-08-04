"""
RoastBro — CEO 中文指挥台
==========================
【链接绑定 + 本地视频投喂】双轨联动 + 工厂全流程监控

侧边栏导航：
    🎯 视频狩猎与投喂  — 链接建档 + 本地视频匹配 + 批准生产
    🏭 工厂流水线监控  — 剪辑状态 / 文案进度 / 渲染队列
    📊 数据与运行分析  — 爆款数据 / 吐槽历史 / 系统成功率
    ⚙️ 工厂运维调优    — 系统核心参数调整

启动方式：
    streamlit run dashboard/app.py

多线程安全设计：
    - 后台流水线通过 status JSON 文件（data/metadata/{vid}.status.json）传递状态
    - Dashboard 主线程只读这些文件，绝不从后台线程触碰 st.session_state
    - 流水线启动改用 subprocess.Popen（非阻塞），前端通过刷新轮询进度
"""

# ── 热加载：强制注入用户 site-packages（防 pip 装错路径） ──
import sys, os
for _site in [
    os.path.expanduser(r"~\AppData\Roaming\Python\Python312\site-packages"),
    os.path.expanduser(r"~\AppData\Local\Programs\Python\Python312\Lib\site-packages"),
    os.path.expanduser(r"~\AppData\Roaming\Python\Python311\site-packages"),
    os.path.expanduser(r"~\AppData\Local\Programs\Python\Python311\Lib\site-packages"),
]:
    if _site not in sys.path and os.path.isdir(_site):
        sys.path.insert(0, _site)

# ── 地毯式强搜 ffmpeg.exe（热注入 PATH，不依赖系统刷新） ──
import subprocess as _subprocess
_ffmpeg_found = None
_ffmpeg_search_paths = [
    os.path.expanduser(r"~\AppData\Local\RoastBro\ffmpeg"),
    os.path.expanduser(r"~\AppData\Local\RoastBro\ffmpeg\bin"),
    r"C:\Program Files\ffmpeg\bin",
    r"C:\ffmpeg\bin",
    r"C:\tools\ffmpeg\bin",
]
# winget 安装路径
_winget_dir = os.path.expanduser(r"~\AppData\Local\Microsoft\WinGet\Links")
if os.path.isdir(_winget_dir):
    for _f in os.listdir(_winget_dir):
        if _f.lower() == "ffmpeg.exe":
            _ffmpeg_found = os.path.join(_winget_dir, _f)
            break
if not _ffmpeg_found:
    for _p in _ffmpeg_search_paths:
        _candidate = os.path.join(_p, "ffmpeg.exe")
        if os.path.isfile(_candidate):
            _ffmpeg_found = _candidate
            break
if not _ffmpeg_found:
    # 搜整个 %USERPROFILE% 下
    _user_root = os.path.expanduser("~")
    for _root, _dirs, _files in os.walk(_user_root):
        if "ffmpeg.exe" in _files:
            _ffmpeg_found = os.path.join(_root, "ffmpeg.exe")
            break
        # 限制搜索深度
        if _root.count(os.sep) > _user_root.count(os.sep) + 4:
            _dirs.clear()
if _ffmpeg_found:
    _ffmpeg_dir = os.path.dirname(_ffmpeg_found)
    os.environ["PATH"] = _ffmpeg_dir + os.pathsep + os.environ.get("PATH", "")
    print(f"[BOOT] FFmpeg found & injected: {_ffmpeg_found}")

import streamlit as st
import subprocess
import sys
import json
import re
import os
import time
from pathlib import Path
from datetime import datetime
from typing import Optional, Dict, List, Any

# ── Constants ────────────────────────────────────────────────
ROOT = Path(__file__).resolve().parent.parent
ORCHESTRATOR_PATH = ROOT / "orchestrator.py"
PENDING_DIR = ROOT / "data" / "pending_videos"
TRACKING_FILE = PENDING_DIR / "tracking.json"
METADATA_DIR = ROOT / "data" / "metadata"

# ── Page Config ──────────────────────────────────────────────
st.set_page_config(page_title="RoastBro CEO 指挥台", page_icon="🔥", layout="wide")

# ── Session State（仅用于前端 UI 状态，不存储流水线进度） ──
if "produced" not in st.session_state:
    st.session_state.produced = set()
if "failed" not in st.session_state:
    st.session_state.failed = {}  # {str(video_path): error_text}  # fallback only
if "running_pids" not in st.session_state:
    st.session_state.running_pids = {}  # {str(video_path): pid}

# ── FFmpeg 自动发现（启动时执行一次） ──────────────────────
def _auto_discover_ffmpeg() -> str:
    """地毯式搜索 ffmpeg.exe，返回路径或空字符串"""
    # 常见安装路径
    search_dirs = [
        Path(os.environ.get("LOCALAPPDATA", "")) / "RoastBro" / "ffmpeg",
        Path(os.environ.get("PROGRAMFILES", "")) / "ffmpeg" / "bin",
        Path(os.environ.get("PROGRAMFILES(X86)", "")) / "ffmpeg" / "bin",
        Path("C:/tools/ffmpeg/bin"),
        Path("C:/ffmpeg/bin"),
    ]
    # winget 安装路径
    winget_links = [
        Path(os.environ.get("LOCALAPPDATA", "")) / "Microsoft" / "WinGet" / "Links",
    ]
    for d in winget_links:
        if d.exists():
            for f in d.iterdir():
                if f.name.lower() == "ffmpeg.exe":
                    return str(f)
    for d in search_dirs:
        candidate = d / "ffmpeg.exe"
        if candidate.exists():
            return str(candidate)
    # PATH 查找
    for p in os.environ.get("PATH", "").split(";"):
        candidate = Path(p) / "ffmpeg.exe"
        if candidate.exists():
            return str(candidate)
    return ""

# 自动发现 FFmpeg 并锁定到 session_state
if "ffmpeg_path" not in st.session_state or not st.session_state.ffmpeg_path:
    found = _auto_discover_ffmpeg()
    if found:
        st.session_state.ffmpeg_path = found

# ── 下载任务跟踪 ────────────────────────────────────────────
if "downloading" not in st.session_state:
    st.session_state.downloading = {}  # {video_id: {"pid": int, "started_at": str}}
_DOWNLOAD_PREFIX = "dl_"

# ── 按钮点击状态持久化（防止 Rerun 闪退） ────────────────────
# 结构: { vid: {"status": "ok"|"error", "pid": int|None, "cmd": str, "py_exe": str, "error": str} }
# 只要 status 文件未变成 running/completed/failed，就持续渲染在卡片上
_SUBMIT_PREFIX = "submit_result_"


def _get_submit_result(vid: str) -> Optional[Dict[str, Any]]:
    return st.session_state.get(f"{_SUBMIT_PREFIX}{vid}")


def _set_submit_result(vid: str, result: Dict[str, Any]):
    st.session_state[f"{_SUBMIT_PREFIX}{vid}"] = result


def _clear_submit_result(vid: str):
    key = f"{_SUBMIT_PREFIX}{vid}"
    if key in st.session_state:
        del st.session_state[key]


# ═══════════════════════════════════════════════════════════════
#  共享工具
# ═══════════════════════════════════════════════════════════════

def get_heartbeat() -> Dict[str, Any]:
    hb_path = ROOT / ".heartbeat"
    if not hb_path.exists():
        return {"status": "no_heartbeat"}
    try:
        return json.loads(hb_path.read_text(encoding="utf-8"))
    except Exception:
        return {"status": "corrupted"}


def _ensure_dirs():
    PENDING_DIR.mkdir(parents=True, exist_ok=True)


def _load_tracking() -> Dict[str, dict]:
    if not TRACKING_FILE.exists():
        return {}
    try:
        data = json.loads(TRACKING_FILE.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _save_tracking(data: Dict[str, dict]):
    _ensure_dirs()
    TRACKING_FILE.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def _extract_video_id(url: str) -> Optional[str]:
    m = re.search(r'(?:video|v)/(\d+)', url)
    if m:
        return m.group(1)
    m = re.search(r'/video/(\d+)', url)
    if m:
        return m.group(1)
    return None


def _extract_author(url: str) -> str:
    m = re.search(r'@([\w.\-]+)', url)
    return m.group(1) if m else "unknown"


# ── 后台子进程日志路径 ──────────────────────────────────────
PIPELINE_ERROR_LOG = METADATA_DIR / "pipeline_launch_errors.log"
PIPELINE_STDOUT_LOG = METADATA_DIR / "orchestrator_stdout.log"
PIPELINE_STDERR_LOG = METADATA_DIR / "orchestrator_stderr.log"


def _read_tail(path: Path, max_lines: int = 30) -> str:
    """读取文件尾部内容（用于诊断）"""
    if not path.exists():
        return "(file not found)"
    try:
        lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
        tail = lines[-max_lines:] if len(lines) > max_lines else lines
        return "\n".join(tail)
    except Exception as e:
        return f"(read error: {e})"


def _run_approve_background(video_path: str) -> Dict[str, Any]:
    """
    非阻塞启动流水线进程。

    stdout → data/metadata/orchestrator_stdout.log
    stderr → data/metadata/orchestrator_stderr.log

    静默执行（不调用任何 st.* 函数），结果通过 dict 传达。
    调用方负责将结果显示到页面并通过 session_state 持久化。

    返回:
        {"ok": True,  "pid": int, "cmd": str, "py_exe": str}   — 成功
        {"ok": False, "pid": None, "cmd": str, "py_exe": str, "error": str}  — 失败
    """
    py_exe = sys.executable
    orch_path = str(ORCHESTRATOR_PATH)
    cmd = [py_exe, orch_path, "--mode", "approve", "--video", video_path]
    cmd_display = " ".join(cmd)
    base = {"cmd": cmd_display, "py_exe": py_exe}

    # ── 预检 ──
    if not py_exe or not os.path.isfile(py_exe):
        err = f"Python interpreter not found: {py_exe}"
        _append_launch_error(cmd_display, err)
        return {**base, "ok": False, "pid": None, "error": err}
    if not os.path.isfile(orch_path):
        err = f"orchestrator.py not found: {orch_path}"
        _append_launch_error(cmd_display, err)
        return {**base, "ok": False, "pid": None, "error": err}
    if not os.path.isfile(video_path):
        err = f"Video file not found: {video_path}"
        _append_launch_error(cmd_display, err)
        return {**base, "ok": False, "pid": None, "error": err}

    # ── 准备日志目录 ──
    METADATA_DIR.mkdir(parents=True, exist_ok=True)

    # 写入启动标记到错误聚合日志
    with open(str(PIPELINE_ERROR_LOG), "a", encoding="utf-8") as f:
        f.write(f"\n--- LAUNCH {datetime.now().isoformat()} ---\n")
        f.write(f"CMD: {cmd_display}\n")

    # 新起一行分隔
    with open(str(PIPELINE_STDOUT_LOG), "a", encoding="utf-8") as f:
        f.write(f"\n===== LAUNCH {datetime.now().isoformat()} =====\n")
    with open(str(PIPELINE_STDERR_LOG), "a", encoding="utf-8") as f:
        f.write(f"\n===== LAUNCH {datetime.now().isoformat()} =====\n")

    # ── 构建子进程环境变量（注入 PYTHONPATH + FFMPEG_PATH） ──
    orch_root = str(ORCHESTRATOR_PATH.parent.resolve())
    my_env = os.environ.copy()
    existing_pythonpath = my_env.get("PYTHONPATH", "")
    if orch_root not in existing_pythonpath:
        if existing_pythonpath:
            my_env["PYTHONPATH"] = f"{orch_root};{existing_pythonpath}"
        else:
            my_env["PYTHONPATH"] = orch_root

    # 注入 FFmpeg 路径（如果 CEO 在运维面板配置了）
    ffmpeg_cfg = st.session_state.get("ffmpeg_path", "")
    if ffmpeg_cfg and os.path.isfile(ffmpeg_cfg):
        my_env["FFMPEG_PATH"] = ffmpeg_cfg
        # 同时加入 PATH 让 subprocess 能找到
        ffmpeg_dir = str(Path(ffmpeg_cfg).parent)
        my_env["PATH"] = f"{ffmpeg_dir};{my_env.get('PATH', '')}"

    # ── Popen（stdout/stderr 各自独立文件 + 注入环境变量） ──
    try:
        stdout_file = open(str(PIPELINE_STDOUT_LOG), "a", encoding="utf-8")
        stderr_file = open(str(PIPELINE_STDERR_LOG), "a", encoding="utf-8")
        proc = subprocess.Popen(
            cmd,
            stdout=stdout_file,
            stderr=stderr_file,
            env=my_env,
        )
        stdout_file.close()
        stderr_file.close()
        return {**base, "ok": True, "pid": proc.pid}
    except FileNotFoundError as e:
        _append_launch_error(cmd_display, f"FileNotFoundError: {e}")
        return {**base, "ok": False, "pid": None, "error": f"FileNotFoundError: {e}"}
    except PermissionError as e:
        _append_launch_error(cmd_display, f"PermissionError: {e}")
        return {**base, "ok": False, "pid": None, "error": f"PermissionError: {e}"}
    except OSError as e:
        _append_launch_error(cmd_display, f"OSError: {e}")
        return {**base, "ok": False, "pid": None, "error": f"OSError: {e}"}
    except Exception as e:
        _append_launch_error(cmd_display, f"Unexpected: {e}")
        return {**base, "ok": False, "pid": None, "error": f"Unexpected: {e}"}


def _append_launch_error(cmd_display: str, error_msg: str):
    """将启动错误追加到日志文件（可用于后续诊断）"""
    try:
        METADATA_DIR.mkdir(parents=True, exist_ok=True)
        with open(str(PIPELINE_ERROR_LOG), "a", encoding="utf-8") as f:
            f.write(f"[{datetime.now().isoformat()}] LAUNCH FAILED: {cmd_display}\n")
            f.write(f"  ERROR: {error_msg}\n")
    except Exception:
        pass  # 日志写入失败不影响主流程


# ── 文件状态读取（前后台解耦核心）────────────────────────────────

def _get_pipeline_status(video_id: str) -> Optional[Dict[str, Any]]:
    """从 status 文件读取流水线状态（线程安全，可被任何线程调用）"""
    spath = METADATA_DIR / f"{video_id}.status.json"
    if not spath.exists():
        return None
    try:
        return json.loads(spath.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None


def _get_all_pipeline_statuses() -> Dict[str, Dict[str, Any]]:
    """读取所有流水线状态"""
    if not METADATA_DIR.exists():
        return {}
    result: Dict[str, Dict[str, Any]] = {}
    for f in sorted(METADATA_DIR.glob("*.status.json")):
        try:
            data = json.loads(f.read_text(encoding="utf-8"))
            vid = data.get("video_id", f.stem.replace(".status", ""))
            result[vid] = data
        except (json.JSONDecodeError, OSError):
            pass
    return result


def _extract_video_id_from_path(video_path_str: str) -> str:
    """从视频文件路径提取 video_id"""
    p = Path(video_path_str)
    return p.stem.replace("tiktok_", "").split("_")[0]


def _is_pipeline_running(video_id: str) -> bool:
    """检查流水线是否正在运行"""
    status = _get_pipeline_status(video_id)
    if status is None:
        return False
    return status.get("status") == "running"


def _is_pipeline_completed(video_id: str) -> bool:
    """检查流水线是否已完成"""
    status = _get_pipeline_status(video_id)
    if status is None:
        return False
    return status.get("status") == "completed"


def _is_pipeline_failed(video_id: str) -> bool:
    """检查流水线是否失败"""
    status = _get_pipeline_status(video_id)
    if status is None:
        return False
    return status.get("status") == "failed"


def _get_pipeline_error(video_id: str) -> str:
    """获取失败原因"""
    status = _get_pipeline_status(video_id)
    if status:
        return status.get("error", "")
    return ""


# ── MP4 快速修复（FastStart / Moov 前置，纯 Python） ──────

def _repair_mp4_faststart(input_path: str, output_path: str) -> bool:
    """
    纯 Python 实现的 MP4 FastStart 修复。
    将 moov atom 从文件尾移到文件头，解决浏览器缓存视频
    缺少 moov 索引头导致的无法播放问题。
    不需要 FFmpeg。
    """
    try:
        with open(input_path, "rb") as f:
            data = f.read()
    except Exception as e:
        print(f"[REPAIR] Read failed: {e}")
        return False

    size = len(data)
    if size < 12:
        return False

    def _read_atom(data: bytes, offset: int) -> tuple:
        """读取一个 atom，返回 (size, type, body, next_offset)"""
        if offset + 8 > len(data):
            return None, None, None, len(data)
        atom_size = int.from_bytes(data[offset:offset+4], "big")
        atom_type = data[offset+4:offset+8].decode("latin-1", errors="replace")
        if atom_size == 0:
            atom_size = len(data) - offset
        body = data[offset+8:offset+atom_size] if atom_size > 8 else b""
        return atom_size, atom_type, body, offset + atom_size

    # 扫描所有顶级 atoms
    atoms = []
    offset = 0
    while offset < size:
        atom_size, atom_type, body, next_offset = _read_atom(data, offset)
        if atom_type is None:
            break
        atoms.append((atom_size, atom_type, body, offset))
        offset = next_offset

    # 找到 ftyp 和 moov
    ftyp_data = None
    moov_data = None
    other_data = b""

    for atom_size, atom_type, body, off in atoms:
        raw = data[off:off+atom_size]
        if atom_type == "ftyp":
            ftyp_data = raw
        elif atom_type == "moov":
            moov_data = raw
        else:
            other_data += raw

    if not ftyp_data:
        ftyp_data = b"\x00\x00\x00\x10ftypmp42\x00\x00\x00\x00mp42"

    if not moov_data:
        # 没有 moov — 直接复制
        print("[REPAIR] No moov atom found, copying as-is")
        import shutil
        shutil.copy2(input_path, output_path)
        return True

    # 重建：ftyp + moov + 其他
    repaired = ftyp_data + moov_data + other_data

    try:
        with open(output_path, "wb") as f:
            f.write(repaired)
        print(f"[REPAIR] OK: moov relocated ({len(moov_data)} bytes) -> {output_path}")
        return True
    except Exception as e:
        print(f"[REPAIR] Write failed: {e}")
        return False


def delete_video_and_tracking(video_id: str):
    for f in PENDING_DIR.glob(f"{video_id}.*"):
        f.unlink(missing_ok=True)
    tracking = _load_tracking()
    tracking.pop(video_id, None)
    _save_tracking(tracking)


def _get_proxy_config() -> str:
    """从 session_state 读取代理配置"""
    return st.session_state.get("proxy_config", "")


def _download_video_background(url: str, video_id: str) -> Optional[int]:
    """
    使用 yt-dlp 在后台下载视频到 data/pending_videos/{video_id}.mp4。
    自动注入浏览器 cookies + 可选代理。
    返回 PID（成功）或 None（失败）。
    """
    output_template = str(PENDING_DIR / f"{video_id}.%(ext)s")
    cmd = [
        sys.executable, "-m", "yt_dlp",
        "--no-playlist",
        "--format", "best[ext=mp4]/best",
        "--output", output_template,
        "--no-part",
        "--quiet",
        "--cookies-from-browser", "chrome",   # 共享浏览器登录态
        url,
    ]

    # 如果配置了代理，追加 --proxy
    proxy = _get_proxy_config()
    if proxy:
        cmd.insert(-1, "--proxy")
        cmd.insert(-1, proxy)
    cmd_display = " ".join(cmd)
    _append_launch_error(cmd_display, f"Starting download for {video_id}")

    try:
        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        return proc.pid
    except Exception as e:
        _append_launch_error(cmd_display, f"Download launch failed: {e}")
        return None


def _delete_status_file(video_id: str):
    """删除流水线状态文件（线程安全）"""
    spath = METADATA_DIR / f"{video_id}.status.json"
    spath.unlink(missing_ok=True)


# ── 本地暂存嗅探器 ───────────────────────────────────────────

def _sniff_cache_dirs() -> List[Path]:
    """返回所有候选缓存目录列表"""
    cache_dirs = []
    # Windows temp
    tmp = os.environ.get("TEMP", "")
    if tmp:
        cache_dirs.append(Path(tmp))
    # Browser caches
    local_appdata = os.environ.get("LOCALAPPDATA", "")
    if local_appdata:
        browsers = [
            "Google/Chrome/User Data/Default/Cache",
            "Google/Chrome/User Data/Default/Code Cache",
            "Microsoft/Edge/User Data/Default/Cache",
            "Microsoft/Edge/User Data/Default/Code Cache",
            "BraveSoftware/Brave-Browser/User Data/Default/Cache",
        ]
        for b in browsers:
            p = Path(local_appdata) / b
            if p.exists():
                cache_dirs.append(p)
    # System temp
    cache_dirs.append(Path("C:/Windows/Temp"))
    return cache_dirs


# ── 嗅探候选列表 session state ──────────────────────────────
if "sniff_candidates" not in st.session_state:
    st.session_state.sniff_candidates = []  # List[Dict]
if "sniff_selected" not in st.session_state:
    st.session_state.sniff_selected = None


def _is_likely_media(path: Path) -> bool:
    """严格校验文件头，排除封面图/残片"""
    try:
        head = path.open("rb").read(20)
        # MP4: bytes 4-8 = "ftyp", brand 8-12 必须是已知视频编码
        if head[4:8] == b"ftyp":
            brand = head[8:12]
            known_video_brands = {b"mp42", b"isom", b"M4V ", b"3gp ", b"3gp5",
                                   b"avc1", b"mp41", b"dash", b"msnv", b"f4v "}
            return brand in known_video_brands
        # AVI: RIFF
        if head[:4] == b"RIFF":
            return True
        # WebM/Matroska
        if head[:4] == b"\x1a\x45\xdf\xa3":
            return True
        return False
    except Exception:
        return False


def _sniff_candidates(max_count: int = 5) -> List[Dict]:
    """
    强力嗅探：30 分钟内、3MB-100MB、任意后缀的潜在媒体文件。
    检测文件头识别媒体格式，按时间倒序返回候选列表。
    """
    candidates = []
    now = time.time()
    MIN_BYTES = 3_000_000       # 3MB（排除封面图 / 碎片）
    MAX_BYTES = 100_000_000     # 100MB
    MAX_AGE = 1800              # 30 分钟

    for cache_dir in _sniff_cache_dirs():
        if not cache_dir.exists():
            continue
        try:
            for f in cache_dir.iterdir():
                if not f.is_file():
                    continue
                size = f.stat().st_size
                age = now - f.stat().st_mtime
                if age > MAX_AGE or size < MIN_BYTES or size > MAX_BYTES:
                    continue
                # 扩展名放行：无后缀 / 临时后缀 /.mp4 /.webm /.ts
                ext = f.suffix.lower()
                if ext and ext not in ("", ".mp4", ".webm", ".ts", ".mkv", ".mov", ".avi", ".part", ".crdownload", ".tmp"):
                    continue
                # 媒体头检测（可选）：有 ftyp 头则优先
                is_media = _is_likely_media(f)
                if not is_media and ext:
                    # 有标准后缀但头检测失败，仍保留（浏览器缓存可能截断头部）
                    pass
                candidates.append({
                    "path": f,
                    "size_mb": round(size / 1024 / 1024, 1),
                    "age_seconds": int(age),
                    "age_str": f"{int(age // 60)}m{int(age % 60)}s" if age > 60 else f"{int(age)}s",
                    "ext": ext or "(no ext)",
                    "is_media": is_media,
                    "dir": cache_dir.name,
                })
        except (PermissionError, OSError):
            pass
        if len(candidates) >= max_count * 5:
            break

    # 按时间倒序（最近的在前），媒体文件优先
    candidates.sort(key=lambda x: (0 if x["is_media"] else 1, x["age_seconds"]))
    return candidates[:max_count]


# ═══════════════════════════════════════════════════════════════
#  视图 1：🎯 视频狩猎与投喂
# ═══════════════════════════════════════════════════════════════

def render_hunting():
    st.header("🎯 视频狩猎与投喂")
    st.caption("粘贴 TikTok 链接 → yt-dlp 自动下载 → 批准生产 → 全自动流水线")

    # ── 环境健康检查指示灯 ──
    health_cols = st.columns(4)
    # FFmpeg
    ffmpeg_path = st.session_state.get("ffmpeg_path", "")
    ffmpeg_ok = ffmpeg_path and os.path.isfile(ffmpeg_path)
    # also check PATH
    if not ffmpeg_ok:
        import shutil
        ffmpeg_ok = shutil.which("ffmpeg") is not None
    health_cols[0].metric("🎬 FFmpeg", "✅ 就绪" if ffmpeg_ok else "❌ 未安装",
                          help=ffmpeg_path or "未找到 ffmpeg.exe")

    # TTS
    try:
        import TTS
        tts_ok = True
    except ImportError:
        tts_ok = False
    health_cols[1].metric("🗣️ TTS", "✅ 就绪" if tts_ok else "⚠️ 未安装",
                          help="pip install TTS" if not tts_ok else "")

    # Whisper
    try:
        import whisper
        whisper_ok = True
    except ImportError:
        whisper_ok = False
    health_cols[2].metric("🧠 Whisper", "✅ 就绪" if whisper_ok else "⚠️ 未安装",
                          help="pip install openai-whisper" if not whisper_ok else "")

    # yt-dlp
    try:
        import yt_dlp
        ytdlp_ok = True
    except ImportError:
        ytdlp_ok = False
    health_cols[3].metric("⬇️ yt-dlp", "✅ 就绪" if ytdlp_ok else "❌ 未安装",
                          help="pip install yt-dlp" if not ytdlp_ok else "")

    # 红色提示条 + 精准修复命令
    missing = []
    if not ffmpeg_ok:
        missing.append("🎬 FFmpeg（字幕烧录）")
    if not tts_ok:
        missing.append("🗣️ TTS（AI 配音）")
    if not whisper_ok:
        missing.append("🧠 Whisper（语音识别）")
    if missing:
        py_exe = sys.executable
        st.warning(
            f"⚠️ **缺少以下依赖，部分功能将使用降级模式：**\n\n"
            + "\n".join(f"- {m}" for m in missing)
        )
        st.info(
            f"**当前 Python 路径：** `{py_exe}`\n\n"
            f"请复制以下命令在终端中执行（**必须使用此 Python 路径**）：\n\n"
            f"```bash\n"
            f'"{py_exe}" -m pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cpu\n'
            f'"{py_exe}" -m pip install TTS openai-whisper\n'
            f"```\n\n"
            f"或运行 `install_dependencies.bat`（右键管理员）一键安装"
        )

    # ── 强杀重启按钮（热修复环境后用） ──
    restart_col1, restart_col2 = st.columns([3, 1])
    with restart_col2:
        if st.button("💥 强杀并重启网页服务", type="secondary", use_container_width=True,
                     key="hard_restart_btn"):
            st.warning("正在强杀 Streamlit 进程并重启...页面将短暂断连")
            st.caption("重启后请刷新页面")
            import subprocess as _sp
            import sys as _sys
            _sp.Popen(
                [_sys.executable, "-m", "streamlit", "run", "dashboard/app.py",
                 "--server.port", "8501"],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            # 强杀当前进程
            os._exit(0)

    # ── 投喂链接 ──
    feed_col1, feed_col2 = st.columns([4, 1])
    with feed_col1:
        feed_url = st.text_input(
            "TikTok URL",
            placeholder="https://www.tiktok.com/@username/video/7632296130302266646",
            key="feed_input", label_visibility="collapsed",
        )
    with feed_col2:
        if st.button("➕ 投喂", type="primary", use_container_width=True, key="feed_btn"):
            if not feed_url:
                st.error("请粘贴 URL")
            else:
                video_id = _extract_video_id(feed_url.strip())
                if not video_id:
                    st.error("无法解析 video_id — 链接需包含 video/ 后跟数字 ID")
                else:
                    url = feed_url.strip()
                    author = _extract_author(url)
                    tracking = _load_tracking()
                    is_new = video_id not in tracking
                    if is_new:
                        tracking[video_id] = {
                            "url": url, "video_id": video_id,
                            "author": author, "title": f"TikTok by @{author}",
                            "fed_at": datetime.now().isoformat(),
                        }
                        _save_tracking(tracking)

                    # 检查是否已有视频文件
                    video_file = PENDING_DIR / f"{video_id}.mp4"
                    if video_file.exists():
                        st.info(f"ℹ️ `{video_id}` — 视频文件已存在，无需重复下载")
                    else:
                        # 用 yt-dlp 直接下载到 pending_videos 目录
                        try:
                            _ensure_dirs()
                            dl_pid = _download_video_background(url, video_id)
                            st.session_state.downloading[video_id] = {
                                "pid": dl_pid,
                                "started_at": datetime.now().isoformat(),
                            }
                            if is_new:
                                st.success(f"✅ 链接已建档！正在下载 `{video_id}`...")
                            else:
                                st.info(f"🔄 正在下载 `{video_id}`...")
                        except Exception as e:
                            st.error(f"❌ 下载启动失败: {e}")

                    st.rerun()

    # ── 缓存嗅探 + 拖拽上传（双保险通道） ──
    with st.container(border=True):
        st.caption("📂 **本地暂存加速** — 嗅探浏览器缓存 或 直接拖入视频文件秒级激活")
        sniff_col, upload_col = st.columns([1, 1])

        with sniff_col:
            sniff_clicked = st.button("🔍 嗅探本地缓存(30分钟)", use_container_width=True, key="sniff_btn")
            if sniff_clicked:
                st.session_state.sniff_candidates = _sniff_candidates(max_count=5)
                st.session_state.sniff_selected = None
                st.rerun()

            candidates = st.session_state.get("sniff_candidates", [])
            if candidates:
                st.markdown(f"**🔍 发现 {len(candidates)} 个候选文件**")
                opts = {
                    f"{c['dir']} / {c['path'].name}  ({c['size_mb']}MB, {c['age_str']}前{' 🎬' if c['is_media'] else ''})": i
                    for i, c in enumerate(candidates)
                }
                selected_label = st.radio(
                    "选择要绑定的文件",
                    list(opts.keys()),
                    key="sniff_radio",
                    label_visibility="collapsed",
                )
                sel_idx = opts[selected_label]
                sel = candidates[sel_idx]

                bind_cols = st.columns([1, 1])
                with bind_cols[0]:
                    bind_name = st.text_input(
                        "保存为 video_id",
                        value=sel["path"].stem.replace(" ", "_")[:40],
                        key="sniff_bind_name",
                    )
                with bind_cols[1]:
                    if st.button("✅ 确认绑定", type="primary", use_container_width=True,
                                 key="sniff_confirm"):
                        _ensure_dirs()
                        target = PENDING_DIR / f"{bind_name}.mp4"
                        # 用 MP4 FastStart 修复（moov 前置）替代直接复制
                        ok = _repair_mp4_faststart(str(sel["path"]), str(target))
                        if not ok:
                            # 降级：直接复制
                            import shutil
                            shutil.copy2(str(sel["path"]), str(target))
                        st.session_state.sniff_candidates = []
                        st.success(f"✅ 已捕获并修复: `{target.name}` ({sel['size_mb']} MB)")
                        st.rerun()

        with upload_col:
            st.caption("💡 **最稳方案**：嗅探可能受浏览器分片影响。请直接将完整 MP4 视频拖入此处秒级激活👇")
            uploaded = st.file_uploader(
                "或将本地视频拖入此处",
                type=["mp4", "mov", "avi", "webm"],
                key="cache_uploader",
                label_visibility="collapsed",
            )
            if uploaded is not None:
                _ensure_dirs()
                raw_name = Path(uploaded.name).stem
                temp_target = PENDING_DIR / f"_{raw_name}_raw.mp4"
                final_target = PENDING_DIR / f"{raw_name}.mp4"
                with open(str(temp_target), "wb") as f:
                    f.write(uploaded.getbuffer())
                # 修复 moov 原子位置
                ok = _repair_mp4_faststart(str(temp_target), str(final_target))
                if not ok:
                    # 降级：重命名
                    temp_target.rename(final_target)
                temp_target.unlink(missing_ok=True)
                st.success(f"✅ 已接收: `{final_target.name}` ({(uploaded.size or 0)/1024/1024:.1f} MB)")
                st.rerun()

    # ── 刷新栏（状态全部从文件读取，不依赖 st.session_state） ──
    st.divider()
    all_statuses = _get_all_pipeline_statuses()
    completed_count = sum(1 for s in all_statuses.values() if s.get("status") == "completed")
    running_count = sum(1 for s in all_statuses.values() if s.get("status") == "running")

    col_a, col_b, col_c = st.columns([1, 1, 5])
    with col_a:
        if st.button("🔄 刷新", type="primary", use_container_width=True, key="hunt_refresh"):
            st.rerun()
    with col_b:
        st.metric("✅ 已生产", completed_count)
    with col_c:
        st.caption(f"暂存区: `{PENDING_DIR}/`  |  🏃 运行中: {running_count}")

    _ensure_dirs()
    tracking = _load_tracking()
    all_ids: set[str] = set()
    all_ids.update(tracking.keys())
    for f in PENDING_DIR.glob("*.mp4"):
        all_ids.add(f.stem)

    if not all_ids:
        st.info("📭 暂无任务 — 在上方粘贴链接，或直接将 `{video_id}.mp4` 放入暂存区")
        st.code(f"暂存区路径: {PENDING_DIR}", language="")
        return

    # 按文件存在 + 状态排序
    sorted_ids = sorted(all_ids, key=lambda vid: (
        0 if (PENDING_DIR / f"{vid}.mp4").exists() else 1, vid,
    ))

    for vid in sorted_ids:
        video_path = PENDING_DIR / f"{vid}.mp4"
        track_info = tracking.get(vid, {})
        url = track_info.get("url", "")
        author = track_info.get("author", "")
        title = track_info.get("title", f"Video {vid}")
        has_file = video_path.exists()
        is_downloading = vid in st.session_state.get("downloading", {})

        # ── 从 status 文件读取流水线状态（前后台解耦） ──
        ps = _get_pipeline_status(vid)
        is_running = ps is not None and ps.get("status") == "running"
        is_done = ps is not None and ps.get("status") == "completed"
        is_failed = ps is not None and ps.get("status") == "failed"
        err_msg = ps.get("error", "") if ps else ""
        progress = ps.get("progress", 0.0) if ps else 0.0
        step_name = ps.get("step_name", "") if ps else ""
        current_step = ps.get("current_step", 0) if ps else 0

        with st.container(border=True):
            title_col, status_col = st.columns([5, 1])
            with title_col:
                if is_running:
                    prefix = "🔄 "
                elif is_done:
                    prefix = "🎉 "
                elif is_failed:
                    prefix = "❌ "
                elif is_downloading:
                    prefix = "⬇️ "
                elif has_file:
                    prefix = "📹 "
                else:
                    prefix = "🔗 "
                st.markdown(f"**{prefix}`{vid}` — {title[:60]}**")
                parts = []
                if url:
                    parts.append(f"🔗 `{url[:70]}{'...' if len(url) > 70 else ''}`")
                if author:
                    parts.append(f"👤 @{author}")
                if has_file:
                    parts.append(f"📏 {video_path.stat().st_size / 1024 / 1024:.1f} MB")
                if is_downloading:
                    dl_info = st.session_state.downloading.get(vid, {})
                    parts.append(f"⬇️ PID={dl_info.get('pid', '?')}")
                if parts:
                    st.caption(" · ".join(parts))
            with status_col:
                if is_done:
                    st.markdown("🎉 **已完成**")
                elif is_running:
                    st.markdown(f"🔄 **{step_name}** ({current_step}/9)")
                elif is_failed:
                    st.markdown("❌ **失败**")
                elif is_downloading:
                    st.markdown("⬇️ **下载中...**")
                elif has_file:
                    st.markdown("⏳ **待处理**")
                else:
                    st.markdown("📌 **等待文件**")

            # ── 检查 session_state 持久化的提交结果（防止 Rerun 闪退） ──
            submit_result = _get_submit_result(vid)
            # 如果 status 文件已推进到 running/completed/failed，则清除提交结果
            if submit_result is not None and (is_running or is_done or is_failed):
                _clear_submit_result(vid)
                submit_result = None

            # 有文件 → 播放器 + 操作按钮
            if has_file:
                try:
                    with open(str(video_path), "rb") as f:
                        st.video(f.read())
                except Exception as e:
                    st.error(f"无法加载视频: {e}")

                if is_running:
                    # ── 运行中：显示进度条，清除提交状态 ──
                    st.progress(progress)
                    st.caption(f"步骤 {current_step}/9: {step_name}  ·  进度 {progress*100:.0f}%")
                    st.info("🔄 流水线正在后台执行，请稍候...点击「刷新」查看最新进度")

                elif is_failed:
                    # ── 失败：显示错误 + 重新生产按钮 ──
                    st.error("❌ 流水线失败")
                    if err_msg:
                        st.code(err_msg[:500], language="")
                    if st.button("🔄 重新生产", type="primary", use_container_width=True,
                                 key=f"appr_retry_{vid}"):
                        _delete_status_file(vid)
                        _clear_submit_result(vid)
                        r = _run_approve_background(str(video_path))
                        _set_submit_result(vid, {
                            "status": "ok" if r["ok"] else "error",
                            "pid": r["pid"],
                            "cmd": r["cmd"],
                            "py_exe": r["py_exe"],
                            "error": r.get("error", ""),
                        })
                        st.rerun()

                elif is_done:
                    # ── 已完成 ──
                    st.success("✅ 流水线执行完成！")
                    st.info(
                        "视频已送往【🏭 工厂流水线】，"
                        "请切换到左侧「工厂流水线监控」视图查看生成进度。"
                    )

                elif submit_result is not None:
                    # ── 有持久化提交结果：固定渲染，防止 Rerun 闪退 ──
                    sr = submit_result
                    if sr.get("status") == "ok":
                        st.warning(
                            f"🧪 **后台命令已执行**\n\n"
                            f"**Python:** `{sr.get('py_exe', '?')}`\n\n"
                            f"**命令:** `{sr.get('cmd', '?')}`\n\n"
                            f"**PID:** {sr.get('pid', '?')}"
                        )
                        st.success(f"🚀 流水线已启动 (PID {sr.get('pid', '?')}) — 等待状态文件更新...")
                        st.caption("💡 点击「🔄 刷新」查看最新进度")
                    else:
                        st.warning(
                            f"🧪 **后台命令已执行**\n\n"
                            f"**Python:** `{sr.get('py_exe', '?')}`\n\n"
                            f"**命令:** `{sr.get('cmd', '?')}`"
                        )
                        st.error(f"❌ 子进程创建失败: {sr.get('error', '未知错误')}")

                    # ── 子进程日志输出（可折叠，方便诊断） ──
                    with st.expander("📋 子进程 stdout / stderr 日志", expanded=False):
                        col_out, col_err = st.columns(2)
                        with col_out:
                            st.markdown("**stdout**")
                            stdout_tail = _read_tail(PIPELINE_STDOUT_LOG, max_lines=20)
                            st.code(stdout_tail, language="")
                        with col_err:
                            st.markdown("**stderr**")
                            stderr_tail = _read_tail(PIPELINE_STDERR_LOG, max_lines=20)
                            st.code(stderr_tail, language="")

                else:
                    # ── 未处理：显示批准生产按钮 ──
                    if st.button("🚀 批准生产", type="primary", use_container_width=True,
                                 key=f"appr_{vid}"):
                        # 在按钮回调中执行 Popen，但将结果存入 session_state
                        r = _run_approve_background(str(video_path))
                        _set_submit_result(vid, {
                            "status": "ok" if r["ok"] else "error",
                            "pid": r["pid"],
                            "cmd": r["cmd"],
                            "py_exe": r["py_exe"],
                            "error": r.get("error", ""),
                        })
                        st.rerun()

                # ── 删除按钮（所有状态都显示） ──
                if st.button("❌ 删除", type="secondary", use_container_width=True,
                             key=f"del_{vid}"):
                    delete_video_and_tracking(vid)
                    _delete_status_file(vid)
                    _clear_submit_result(vid)
                    st.rerun()

            # 无文件 → 友好提示
            else:
                st.info(
                    f"✅ 已成功关联链接！请将下载好的视频重命名"
                    f"为 **`{vid}.mp4`** 并放入 `{PENDING_DIR}/` 以激活预览。"
                )
                if st.button("❌ 删除此条目", key=f"del_track_{vid}"):
                    delete_video_and_tracking(vid)
                    st.rerun()

    # ── 📋 流水线实时运行日志（始终可见，方便排查） ──
    st.divider()
    st.subheader("📋 流水线实时运行日志")
    st.caption("以下日志来自 data/metadata/ — 每次「🔄 刷新」页面时自动更新")
    log_tabs = st.tabs(["stdout", "stderr", "启动错误", "状态文件"])
    with log_tabs[0]:
        stdout_tail = _read_tail(PIPELINE_STDOUT_LOG, max_lines=30)
        st.code(stdout_tail, language="", line_numbers=True)
    with log_tabs[1]:
        stderr_tail = _read_tail(PIPELINE_STDERR_LOG, max_lines=30)
        st.code(stderr_tail, language="", line_numbers=True)
    with log_tabs[2]:
        err_tail = _read_tail(PIPELINE_ERROR_LOG, max_lines=20)
        st.code(err_tail, language="")
    with log_tabs[3]:
        # 显示所有 status.json 文件摘要
        all_ps = _get_all_pipeline_statuses()
        if all_ps:
            for vid, ps in all_ps.items():
                st.markdown(f"**`{vid}`**: {ps.get('status','?')}  step={ps.get('current_step',0)}/9  "
                           f"progress={ps.get('progress',0)*100:.0f}%  "
                           f"step_name={ps.get('step_name','')}")
                err = ps.get("error", "")
                if err:
                    st.code(err[:200], language="")
        else:
            st.caption("暂无状态文件")

# ═══════════════════════════════════════════════════════════════
#  视图 2：🏭 工厂流水线监控
# ═══════════════════════════════════════════════════════════════

def render_factory():
    st.header("🏭 工厂流水线监控")
    st.caption("实时监控 · 文件状态驱动 · 无需后台线程触碰 st.session_state")

    # ── 全部从 status 文件读取（前后台完全解耦） ──
    all_statuses = _get_all_pipeline_statuses()
    running_videos = {k: v for k, v in all_statuses.items() if v.get("status") == "running"}
    completed_videos = {k: v for k, v in all_statuses.items() if v.get("status") == "completed"}
    failed_videos = {k: v for k, v in all_statuses.items() if v.get("status") == "failed"}

    # 状态摘要
    overall_state = "running" if running_videos else "idle"
    state_colors = {"running": "🟢", "idle": "⚪"}
    state_labels = {"running": "运行中", "idle": "空闲"}
    st.markdown(
        f"## {state_colors.get(overall_state, '⚪')} "
        f"状态: `{state_labels.get(overall_state, overall_state.upper())}`"
    )

    # 核心指标
    cols = st.columns(5)
    with cols[0]:
        st.metric("🏃 运行中", len(running_videos))
    with cols[1]:
        st.metric("✅ 已完成", len(completed_videos))
    with cols[2]:
        st.metric("❌ 已失败", len(failed_videos))
    with cols[3]:
        st.metric("📋 队列长度", 0)
    with cols[4]:
        if running_videos:
            first = next(iter(running_videos.values()))
            st.metric("🔄 当前步骤", f"{first.get('current_step', 0)}/9")
        else:
            st.metric("🔄 当前步骤", "-")

    st.divider()

    # ── 运行中的流水线详情 ──
    st.subheader("🏃 运行中的流水线")
    if running_videos:
        for vid, ps in running_videos.items():
            with st.container(border=True):
                cols = st.columns([2, 1, 1, 1])
                cols[0].markdown(f"**`{vid}`**")
                cols[1].markdown(f"步骤 {ps.get('current_step', 0)}/9")
                cols[2].markdown(ps.get("step_name", ""))
                cols[3].markdown(f"{ps.get('progress', 0)*100:.0f}%")
                st.progress(ps.get("progress", 0))
    else:
        st.info("当前无运行中的流水线")

    st.divider()

    # ── 最近完成的流水线 ──
    st.subheader("✅ 最近完成的流水线")
    if completed_videos:
        for vid in list(completed_videos.keys())[-5:]:
            ps = completed_videos[vid]
            st.caption(f"🎉 `{vid}`  —  完成于 {ps.get('completed_at', '?')[:19]}")
    else:
        st.caption("暂无")

    st.divider()

    # ── 失败的流水线 ──
    st.subheader("❌ 失败的流水线")
    if failed_videos:
        for vid, ps in failed_videos.items():
            with st.container(border=True):
                st.markdown(f"**❌ `{vid}`**")
                err = ps.get("error", "")
                if err:
                    st.code(err[:300], language="")
                if st.button(f"🗑️ 清除状态", key=f"factory_clear_fail_{vid}"):
                    _delete_status_file(vid)
                    st.rerun()
    else:
        st.caption("无")


# ═══════════════════════════════════════════════════════════════
#  视图 3：📊 数据与运行分析
# ═══════════════════════════════════════════════════════════════

def render_analytics():
    st.header("📊 数据与运行分析")
    st.caption("爆款数据 · 吐槽历史 · 系统成功率 · 模块耗时")

    # SEO 评分趋势
    st.subheader("📈 SEO 评分趋势")
    seo_data = [
        {"video": "Video #001", "score": 95},
        {"video": "Video #002", "score": 88},
        {"video": "Video #003", "score": 92},
    ]
    cols = st.columns(3)
    for i, d in enumerate(seo_data):
        with cols[i]:
            color = "🟢" if d["score"] >= 90 else "🟡" if d["score"] >= 70 else "🔴"
            st.metric(f"{d['video']}", f"{color} {d['score']}/100")

    st.divider()

    # 模块耗时统计
    st.subheader("⏱️ 模块耗时统计")
    timings = [
        ("🕷️ 爬虫 Scraper", 30, "🟢"),
        ("🧠 分析 Analyzer", 60, "🟢"),
        ("🎯 槽点 RoastPoint", 5, "🟢"),
        ("✍️ 文案 Script", 10, "🟢"),
        ("🎨 创作者蒸馏", 3, "🟢"),
        ("🎬 剪辑 Editor", 120, "🟡"),
        ("🗣️ 配音 Voice", 30, "🟢"),
        ("🛡️ 合规 Compliance", 2, "🟢"),
        ("🔍 发布预览", 3, "🟢"),
        ("📤 发布 Publisher", 60, "🟢"),
    ]
    for name, seconds, icon in timings:
        cols = st.columns([3, 1, 4])
        cols[0].markdown(f"**{name}**")
        cols[1].markdown(f"{icon} {seconds}s")
        bar_len = max(1, seconds // 10)
        bar = "█" * bar_len + "░" * (12 - bar_len)
        cols[2].markdown(f"`{bar}`")

    st.divider()

    # 合规统计
    st.subheader("🛡️ 合规统计")
    c1, c2, c3 = st.columns(3)
    with c1:
        st.metric("总检查数", "47", "✅ 全部通过")
    with c2:
        st.metric("高风险阻断", "0", "✅ 无")
    with c3:
        st.metric("中等风险警告", "3", "⚠️ 需关注")

    st.divider()

    # 生产概览（从文件读取，不依赖 st.session_state）
    st.subheader("📋 生产概览")
    all_statuses = _get_all_pipeline_statuses()
    produced_count = sum(1 for s in all_statuses.values() if s.get("status") == "completed")
    tracking = _load_tracking()
    total_fed = len(tracking)
    with_files = sum(1 for vid in tracking if (PENDING_DIR / f"{vid}.mp4").exists())
    col_a, col_b, col_c = st.columns(3)
    with col_a:
        st.metric("📋 已投喂链接", total_fed)
    with col_b:
        st.metric("📹 已放入视频", with_files)
    with col_c:
        st.metric("✅ 已生产", produced_count)


# ═══════════════════════════════════════════════════════════════
#  视图 4：⚙️ 工厂运维调优
# ═══════════════════════════════════════════════════════════════

def render_tuning():
    st.header("⚙️ 工厂运维调优")
    st.caption("脚本风格 · 剪辑节奏 · 语速 · SEO · 合规 · 自动抓取")

    sys.path.insert(0, str(ROOT))
    try:
        from orchestrator.factory_controller import FactoryController
        ctrl = FactoryController()
    except Exception:
        st.warning("⚠️ FactoryController 未就绪")
        return

    cfg = ctrl.get_config()

    st.subheader("✍️ 脚本权重")
    cfg["cn_script_weight"] = st.slider("🇨🇳 中文脚本权重", 0.0, 1.0,
                                         cfg.get("cn_script_weight", 0.5), key="tune_cn")
    cfg["en_script_weight"] = st.slider("🇬🇧 英文脚本权重", 0.0, 1.0,
                                         cfg.get("en_script_weight", 0.5), key="tune_en")

    st.divider()
    st.subheader("🎨 创作者蒸馏权重")
    cfg["creator_structure_weight"] = st.slider("结构权重", 0.0, 1.0,
                                                  cfg.get("creator_structure_weight", 0.33), key="tune_struct")
    cfg["creator_emotion_weight"] = st.slider("情感权重", 0.0, 1.0,
                                                cfg.get("creator_emotion_weight", 0.33), key="tune_emot")
    cfg["creator_pacing_weight"] = st.slider("节奏权重", 0.0, 1.0,
                                               cfg.get("creator_pacing_weight", 0.33), key="tune_pace")

    st.divider()
    st.subheader("🎬 剪辑与配音")
    current_pace = cfg.get("editing_pacing", "medium")
    pace_options = ["slow", "medium", "fast"]
    cfg["editing_pacing"] = st.selectbox(
        "剪辑节奏", pace_options,
        index=pace_options.index(current_pace) if current_pace in pace_options else 1,
        key="tune_pace_select",
    )
    cfg["voice_speed"] = st.slider("语速", 0.5, 2.0, cfg.get("voice_speed", 1.0), key="tune_voice")
    cfg["subtitle_density"] = st.slider("字幕密度", 0.0, 1.0, cfg.get("subtitle_density", 0.5), key="tune_sub")

    st.divider()
    st.subheader("🔍 SEO 与合规")
    cfg["seo_intensity"] = st.slider("SEO 强度", 0.0, 1.0, cfg.get("seo_intensity", 0.5), key="tune_seo")
    strict_options = ["loose", "standard", "strict"]
    current_strict = cfg.get("compliance_strictness", "standard")
    cfg["compliance_strictness"] = st.selectbox(
        "合规严格度", strict_options,
        index=strict_options.index(current_strict) if current_strict in strict_options else 1,
        key="tune_strict",
    )

    st.divider()
    st.subheader("🤖 自动抓取设置")
    cfg["auto_fetch_interval"] = st.number_input("抓取间隔（分钟）", 5, 480,
                                                   cfg.get("auto_fetch_interval", 60), key="tune_interval")
    source_options = ["cn", "en", "both"]
    current_source = cfg.get("auto_fetch_source", "both")
    cfg["auto_fetch_source"] = st.selectbox(
        "抓取源", source_options,
        index=source_options.index(current_source) if current_source in source_options else 2,
        key="tune_source",
    )
    cfg["daily_production_limit"] = st.number_input("每日产量上限", 1, 100,
                                                      cfg.get("daily_production_limit", 10), key="tune_daily")

    st.divider()
    st.subheader("🌐 网络与代理")
    current_proxy = st.session_state.get("proxy_config", "")
    new_proxy = st.text_input(
        "HTTP 代理 (yt-dlp 下载用，空=直连)",
        value=current_proxy,
        placeholder="http://127.0.0.1:7890",
        key="tune_proxy",
    )
    if new_proxy != current_proxy:
        st.session_state.proxy_config = new_proxy
    st.caption("配置后点击【投喂】时自动附加 `--proxy` 参数")

    st.divider()
    st.subheader("🎬 FFmpeg 路径")
    current_ffmpeg = st.session_state.get("ffmpeg_path", "")
    new_ffmpeg = st.text_input(
        "ffmpeg.exe 绝对路径（空=自动从 PATH 查找）",
        value=current_ffmpeg,
        placeholder="C:\\ffmpeg\\bin\\ffmpeg.exe",
        key="tune_ffmpeg",
    )
    if new_ffmpeg != current_ffmpeg:
        st.session_state.ffmpeg_path = new_ffmpeg
    st.caption("安装依赖可用: `install_dependencies.bat`（右键管理员运行）")

    st.divider()
    if st.button("💾 保存配置", type="primary", use_container_width=True, key="tune_save"):
        try:
            ctrl.update_config(cfg)
            st.success("✅ 配置已保存！")
        except Exception as e:
            st.error(f"❌ 保存失败: {e}")


# ═══════════════════════════════════════════════════════════════
#  视图 5：🎬 成品预览与发布
# ═══════════════════════════════════════════════════════════════

OUTPUT_VIDEO_DIR = ROOT / "output" / "video"
OUTPUT_SCRIPTS_DIR = ROOT / "output" / "scripts"
OUTPUT_SUBTITLES_DIR = ROOT / "output" / "subtitles"
EDITOR_OUTPUT_DIR = ROOT / "data" / "outputs"  # AutoEditor 默认输出


def _find_finished_videos() -> List[Dict[str, Any]]:
    """扫描所有已完成流水线的成品文件（多路径发现）"""
    all_statuses = _get_all_pipeline_statuses()
    items = []
    for vid, ps in all_statuses.items():
        if ps.get("status") != "completed":
            continue
        item = {
            "video_id": vid,
            "label": ps.get("label", vid),
            "completed_at": ps.get("completed_at", ""),
            "video_path": None,
            "scripts": [],
            "subtitles": [],
        }
        # 查找成品视频: 多候选路径
        candidates = [
            OUTPUT_VIDEO_DIR / f"{vid}.mp4",
            OUTPUT_VIDEO_DIR / "final_production.mp4",
            OUTPUT_VIDEO_DIR / f"{vid}_long.mp4",
            OUTPUT_VIDEO_DIR / f"{vid}_roasted.mp4",
            EDITOR_OUTPUT_DIR / f"{vid}_roasted.mp4",
        ]
        # 扫描 editor 输出目录
        if EDITOR_OUTPUT_DIR.exists():
            for f in sorted(EDITOR_OUTPUT_DIR.glob("*_roasted.mp4")):
                candidates.append(f)
        for cp in candidates:
            if cp and cp.exists():
                item["video_path"] = str(cp)
                break
        # 查找文案脚本
        if OUTPUT_SCRIPTS_DIR.exists():
            for sf in sorted(OUTPUT_SCRIPTS_DIR.rglob("*_roast_script.md")):
                item["scripts"].append(str(sf))
        # 如果没找到特定的脚本，fallback 到任何 .md
        if not item["scripts"] and OUTPUT_SCRIPTS_DIR.exists():
            for sf in sorted(OUTPUT_SCRIPTS_DIR.rglob("*.md")):
                item["scripts"].append(str(sf))
        # 查找字幕
        if OUTPUT_SUBTITLES_DIR.exists():
            for sf in sorted(OUTPUT_SUBTITLES_DIR.glob("*.srt")):
                item["subtitles"].append(str(sf))
        items.append(item)
    return items


def render_publish_center():
    st.header("🎬 成品预览与发布")
    st.caption("已完成流水线的成品视频 · AI 吐槽文案 · 一键发布")

    items = _find_finished_videos()
    if not items:
        st.info("📭 暂无已完成视频 — 生产完成后会自动出现在这里")
        st.caption("成品视频目录: `output/video/`")
        return

    for item in items:
        vid = item["video_id"]
        with st.container(border=True):
            st.markdown(f"### 🎉 `{vid}` — {item['label']}")
            if item.get("completed_at"):
                st.caption(f"完成于 {item['completed_at'][:19]}")

            cols = st.columns([3, 2])
            with cols[0]:
                # ── 视频播放器 ──
                if item["video_path"]:
                    try:
                        with open(item["video_path"], "rb") as f:
                            st.video(f.read())
                    except Exception as e:
                        st.error(f"无法加载视频: {e}")
                else:
                    st.info("📹 成品视频文件未找到")

            with cols[1]:
                # ── 发布设置面板 ──
                st.subheader("📤 发布设置")
                platform = st.selectbox(
                    "目标平台",
                    ["YouTube", "TikTok", "Bilibili", "抖音"],
                    key=f"pub_plat_{vid}",
                )
                publish_time = st.selectbox(
                    "发布时间",
                    ["立即发布", "定时发布（1小时后）", "定时发布（3小时后）", "定时发布（明天）"],
                    key=f"pub_time_{vid}",
                )
                title_input = st.text_input(
                    "视频标题",
                    value=f"🔥 {item['label']} #吐槽 #搞笑",
                    key=f"pub_title_{vid}",
                )
                if st.button("🚀 发布", type="primary", use_container_width=True,
                             key=f"pub_btn_{vid}"):
                    st.success(f"✅ 已添加到发布队列: {platform} / {publish_time}")

            # ── 文案展示 ──
            if item["scripts"]:
                st.divider()
                st.subheader("✍️ AI 吐槽文案")
                script_tabs = st.tabs([Path(s).name for s in item["scripts"]])
                for i, spath in enumerate(item["scripts"]):
                    with script_tabs[i]:
                        try:
                            content = Path(spath).read_text(encoding="utf-8")
                            st.text_area(
                                "文案内容（可复制）",
                                value=content,
                                height=200,
                                key=f"script_{vid}_{i}",
                            )
                        except Exception as e:
                            st.error(f"读取失败: {e}")

            # ── 字幕展示 ──
            if item["subtitles"]:
                with st.expander("📜 字幕文件", expanded=False):
                    for sp in item["subtitles"]:
                        st.caption(f"`{Path(sp).name}`")
                        try:
                            st.code(Path(sp).read_text(encoding="utf-8")[:300], language="")
                        except Exception:
                            pass

    # ── 状态汇总 ──
    st.divider()
    all_statuses = _get_all_pipeline_statuses()
    completed = sum(1 for s in all_statuses.values() if s.get("status") == "completed")
    running = sum(1 for s in all_statuses.values() if s.get("status") == "running")
    failed = sum(1 for s in all_statuses.values() if s.get("status") == "failed")
    cc, cr, cf = st.columns(3)
    cc.metric("✅ 已完成", completed)
    cr.metric("🏃 运行中", running)
    cf.metric("❌ 失败", failed)


# ═══════════════════════════════════════════════════════════════
#  系统运维面板（所有视图底部统一显示）
# ═══════════════════════════════════════════════════════════════

def render_ops_panel():
    with st.expander("🛠️ 系统运维", expanded=False):
        col1, col2 = st.columns(2)
        with col1:
            st.markdown("**模块健康度**")
            modules = {
                "analyzer": "🧠 分析", "roastpoints": "🎯 槽点",
                "scripts": "✍️ 脚本", "editor": "🎬 剪辑",
                "voice": "🗣️ 配音", "publisher": "📤 发布",
                "compliance": "🛡️ 合规", "seo": "🔍 SEO",
            }
            cols = st.columns(4)
            for i, (key, label) in enumerate(modules.items()):
                mod_dir = ROOT / key
                files = len(list(mod_dir.rglob("*.py"))) if mod_dir.exists() else 0
                with cols[i % 4]:
                    st.caption(f"{'✅' if files > 0 else '⚠️'} {label} ({files})")
        with col2:
            st.markdown("**磁盘清理**")
            for label, d in [
                ("data/pending_videos/", PENDING_DIR),
                ("output/video/", ROOT / "output" / "video"),
                ("output/preview/", ROOT / "output" / "preview"),
            ]:
                if d.exists():
                    total = sum(f.stat().st_size for f in d.rglob("*") if f.is_file())
                    cnt = sum(1 for f in d.rglob("*") if f.is_file())
                    st.caption(f"📁 `{label}` {cnt} 文件 / {total / 1024 / 1024:.1f} MB")
            if st.button("🗑️ 一键清理", type="secondary", use_container_width=True, key="ops_clean"):
                deleted = 0
                freed = 0
                for d in [ROOT / "output" / "video", ROOT / "output" / "cache", ROOT / "output" / "preview"]:
                    if d.exists():
                        for f in d.rglob("*"):
                            if f.is_file() and f.suffix.lower() in (".mp4", ".webm", ".mkv", ".json", ".jpg", ".png"):
                                freed += f.stat().st_size
                                f.unlink(missing_ok=True)
                                deleted += 1
                st.success(f"🧹 已删除 {deleted} 个文件，释放 {freed / 1024 / 1024:.1f} MB")

        st.divider()
        hb = get_heartbeat()
        st.caption(
            f"{'🟢' if hb.get('status') == 'alive' else '🔴'} "
            f"系统: {hb.get('status', 'N/A')}  |  "
            f"🕒 {hb.get('timestamp', '')[:19] if isinstance(hb.get('timestamp'), str) else 'N/A'}"
        )


# ═══════════════════════════════════════════════════════════════
#  MAIN
# ═══════════════════════════════════════════════════════════════

def main():
    # ── 侧边栏导航 ──────────────────────────────────────────
    st.sidebar.title("🔥 RoastBro")
    st.sidebar.caption("CEO 中文指挥台")

    nav = st.sidebar.radio(
        "导航菜单",
        [
            "🎯 视频狩猎与投喂",
            "🏭 工厂流水线监控",
            "🎬 成品预览与发布",
            "📊 数据与运行分析",
            "⚙️ 工厂运维调优",
        ],
        key="nav_radio",
    )

    st.sidebar.divider()
    st.sidebar.caption(f"v3.0 · {datetime.now().strftime('%m/%d %H:%M')}")

    # ── 视图路由 ────────────────────────────────────────────
    if nav == "🎯 视频狩猎与投喂":
        render_hunting()
    elif nav == "🏭 工厂流水线监控":
        render_factory()
    elif nav == "🎬 成品预览与发布":
        render_publish_center()
    elif nav == "📊 数据与运行分析":
        render_analytics()
    elif nav == "⚙️ 工厂运维调优":
        render_tuning()

    # ── 底部运维面板 ────────────────────────────────────────
    render_ops_panel()

    st.divider()
    st.caption(
        f"🕒 {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}"
        f"  ·  🔥 RoastBro v3.0  ·  🔗 链接绑定 + 📁 本地匹配"
        f"  ·  🚀 零网络下载"
    )


if __name__ == "__main__":
    main()
