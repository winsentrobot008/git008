# -*- coding: utf-8 -*-
"""
GIT008 - AutoHunter (MediaIndexerPro Integration Bridge)
======================================================
这个模块负责挂载 MediaIndexerPro 项目，利用其 7 大引擎搜索素材，
并下载选中的视频/图片保存到本地 data/temp_assets/ 供渲染使用。
"""

import os
import sys
import urllib.request
import yt_dlp

# 1. 动态挂载 MediaIndexerPro 路径 (以当前 RoastBro 所在目录的同级目录进行定位)
CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))  # scrapers/fetcher
ROASTBRO_DIR = os.path.abspath(os.path.join(CURRENT_DIR, "..", ".."))
WORKSPACE_DIR = os.path.abspath(os.path.join(ROASTBRO_DIR, ".."))
INDEXER_DIR = os.path.join(WORKSPACE_DIR, "MediaIndexerPro")

if os.path.exists(INDEXER_DIR):
    sys.path.append(INDEXER_DIR)
    print(f"[AutoHunter] 成功挂载外部素材索引引擎路径: {INDEXER_DIR}")
else:
    print(f"[AutoHunter] ⚠️ 未能在预期路径找到 MediaIndexerPro: {INDEXER_DIR}")

# 尝试导入 MediaIndexerPro 核心引擎
try:
    from engine.stock_engine import UniversalStockEngine
    from domain.models import MediaItem, SourceType
    HAS_INDEXER = True
except ImportError as e:
    print(f"[AutoHunter] 导入 MediaIndexerPro 失败: {e}")
    HAS_INDEXER = False


class AutoHunter:
    def __init__(self):
        if HAS_INDEXER:
            # 初始化 MediaIndexerPro 的聚合搜索引擎
            self.engine = UniversalStockEngine()
            print("[AutoHunter] UniversalStockEngine 引擎初始化成功！")
        else:
            self.engine = None
            print("[AutoHunter] 引擎不可用，将启动优雅降级模拟模式。")

    def _download_file(self, url, save_path):
        """通用下载器：支持普通网络链接直接下载"""
        try:
            print(f"  └─ 正在下载网络资源: {url}")
            # 设置 User-Agent 规避基础反爬
            req = urllib.request.Request(
                url,
                headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}
            )
            with urllib.request.urlopen(req, timeout=15) as response, open(save_path, 'wb') as out_file:
                out_file.write(response.read())
            print(f"  └─ 下载成功: {save_path}")
            return True
        except Exception as e:
            print(f"  └─ [错误] 下载失败: {e}")
            return False

    def _download_youtube_video(self, url, save_path):
        """yt-dlp 视频流提取与下载"""
        try:
            print(f"  └─ 正在调用 yt-dlp 提取 YouTube 素材: {url}")
            ydl_opts = {
                'outtmpl': save_path,
                'format': 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
                'quiet': True,
                'max_filesize': 100 * 1024 * 1024,  # 限制 100MB 硬盘守护
            }
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                ydl.download([url])
            print(f"  └─ yt-dlp 视频提取成功: {save_path}")
            return True
        except Exception as e:
            print(f"  └─ [错误] yt-dlp 提取失败: {e}")
            return False

    def scout_and_download(self, visual_prompts, output_dir="data/temp_assets"):
        """
        核心调度：
        1. 针对每个视觉 prompt，调用 MediaIndexerPro 搜索高质量候选素材
        2. 选取排在最前（相关度最高）的资产进行下载
        """
        os.makedirs(output_dir, exist_ok=True)
        downloaded_assets = []

        if not HAS_INDEXER or not self.engine:
            print("[AutoHunter] 未启用 MediaIndexerPro，返回模拟资源。")
            return [os.path.join(output_dir, f"mock_scene_{i}.mp4") for i in range(len(visual_prompts))]

        for idx, prompt in enumerate(visual_prompts):
            print(f"\n[AutoHunter] 🔍 正在检索视觉主题: '{prompt}'...")
            try:
                # 1. 通过 MediaIndexerPro 检索全网元数据 (不下载)
                # UniversalStockEngine.search(topic, keywords, category)
                # 将 prompt 同时作为 topic 和 keywords 传入
                search_results, perf_data = self.engine.search(
                    topic=prompt,
                    keywords=[prompt],
                    category="all"
                )
                if not search_results:
                    print(f"  └─ ⚠️ 未检索到关于 '{prompt}' 的相关素材")
                    continue

                print(f"  └─ 检索到 {len(search_results)} 个素材元数据 (来自 {perf_data.get('active_count', 0)} 个适配器)。正在挑选最优素材...")

                # 2. 选取最匹配的第一个可用素材进行下载
                target_item = search_results[0]
                file_ext = ".mp4" if target_item.type == SourceType.VIDEO else ".jpg"
                save_filename = f"scene_{idx+1}{file_ext}"
                save_path = os.path.join(output_dir, save_filename)

                print(f"  └─ 获胜资产来自 [{target_item.source}]: {target_item.title}")

                # 3. 执行真正的下载逻辑
                success = False
                if "youtube" in target_item.source.lower() or "yt" in target_item.source.lower():
                    success = self._download_youtube_video(target_item.url, save_path)
                else:
                    # 图片或来自 Pexels/Pixabay 的直链直接下载
                    # 优先使用 thumbnail (通常是图片或轻量 mp4 预览直链)，如果 url 是直链则用 url
                    download_url = target_item.thumbnail if target_item.thumbnail else target_item.url
                    success = self._download_file(download_url, save_path)

                if success:
                    downloaded_assets.append(save_path)
                else:
                    print("  └─ ⚠️ 该素材下载失败，尝试优雅降级...")
            except Exception as ex:
                print(f"  └─ [检索错误] 处理分镜 {idx+1} 时出现异常: {ex}")

        return downloaded_assets
