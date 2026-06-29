from typing import List, Dict

def fuse_radar_data(tavily_results, trendradar_hits, github_trending):
    all_items = []
    for item in tavily_results:
        all_items.append({"source": "tavily", **item})
    all_items.sort(key=lambda x: x.get("score", 0), reverse=True)
    return all_items[:20]
