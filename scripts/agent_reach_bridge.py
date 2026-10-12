#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Agent-Reach 取材桥接模块(多源免配置)。

经 Agent-Reach 的零配置通道取材:
  - github : GitHub Trending (Jina Reader)
  - v2ex   : V2EX 热门主题 (公共 API)
  - rss    : 默认科技 RSS 源 (Hacker News 等)
  - web    : 任意网址(Jina Reader 全文) / 普通搜索词(Jina Search)
  - auto   : 按 topic_query 自动路由

产出: text(文案) / raw_keywords(原始词) / visual_keywords(视觉实拍检索词)
"""
from __future__ import annotations

import sys as _sys

if hasattr(_sys.stdout, "reconfigure"):
    _sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    _sys.stderr.reconfigure(encoding="utf-8", errors="replace")

import json
import re
import subprocess
import urllib.parse
from pathlib import Path

try:
    import requests
except ImportError:  # pragma: no cover
    requests = None

ROOT = Path(r"D:\git008")
AR_LAUNCHER = ROOT / "scripts" / "agent-reach.ps1"
JINA = "https://r.jina.ai/"
JINA_SEARCH = "https://s.jina.ai/"
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}

GITHUB_TRENDING = "https://github.com/trending"
V2EX_HOT_API = "https://www.v2ex.com/api/topics/hot.json"
DEFAULT_RSS_FEEDS = [
    "https://hnrss.org/frontpage",          # Hacker News 首页
    "https://news.ycombinator.com/rss",     # HN 官方 RSS
    "https://feeds.arstechnica.com/arstechnica/technology-lab",
]

_STOPWORDS = {
    "the", "and", "for", "with", "from", "that", "this", "your", "you", "are",
    "our", "get", "new", "use", "app", "code", "open", "source", "free", "all",
    "https", "github", "com", "www", "how", "why", "what", "not", "his", "her",
}

# 技术域 -> Pexels 可检索的英文视觉实拍词
_VISUAL_MAP = {
    "github": ["coding", "software developer", "computer screen"],
    "git": ["coding", "software developer", "computer screen"],
    "code": ["coding", "software developer", "computer screen"],
    "coding": ["coding", "software developer", "computer screen"],
    "developer": ["coding", "software developer"],
    "software": ["coding", "computer screen"],
    "programming": ["coding", "programmer typing"],
    "cli": ["terminal screen", "typing on keyboard"],
    "terminal": ["terminal screen", "typing on keyboard"],
    "python": ["coding", "programming"],
    "api": ["server room", "digital network"],
    "ai": ["artificial intelligence", "glowing brain"],
    "llm": ["artificial intelligence", "glowing brain"],
    "gpt": ["artificial intelligence", "neural network"],
    "neural": ["neural network", "glowing brain"],
    "model": ["artificial intelligence", "data visualization"],
    "agent": ["artificial intelligence", "robot assistant"],
    "database": ["data center", "server rack", "digital network"],
    "data": ["data center", "digital network", "data visualization"],
    "server": ["server rack", "data center"],
    "architecture": ["data center", "server rack"],
    "cloud": ["cloud computing", "data center"],
    "network": ["digital network", "server rack"],
    "automation": ["robotics", "typing on keyboard"],
    "automated": ["robotics", "conveyor belt"],
    "test": ["typing on keyboard", "software testing"],
    "testing": ["typing on keyboard", "software testing"],
    "pipeline": ["robotics", "assembly line"],
    "robot": ["robotics", "robot arm"],
    "bot": ["robotics"],
    "security": ["cyber security", "hacker code"],
    "hack": ["cyber security", "hacker code"],
    "web": ["web design", "computer screen"],
    "mobile": ["smartphone", "mobile app"],
    "video": ["video editing", "camera"],
    "blockchain": ["blockchain", "crypto technology"],
    "crypto": ["crypto technology", "blockchain"],
    "learning": ["artificial intelligence", "student laptop"],
    "memory": ["data center", "digital network"],
    "trending": ["abstract digital network", "technology background"],
    "startup": ["modern office", "business team"],
    "chip": ["semiconductor", "circuit board"],
}

# 中文技术域 -> Pexels 可检索的英文视觉实拍词
_ZH_VISUAL_MAP = {
    "人工智能": ["artificial intelligence", "glowing brain", "digital network"],
    "大模型": ["artificial intelligence", "glowing brain", "digital network"],
    "深度学习": ["artificial intelligence", "glowing brain", "digital network"],
    "神经": ["artificial intelligence", "glowing brain", "digital network"],
    "编程": ["coding", "software developer", "computer screen"],
    "代码": ["coding", "software developer", "computer screen"],
    "程序员": ["coding", "software developer", "computer screen"],
    "软件": ["coding", "software developer", "computer screen"],
    "开发者": ["coding", "software developer", "computer screen"],
    "开发": ["coding", "software developer", "computer screen"],
    "服务器": ["data center", "server rack", "network switch"],
    "数据库": ["data center", "server rack", "network switch"],
    "云计算": ["data center", "server rack", "network switch"],
    "架构": ["data center", "server rack", "network switch"],
    "手机": ["smartphone", "modern technology", "gadgets"],
    "苹果": ["smartphone", "modern technology", "gadgets"],
    "数码": ["smartphone", "modern technology", "gadgets"],
    "智能设备": ["smartphone", "modern technology", "gadgets"],
    "芯片": ["microchip", "circuit board", "computer hardware"],
    "半导体": ["microchip", "circuit board", "computer hardware"],
    "显卡": ["microchip", "circuit board", "computer hardware"],
    "硬件": ["microchip", "circuit board", "computer hardware"],
    "汽车": ["electric car", "autonomous driving", "modern vehicle"],
    "新能源": ["electric car", "autonomous driving", "modern vehicle"],
    "自动驾驶": ["electric car", "autonomous driving", "modern vehicle"],
}
# ---------------------------------------------------------------------------
# 分镜语义层：情绪 / 行为 → 具象实拍镜头
#
# 通用/抽象空镜（code / keyboard / network / technology background …）会让每条视频长得
# 一模一样，还和旁白毫无关系，一律列入黑名单；取词必须落到「情绪 + 行为」真能拍出画面
# 的具象镜头（焦虑的人 / 火箭点火 / 系鞋带出发）。
# ---------------------------------------------------------------------------
_ABSTRACT_VISUAL_BLOCKLIST = frozenset({
    "code", "coding", "keyboard", "network", "digital", "abstract", "technology",
    "laptop", "monitor", "screen", "server", "software", "hardware", "circuit",
    "programming", "terminal", "cyber", "hologram", "data", "algorithm",
})

# 英文触发词 → 具象镜头（英文剧本）
_EMOTION_VISUAL_MAP = {
    "anxiety": ["stressed woman touching temples", "anxious man alone at desk", "close up tense face"],
    "anxious": ["stressed woman touching temples", "anxious man alone at desk"],
    "rumination": ["exhausted person lying awake at night", "person staring at the ceiling"],
    "overthink": ["person staring at a blank page", "hands covering a tired face"],
    "fear": ["person hesitating at a closed door", "wide eyes in the dark", "shadow on the wall"],
    "avoid": ["person walking away down a corridor", "empty chair at a meeting table"],
    "procrastinate": ["person scrolling a phone in bed", "clock ticking on a wall"],
    "pressure": ["high pressure meeting in a boardroom", "storm clouds over a city skyline"],
    "crisis": ["alarm lights in a control room", "emergency team running"],
    "rocket": ["rocket lifting off at dawn", "rocket engine static fire", "launch pad at night"],
    "fuel": ["jet engine flame close up", "booster firing in slow motion"],
    "experiment": ["scientist writing in a lab notebook", "lab glassware close up"],
    "action": ["person lacing running shoes at dawn", "runner in the starting blocks"],
    "execute": ["hands writing a checklist", "person crossing items off a list"],
    "iterate": ["craftsman refining a wooden prototype", "sculptor shaping wet clay"],
    "perfection": ["crumpled draft pages in a bin", "hammer breaking a wall"],
    "habit": ["making the bed in the morning", "pouring coffee into a cup at dawn"],
    "question": ["whiteboard covered in sticky notes", "hand raised in a meeting room"],
}

# 中文触发词 → 具象镜头（顺序即优先级：越靠前越「具象且本镜专属」）
_ZH_EMOTION_VISUAL_MAP = {
    "内耗": ["exhausted person lying awake at night", "dim bedroom silhouette", "person staring at the ceiling"],
    "精神内耗": ["exhausted person lying awake at night", "person staring at the ceiling"],
    "回避": ["person walking away down a corridor", "empty chair at a meeting table", "closed door close up"],
    "逃避": ["person walking away down a corridor", "closed door close up"],
    "害怕失败": ["runner falling on a track", "office worker with head in hands"],
    "害怕评价": ["nervous speaker facing an audience", "crowd watching a stage"],
    "拖延": ["person scrolling a phone in bed", "clock ticking on a wall", "messy desk in the morning"],
    "焦虑": ["stressed woman touching temples", "anxious man alone at desk", "close up tense face"],
    "压力": ["high pressure meeting in a boardroom", "man holding his head at a desk"],
    "危机": ["alarm lights in a control room", "stormy sea crashing on rocks"],
    "火箭": ["rocket lifting off at dawn", "launch pad at night", "rocket engine static fire"],
    "燃料": ["jet engine flame close up", "booster firing in slow motion"],
    "实验": ["scientist writing in a lab notebook", "lab glassware close up"],
    "行动": ["person lacing running shoes at dawn", "runner in the starting blocks", "footstep close up"],
    "执行": ["hands writing a checklist", "person crossing items off a list"],
    "迭代": ["craftsman refining a wooden prototype", "sculptor shaping wet clay"],
    "优化": ["engineer adjusting a machine", "careful hands sanding wood"],
    "完美": ["crumpled draft pages in a bin", "shattered glass on the floor"],
    "下一步": ["hand drawing an arrow on paper", "climbing stairs one step at a time"],
    "问题": ["whiteboard covered in sticky notes", "team brainstorming around a table"],
    "思维": ["person staring at a chess board", "notebook filled with arrows"],
    "敌人": ["boxer shadow boxing in a gym", "fencing duel close up"],
    "马斯克": ["rocket launch control room", "electric car factory line", "spacecraft hangar"],
    "习惯": ["making the bed in the morning", "pouring coffee into a cup at dawn"],
    "训练": ["athlete training in a gym", "swimmer in a pool at dawn"],
    "不安": ["person pacing in a corridor", "close up uneasy eyes"],
    "恐惧": ["person hesitating at a closed door", "shadow on the wall at night"],
    # 悬疑 / 深夜 / 孤独：这类文案最容易被泛化检索词坑成「火箭 + 写字楼」，
    # 必须落到暗夜、冷光、空屋、与人对峙的具象镜头。
    "悬疑": ["empty room lit by a single cold light", "figure standing still in a dark corridor"],
    "诡异": ["flickering light in an empty room", "long shadow moving across a wall at night"],
    "恐怖": ["dark doorway with light seeping underneath", "hand slowly pushing a door open in the dark"],
    "灵异": ["cold light glowing from an appliance in the dark", "empty kitchen with one light switching on"],
    "秘密": ["sealed envelope held in two hands under a lamp", "folded note hidden in a drawer"],
    "孤独": ["solitary figure sitting alone in a dim room", "one person alone at a window at night"],
    "寂静": ["silent empty room at night", "still dark room with one light source"],
    "黑暗": ["pitch dark room, single sliver of light", "shape barely visible in the dark"],
    "亮起": ["light switching on by itself in a dark room", "cold glow spreading across a dark floor"],
    "无人": ["abandoned room with everything left behind", "empty street at night with no one around"],
}

# ---------------------------------------------------------------------------
# 具象名词层：文案里的「物件 / 空间」→ 英文画面短语（Prompt Engine 的具象主语）。
#
# 这是「素材与文案脱节」的正面解：泛化检索词（rocket / office / running shoes）
# 会让「凌晨冰箱自己亮起」配出火箭和写字楼；这里把每个具象名词钉到一组专属、
# 可拍可画的画面，逐镜再按镜序在短语池内错位取词，既保证相关也保证逐镜不同。
# ---------------------------------------------------------------------------
_OBJECT_VISUAL_MAP = {
    "fridge": [
        "refrigerator door standing open in a dark kitchen",
        "cold interior light glowing from an open fridge",
        "hand reaching into a lit refrigerator at night",
    ],
    "refrigerator": [
        "refrigerator door standing open in a dark kitchen",
        "cold interior light glowing from an open fridge",
    ],
    "letter": [
        "folded handwritten letter held in two hands",
        "handwritten letter unfolded under a dim lamp",
        "crumpled paper letter close up",
    ],
    "kitchen": [
        "dim kitchen counter at night",
        "empty kitchen with a single light on",
        "kitchen doorway in darkness",
    ],
    "window": [
        "rain-streaked window at night",
        "view through a dark window",
        "window light cutting across a dark room",
    ],
    "mirror": ["figure reflected in a dim mirror", "half-lit mirror in an empty room"],
    "shadow": ["long shadow stretching across a dark wall", "silhouette cast on a wall at night"],
    "door": ["half-open door with light behind it", "closed door at the end of a dark hallway"],
    "clock": ["wall clock reading the small hours", "clock face close up at night"],
    "subway": [
        "empty subway car at dawn",
        "subway window streaking with passing light",
        "platform almost empty at first light",
    ],
    "city": ["city skyline at night", "distant city lights seen from a rooftop"],
    "coffee": ["steaming coffee cup on a table", "hand holding a cup of coffee at dawn"],
    "phone": ["glowing phone lighting up a face in the dark", "hand holding a glowing phone at night"],
    "rain": ["rain running down a window pane", "rain falling on an empty street at night"],
    "snow": ["snow falling past a window at night"],
    "bed": ["unmade bed in a dark bedroom", "person lying awake in bed at night"],
}

# 中文具象名词 → 英文画面短语（顺序即优先级：越靠前越「本镜专属」）
_ZH_OBJECT_VISUAL_MAP = {
    "冰箱": [
        "refrigerator door standing open in a dark kitchen",
        "cold interior light glowing out of an open fridge",
        "hand resting on a refrigerator handle at night",
        "frost forming on a refrigerator shelf",
    ],
    "冷藏": ["cold shelf inside an open refrigerator", "cold vapour drifting out of an open fridge"],
    "冷冻": ["frost-covered shelf inside a freezer", "cold vapour drifting out of a freezer door"],
    "冻": ["ice crystals glittering on frozen paper", "frost-covered surface in cold light"],
    "冰": ["ice crystals glittering in cold blue light", "frost creeping across a cold surface"],
    "厨房": [
        "dim kitchen counter at night",
        "empty kitchen with a single light on",
        "kitchen doorway in darkness",
    ],
    "信": [
        "folded handwritten letter held in two hands",
        "handwritten letter unfolded under a dim lamp",
        "crumpled paper letter close up",
        "sealed envelope resting on a bare table",
    ],
    "纸": ["single sheet of paper catching one light", "curled paper corner close up"],
    "字迹": ["ink handwriting seen in close up", "fountain pen resting on written paper"],
    "出发": [
        "packed suitcase waiting by the door",
        "footsteps leaving a doorway at dawn",
        "suitcase wheeled down an empty street",
    ],
    "明天": ["packed bag waiting by a doorway at night", "coat and bag ready by the door"],
    "旅途": ["empty road stretching toward the horizon", "highway vanishing point at dawn"],
    "窗": [
        "rain-streaked window at night",
        "view through a dark window",
        "window light cutting across a dark room",
    ],
    "城市": ["city skyline at night", "distant city lights seen from a rooftop"],
    "灯火": ["distant city lights going dark one by one", "street lamps switching off along an empty road"],
    "霓虹": ["neon sign flickering in a dark street", "wet neon reflection on an empty road at night"],
    "地铁": [
        "empty subway car at dawn",
        "subway window streaking with passing light",
        "platform almost empty at first light",
    ],
    "列车": ["empty train car at dawn", "train window flashing with passing lights"],
    "站台": ["empty train platform at first light", "platform clock under dim lamps"],
    "胸口": ["hand pressed over the heart in close up", "a letter held tight against a chest"],
    "心": ["close up of a hand pressed to the chest", "person breathing out slowly in dim light"],
    "亮起": [
        "light switching on by itself in a dark room",
        "cold glow spreading across a dark floor",
        "single cold light glowing from a dark appliance",
    ],
    "灯": [
        "single bare bulb glowing in a dark room",
        "one lamp left on in an empty room",
        "cold light spilling across a dark floor",
    ],
    "影子": ["long shadow stretching across a dark wall", "silhouette cast on a wall at night"],
    "门": ["half-open door with light behind it", "closed door at the end of a dark hallway"],
    "走廊": ["empty corridor under dim lights", "corridor receding into darkness"],
    "楼梯": ["stairwell lit by a single bulb", "narrow staircase in low light"],
    "镜子": ["figure reflected in a dim mirror", "half-lit mirror in an empty room"],
    "床": ["unmade bed in a dark bedroom", "person lying awake in bed at night"],
    "沙发": ["empty sofa in a dim living room", "person sitting alone on a sofa at night"],
    "餐桌": ["set dinner table with one empty chair", "bare table under a single lamp"],
    "杯子": ["steaming cup on a table in dim light", "hand closing around a warm cup"],
    "咖啡": ["steaming coffee cup on a table", "hand holding a cup of coffee at dawn"],
    "手机": ["glowing phone lighting up a face in the dark", "hand holding a glowing phone at night"],
    "时钟": ["wall clock reading the small hours", "clock face close up at night"],
    "雨": ["rain running down a window pane", "rain falling on an empty street at night"],
    "雪": ["snow falling past a window at night", "fresh snow on an empty street"],
    "雾": ["mist drifting through a dark street", "headlights cutting through fog at night"],
    "夜空": ["night sky above a dark roofline", "stars over a sleeping city"],
}

# 时间 / 空间 → 场景基调短语（Prompt Engine 的 setting 段：画面必须与文案的时空一致）
_SETTING_VISUAL_MAP = {
    "midnight": "in the dead of night",
    "2am": "at two in the morning",
    "dawn": "at first light of dawn",
    "dusk": "at dusk",
    "night": "at night",
}

_ZH_SETTING_VISUAL_MAP = {
    "两点": "at two in the morning",
    "三点": "at three in the morning",
    "凌晨": "in the dead of night, everything dark and silent",
    "深夜": "late at night with a single dim light source",
    "半夜": "in the middle of the night",
    "夜晚": "at night",
    "夜里": "at night",
    "清晨": "at first light of dawn",
    "早晨": "in the early morning",
    "黎明": "at first light of dawn",
    "天亮": "as the sky first brightens",
    "黄昏": "at dusk with warm fading light",
    "傍晚": "at dusk",
    "中午": "in harsh midday light",
    "窗外": "seen from inside through a window",
    "空荡": "in an empty, deserted space",
    "无人": "with no one around",
}

# 具象真人兜底：词典全不命中时也绝不回到抽象空镜
_CONCRETE_HUMAN_FALLBACK = [
    "person in deep thought by a window",
    "close up hands writing notes",
    "people talking in a bright office",
]


def _match(trigger: str, haystack: str) -> bool:
    return re.search(rf"(?<![a-z0-9]){re.escape(trigger)}(?![a-z0-9])", haystack) is not None


def _dedupe(items, limit=None):
    out: list[str] = []
    for item in items:
        text = str(item).strip()
        if text and text not in out:
            out.append(text)
    return out[:limit] if limit else out


def _interleave(groups, limit=None) -> list[str]:
    """多主体 Beat 的短语组轮转合并：A1 B1 A2 B2 …

    一个 Beat 常同时提到多个具象名词（「她把信贴在胸口，决定明天就出发」= 信 + 出发）。
    若按词典顺序整组铺开，靠后的主体会被前一组挤到窗口之外，整镜只剩「信」的特写，
    Beat 的核心情节就丢掉一半——这是「素材与文案脱节」的另一种形态。
    轮转让每个命中主体都进前几位，且首组头名仍是第一顺位（主体不被稀释）。
    """
    queues: list[list[str]] = []
    for group in groups or []:
        queue = [str(word).strip() for word in (group or []) if str(word).strip()]
        if queue:
            queues.append(queue)
    cap = None if limit is None else max(0, int(limit))
    out: list[str] = []
    while queues and (cap is None or len(out) < cap):
        remaining: list[list[str]] = []
        for queue in queues:
            word = queue.pop(0)
            if word not in out:
                out.append(word)
            if queue:
                remaining.append(queue)
            if cap is not None and len(out) >= cap:
                break
        queues = remaining
    return out


def _zh_object_matches(haystack: str) -> list[tuple[str, list[str]]]:
    """命中的中文具象名词（子串命中），**长词优先**。

    「冰箱」含「冰」、「冷冻」含「冻」，短词触发会给本镜叠加不相干的画面
    （冰箱悬疑文案配上"ice crystals"特写）。只有一个触发词是最长匹配时才采纳它。
    """
    matched = [
        (trigger, list(words))
        for trigger, words in _ZH_OBJECT_VISUAL_MAP.items()
        if trigger and trigger in haystack
    ]
    return [
        (trigger, words)
        for trigger, words in matched
        if not any(trigger != other and trigger in other for other, _ in matched)
    ]


def is_abstract_visual(word: str) -> bool:
    """是否含被禁用的通用/抽象词（code / keyboard / network / technology …）。"""
    tokens = {tok for tok in re.split(r"[^a-z0-9]+", str(word or "").lower()) if tok}
    return bool(tokens & _ABSTRACT_VISUAL_BLOCKLIST)


def strip_abstract_visuals(words, *, limit=None) -> list[str]:
    """剔除通用/抽象词：任何最终检索词列表都先过这一层。"""
    return _dedupe([w for w in (words or []) if not is_abstract_visual(w)], limit)


# 触发词 → 情绪基调（SD Prompt Engine 的 mood 段；覆盖上面两张表的所有触发词）
_MOOD_BY_TRIGGER = {
    "anxiety": "tense anxious mood",
    "anxious": "tense anxious mood",
    "rumination": "melancholic introspective mood",
    "overthink": "restless overthinking mood",
    "fear": "uneasy suspenseful mood",
    "avoid": "quiet withdrawn mood",
    "procrastinate": "stagnant restless mood",
    "pressure": "high-stakes urgent mood",
    "crisis": "urgent dramatic mood",
    "rocket": "epic ambitious mood",
    "fuel": "intense energetic mood",
    "experiment": "curious analytical mood",
    "action": "determined energised mood",
    "execute": "focused productive mood",
    "iterate": "craftsman iterative mood",
    "perfection": "frustrated perfectionist mood",
    "habit": "calm disciplined mood",
    "question": "inquisitive collaborative mood",
    "内耗": "melancholic introspective mood",
    "精神内耗": "melancholic introspective mood",
    "回避": "quiet withdrawn mood",
    "逃避": "quiet withdrawn mood",
    "害怕失败": "uneasy suspenseful mood",
    "害怕评价": "uneasy suspenseful mood",
    "拖延": "stagnant restless mood",
    "焦虑": "tense anxious mood",
    "压力": "high-stakes urgent mood",
    "危机": "urgent dramatic mood",
    "火箭": "epic ambitious mood",
    "燃料": "intense energetic mood",
    "实验": "curious analytical mood",
    "行动": "determined energised mood",
    "执行": "focused productive mood",
    "迭代": "craftsman iterative mood",
    "优化": "craftsman iterative mood",
    "完美": "frustrated perfectionist mood",
    "下一步": "focused forward-looking mood",
    "问题": "inquisitive collaborative mood",
    "思维": "inquisitive collaborative mood",
    "敌人": "defiant determined mood",
    "马斯克": "epic ambitious mood",
    "习惯": "calm disciplined mood",
    "训练": "determined energised mood",
    "不安": "uneasy suspenseful mood",
    "恐惧": "uneasy suspenseful mood",
    "悬疑": "eerie suspenseful mood",
    "诡异": "eerie unsettling mood",
    "恐怖": "dark horror-tinged mood",
    "灵异": "eerie supernatural mood",
    "秘密": "secretive hushed mood",
    "孤独": "solitary melancholic mood",
    "寂静": "still silent mood",
    "黑暗": "dark ominous mood",
    "亮起": "eerie suspenseful mood",
    "无人": "desolate empty mood",
}
_DEFAULT_MOOD = "cinematic dramatic mood"


def matched_triggers(text: str) -> list[str]:
    """命中的情绪/行为触发词（按词典优先级，与 semantic_visuals 同一顺序）。"""
    haystack = str(text or "")
    if not haystack.strip():
        return []
    haystack_low = haystack.lower()
    hits: list[str] = []
    for trigger in _EMOTION_VISUAL_MAP:
        if _match(trigger, haystack_low):
            hits.append(trigger)
    for trigger in _ZH_EMOTION_VISUAL_MAP:
        if trigger in haystack:
            hits.append(trigger)
    return hits


def semantic_mood(text: str) -> str:
    """文案 → 情绪基调（未命中返回空串，由 Prompt Engine 用默认基调）。"""
    hits = matched_triggers(text)
    if not hits:
        return ""
    return _MOOD_BY_TRIGGER.get(hits[0], _DEFAULT_MOOD)


def semantic_prompt_parts(text: str, limit: int = 3, index: int = 0) -> dict:
    """Prompt Engine 的语义三要素：具象主语/动作 + 情绪基调。

    :param index: 该 Beat 在整片中的镜序；用于把共享同一情绪词的相邻 Beat 岔开到
        不同的具象镜头，避免「焦虑 Beat 1」和「框架 Beat 4」画出同一张图。
    """
    return {
        "subjects": semantic_subjects(text, limit=limit, index=index),
        "objects": object_visuals(text, limit=limit),
        "setting": setting_phrase(text),
        "mood": semantic_mood(text) or _DEFAULT_MOOD,
        "triggers": matched_triggers(text),
    }


def _window(pool: list[str], limit: int, index: int) -> list[str]:
    """按镜序在短语池内错位取词（到池尾即夹住），保证逐镜不共用同一串画面。"""
    if not pool:
        return []
    size = max(1, int(limit))
    if int(index) <= 0:
        return pool[:size]
    start = min(int(index), max(0, len(pool) - size))
    return pool[start:start + size] or pool[:size]


def _emotion_pool(text: str) -> list[str]:
    """汇总本 Beat 命中的**全部**情绪 / 行为触发词的具象镜头（词典优先级排序）。"""
    haystack = str(text or "")
    if not haystack.strip():
        return []
    haystack_low = haystack.lower()
    pool: list[str] = []
    for trigger, words in _EMOTION_VISUAL_MAP.items():
        if _match(trigger, haystack_low):
            pool.extend(words)
    for trigger, words in _ZH_EMOTION_VISUAL_MAP.items():
        if trigger in haystack:
            pool.extend(words)
    return strip_abstract_visuals(pool)


def semantic_visuals(text: str, limit: int = 3, index: int = 0) -> list[str]:
    """文案的情绪 / 行为 → 具象实拍镜头（未命中返回空列表）。

    取词规则（确定性，与文案 100% 绑定）：第 1 镜取最贴 Beat 主情绪的前 ``limit``
    个；第 N 镜把窗口向后偏移 N 格——这样「焦虑型人格 Beat」和「三步行动框架
    Beat」即便都提到"焦虑"，也会落到不同的具象画面，而不是整片反复用同一张图。
    """
    return _window(_emotion_pool(text), limit, index)


def object_visuals(text: str, limit: int | None = None) -> list[str]:
    """文案里的具象名词 / 空间 → 英文画面短语（未命中返回空列表）。

    这是 Prompt Engine 的**具象主语首选来源**：冰箱 / 信 / 地铁 / 窗 这类名词直接
    钉住画面，绝不会像泛化检索词那样把悬疑文案画成火箭和写字楼。
    """
    haystack = str(text or "")
    if not haystack.strip():
        return []
    haystack_low = haystack.lower()
    groups: list[list[str]] = []
    for trigger, words in _OBJECT_VISUAL_MAP.items():
        if _match(trigger, haystack_low):
            groups.append(list(words))
    for _trigger, words in _zh_object_matches(haystack):
        groups.append(list(words))
    return strip_abstract_visuals(_interleave(groups, limit=limit), limit=limit)


def setting_phrases(text: str, limit: int = 2) -> list[str]:
    """文案里的时间 / 空间 → 场景基调短语（保证画面时空与文案一致）。"""
    haystack = str(text or "")
    if not haystack.strip():
        return []
    haystack_low = haystack.lower()
    out: list[str] = []
    for trigger, phrase in _SETTING_VISUAL_MAP.items():
        if _match(trigger, haystack_low):
            out.append(phrase)
    for trigger, phrase in _ZH_SETTING_VISUAL_MAP.items():
        if trigger in haystack:
            out.append(phrase)
    return _dedupe(out, limit)


def setting_phrase(text: str) -> str:
    """最佳场景基调短语（未命中返回空串，由 Prompt Engine 继续用默认基调）。"""
    phrases = setting_phrases(text, limit=1)
    return phrases[0] if phrases else ""


def semantic_subjects(text: str, limit: int = 3, index: int = 0) -> list[str]:
    """Prompt Engine 的具象主语池：具象名词优先，其次情绪 / 行为镜头。

    具象名词（冰箱、信、地铁）比情绪镜头更能锚定画面与文案的关系；两者都拿不到时
    返回空列表，交由调用方的具象兜底池按镜序轮换。
    """
    pool = _dedupe([*object_visuals(text), *_emotion_pool(text)])
    return _window(strip_abstract_visuals(pool), limit, index)


def map_to_visual_keywords(raw_keywords, text_summary="", limit=5):
    """原始/技术关键词 → Pexels 可检索的英文具象实拍词。

    优先级：情绪/行为具象镜头 → 技术词典（过滤抽象词）→ 具象真人兜底。
    """
    haystack = " ".join([*(raw_keywords or []), text_summary or ""])
    haystack_low = haystack.lower()
    visual: list[str] = []
    hits: list[str] = []

    def _absorb(trigger: str, words) -> None:
        if trigger not in hits:
            hits.append(trigger)
        for word in words:
            if word not in visual:
                visual.append(word)

    # 具象名词优先：冰箱 / 信 / 地铁 这类名词直接锚住画面；情绪 / 行为镜头是第二顺位。
    # 顺序反过来的话，「凌晨冰箱自己亮起」会先命中"亮起"的情绪镜头而丢掉冰箱，
    # 抽掉主体正是「素材与文案脱节」的老毛病。
    object_groups: list[list[str]] = []
    for trigger, words in _OBJECT_VISUAL_MAP.items():
        if _match(trigger, haystack_low):
            if trigger not in hits:
                hits.append(trigger)
            object_groups.append(list(words))
    for trigger, words in _zh_object_matches(haystack):
        if trigger not in hits:
            hits.append(trigger)
        object_groups.append(list(words))
    for word in _interleave(object_groups):
        if word not in visual:
            visual.append(word)

    if not visual:
        for trigger, words in _EMOTION_VISUAL_MAP.items():
            if _match(trigger, haystack_low):
                _absorb(trigger, words)
        for trigger, words in _ZH_EMOTION_VISUAL_MAP.items():
            if trigger in haystack:
                _absorb(trigger, words)

    if not visual:
        for trigger, words in _VISUAL_MAP.items():
            if _match(trigger, haystack_low):
                _absorb(trigger, words)
        for trigger, words in _ZH_VISUAL_MAP.items():
            if trigger in haystack:
                _absorb(trigger, words)

    visual = strip_abstract_visuals(visual)
    used_fallback = not visual
    # 只在**完全没有语义命中**时才退到具象真人兜底：给已经贴题的画面再叠加
    # "people talking in a bright office" 这种通用空镜，等于亲手制造脱节。
    visual = _dedupe(_CONCRETE_HUMAN_FALLBACK if used_fallback else visual, limit)
    print(f"[visual] raw={list(raw_keywords or [])} hits={hits} -> visual={visual}"
          f"{' (具象兜底)' if used_fallback else ''}")
    return visual

def agent_reach_status(timeout=60):
    """调用 agent-reach.ps1 doctor --json, 返回可用渠道快照(失败返回 None)。"""
    if not AR_LAUNCHER.exists():
        return None
    try:
        proc = subprocess.run(
            ["pwsh", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(AR_LAUNCHER),
             "doctor", "--json"],
            capture_output=True, text=True, timeout=timeout,
        )
        start = proc.stdout.find("{")
        return json.loads(proc.stdout[start:]) if start >= 0 else None
    except Exception:  # noqa: BLE001
        return None


def _http_get(url, timeout=90, as_json=False):
    if requests is None:
        raise RuntimeError("缺少 requests 依赖")
    resp = requests.get(url, headers=UA, timeout=timeout)
    resp.raise_for_status()
    return resp.json() if as_json else resp.text


def _clean_md_line(line):
    line = re.sub(r"!\[[^\]]*\]\([^)]*\)", "", line)
    line = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", line)
    line = re.sub(r"[*_`#>]+", " ", line)
    return re.sub(r"\s+", " ", line).strip()

def fetch_v2ex_trending(limit=5):
    return [t.get("title", "").strip() for t in _http_get(V2EX_HOT_API, as_json=True)[:limit]]


def fetch_github_trending(limit=5):
    """经 Jina Reader 读取 GitHub 热榜。"""
    md = _http_get(JINA + GITHUB_TRENDING)
    skip = re.compile(r"/(login|signup|features|topics|collections|sponsors|apps|marketplace|"
                      r"pricing|about|contact|security|enterprise|team|orgs|settings|mcp|site|"
                      r"search|trending|solutions|resources|customer-stories|open-source|"
                      r"codespaces|mobile|why-github|readme)")
    repos = []
    for m in re.finditer(r"https://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", md):
        url = m.group(0).rstrip(".,)")
        slug = url.replace("https://github.com/", "")
        if not skip.search(url) and slug not in repos:
            repos.append(slug)
    print(f"[bridge] GitHub 热榜解析到 {len(repos)} 个仓库")
    return repos[:limit]


def fetch_rss(feed_url=None, limit=5):
    """抓取默认科技 RSS(Hacker News 等), 提炼标题。"""
    feeds = [feed_url] if feed_url else DEFAULT_RSS_FEEDS
    for url in feeds:
        try:
            titles = _parse_feed(url, limit)
        except Exception as exc:  # noqa: BLE001
            print(f"[bridge] RSS 源失败 {url}: {exc}")
            continue
        if titles:
            print(f"[bridge] RSS {url} 解析到 {len(titles)} 条")
            return titles
    print("[bridge] 所有 RSS 源均失败")
    return []


def _parse_feed(url, limit):
    try:
        import feedparser

        entries = feedparser.parse(url).entries
        return [e.get("title", "").strip() for e in entries[:limit] if e.get("title")]
    except ImportError:
        xml = _http_get(url)
        raw = re.findall(r"<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?</title>", xml, re.S)
        return [re.sub(r"\s+", " ", t).strip() for t in raw[1:limit + 1]]


def fetch_page(url, limit=5):
    """经 Jina Reader 读取网页, 优先提炼外链标题(适配 HN 等整页无换行的聚合页)。"""
    md = _http_get(JINA + url)
    host = urllib.parse.urlparse(url).netloc
    titles = []
    for m in re.finditer(r"(!?)\[([^\]]+)\]\((https?://[^)\s]+)\)", md):
        is_img, text, href = m.group(1), m.group(2).strip(), m.group(3)
        if is_img or len(text) < 20:
            continue
        if urllib.parse.urlparse(href).netloc == host:
            continue
        if re.fullmatch(r"[\w.\-]+\.\w{2,}", text):
            continue
        if text not in titles:
            titles.append(text)
    if not titles:
        titles = [c for c in (_clean_md_line(l) for l in md.splitlines()) if 20 <= len(c) <= 160]
    print(f"[bridge] 网页提炼到 {len(titles)} 条")
    return titles[:max(limit, 5)]

def fetch_web_search(query, limit=5):
    """普通搜索词 -> Jina Search 全文。"""
    md = _http_get(JINA_SEARCH + urllib.parse.quote(query))
    out = [c for c in (_clean_md_line(l) for l in md.splitlines()) if 20 <= len(c) <= 160]
    print(f"[bridge] Jina Search 解析到 {len(out)} 行")
    return out[:max(limit, 5)]


# ---------------------------------------------------------------- 路由
def _detect_source(topic_query: str) -> str:
    q = (topic_query or "").strip()
    low = q.lower()
    if low.startswith(("http://", "https://")):
        return "web"
    if "v2ex" in low:
        return "v2ex"
    if "github" in low:
        return "github"
    if "rss" in low or "hacker" in low or "news" in low or "新闻" in q:
        return "rss"
    return "rss"  # 其余默认走综合热点(RSS)


def _keywords_from(items, limit=5):
    words = []
    for item in items:
        for tok in re.findall(r"[A-Za-z][A-Za-z0-9\-]{2,}", item):
            low = tok.lower()
            if low not in _STOPWORDS and low not in words:
                words.append(low)
    return words[:limit]


def _compose_text(topic, items):
    lines = [f"今天带你速览「{topic}」的最新热点。"]
    for i, item in enumerate(items[:4], 1):
        clean = re.sub(r"https?://\S+", "", item).strip().split("——")[0].strip()
        if clean:
            lines.append(f"第{i}条，{clean[:60]}。")
    lines.append("以上是本期速览，关注我获取更多前沿动态。")
    return " ".join(lines)


def extract_topic_data(topic_query, source="auto", max_items=5):
    """多源取材, 返回 {text, raw_keywords, visual_keywords, source, items}。"""
    q = (topic_query or "").strip()
    resolved = source if source and source != "auto" else _detect_source(q)

    try:
        if resolved == "github":
            items = fetch_github_trending(max_items)
        elif resolved == "v2ex":
            items = fetch_v2ex_trending(max_items)
        elif resolved == "rss":
            feed = q if q.lower().startswith(("http://", "https://")) else None
            items = fetch_rss(feed, max_items)
        elif resolved == "web":
            if q.lower().startswith(("http://", "https://")):
                items = fetch_page(q, max_items)
            else:
                items = fetch_web_search(q, max_items)
        else:
            raise ValueError(f"未知来源: {resolved}")
    except Exception as exc:  # noqa: BLE001
        print(f"[bridge] {resolved} 取材失败({exc}), 回退 GitHub 热榜")
        resolved, items = "github-fallback", fetch_github_trending(max_items)

    if not items:
        print("[bridge] 首轮为空, 回退 GitHub 热榜")
        resolved, items = "github-fallback", fetch_github_trending(max_items)

    raw_keywords = _keywords_from(items)
    text = _compose_text(q or "科技热点", items)
    visual_keywords = map_to_visual_keywords(raw_keywords, text)
    return {
        "text": text,
        "raw_keywords": raw_keywords,
        "visual_keywords": visual_keywords,
        "keywords": visual_keywords,  # 向后兼容别名
        "source": resolved,
        "items": items,
    }


def main(argv=None):
    import argparse

    ap = argparse.ArgumentParser(description="Agent-Reach 多源取材桥接")
    ap.add_argument("topic")
    ap.add_argument("--source", default="auto",
                    choices=["auto", "github", "v2ex", "rss", "web"])
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args(argv)
    data = extract_topic_data(args.topic, source=args.source)
    if args.json:
        print(json.dumps(data, ensure_ascii=False, indent=2))
    else:
        print("TEXT:", data["text"])
        print("RAW:", ", ".join(data["raw_keywords"]))
        print("VISUAL:", ", ".join(data["visual_keywords"]))
        print("SOURCE:", data["source"])
    return 0


if __name__ == "__main__":
    _sys.exit(main())
