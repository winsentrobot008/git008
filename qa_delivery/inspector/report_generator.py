import sys
import time
from pathlib import Path


class QAReportGenerator:
    def __init__(self, base_dir=None):
        if base_dir is None:
            # 自动定位到 git008 根目录
            # 当前文件: qa_delivery/inspector/report_generator.py -> 向上 3 级
            self.root_dir = Path(__file__).resolve().parent.parent.parent
        else:
            self.root_dir = Path(base_dir)

        self.reports_dir = self.root_dir / "qa_delivery" / "reports"
        self.reports_dir.mkdir(parents=True, exist_ok=True)

    def generate_markdown_report(self, task_id: str, status: str, result_data: dict, log_trace: str = "") -> str:
        """
        生成标准 QA 验收 Markdown 报告
        """
        timestamp_str = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime())
        product = result_data.get("product", "orchestrator")
        cmd = result_data.get("cmd", "N/A")
        stdout = result_data.get("stdout", "").strip()
        exit_code = result_data.get("exit_code", 0 if status == "SUCCESS" else 1)

        status_emoji = "✅ PASS" if status == "SUCCESS" else "❌ FAIL / NEED_HUMAN"

        md_content = f"""# 🛡️ 白龙马 AGI 自动化 QA 质检报告

- **任务 ID (Task ID)**: `{task_id}`
- **目标产品 (Product)**: `{product}`
- **生成时间 (Timestamp)**: `{timestamp_str}`
- **质检结果 (Status)**: **{status_emoji}**

---

## 📋 执行明细 (Execution Details)

- **执行指令**: `{cmd}`
- **Exit Code**: `{exit_code}`
- **Max Retries 状态**: {"未触发熔断" if status == "SUCCESS" else "已触发熔断，转交人工介入"}

---

## 🖨️ 标准输出 (Stdout Capture)

```text
{stdout if stdout else "(无标准输出)"}
"""

        if log_trace:
            md_content += f"""## ⚠️ 异常堆栈 (Error Trace)

```text
{log_trace}
```
"""

        # 新增：网页截图（UI_E2E 巡检）
        screenshots = result_data.get("screenshots", [])
        if screenshots:
            md_content += "\n## 📸 网页截图 (Screenshots)\n\n"
            for sp in screenshots:
                md_content += f"![{Path(sp).name}]({sp})\n\n"

        # 新增：Console 报错（UI_E2E 巡检）
        console_errors = result_data.get("console_errors", [])
        if console_errors:
            md_content += "\n## 🖥️ Console 报错 (Console Errors)\n\n"
            for ce in console_errors[:20]:
                md_content += f"- `{ce}`\n"
            md_content += "\n"

        md_content += f"\n---\n*本报告由 White Dragon Horse AGI Orchestrator 巡检引擎自动生成于 `{timestamp_str}`*\n"

        report_file = self.reports_dir / f"inspection_{task_id}_{int(time.time())}.md"
        with open(report_file, "w", encoding="utf-8") as f:
            f.write(md_content)

        # 挂载发信引擎：将报告推送至汇报专用通道（预留 Webhook 出口）
        self.send_notification(md_content)

        return str(report_file)

    def send_notification(self, report_md: str) -> dict:
        """
        【预留】汇报专用通道：将 Markdown 报告打印到控制台汇报区。
        为后续接入 Webhook（钉钉/Slack/飞书/企业微信）预留统一出口。
        """
        # 安全打印：Windows 控制台默认 GBK 无法编码 emoji，统一转 UTF-8 + replace 避免崩溃
        try:
            sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass
        print("\n" + "=" * 60)
        print("[汇报专用通道] Webhook 预留挂载点（当前为控制台输出）")
        print("=" * 60)
        print(report_md)
        print("=" * 60)
        # TODO(预留): 接入 Webhook 时在此处调用 requests.post(webhook_url, json={"markdown": report_md})
        return {"channel": "console", "sent": True}
