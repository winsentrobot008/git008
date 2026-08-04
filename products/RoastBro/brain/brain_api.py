"""
Content Brain API — RoastBro ↔ second-brain Bridge
====================================================
统一知识接口，将 second-brain 的知识管理能力挂载到 RoastBro。

核心功能：
    1. save_memory()    — 保存内容到 second-brain/wiki/
    2. load_memory()    — 读取知识笔记
    3. search()         — 关键词搜索知识库
    4. semantic_cluster — 主题聚类
    5. get_history()    — 获取知识活动历史
    6. get_assets()     — 获取所有知识资产
    7. get_topics()     — 获取知识主题列表

宪法约束：
    second-brain/ 是白名单受保护资产（Section 6）
    WRITE 操作仅允许在 wiki/ 目录内通过 knowledge_linker.py 执行
    本模块仅执行 READ 操作，不修改 second-brain 结构
"""

import json
import re
from pathlib import Path
from datetime import datetime
from typing import Optional, Dict, List, Any
from dataclasses import dataclass, field


# ── Constants ────────────────────────────────────────────────
ROOT = Path(__file__).resolve().parent.parent.parent  # git008/
SECOND_BRAIN = ROOT / "second-brain"
BRAIN_WIKI = SECOND_BRAIN / "wiki"
BRAIN_RAW = SECOND_BRAIN / "raw"
BRAIN_LOGS = SECOND_BRAIN / "logs"
HEARTBEAT = SECOND_BRAIN / ".heartbeat"
ACTIVITY_LOG = BRAIN_LOGS / "activity.md"
PROCESSED_HASHES = BRAIN_WIKI / ".processed_hashes.json"

# RoastBro's own brain storage (for RoastBro-specific knowledge)
ROASTBRO_ROOT = ROOT / "RoastBro"
ROASTBRO_BRAIN = ROASTBRO_ROOT / "brain"
ROASTBRO_MEMORY = ROASTBRO_BRAIN / "memory"
ROASTBRO_INDEX = ROASTBRO_BRAIN / "index.json"


# ── Data Models ──────────────────────────────────────────────

@dataclass
class KnowledgeNote:
    """知识笔记模型"""
    title: str
    filename: str
    path: str
    summary: str = ""
    keywords: List[str] = field(default_factory=list)
    created_at: str = ""
    size_bytes: int = 0


@dataclass
class MemoryEntry:
    """记忆条目"""
    id: str
    topic: str
    content: str
    tags: List[str] = field(default_factory=list)
    created_at: str = field(default_factory=lambda: datetime.now().isoformat())
    source: str = "roastbro"


