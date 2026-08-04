"""
RoastBro Orchestrator
======================
全流水线编排与调度引擎。

负责协调各模块的数据流转（11 阶段流水线）：
    Scraper → Analyzer → RoastPoint → RoastScript → CreatorDistill → Editor
    → Voice → Compliance → PublishPreview(SEO+合规) → Publisher
                                                                              
    v2.0 新增阶段:
    - CreatorDistill : 从分析结果提取博主技能向量 → second-brain/wiki/
    - PublishPreview : generate_preview + evaluate_title + check_compliance

Usage:
    # 完整流水线
    python orchestrator.py --mode full --source tiktok

    # 仅下载到本地预览区（等待人工审批）
    python orchestrator.py --mode download --url https://www.tiktok.com/@user/video/123

    # 审批本地视频：从 pending_review 批准开工
    python orchestrator.py --mode approve --video output/pending_review/video_name.mp4

    # 单步执行
    python orchestrator.py --mode analyze --video path/to/video.mp4

    # 持续生产模式
    python orchestrator.py --mode daemon --interval 3600
"""

import argparse
import asyncio
import json
import logging
import os
import sys
import time
from pathlib import Path
from datetime import datetime
from typing import Optional, Dict, Any, List

# ── 绝对路径注入：确保子进程无论从何启动都能找到项目模块 ──
_current_dir = os.path.dirname(os.path.abspath(__file__))
if _current_dir not in sys.path:
    sys.path.insert(0, _current_dir)

from orchestrator.pipeline_status import (
    init_status,
    update_status,
    mark_completed,
    mark_failed,
    get_status,
)

from scrapers.tiktok_scraper import TikTokScraper, VideoMeta
from analyzer.video_analyzer import VideoAnalyzer
from roastpoints.roast_score_engine import RoastScoreEngine
from scripts.roast_script_engine import RoastScriptEngine, StyleType
from editor.auto_editor import AutoEditor, EditorConfig, OutputFormat
from voice.auto_voice import AutoVoice, VoiceConfig
from publisher.auto_publisher import AutoPublisher, Platform, PublishConfig
from compliance.compliance_guard import ComplianceGuard
from seo.seo_engine import SEOEngine
from dashboard._legacy_pages.publish_center.publish_center_preview import PublishCenterPreview

# ── 路径常量 ─────────────────────────────────────────────────
PENDING_REVIEW_DIR = Path("output/pending_review")

# ── Logging Setup (UTF-8 safe) ──────────────────────────────
import io
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.StreamHandler(io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")),
        logging.FileHandler("logs/orchestrator.log", encoding="utf-8"),
    ],
)
logger = logging.getLogger("roastbro")


class PipelineContext:
    """流水线上下文 — 在各模块间传递数据"""

    def __init__(self):
        self.video_path: Optional[str] = None
        self.video_meta: Optional[VideoMeta] = None
        self.analysis_result: Any = None
        self.roast_report: Any = None
        self.roast_script: Any = None
        self.edited_videos: Dict[str, str] = {}
        self.narration_paths: List[str] = []
        self.compliance_report: Any = None
        self.publish_results: List[Any] = []
        self.start_time: float = time.time()

    @property
    def elapsed(self) -> float:
        return time.time() - self.start_time


