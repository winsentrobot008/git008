#!/usr/bin/env python3
"""
MediaIndexerPro — src/indexer.py
媒体元数据索引器：扫描指定目录，提取媒体文件元数据，生成 media_index.json。

Usage:
    python src/indexer.py --dir <directory> [--output <path>]
"""

import os
import json
import argparse
import hashlib
from datetime import datetime
from pathlib import Path

# 支持的媒体文件扩展名
IMAGE_EXTENSIONS = {'.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg', '.ico'}
VIDEO_EXTENSIONS = {'.mp4', '.avi', '.mov', '.mkv', '.wmv', '.flv', '.webm'}
AUDIO_EXTENSIONS = {'.mp3', '.wav', '.flac', '.ogg', '.aac', '.m4a', '.wma'}
DOCUMENT_EXTENSIONS = {'.pdf', '.doc', '.docx', '.txt', '.md', '.json', '.xml', '.csv'}

ALL_MEDIA_EXTENSIONS = IMAGE_EXTENSIONS | VIDEO_EXTENSIONS | AUDIO_EXTENSIONS | DOCUMENT_EXTENSIONS


def get_media_type(ext: str) -> str:
    """根据文件扩展名返回媒体类型"""
    ext = ext.lower()
    if ext in IMAGE_EXTENSIONS:
        return "image"
    elif ext in VIDEO_EXTENSIONS:
        return "video"
    elif ext in AUDIO_EXTENSIONS:
        return "audio"
    elif ext in DOCUMENT_EXTENSIONS:
        return "document"
    return "other"


def format_size(size_bytes: int) -> str:
    """将字节数格式化为人类可读的字符串"""
    for unit in ['B', 'KB', 'MB', 'GB']:
        if size_bytes < 1024:
            return f"{size_bytes:.1f} {unit}"
        size_bytes /= 1024
    return f"{size_bytes:.1f} TB"


def scan_directory(directory: str) -> list:
    """扫描目录并返回所有媒体文件的元数据列表"""
    media_files = []
    base_path = Path(directory).resolve()

    if not base_path.exists():
        print(f"[ERROR] 目录不存在: {base_path}")
        return media_files

    print(f"[SCAN] 正在扫描: {base_path}")

    for file_path in base_path.rglob("*"):
        if not file_path.is_file():
            continue

        ext = file_path.suffix.lower()
        if ext not in ALL_MEDIA_EXTENSIONS:
            continue

        stat = file_path.stat()
        media_info = {
            "name": file_path.name,
            "path": str(file_path.relative_to(base_path)),
            "absolute_path": str(file_path.resolve()),
            "extension": ext,
            "type": get_media_type(ext),
            "size_bytes": stat.st_size,
            "size_human": format_size(stat.st_size),
            "modified": datetime.fromtimestamp(stat.st_mtime).isoformat(),
            "created": datetime.fromtimestamp(stat.st_ctime).isoformat(),
        }
        media_files.append(media_info)

    print(f"[SCAN] 找到 {len(media_files)} 个媒体文件")
    return media_files


def build_index(directory: str, output_path: str = "media_index.json"):
    """扫描目录并构建索引 JSON 文件"""
    files = scan_directory(directory)

    # 按类型统计
    type_counts = {}
    for f in files:
        t = f["type"]
        type_counts[t] = type_counts.get(t, 0) + 1

    index_data = {
        "generated": datetime.now().isoformat(),
        "source_directory": str(Path(directory).resolve()),
        "total_files": len(files),
        "total_size_bytes": sum(f["size_bytes"] for f in files),
        "total_size_human": format_size(sum(f["size_bytes"] for f in files)),
        "type_counts": type_counts,
        "files": files,
    }

    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(index_data, f, indent=2, ensure_ascii=False)

    print(f"[INDEX] 索引已写入: {output_path}")
    print(f"[INDEX] 总计 {len(files)} 个文件, {index_data['total_size_human']}")
    return index_data


def main():
    parser = argparse.ArgumentParser(description="MediaIndexerPro — 媒体元数据索引器")
    parser.add_argument("--dir", default="./data/media",
                        help="要扫描的目录路径 (默认: ./data/media)")
    parser.add_argument("--output", default="media_index.json",
                        help="输出的 JSON 文件路径 (默认: media_index.json)")
    args = parser.parse_args()

    build_index(args.dir, args.output)


if __name__ == "__main__":
    main()
