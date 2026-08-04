"""
Sample Video Generator — 样本视频生成（3 条）
==============================================
Automatically selects 3 different strategies and generates sample videos.

Priority: TikTokApi -> yt-dlp -> Fallback
Output: preview/cn/ and preview/en/
"""

import sys, os, json, time
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.chdir(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from pathlib import Path
from datetime import datetime

ROOT = Path(__file__).resolve().parent.parent
TEMP = ROOT / "pipeline" / "temp"
OUTPUT = TEMP / "input_video_hd.mp4"
os.makedirs(TEMP, exist_ok=True)

LOG = lambda m: print(f"  {m}")


def generate_samples() -> list:
    """
    Generate 3 sample videos using different strategies.

    Returns:
        list of generated video paths
    """
    print()
    print("=" * 60)
    print("  ROASTBRO SAMPLE VIDEO GENERATOR")
    print("  Generating 3 sample videos with different strategies")
    print("=" * 60)

    from skills.video_source.skill_selector import STRATEGIES

    # Select strategies: prefer non-fallback ones first
    preferred_order = ["yt_dlp", "playwright", "fallback"]
    strategies_to_use = []
    for sid in preferred_order:
        for s in STRATEGIES:
            if s["id"] == sid:
                strategies_to_use.append(s)
                break

    # Fallback if any are missing
    if len(strategies_to_use) < 3:
        for s in STRATEGIES:
            if s not in strategies_to_use:
                strategies_to_use.append(s)
            if len(strategies_to_use) >= 3:
                break

    from pipeline.modules.editor_light import run_editor
    from pipeline.modules.voice_light import run_tts
    from pipeline.modules.publisher_light import synthesize

    generated_paths = []

    for idx, strategy in enumerate(strategies_to_use[:3]):
        LOG(f"\n  --- Sample {idx + 1}/3: {strategy['name']} ---")

        # Step 1: Generate source
        LOG(f"  [1] Generating source...")
        if OUTPUT.exists():
            OUTPUT.unlink()

        try:
            mod = __import__(strategy["module"], fromlist=["generate_hd_source"])
            mod.generate_hd_source({})
        except Exception as e:
            LOG(f"    Source error: {e}, using fallback")
            from skills.video_source.fallback_source import generate_hd_source
            generate_hd_source({})

        if not OUTPUT.exists() or os.path.getsize(OUTPUT) == 0:
            LOG(f"    [FAIL] No source generated, skipping")
            continue

        source_size = os.path.getsize(OUTPUT) / (1024 * 1024)
        LOG(f"    Source: {source_size:.2f} MB [OK]")

        # Step 2: Editor
        LOG(f"  [2] Running Editor...")
        try:
            editor_out = run_editor(
                input_video=str(OUTPUT),
                roast_points=[
                    {"text": f"Sample {idx+1}", "timestamp": 2},
                    {"text": strategy["name"], "timestamp": 5},
                ],
            )
            LOG(f"    Editor: {os.path.getsize(editor_out)/1024/1024:.2f} MB [OK]")
        except Exception as e:
            LOG(f"    Editor error: {e}, using source")
            editor_out = str(OUTPUT)

        # Step 3: Voice
        LOG(f"  [3] Generating Voice...")
        try:
            script_cn = f"zhe shi di {idx+1} ge yang ben shi pin, lai zi {strategy['name']} ce lve"
            script_en = f"This is sample video #{idx+1}, from {strategy['name']} strategy"
            voice_cn = run_tts(script_cn, lang="zh")
            voice_en = run_tts(script_en, lang="en")
            LOG(f"    Voice: CN={os.path.getsize(voice_cn)}b, EN={os.path.getsize(voice_en)}b [OK]")
        except Exception as e:
            LOG(f"    Voice error: {e}")
            voice_cn = str(TEMP / f"voice_cn_{idx}.mp3")
            voice_en = str(TEMP / f"voice_en_{idx}.mp3")
            Path(voice_cn).write_text("", encoding="utf-8")
            Path(voice_en).write_text("", encoding="utf-8")

        # Step 4: Publisher
        LOG(f"  [4] Running Publisher...")
        try:
            ts = datetime.now().strftime("%Y%m%d_%H%M%S")
            result = synthesize(
                video_path=editor_out,
                audio_path_cn=voice_cn,
                audio_path_en=voice_en,
                title=f"Sample #{idx+1} - {strategy['name']} #{ts}",
                seo_score_cn=85,
                seo_score_en=80,
                compliance="passed",
                script_summary=f"Sample video #{idx+1} using {strategy['name']} strategy",
                roast_points=2,
            )

            # Add strategy to metadata
            for mk in ["cn_meta_path", "en_meta_path"]:
                mp = result.get(mk, "")
                if mp:
                    try:
                        data = json.load(open(mp, encoding="utf-8"))
                        data["source_strategy"] = strategy["id"]
                        data["source_strategy_name"] = strategy["name"]
                        with open(mp, "w", encoding="utf-8") as f:
                            json.dump(data, f, indent=2, ensure_ascii=False)
                    except Exception:
                        pass

            for k, v in result.items():
                if v and os.path.isfile(v):
                    LOG(f"    {k}: {os.path.basename(v)} ({os.path.getsize(v)} bytes)")
                    generated_paths.append(v)

            LOG(f"    [OK] Sample #{idx + 1} complete")

        except Exception as e:
            LOG(f"    Publisher error: {e} [FAIL]")

    print()
    print("=" * 60)
    print(f"  SAMPLE VIDEO GENERATION COMPLETE")
    print(f"  Generated {len(generated_paths)} files")
    print("=" * 60)

    return generated_paths


if __name__ == "__main__":
    generate_samples()