class ContentBrain:
    """
    内容大脑 — 第二知识接口。

    提供统一的读写 API 来管理 RoastBro 的知识资产。
    读取 second-brain 的 wiki/ 知识库，
    写入 RoastBro/brain/memory/ 的本地记忆。

    Usage:
        brain = ContentBrain()
        brain.save_memory("roast_style", "谷阿莫风格...")
        notes = brain.search("吐槽")
        for note in notes:
            print(note.title)
    """

    def __init__(self):
        # Ensure RoastBro brain directories exist
        ROASTBRO_MEMORY.mkdir(parents=True, exist_ok=True)
        if ROASTBRO_INDEX.exists():
            self._index = json.loads(ROASTBRO_INDEX.read_text(encoding="utf-8"))
        else:
            self._index = {"notes": [], "memories": [], "updated_at": datetime.now().isoformat()}
            self._save_index()

    # ── Public API ───────────────────────────────────────────

    def save_memory(
        self,
        topic: str,
        content: str,
        tags: Optional[List[str]] = None,
    ) -> str:
        """
        保存知识记忆。

        将内容保存为两个副本：
        1. RoastBro/brain/memory/{topic}_{timestamp}.md — 本地持久化
        2. 索引记录到 index.json

        Args:
            topic: 主题（用作文件名）
            content: Markdown 内容
            tags: 标签列表

        Returns:
            str: 记忆 ID
        """
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        safe_topic = re.sub(r'[^\w\-_]', '_', topic)[:40]
        memory_id = f"{safe_topic}_{timestamp}"

        # Write memory file
        md_content = (
            f"# {topic}\n\n"
            f"> 创建时间: {datetime.now().isoformat()}\n"
            f"> 标签: {', '.join(tags) if tags else '无'}\n"
            f"> 来源: RoastBro Content Brain\n\n"
            f"{content}\n"
        )
        memory_path = ROASTBRO_MEMORY / f"{memory_id}.md"
        memory_path.write_text(md_content, encoding="utf-8")

        # Update index
        entry = {
            "id": memory_id,
            "topic": topic,
            "tags": tags or [],
            "created_at": datetime.now().isoformat(),
            "path": str(memory_path.relative_to(ROASTBRO_ROOT)),
        }
        self._index["memories"].append(entry)
        self._save_index()

        return memory_id

    def load_memory(self, topic: str) -> Optional[Dict[str, Any]]:
        """
        从知识库加载指定主题的内容。

        搜索顺序：
        1. RoastBro/brain/memory/ — 本地记忆
        2. second-brain/wiki/ — 全局知识库

        Args:
            topic: 主题关键词

        Returns:
            Optional[Dict]: 包含 title, content, source, keywords 的字典
        """
        # 1. Search local memory
        for mem in self._index.get("memories", []):
            if topic.lower() in mem["topic"].lower():
                mem_path = ROASTBRO_ROOT / mem["path"]
                if mem_path.exists():
                    content = mem_path.read_text(encoding="utf-8")
                    return {
                        "title": mem["topic"],
                        "content": content,
                        "source": "roastbro_memory",
                        "created_at": mem["created_at"],
                    }

        # 2. Search second-brain wiki
        if BRAIN_WIKI.exists():
            for f in sorted(BRAIN_WIKI.glob("*.md")):
                if f.name == "index.md":
                    continue
                if topic.lower() in f.stem.lower():
                    content = f.read_text(encoding="utf-8")
                    title = self._extract_title(content)
                    return {
                        "title": title,
                        "content": content,
                        "source": "second_brain_wiki",
                        "filename": f.name,
                    }

        return None

    def search(self, query: str, max_results: int = 10) -> List[KnowledgeNote]:
        """
        搜索知识库。

        搜索范围：
        - second-brain/wiki/ 所有笔记
        - RoastBro/brain/memory/ 所有记忆

        Args:
            query: 搜索关键词
            max_results: 最大结果数

        Returns:
            List[KnowledgeNote]: 匹配的知识笔记列表
        """
        results = []
        query_lower = query.lower()

        # 1. Search second-brain wiki
        if BRAIN_WIKI.exists():
            for f in sorted(BRAIN_WIKI.glob("*.md")):
                if f.name == "index.md":
                    continue
                content = f.read_text(encoding="utf-8")
                if query_lower in content.lower() or query_lower in f.stem.lower():
                    title = self._extract_title(content)
                    results.append(KnowledgeNote(
                        title=title,
                        filename=f.name,
                        path=str(f.relative_to(ROOT)),
                        summary=content[:200].replace("\n", " ").strip(),
                        keywords=self._extract_keywords(content),
                        created_at=datetime.fromtimestamp(f.stat().st_mtime).isoformat(),
                        size_bytes=f.stat().st_size,
                    ))
                    if len(results) >= max_results:
                        break

        # 2. Search local memory
        for mem in self._index.get("memories", []):
            if len(results) >= max_results:
                break
            if query_lower in mem["topic"].lower():
                results.append(KnowledgeNote(
                    title=mem["topic"],
                    filename=f"{mem['id']}.md",
                    path=mem["path"],
                    summary=f"Local memory: {mem['topic']}",
                    keywords=mem.get("tags", []),
                    created_at=mem["created_at"],
                ))

        return results

    def semantic_cluster(self, keywords: List[str]) -> Dict[str, List[KnowledgeNote]]:
        """
        基于关键词进行语义聚类。

        遍历 wiki/ 中的所有笔记，计算关键词匹配度，
        将笔记分组到匹配的主题下。

        Args:
            keywords: 关键词列表

        Returns:
            Dict[str, List[KnowledgeNote]]: 主题 → 笔记列表 的映射
        """
        clusters: Dict[str, List[KnowledgeNote]] = {}
        kw_lower = [k.lower() for k in keywords]

        if not BRAIN_WIKI.exists():
            return clusters

        for f in BRAIN_WIKI.glob("*.md"):
            if f.name == "index.md":
                continue

            content = f.read_text(encoding="utf-8")
            content_lower = content.lower()

            # Count keyword matches
            matched = [kw for kw in kw_lower if kw in content_lower]
            if not matched:
                continue

            title = self._extract_title(content)
            note = KnowledgeNote(
                title=title,
                filename=f.name,
                path=str(f.relative_to(ROOT)),
                summary=content[:200].replace("\n", " ").strip(),
                keywords=self._extract_keywords(content),
            )

            for kw in matched:
                if kw not in clusters:
                    clusters[kw] = []
                clusters[kw].append(note)

        return clusters

    def get_history(self, limit: int = 20) -> List[Dict[str, str]]:
        """
        获取知识活动历史。

        从 second-brain/logs/activity.md 解析活动记录。

        Args:
            limit: 返回条数上限

        Returns:
            List[Dict]: 历史活动列表，每项包含 timestamp 和 event
        """
        if not ACTIVITY_LOG.exists():
            return []

        content = ACTIVITY_LOG.read_text(encoding="utf-8")
        events = []

        # Parse activity.md format: - **[timestamp]** event
        pattern = r"- \*\*\[([^\]]+)\]\*\*\s+(.+)"
        for match in re.finditer(pattern, content):
            events.append({
                "timestamp": match.group(1),
                "event": match.group(2).strip(),
            })

        # Also add RoastBro brain memory history
        for mem in self._index.get("memories", []):
            events.append({
                "timestamp": mem["created_at"],
                "event": f"[RoastBro Brain] Saved memory: {mem['topic']}",
            })

        events.sort(key=lambda e: e["timestamp"], reverse=True)
        return events[:limit]

    def get_assets(self) -> List[KnowledgeNote]:
        """
        获取所有知识资产。

        列出 second-brain/wiki/ 和 RoastBro/brain/memory/ 的全部内容。

        Returns:
            List[KnowledgeNote]: 所有知识笔记
        """
        assets: List[KnowledgeNote] = []

        # 1. second-brain wiki notes
        if BRAIN_WIKI.exists():
            for f in sorted(BRAIN_WIKI.glob("*.md")):
                if f.name == "index.md":
                    continue
                content = f.read_text(encoding="utf-8")
                title = self._extract_title(content)
                assets.append(KnowledgeNote(
                    title=title,
                    filename=f.name,
                    path=str(f.relative_to(ROOT)),
                    summary=content[:200].replace("\n", " ").strip(),
                    keywords=self._extract_keywords(content),
                    size_bytes=f.stat().st_size,
                ))

        # 2. RoastBro brain memories
        for mem in self._index.get("memories", []):
            assets.append(KnowledgeNote(
                title=mem["topic"],
                filename=f"{mem['id']}.md",
                path=mem["path"],
                summary=mem["topic"],
                keywords=mem.get("tags", []),
                created_at=mem["created_at"],
            ))

        return assets

    def get_topics(self) -> List[Dict[str, Any]]:
        """
        获取知识主题列表。

        从 wiki/index.md 解析主题索引，
        从 RoastBro brain index 解析本地主题。

        Returns:
            List[Dict]: 主题列表，每项包含 title, path, summary
        """
        topics = []

        # 1. Parse wiki/index.md
        index_path = BRAIN_WIKI / "index.md"
        if index_path.exists():
            content = index_path.read_text(encoding="utf-8")
            pattern = r"- \[([^\]]+)\]\(([^)]+)\)\s*—\s*(.+)"
            for match in re.finditer(pattern, content):
                topics.append({
                    "title": match.group(1),
                    "path": match.group(2),
                    "summary": match.group(3).strip(),
                    "source": "second_brain_wiki",
                })

        # 2. RoastBro brain topics
        for mem in self._index.get("memories", []):
            topics.append({
                "title": mem["topic"],
                "path": mem["path"],
                "summary": f"Tags: {', '.join(mem.get('tags', []))}",
                "source": "roastbro_brain",
                "id": mem["id"],
                "created_at": mem["created_at"],
            })

        return topics

    def get_stats(self) -> Dict[str, Any]:
        """
        获取知识库统计信息。

        Returns:
            Dict: 包含笔记数、记忆数、关键词数等统计
        """
        wiki_count = 0
        wiki_size = 0
        if BRAIN_WIKI.exists():
            for f in BRAIN_WIKI.glob("*.md"):
                if f.name != "index.md":
                    wiki_count += 1
                    wiki_size += f.stat().st_size

        memory_count = len(self._index.get("memories", []))
        total_keywords = 0

        # Count keywords in wiki notes
        if BRAIN_WIKI.exists():
            for f in BRAIN_WIKI.glob("*.md"):
                if f.name == "index.md":
                    continue
                content = f.read_text(encoding="utf-8")
                kws = self._extract_keywords(content)
                total_keywords += len(kws)

        return {
            "wiki_notes": wiki_count,
            "wiki_size_bytes": wiki_size,
            "local_memories": memory_count,
            "total_keywords": total_keywords,
            "brain_path": str(SECOND_BRAIN.relative_to(ROOT)),
            "roastbro_brain_path": str(ROASTBRO_BRAIN.relative_to(ROASTBRO_ROOT)),
            "last_index_update": self._index.get("updated_at", "N/A"),
        }

    # ── Internal Methods ─────────────────────────────────────

    def _save_index(self):
        """持久化记忆索引"""
        self._index["updated_at"] = datetime.now().isoformat()
        ROASTBRO_INDEX.write_text(
            json.dumps(self._index, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    @staticmethod
    def _extract_title(content: str) -> str:
        """从 Markdown 中提取第一个 # 标题"""
        for line in content.split("\n"):
            stripped = line.strip()
            if stripped.startswith("# ") and not stripped.startswith("## "):
                return stripped.lstrip("# ").strip()
        return "(无标题)"

    @staticmethod
    def _extract_keywords(content: str) -> List[str]:
        """从 Markdown 中提取关键词"""
        keywords = set()
        # **标记内容**
        for m in re.finditer(r"\*\*([^*]+)\*\*", content):
            keywords.add(m.group(1).strip())
        # 列表项关键词
        for line in content.split("\n"):
            stripped = line.strip()
            if stripped.startswith("- ") or stripped.startswith("* "):
                item = stripped.lstrip("-* ").strip()
                if ":" in item:
                    name = item.split(":", 1)[0].strip().replace("**", "")
                    if name and len(name) >= 2:
                        keywords.add(name)
        return sorted(keywords)[:20]