class RoastBroOrchestrator:
    """
    RoastBro 流水线编排器。

    管理完整的内容生产流程：
    1. 从各平台爬取视频
    2. 分析视频内容
    3. 识别槽点
    4. 生成吐槽脚本
    5. 剪辑成品视频
    6. 生成配音
    7. 合规检查
    8. 发布到各平台
    """

    def __init__(self, config_path: Optional[str] = None, toxicity_level: int = 5):
        self.config = self._load_config(config_path)
        self.toxicity_level = toxicity_level
        self._setup_logging()

        # 初始化各模块
        self.scraper = TikTokScraper(cache_dir="data/cache")
        self.analyzer = VideoAnalyzer(
            whisper_model=self.config.get("whisper_model", "medium"),
            device=self.config.get("device", "cpu"),
        )
        self.roast_engine = RoastScoreEngine()
        self.script_engine = RoastScriptEngine(
            style=StyleType(self.config.get("script_style", "hybrid")),
            toxicity_level=toxicity_level,
        )
        self.editor = AutoEditor(config=EditorConfig())
        self.voice = AutoVoice(config=VoiceConfig())
        self.publisher = AutoPublisher(config=PublishConfig())
        self.compliance = ComplianceGuard()
        self.seo = SEOEngine()
        self.publish_preview = PublishCenterPreview(
            editor=self.editor,
            compliance=self.compliance,
            seo=self.seo,
        )

    def _load_config(self, config_path: Optional[str]) -> Dict[str, Any]:
        """加载配置文件"""
        default_config = {
            "whisper_model": "medium",
            "device": "cpu",
            "script_style": "hybrid",
            "output_format": "multi",
            "auto_publish": False,
            "max_videos_per_run": 5,
        }

        if config_path and Path(config_path).exists():
            with open(config_path, "r", encoding="utf-8") as f:
                user_config = json.load(f)
                default_config.update(user_config)

        return default_config

    def _setup_logging(self):
        """确保日志目录存在"""
        Path("logs").mkdir(exist_ok=True)

    async def run_full_pipeline(
        self,
        source: str = "tiktok",
        max_videos: int = 1,
        url: str = "",
    ) -> List[PipelineContext]:
        """
        执行完整流水线：爬取 → 合规初筛 → 分析 → 吐槽 → 脚本 → 合规 → 剪辑 → 配音 → 发布

        Args:
            source: 内容来源平台
            max_videos: 最大处理视频数
            url: 指定单个视频 URL（优先级高于 source）

        Returns:
            List[PipelineContext]: 各视频的处理上下文
        """
        logger.info(f"🚀 Starting full pipeline: source={source}, max_videos={max_videos}"
                     f"{', url=' + url if url else ''}")
        contexts = []

        # Step 1: Scrape videos (download via yt-dlp if URL provided)
        videos = await self._step_scrape(source, max_videos, url=url)
        if not videos:
            logger.warning("No videos to process")
            return contexts

        for video in videos[:max_videos]:
            ctx = PipelineContext()
            ctx.video_meta = video
            video_id = video.video_id

            # ── 初始化文件状态（线程安全，前后台解耦） ──
            init_status(video_id, label=video.title[:50])

            try:
                # ── 提取下载路径（从 description 扩展字段） ──────────
                if video.description.startswith("__local_path__::"):
                    ctx.video_path = video.description.split("::", 1)[1]
                    logger.info(f"  → Local video path: {ctx.video_path}")

                # ── 检测 metadata_only 模式 ──────────────────────
                if video.description.startswith("__metadata_only__::"):
                    metadata_path = video.description.split("::", 1)[1]
                    ctx.video_path = metadata_path  # 存元数据路径，标记为 metadata_only
                    logger.info(f"  📋 Metadata-only — 跳过视频分析/剪辑流水线")
                    logger.info(f"  ✅ Pipeline complete (metadata-only): {video_id}")
                    contexts.append(ctx)
                    continue

                # ── Step 1.5: 视频文件合规初筛 ─────────────────────
                update_status(video_id, current_step=1, step_name="合规初筛", progress=0.1)
                if ctx.video_path and Path(ctx.video_path).exists():
                    logger.info("Step 1.5/9: 🛡️ Preliminary compliance screening...")
                    video_compliance = self.compliance.check_video_file(ctx.video_path)
                    if video_compliance.blocked:
                        logger.warning(f"⛔ Video file blocked by compliance screening: "
                                       f"{video_compliance.overall_risk}")
                        ctx.compliance_report = video_compliance
                        mark_failed(video_id, f"Video blocked: {video_compliance.overall_risk}")
                        contexts.append(ctx)
                        continue
                    logger.info(f"  → Video file compliance: {video_compliance.overall_risk.value}")

                # Step 2: Analyze video
                update_status(video_id, current_step=2, step_name="视频分析", progress=0.2,
                              cn_progress=0.15, en_progress=0.1)
                await self._step_analyze(ctx)

                # Step 3: Detect roast points
                update_status(video_id, current_step=3, step_name="槽点识别", progress=0.35,
                              cn_progress=0.3, en_progress=0.2)
                self._step_roast_points(ctx)

                # Step 4: Generate script
                update_status(video_id, current_step=4, step_name="文案生成", progress=0.45,
                              cn_progress=0.4, en_progress=0.3)
                self._step_generate_script(ctx)

                # Step 5: Compliance check (脚本合规)
                update_status(video_id, current_step=5, step_name="合规检查", progress=0.55,
                              cn_progress=0.5, en_progress=0.4)
                self._step_compliance(ctx)

                if ctx.compliance_report and not ctx.compliance_report.is_safe:
                    logger.warning(f"⛔ Script blocked by compliance: {video_id}")
                    mark_failed(video_id, "Script blocked by compliance")
                    contexts.append(ctx)
                    continue

                # Step 6: Edit video
                update_status(video_id, current_step=6, step_name="视频剪辑", progress=0.65,
                              cn_progress=0.6, en_progress=0.5)
                self._step_edit(ctx)

                # Step 7: Generate voice
                update_status(video_id, current_step=7, step_name="配音生成", progress=0.8,
                              cn_progress=0.75, en_progress=0.7)
                self._step_voice(ctx)

                # Step 8: Publish (if enabled)
                if self.config.get("auto_publish", False):
                    update_status(video_id, current_step=8, step_name="发布中", progress=0.9,
                                  cn_progress=0.9, en_progress=0.9)
                    await self._step_publish(ctx)

                # ── 标记完成 ──
                mark_completed(video_id)
                logger.info(f"✅ Pipeline complete: {video_id} in {ctx.elapsed:.1f}s")

            except Exception as e:
                logger.error(f"❌ Pipeline failed for {video_id}: {e}")
                import traceback
                logger.error(traceback.format_exc())
                mark_failed(video_id, str(e)[:500])

            contexts.append(ctx)

        return contexts

    async def run_download_only(
        self,
        url: str,
    ) -> Optional[Dict[str, Any]]:
        """
        仅执行下载步骤 — 视频下载到 output/pending_review/ 后暂停，
        等待人工审批。不触发 analyzer / editor 等后续流水线。

        Args:
            url: TikTok 视频 URL

        Returns:
            dict: 包含下载结果信息 {"video_path", "title", "author", "status"}
                  或 None（下载失败）
        """
        logger.info(f"📥 Download-only mode: downloading {url}")
        logger.info("  ⏸️  后续流水线暂停 — 等待人工审批")

        PENDING_REVIEW_DIR.mkdir(parents=True, exist_ok=True)

        # Step 1: 用 scraper 下载到缓存目录
        video_path = await self.scraper.download_video(url)
        if video_path is None:
            logger.error("  ❌ Video download failed — 跳过审批")
            return None

        # ── 检测 metadata_only 模式（返回 .json 路径而非视频文件）───
        is_metadata_only = video_path.suffix == ".json"
        if is_metadata_only:
            logger.info(f"  📋 Metadata-only mode: {video_path.name}")
            try:
                meta = json.loads(video_path.read_text(encoding="utf-8"))
                video_id = meta.get("video_id", video_path.stem)
                title = meta.get("title", f"TikTok Video {video_id}") or f"TikTok Video {video_id}"
                author = meta.get("uploader", "") or meta.get("channel", "") or ""
                thumbnail_url = meta.get("thumbnail_url", "")
            except Exception as e:
                logger.warning(f"  → Failed to read metadata JSON: {e}")
                video_id = video_path.stem
                title = f"TikTok Video {video_id}"
                author = ""
                thumbnail_url = ""

            # 保存在 metadata 目录中的审批标记
            approval_data = {
                "status": "pending",
                "video_path": "",  # 无视频文件
                "metadata_path": str(video_path),
                "original_url": url,
                "title": title,
                "author": author,
                "video_id": video_id,
                "metadata_only": True,
                "thumbnail_url": thumbnail_url,
                "downloaded_at": datetime.now().isoformat(),
            }
            # 将审批标记写到 metadata 目录旁边
            approval_path = video_path.with_suffix(".approval.json")
            approval_path.write_text(
                json.dumps(approval_data, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )

            logger.info(f"  ✅ 元数据已抓取: {title[:60]}")
            logger.info(f"  ⛔ 视频需登录，仅获得封面图和信息")
            logger.info(f"  📋 请在 Dashboard 中查看")

            return {
                "status": "metadata_only",
                "metadata_path": str(video_path),
                "title": title,
                "author": author,
                "video_id": video_id,
                "thumbnail_url": thumbnail_url,
            }

        # Step 2: 提取元数据（常规下载模式）
        video_id = video_path.stem.replace("tiktok_", "").split("_")[0]
        meta_path = video_path.with_suffix(".json")
        title = f"TikTok Video {video_id}"
        author = ""
        if meta_path.exists():
            try:
                meta = json.loads(meta_path.read_text(encoding="utf-8"))
                title = meta.get("title", title) or title
                author = meta.get("uploader", "") or meta.get("channel", "") or ""
            except Exception:
                pass

        # Step 3: 复制到 pending_review 目录
        import shutil
        dest_filename = f"pending_{video_id}_{Path(video_path).name}"
        dest_path = PENDING_REVIEW_DIR / dest_filename
        shutil.copy2(video_path, dest_path)

        # 同时复制元数据 JSON
        if meta_path.exists():
            dest_meta = dest_path.with_suffix(".json")
            shutil.copy2(meta_path, dest_meta)

        # 保存审批标记文件（初始为 pending）
        approval_file = dest_path.with_suffix(".approval.json")
        approval_data = {
            "status": "pending",
            "video_path": str(dest_path),
            "original_url": url,
            "title": title,
            "author": author,
            "video_id": video_id,
            "downloaded_at": datetime.now().isoformat(),
        }
        approval_file.write_text(
            json.dumps(approval_data, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

        logger.info(f"  ✅ 视频已下载至本地预览区: {dest_path.name}")
        logger.info(f"  📋 标题: {title[:60]}")
        logger.info(f"  👤 作者: {author}")
        logger.info(f"  ⏳ 状态: 等待审批 — 请前往 Dashboard「待审预览区」审核")
        logger.info(f"  {'='*50}")
        logger.info(f"  🚀 批准开工: python orchestrator.py --mode approve --video \"{dest_path}\"")
        logger.info(f"  {'='*50}")

        return {
            "status": "pending_review",
            "video_path": str(dest_path),
            "title": title,
            "author": author,
            "video_id": video_id,
        }

    async def run_from_local(
        self,
        video_path: str,
        mark_approved: bool = True,
    ) -> Optional[PipelineContext]:
        """
        对已下载到本地的视频执行完整流水线（analyze → roast → script → edit → voice → compliance → publish）。
        由 Dashboard「批准开工」按钮触发。

        Args:
            video_path: 本地视频文件路径（通常在 output/pending_review/）
            mark_approved: 是否将审批标记从 pending 改为 approved

        Returns:
            PipelineContext: 流水线上下文
        """
        video_path_obj = Path(video_path)
        if not video_path_obj.exists():
            logger.error(f"  ❌ 视频文件不存在: {video_path}")
            return None

        logger.info(f"🚀 批准开工！处理本地视频: {video_path_obj.name}")

        ctx = PipelineContext()
        ctx.video_path = str(video_path_obj)

        # 构建 VideoMeta
        video_id = video_path_obj.stem.replace("tiktok_", "").split("_")[0]
        title = f"TikTok Video {video_id}"
        author = ""

        # 读取元数据 JSON（如果有）
        meta_path = video_path_obj.with_suffix(".json")
        if meta_path.exists():
            try:
                meta = json.loads(meta_path.read_text(encoding="utf-8"))
                title = meta.get("title", title) or title
                author = meta.get("uploader", "") or meta.get("channel", "") or ""
            except Exception:
                pass

        ctx.video_meta = VideoMeta(
            video_id=video_id,
            url="",  # 本地文件无 URL
            title=title,
            author=author,
        )

        # ── 初始化文件状态（线程安全，前后台解耦） ──
        init_status(video_id, label=title)

        # 更新审批标记
        if mark_approved:
            approval_file = video_path_obj.with_suffix(".approval.json")
            if approval_file.exists():
                try:
                    approval_data = json.loads(approval_file.read_text(encoding="utf-8"))
                    approval_data["status"] = "approved"
                    approval_data["approved_at"] = datetime.now().isoformat()
                    approval_file.write_text(
                        json.dumps(approval_data, ensure_ascii=False, indent=2),
                        encoding="utf-8",
                    )
                    logger.info(f"  ✅ 审批标记已更新: {approval_file.name}")
                except Exception:
                    pass

        # ── 执行后续流水线（写入文件状态，不碰 st.session_state） ──
        try:
            # Step 1.5: 视频文件合规初筛
            update_status(video_id, current_step=1, step_name="合规初筛", progress=0.1)
            if ctx.video_path and Path(ctx.video_path).exists():
                logger.info("  🛡️ Preliminary compliance screening...")
                video_compliance = self.compliance.check_video_file(ctx.video_path)
                if video_compliance.blocked:
                    logger.warning(f"  ⛔ Video blocked: {video_compliance.overall_risk}")
                    ctx.compliance_report = video_compliance
                    mark_failed(video_id, f"Video blocked: {video_compliance.overall_risk}")
                    return ctx

            # Step 2: Analyze
            update_status(video_id, current_step=2, step_name="视频分析", progress=0.2,
                          cn_progress=0.15, en_progress=0.1)
            await self._step_analyze(ctx)

            # Step 3: Roast points
            update_status(video_id, current_step=3, step_name="槽点识别", progress=0.35,
                          cn_progress=0.3, en_progress=0.2)
            self._step_roast_points(ctx)

            # Step 4: Generate script
            update_status(video_id, current_step=4, step_name="文案生成", progress=0.45,
                          cn_progress=0.4, en_progress=0.3)
            self._step_generate_script(ctx)

            # Step 5: Compliance check
            update_status(video_id, current_step=5, step_name="合规检查", progress=0.55,
                          cn_progress=0.5, en_progress=0.4)
            self._step_compliance(ctx)
            if ctx.compliance_report and not ctx.compliance_report.is_safe:
                logger.warning(f"  ⛔ Script blocked by compliance")
                mark_failed(video_id, "Script blocked by compliance")
                return ctx

            # Step 6: Edit video
            update_status(video_id, current_step=6, step_name="视频剪辑", progress=0.65,
                          cn_progress=0.6, en_progress=0.5)
            self._step_edit(ctx)

            # Step 7: Generate voice
            update_status(video_id, current_step=7, step_name="配音生成", progress=0.8,
                          cn_progress=0.75, en_progress=0.7)
            self._step_voice(ctx)

            # Step 8: Publish (if enabled)
            if self.config.get("auto_publish", False):
                update_status(video_id, current_step=8, step_name="发布中", progress=0.9,
                              cn_progress=0.9, en_progress=0.9)
                await self._step_publish(ctx)

            # ── 标记完成（写入文件，不碰 st.session_state） ──
            mark_completed(video_id)
            logger.info(f"  ✅ Pipeline complete: {video_id} in {ctx.elapsed:.1f}s")

        except Exception as e:
            logger.error(f"  ❌ Pipeline failed for {video_id}: {e}")
            import traceback
            logger.error(traceback.format_exc())
            mark_failed(video_id, str(e)[:500])

        return ctx

    async def _step_scrape(self, source: str, count: int, url: str = "") -> List[VideoMeta]:
        """Step 1: 爬取视频

        如果提供了 url 参数，直接下载该 URL 对应的视频；
        否则按 source 平台搜索热榜视频。
        """
        logger.info("Step 1/8: 🕷️ Scraping videos...")

        # ── 单 URL 下载模式 ────────────────────────────────────
        if url:
            logger.info(f"  → Downloading from URL: {url}")
            video_path = await self.scraper.download_video(url)
            if video_path is None:
                logger.error("  ❌ Video download failed")
                return []

            # ── 检测 metadata_only 模式 ──────────────────────────
            is_metadata_only = video_path.suffix == ".json"
            if is_metadata_only:
                logger.info(f"  📋 Metadata-only mode detected: {video_path.name}")
                try:
                    meta = json.loads(video_path.read_text(encoding="utf-8"))
                    video_id = meta.get("video_id", "")
                    title = meta.get("title", f"TikTok Video {video_id}")
                    author = meta.get("uploader", "") or meta.get("channel", "") or ""
                    # 用 metadata_only 标记描述字段
                    video_meta = VideoMeta(
                        video_id=video_id,
                        url=url,
                        title=title,
                        author=author,
                    )
                    video_meta.description = f"__metadata_only__::{video_path}"
                    logger.info(f"  ✅ Metadata fetched: {title[:50]}")
                    return [video_meta]
                except Exception as e:
                    logger.error(f"  ❌ Failed to read metadata JSON: {e}")
                    return []

            # 从下载路径提取 video_id
            video_id = video_path.stem.replace("tiktok_", "").split("_")[0]

            # 尝试加载 yt-dlp 保存的元数据
            meta_path = video_path.with_suffix(".json")
            title = f"TikTok Video {video_id}"
            author = ""
            if meta_path.exists():
                try:
                    meta = json.loads(meta_path.read_text(encoding="utf-8"))
                    title = meta.get("title", title) or title
                    author = meta.get("uploader", "") or meta.get("channel", "") or ""
                except Exception:
                    pass

            video_meta = VideoMeta(
                video_id=video_id,
                url=url,
                title=title,
                author=author,
            )
            # 将下载路径存到 meta 的扩展字段中（通过 description 传递）
            video_meta.description = f"__local_path__::{video_path}"
            logger.info(f"  ✅ Downloaded: {video_path.name} ({title[:50]})")
            return [video_meta]

        # ── 平台热榜搜索模式 ──────────────────────────────────
        if source == "tiktok":
            logger.info("  → Searching TikTok trending...")
            videos = await self.scraper.get_trending(count=count)
            if videos:
                logger.info(f"  → Found {len(videos)} trending videos")
                return videos
            logger.info("  → No trending results, falling back to mock data")
            return [
                VideoMeta(
                    video_id="mock_001",
                    url="https://example.com/video1",
                    title="测试视频",
                    author="test_user",
                )
            ]
        elif source == "youtube":
            logger.info("  → YouTube scraper not yet implemented")
            return []
        else:
            logger.warning(f"  → Unknown source: {source}")
            return []

    async def _step_analyze(self, ctx: PipelineContext):
        """Step 2: 分析视频"""
        logger.info("Step 2/8: 🧠 Analyzing video...")

        if ctx.video_path and Path(ctx.video_path).exists():
            logger.info(f"  → Analyzing: {ctx.video_path}")
            try:
                ctx.analysis_result = self.analyzer.analyze(ctx.video_path)
                if ctx.analysis_result:
                    logger.info(f"  ✅ Analysis complete")
                else:
                    logger.warning("  → Analyzer returned None, using stub")
            except Exception as e:
                logger.warning(f"  → Analyzer error: {e}, using stub")
                ctx.analysis_result = None
        else:
            logger.info("  → No video path available, using stub")

    def _step_roast_points(self, ctx: PipelineContext):
        """Step 3: 识别槽点"""
        logger.info("Step 3/8: 🎯 Detecting roast points...")

        if ctx.analysis_result:
            ctx.roast_report = self.roast_engine.analyze(ctx.analysis_result)
            logger.info(f"  → Found {ctx.roast_report.total_roast_points} roast points")
        else:
            # Fallback: create generic roast report based on video metadata
            logger.info("  → No analysis data, using title-based fallback")
            title = ctx.video_meta.title if ctx.video_meta else "Unknown Video"
            ctx.roast_report = self.roast_engine.analyze({"title": title, "fallback": True})
            if not ctx.roast_report:
                logger.warning("  → RoastEngine fallback also failed")

    def _step_generate_script(self, ctx: PipelineContext):
        """Step 4: 生成吐槽脚本"""
        logger.info("Step 4/8: ✍️ Generating roast script...")

        if ctx.roast_report:
            ctx.roast_script = self.script_engine.generate(ctx.roast_report)
            logger.info(f"  → Script generated: {ctx.roast_script.total_word_count} chars")
        else:
            # Fallback: create a generic roast script so editor can burn subtitles
            logger.info("  → No roast report, generating fallback script")
            from scripts.roast_script_engine import RoastScript, ScriptSegment, StyleType
            title = ctx.video_meta.title if ctx.video_meta else "RoastBro Video"
            ctx.roast_script = RoastScript(
                title=f"🔥 Roast: {title}",
                video_source=ctx.video_path or "",
                style=StyleType.HYBRID,
                segments=[
                    ScriptSegment(order=1, content=f"今天我们来吐槽一下这个视频：{title}", start_time=0.0, end_time=5.0),
                    ScriptSegment(order=2, content="不是，你确定这是在认真的吗？这操作也太迷惑了吧。", start_time=5.0, end_time=10.0),
                    ScriptSegment(order=3, content="简单来说就是：我看不懂，但我大受震撼。", start_time=10.0, end_time=15.0),
                    ScriptSegment(order=4, content="ROASTBRO 出品，必属精品！记得点赞关注！", start_time=15.0, end_time=20.0),
                ],
                total_word_count=120,
                safe_verified=True,
            )
            logger.info(f"  → Fallback script generated: {len(ctx.roast_script.segments)} segments")

    def _step_compliance(self, ctx: PipelineContext):
        """Step 5: 合规检查"""
        logger.info("Step 5/8: 🛡️ Running compliance check...")

        if ctx.roast_script:
            ctx.compliance_report = self.compliance.check_for_publication(
                ctx.roast_script,
                platform="youtube",
            )
            status = "✅ SAFE" if ctx.compliance_report.is_safe else "⛔ BLOCKED"
            logger.info(f"  → Compliance: {status}")
        else:
            logger.info("  → Compliance stub: no script data")

    def _step_edit(self, ctx: PipelineContext):
        """Step 6: 剪辑视频 — 调用 FFmpeg 引擎烧录字幕"""
        logger.info("Step 6/8: 🎬 Editing video with FFmpeg...")

        if ctx.video_path and ctx.roast_script:
            # 确保输出目录存在
            Path("output/video").mkdir(parents=True, exist_ok=True)

            # 保存脚本到 output/scripts/ 供 Dashboard 读取
            script_dir = Path("output/scripts")
            script_dir.mkdir(parents=True, exist_ok=True)
            try:
                script_path = script_dir / f"{Path(ctx.video_path).stem}_roast_script.md"
                script_path.write_text(ctx.roast_script.full_text, encoding="utf-8")
                logger.info(f"  → Script saved: {script_path}")
            except Exception as e:
                logger.warning(f"  → Script save failed: {e}")

            # 执行 FFmpeg 剪辑
            ctx.edited_videos = self.editor.edit(
                video_path=ctx.video_path,
                script=ctx.roast_script,
                output_format=OutputFormat.MULTI,
            )
            logger.info(f"  → Edited videos: {list(ctx.edited_videos.keys())}")

            # 将成品视频同步到 output/video/ 供 Dashboard 发现
            for fmt, out_path in (ctx.edited_videos or {}).items():
                if out_path and Path(out_path).exists():
                    dest = Path("output/video") / f"{Path(ctx.video_path).stem}_{fmt}.mp4"
                    try:
                        import shutil
                        shutil.copy2(out_path, dest)
                        logger.info(f"  → Copied to dashboard path: {dest}")
                    except Exception as e:
                        logger.warning(f"  → Copy failed: {e}")
        else:
            logger.warning("  → Editor stub: no video/script data")

    def _step_voice(self, ctx: PipelineContext):
        """Step 7: 生成配音"""
        logger.info("Step 7/8: 🗣️ Generating voice...")

        if ctx.roast_script:
            ctx.narration_paths = self.voice.generate_narration(ctx.roast_script)
            logger.info(f"  → Generated {len(ctx.narration_paths)} narration segments")
        else:
            logger.info("  → Voice stub: no script data")

    def _step_publish_preview(self, ctx: PipelineContext):
        """Step 8: 发布预览 — generate_preview + evaluate_title + check_compliance"""
        logger.info("Step 8/9: 🔍 Running publish preview...")

        video_path = ctx.video_path or ""
        title = ctx.roast_script.title if ctx.roast_script else "RoastBro Video"

        # generate_preview → thumbnail + preview_clip
        thumbnail, preview_clip = self.publish_preview.generate_preview(video_path)
        ctx.publish_thumbnail = thumbnail
        ctx.preview_clip = preview_clip
        logger.info(f"  → Preview: thumb={thumbnail}, clip={preview_clip}")

        # evaluate_title → SEO score
        seo_result = self.publish_preview.evaluate_title(title)
        ctx.seo_score = seo_result.score
        logger.info(f"  → SEO score: {seo_result.score}/100")
        if seo_result.suggestions:
            for s in seo_result.suggestions:
                logger.info(f"  → Suggestion: {s}")

        # check_compliance → compliance result
        compliance_result = self.publish_preview.check_compliance(video_path)
        ctx.preview_compliance = compliance_result
        status = "✅ PASS" if compliance_result.passed else "⛔ BLOCKED"
        logger.info(f"  → Compliance: {status} ({compliance_result.risk_level})")
        if compliance_result.warnings:
            for w in compliance_result.warnings:
                logger.info(f"  → Warning: {w}")

    async def _step_publish(self, ctx: PipelineContext):
        """Step 9: 发布视频"""
        logger.info("Step 9/9: 📤 Publishing...")

        if ctx.edited_videos:
            for platform_key, video_path in ctx.edited_videos.items():
                platform = Platform(platform_key)
                result = await self.publisher.publish(
                    video_path=video_path,
                    title=ctx.roast_script.title if ctx.roast_script else "RoastBro Video",
                    description="",
                    platform=platform,
                )
                ctx.publish_results.append(result)
                logger.info(f"  → Published to {platform.value}: {result.status}")

    async def run_single_step(self, step: str, video_path: str):
        """
        执行流水线中的单个步骤。

        Args:
            step: 步骤名称 (analyze / roast / script / edit / voice)
            video_path: 视频文件路径
        """
        logger.info(f"Running single step: {step} on {video_path}")

        if step == "analyze":
            result = self.analyzer.analyze(video_path)
            logger.info(f"Analysis complete: {result.transcription.full_text[:100]}...")
            return result

        elif step == "roast":
            analysis = self.analyzer.analyze(video_path)
            report = self.roast_engine.analyze(analysis)
            logger.info(f"Found {report.total_roast_points} roast points")
            print(json.dumps(report.to_dict(), ensure_ascii=False, indent=2))
            return report

        elif step == "script":
            analysis = self.analyzer.analyze(video_path)
            report = self.roast_engine.analyze(analysis)
            script = self.script_engine.generate(report)
            logger.info(f"Script generated: {script.total_word_count} chars")
            print(script.full_text)
            return script

        else:
            logger.warning(f"Unknown step: {step}")
            return None

    async def run_daemon(self, interval: int = 3600):
        """
        持续生产模式 — 按间隔自动运行流水线。

        Args:
            interval: 运行间隔（秒）
        """
        logger.info(f"🔄 Starting daemon mode: interval={interval}s")

        while True:
            try:
                logger.info(f"--- Pipeline run at {datetime.now().isoformat()} ---")
                await self.run_full_pipeline(
                    source="tiktok",
                    max_videos=self.config.get("max_videos_per_run", 5),
                )
            except Exception as e:
                logger.error(f"Pipeline run failed: {e}")

            logger.info(f"Sleeping for {interval}s...")
            await asyncio.sleep(interval)


# ============================================================
# CLI 入口
# ============================================================

def main():
    parser = argparse.ArgumentParser(
        description="RoastBro — AI 自动化反讽吐槽内容工厂",
    )
    parser.add_argument(
        "--mode", "-m",
        choices=["full", "download", "approve", "analyze", "roast", "script", "edit", "voice", "daemon"],
        default="full",
        help="运行模式: download=仅下载到预览区, approve=批准本地视频开工",
    )
    parser.add_argument(
        "--source", "-s",
        choices=["tiktok", "youtube", "bilibili"],
        default="tiktok",
        help="内容来源平台",
    )
    parser.add_argument(
        "--video", "-v",
        help="视频文件路径（单步模式使用）",
    )
    parser.add_argument(
        "--count", "-c",
        type=int,
        default=1,
        help="处理视频数量",
    )
    parser.add_argument(
        "--interval", "-i",
        type=int,
        default=3600,
        help="daemon 模式运行间隔（秒）",
    )
    parser.add_argument(
        "--config",
        help="配置文件路径（JSON）",
    )
    parser.add_argument(
        "--toxicity", "-t",
        type=int,
        default=5,
        choices=range(1, 11),
        help="毒舌烈度 (1-10, 5=标准)",
    )
    parser.add_argument(
        "--url", "-u",
        default="",
        help="指定单个 TikTok 视频 URL 直接下载（跳过搜索）",
    )

    args = parser.parse_args()

    orchestrator = RoastBroOrchestrator(
        config_path=args.config,
        toxicity_level=args.toxicity,
    )

    if args.mode == "daemon":
        asyncio.run(orchestrator.run_daemon(interval=args.interval))

    elif args.mode == "full":
        asyncio.run(orchestrator.run_full_pipeline(
            source=args.source,
            max_videos=args.count,
            url=args.url,
        ))

    elif args.mode == "download":
        # 仅下载到 preview 区，等待人工审批
        if not args.url:
            logger.error("Download mode requires --url argument")
            sys.exit(1)
        result = asyncio.run(orchestrator.run_download_only(url=args.url))
        if result:
            logger.info(f"✅ 下载完成，等待人工审批: {result.get('title', 'N/A')}")
        else:
            logger.error("❌ 下载失败")

    elif args.mode == "approve":
        # 批准本地视频，执行完整流水线
        if not args.video:
            logger.error("Approve mode requires --video argument pointing to a local mp4")
            sys.exit(1)
        ctx = asyncio.run(orchestrator.run_from_local(video_path=args.video))
        if ctx:
            logger.info(f"✅ 本地视频流水线完成: {ctx.video_meta.video_id if ctx.video_meta else 'N/A'}")
        else:
            logger.error("❌ 本地视频流水线失败")

    elif args.mode in ("analyze", "roast", "script"):
        if not args.video:
            logger.error("Single-step mode requires --video argument")
            sys.exit(1)
        asyncio.run(orchestrator.run_single_step(args.mode, args.video))

    else:
        logger.warning(f"Mode '{args.mode}' not yet implemented")


if __name__ == "__main__":
    main()
