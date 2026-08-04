# AI 内容理解架构 (AI Understanding Layer)

## AI 模块架构

```
┌────────────────────────────────────────────────────────────┐
│                   AI Understanding Layer                    │
├────────────────────────────────────────────────────────────┤
│                                                            │
│  ┌──────────────────────────────────────────────────────┐  │
│  │             emotion_engine.py                        │  │
│  │  [Emotion Lexicon] → [Segment Scoring] → [Curve]    │  │
│  │  8 categories, 50+ keywords, intensity 0.0-1.0      │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                            │
│  ┌──────────────────────────────────────────────────────┐  │
│  │             Style Mapping                            │  │
│  │  Emotion → {tone, pace, camera, light, color_filter} │  │
│  │  Used by: render_engine.py, scene_planner.py         │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                            │
│  ┌──────────────────────────────────────────────────────┐  │
│  │             Asset Keyword Mapping                    │  │
│  │  Emotion → [search keywords for asset matching]      │  │
│  │  Used by: asset_selector.py, search_online           │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

## 情绪分析流程

```
输入文本 → 清理 → 分段 → 每段评分 → 生成曲线 → 确定主情绪
                                      ↓
                              返回 EmotionAnalysis
                              ├─ curve: [EmotionPhase]
                              ├─ dominant_emotion: str
                              └─ summary: str
```

## 评分策略

词典匹配 (lexicon-based):
```python
EMOTION_LEXICON = {
    "孤独": [("孤单", 0.8), ("一个人", 0.7), ("寂寞", 0.9), ...],
    "希望": [("希望", 0.9), ("期待", 0.7), ("未来", 0.6), ...],
    ...
}
```

## metadata.json

```json
{
  "id": "media-abc123",
  "filename": "sunset.mp4",
  "type": "video",
  "emotion": "希望",
  "tags": ["希望", "warm", "sunset"],
  "summary": "情绪: 希望 | 风格: warm/medium",
  "style": {"tone": "warm", "pace": "medium", "camera": "wide_up"},
  "thumbnail": "/api/data/thumbs/media-abc123.jpg",
  "version": 1
}
```
