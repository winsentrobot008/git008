from datetime import datetime
from pathlib import Path

def generate_markdown_report(opportunities, output_dir="./reports"):
    Path(output_dir).mkdir(parents=True, exist_ok=True)
    now = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"{output_dir}/opp_brief_{now}.md"
    content = f"# Maneki-AI 情报简报 {now}\n\n"
    for idx, opp in enumerate(opportunities, 1):
        content += f"## {idx}. {opp.get('title', '未命名')}\n"
        content += f"- 来源: {opp.get('source')}\n"
        content += f"- 置信度: {opp.get('score')}\n"
        content += f"- 摘要: {opp.get('summary')}\n\n"
    with open(filename, "w", encoding="utf-8") as f:
        f.write(content)
    return filename
