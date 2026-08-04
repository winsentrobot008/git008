"""
MediaIndexerPro — Multi-Topic Automated Test Suite

Tests 12 topics for:
- Response time
- Item count
- Source diversity
- Type diversity
- Error rate
"""

import json
import time
import sys
import os
from pathlib import Path

# Set stdout to utf-8 to handle Unicode characters
sys.stdout.reconfigure(encoding='utf-8')  # type: ignore

# Add project root
sys.path.insert(0, str(Path(__file__).parent))

try:
    import urllib.request, urllib.parse
except ImportError:
    import urllib.request, urllib.parse

API_BASE = "http://127.0.0.1:8000"

TOPICS = [
    "cat",
    "dog",
    "AI \u672a\u6765",
    "Elon Musk",
    "\u4e1c\u65b9\u667a\u6167",
    "\u7126\u8651\u578b\u4eba\u683c",
    "\u5546\u4e1a\u6218\u7565",
    "\u5fc3\u7406\u5b66\u6210\u957f",
    "\u65c5\u884c\u98ce\u666f",
    "\u5065\u8eab\u8bad\u7ec3",
    "\u70f9\u996a\u7f8e\u98df",
    "\u79d1\u6280\u8d8b\u52bf",
]

REQUIREMENTS = {
    "min_items": 3,
    "min_sources": 2,
    "min_types": 2,
}


def call_api(topic: str) -> tuple[dict | None, float, str | None]:
    """Call the API and return (data, elapsed_ms, error)."""
    url = f"{API_BASE}/api/search?topic={urllib.parse.quote(topic)}"
    start = time.time()
    try:
        req = urllib.request.Request(url)
        with urllib.request.urlopen(req, timeout=120) as resp:
            elapsed = (time.time() - start) * 1000
            data = json.loads(resp.read().decode("utf-8"))
            return data, elapsed, None
    except Exception as e:
        elapsed = (time.time() - start) * 1000
        return None, elapsed, str(e)


def analyze_topic(topic: str) -> dict:
    """Run a single topic test and return structured results."""
    data, elapsed_ms, error = call_api(topic)

    result = {
        "topic": topic,
        "response_time_ms": round(elapsed_ms, 1),
        "error": error,
        "total_items": 0,
        "sources": {},
        "types": {},
        "by_source": {},
        "by_type": {},
        "items_sample": [],
        "passed": False,
        "failures": [],
    }

    if error:
        result["failures"].append(f"API error: {error}")
        return result

    if data is None:
        result["failures"].append("No data returned")
        return result

    items = data.get("items", [])
    summary = data.get("summary", {})
    by_source = summary.get("by_source", {})
    by_type = summary.get("by_type", {})

    result["total_items"] = data.get("total_items", len(items))
    result["sources"] = by_source
    result["types"] = by_type
    result["by_source"] = by_source
    result["by_type"] = by_type
    result["by_source"] = {k: v for k, v in sorted(by_source.items(), key=lambda x: -x[1])}
    result["by_type"] = {k: v for k, v in sorted(by_type.items(), key=lambda x: -x[1])}

    # Sample first 3 items
    result["items_sample"] = [
        {"title": i.get("title", "")[:60], "source": i.get("source", ""), "type": i.get("type", "")}
        for i in items[:3]
    ]

    # Validation
    if result["total_items"] < REQUIREMENTS["min_items"]:
        result["failures"].append(
            f"Too few items: {result['total_items']} < {REQUIREMENTS['min_items']}"
        )

    if len(by_source) < REQUIREMENTS["min_sources"]:
        result["failures"].append(
            f"Too few sources: {len(by_source)} < {REQUIREMENTS['min_sources']}"
        )

    if len(by_type) < REQUIREMENTS["min_types"]:
        result["failures"].append(
            f"Too few types: {len(by_type)} < {REQUIREMENTS['min_types']}"
        )

    result["passed"] = len(result["failures"]) == 0
    return result


def run_all():
    """Run all topic tests and print report."""
    results = []
    total_start = time.time()

    print(f"{'='*80}")
    print(f"  MediaIndexerPro — Multi-Topic Automated Test")
    print(f"  API: {API_BASE}")
    print(f"  Topics: {len(TOPICS)}")
    print(f"{'='*80}\n")

    for i, topic in enumerate(TOPICS, 1):
        print(f"  [{i}/{len(TOPICS)}] Testing: {topic}...", end=" ", flush=True)
        result = analyze_topic(topic)
        results.append(result)

        status = "[PASS]" if result["passed"] else "[FAIL]"
        print(f"{status} | {result['total_items']:3d} items | "
              f"{result['response_time_ms']:8.1f}ms | "
              f"{len(result['sources'])} sources | "
              f"{len(result['types'])} types")

        if result["failures"]:
            for f in result["failures"]:
                print(f"         └─ {f}")

    total_elapsed = time.time() - total_start

    # Summary
    print(f"\n{'='*80}")
    print(f"  SUMMARY")
    print(f"{'='*80}")
    print(f"  Total time: {total_elapsed:.1f}s")
    print(f"  Avg time/topic: {(total_elapsed/len(TOPICS))*1000:.0f}ms")

    passed = sum(1 for r in results if r["passed"])
    failed = sum(1 for r in results if not r["passed"])
    total_items = sum(r["total_items"] for r in results)
    avg_items = total_items / len(TOPICS)
    avg_time = sum(r["response_time_ms"] for r in results) / len(TOPICS)
    max_time = max(r["response_time_ms"] for r in results)
    min_time = min(r["response_time_ms"] for r in results)

    # Aggregate sources
    all_sources = {}
    all_types = {}
    for r in results:
        for src, cnt in r["sources"].items():
            all_sources[src] = all_sources.get(src, 0) + cnt
        for typ, cnt in r["types"].items():
            all_types[typ] = all_types.get(typ, 0) + cnt

    print(f"  Passed: {passed}/{len(TOPICS)}")
    print(f"  Failed: {failed}/{len(TOPICS)}")
    print(f"  Total items: {total_items} (avg {avg_items:.0f}/topic)")
    print(f"  Avg response: {avg_time:.0f}ms")
    print(f"  Min response: {min_time:.0f}ms")
    print(f"  Max response: {max_time:.0f}ms")
    print(f"\n  Aggregate sources: {dict(sorted(all_sources.items(), key=lambda x: -x[1]))}")
    print(f"  Aggregate types: {dict(sorted(all_types.items(), key=lambda x: -x[1]))}")
    print(f"{'='*80}")

    return results, {
        "total_time_s": round(total_elapsed, 1),
        "avg_time_ms": round(avg_time, 1),
        "max_time_ms": round(max_time, 1),
        "min_time_ms": round(min_time, 1),
        "passed": passed,
        "failed": failed,
        "total_items": total_items,
        "avg_items_per_topic": round(avg_items, 1),
        "all_sources": dict(sorted(all_sources.items(), key=lambda x: -x[1])),
        "all_types": dict(sorted(all_types.items(), key=lambda x: -x[1])),
    }


if __name__ == "__main__":
    results, summary = run_all()

    # Save results
    output = {
        "test_timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "api_base": API_BASE,
        "topics_tested": len(TOPICS),
        "summary": summary,
        "results": results,
    }

    out_path = Path(__file__).parent.parent / "ui" / "webapp" / "multi_topic_test_results.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)
    print(f"\n  Results saved to: {out_path}")
