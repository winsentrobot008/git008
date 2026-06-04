import os
from tavily import TavilyClient

def tavily_search(query: str, max_results: int = 5):
    api_key = os.getenv("TAVILY_API_KEY")
    if not api_key:
        print("⚠️ 未设置 TAVILY_API_KEY，使用模拟数据")
        return [{"title": f"模拟结果: {query}", "content": "模拟内容", "score": 0.8}]
    client = TavilyClient(api_key=api_key)
    response = client.search(query, max_results=max_results)
    return response.get("results", [])
