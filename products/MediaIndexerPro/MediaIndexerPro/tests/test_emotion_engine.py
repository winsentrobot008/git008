"""
test_emotion_engine.py — Tests for the emotion-driven pipeline modules.

Run with: python -m pytest tests/test_emotion_engine.py -v
Or:       python tests/test_emotion_engine.py  (manual mode)
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


def test_analyze_script():
    """Test basic emotion analysis."""
    from workflow.emotion_engine import analyze_script

    script = "我感到很孤独，一个人坐在空荡荡的房间里。但我知道明天会更好，希望就在前方。"
    result = analyze_script(script)

    assert result is not None
    assert len(result.curve) > 0
    assert result.summary != ""
    print(f"  Emotion curve: {result.summary}")
    print(f"  Dominant: {result.dominant_emotion}")
    print(f"  Phases: {len(result.curve)}")
    for p in result.curve:
        print(f"    {p.label} (intensity={p.intensity:.2f}): {p.text}")


def test_emotion_lexicon_coverage():
    """Verify all emotion categories have style mappings."""
    from workflow.emotion_engine import EMOTION_LEXICON, EMOTION_STYLE, EMOTION_ASSET_KEYWORDS

    for emotion in EMOTION_LEXICON:
        assert emotion in EMOTION_STYLE, f"Missing style: {emotion}"
        assert emotion in EMOTION_ASSET_KEYWORDS, f"Missing asset keywords: {emotion}"

    print(f"  {len(EMOTION_LEXICON)} emotion categories fully mapped")


def test_plan_scenes():
    """Test scene planning with emotion input."""
    from workflow.emotion_engine import analyze_script
    from workflow.scene_planner import plan_scenes

    script = "孤独的夜晚，我一个人走在街上。但看到日出时，心中充满希望。"
    emotion = analyze_script(script)
    scenes = plan_scenes(script, emotion, ratio="1:1")

    assert len(scenes) > 0
    print(f"  {len(scenes)} scenes planned:")
    for s in scenes:
        print(f"    Scene {s.id}: [{s.emotion_label}] {s.prompt[:60]}...")


def test_asset_selector():
    """Test asset selection (will use placeholders if no local assets)."""
    from workflow.emotion_engine import analyze_script
    from workflow.scene_planner import plan_scenes
    from workflow.asset_selector import select_assets

    script = "温暖阳光下，两个人紧紧拥抱在一起。"
    emotion = analyze_script(script)
    scenes = plan_scenes(script, emotion)
    enriched = select_assets(scenes)

    assert len(enriched) > 0
    for e in enriched:
        assert "assets" in e
        assert len(e["assets"]) > 0
        print(f"  Scene {e['scene_id']} ({e['emotion']}): {e['assets'][0]['source']}")


def test_render_engine():
    """Test render parameter building."""
    from workflow.emotion_engine import analyze_script
    from workflow.scene_planner import plan_scenes
    from workflow.asset_selector import select_assets
    from workflow.render_engine import build_render_params

    script = "焦虑的城市节奏让人喘不过气，但平静的湖面能治愈一切。"
    emotion = analyze_script(script)
    scenes = plan_scenes(script, emotion)
    enriched = select_assets(scenes)
    params = build_render_params(enriched)

    assert len(params) > 0
    for p in params:
        assert p.emotion in ("焦虑", "平静", "温暖", "孤独", "悲伤", "希望", "释怀", "迷茫")
        print(f"  Scene {p.scene_id}: {p.emotion} | filter={p.color_filter[:30] if p.color_filter else 'none'}...")


def test_full_pipeline():
    """Test the full emotion pipeline end-to-end."""
    from workflow.pipeline_orchestrator import run_pipeline, PipelineConfig

    config = PipelineConfig(
        script="深夜的孤独让人感到寒冷，但黎明终会到来。温暖的阳光会照进每一个角落。",
        ratio="1:1",
    )
    result = run_pipeline(config)

    assert result.status == "ok"
    assert result.job_id != ""
    assert result.emotion is not None
    assert len(result.scenes) > 0
    print(f"  Job: {result.job_id}")
    print(f"  Status: {result.status}")
    print(f"  Emotion: {result.emotion['summary']}")
    print(f"  Scenes: {len(result.scenes)}")
    print(f"  Video: {result.final_video}")


if __name__ == "__main__":
    print("=== test_analyze_script ===")
    test_analyze_script()
    print()
    print("=== test_emotion_lexicon_coverage ===")
    test_emotion_lexicon_coverage()
    print()
    print("=== test_plan_scenes ===")
    test_plan_scenes()
    print()
    print("=== test_asset_selector ===")
    test_asset_selector()
    print()
    print("=== test_render_engine ===")
    test_render_engine()
    print()
    print("=== test_full_pipeline ===")
    test_full_pipeline()
    print()
    print("All tests passed!")
