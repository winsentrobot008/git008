#!/usr/bin/env python3
"""GIT008 中央业务调度中枢 — 纯外部网络派发，与 OpenMontage 解耦。

OpenMontage 是独立的完整实体，可本地运行或 Docker/PyInstaller 打包部署。
本中枢仅通过标准 HTTP 请求与之通信，不依赖其内部文件结构。
"""

from fastapi import FastAPI, Form
from fastapi.responses import HTMLResponse
import urllib.request
import urllib.error
import json

app = FastAPI(title="GIT008 中央业务中枢")


HTML_PAGE = """<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>GIT008 中央业务中枢</title>
<style>
  * {{ box-sizing: border-box; margin: 0; padding: 0; }}
  body {{ font-family: 'Segoe UI', Arial, sans-serif; background: #0f111a; color: #e2e8f0; padding: 40px 20px; }}
  .wrap {{ max-width: 640px; margin: 0 auto; }}
  h2 {{ margin-bottom: 8px; color: #3b82f6; }}
  .sub {{ color: #8899aa; font-size: 14px; margin-bottom: 24px; }}
  .card {{ background: #1a1f2c; border-radius: 10px; padding: 24px; border: 1px solid #2e3748; }}
  label {{ display: block; font-size: 13px; color: #aabbcc; margin-top: 16px; margin-bottom: 4px; }}
  input, textarea {{ width: 100%; background: #0f111a; border: 1px solid #4a5568; color: white; padding: 10px; border-radius: 6px; font-size: 14px; font-family: inherit; }}
  textarea {{ height: 100px; resize: vertical; }}
  button {{ background: #3b82f6; color: white; border: none; padding: 12px 24px; border-radius: 6px; font-weight: 600; font-size: 15px; cursor: pointer; width: 100%; margin-top: 20px; }}
  button:hover {{ background: #2563eb; }}
  .result {{ margin-top: 16px; padding: 16px; border-radius: 6px; font-size: 14px; display: none; word-break: break-all; }}
  .result.ok {{ display: block; background: #0a2e1a; border: 1px solid #10b981; color: #7ddfb3; }}
  .result.err {{ display: block; background: #2e0a0a; border: 1px solid #ef4444; color: #fca5a5; }}
  .status {{ display: flex; gap: 12px; margin-bottom: 24px; }}
  .status-item {{ background: #1a1f2c; border-radius: 8px; padding: 12px 16px; flex: 1; text-align: center; font-size: 13px; border: 1px solid #2e3748; }}
  .status-item .val {{ font-size: 18px; font-weight: 700; margin-bottom: 2px; }}
  .status-item.green .val {{ color: #10b981; }}
  .status-item.red .val {{ color: #ef4444; }}
  a {{ color: #3b82f6; }}
</style>
</head>
<body>
<div class="wrap">
  <h2>GIT008 中央业务调度中枢</h2>
  <p class="sub">解耦模式 · OpenMontage 渲染器作为独立集群运行</p>

  <div class="status">
    <div class="status-item" id="sNode"><div class="val">--</div><div>OpenMontage 节点</div></div>
    <div class="status-item" id="sLocal"><div class="val">--</div><div>本地 Backlot</div></div>
  </div>

  <div class="card">
    <form onsubmit="return dispatch(event)">
      <label>目标 OpenMontage 服务地址（本地或云端 URL）：</label>
      <input type="text" id="targetUrl" value="http://127.0.0.1:7890">
      <label>批量文本录入：</label>
      <textarea id="texts" placeholder="输入口播文案...">让独立运行的 OpenMontage 渲染第一条 CEO 爆款视频！</textarea>
      <button type="submit">远程/本地一键派发</button>
    </form>
    <div class="result" id="result"></div>
  </div>
</div>
<script>
async function checkStatus() {{
  for (const url of ['http://127.0.0.1:7890', 'http://127.0.0.1:8000']) {{
    try {{
      const r = await fetch(url + '/api/health', {{ signal: AbortSignal.timeout(2000) }});
      const data = await r.json();
      const ok = data && data.ok;
      document.getElementById(url.includes('7890') ? 'sLocal' : 'sNode').className =
        'status-item ' + (ok ? 'green' : 'red');
      document.getElementById(url.includes('7890') ? 'sLocal' : 'sNode').querySelector('.val').textContent =
        ok ? '在线' : '离线';
    }} catch(e) {{
      document.getElementById(url.includes('7890') ? 'sLocal' : 'sNode').className = 'status-item red';
      document.getElementById(url.includes('7890') ? 'sLocal' : 'sNode').querySelector('.val').textContent = '离线';
    }}
  }}
}}
checkStatus();

async function dispatch(event) {{
  event.preventDefault();
  const el = document.getElementById('result');
  el.className = 'result'; el.style.display = 'none';
  const target = document.getElementById('targetUrl').value;
  const texts = document.getElementById('texts').value;
  try {{
    const res = await fetch('/dispatch', {{
      method: 'POST',
      headers: {{ 'Content-Type': 'application/x-www-form-urlencoded' }},
      body: 'target_url=' + encodeURIComponent(target) + '&texts=' + encodeURIComponent(texts),
    }});
    const html = await res.text();
    el.innerHTML = html; el.className = 'result ok';
  }} catch(e) {{ el.textContent = '请求失败: ' + e.message; el.className = 'result err'; }}
  return false;
}}
</script>
</body>
</html>"""


@app.get("/", response_class=HTMLResponse)
def index() -> str:
    return HTML_PAGE


@app.get("/api/health")
def health() -> dict:
    return {"ok": True, "app": "git008_main_panel"}


@app.post("/dispatch")
def dispatch_task(target_url: str = Form(...), texts: str = Form(...)) -> HTMLResponse:
    """纯外部网络调用 — 不依赖 OpenMontage 内部文件结构。"""
    lines = [t.strip() for t in texts.strip().split("\n") if t.strip()]
    results = []

    for i, text in enumerate(lines):
        payload = json.dumps({
            "name": "CEO_Standard",
            "text": text,
            "voice_type": "EdgeTTS",
            "mode": "talk",
        }).encode("utf-8")

        try:
            req = urllib.request.Request(
                f"{target_url.rstrip('/')}/api/ceo/publish",
                data=payload,
                headers={"Content-Type": "application/json"},
            )
            resp = urllib.request.urlopen(req, timeout=30)
            resp_data = json.loads(resp.read().decode("utf-8"))
            ok = resp_data.get("status") == "success"
            results.append(
                f"#{i+1}: {'✅' if ok else '❌'} "
                f"{resp_data.get('message', '')[:120]}"
            )
        except urllib.error.HTTPError as e:
            results.append(f"#{i+1}: ❌ HTTP {e.code}")
        except urllib.error.URLError:
            results.append(f"#{i+1}: ❌ 节点 [{target_url}] 不可达 — 请确认 OpenMontage 已独立启动")
        except Exception as e:
            results.append(f"#{i+1}: ❌ {e}")

    summary = "<br>".join(results)
    return HTMLResponse(
        f"<b>派发完成</b> — {len(lines)} 条<br>"
        f"目标节点: {target_url}<br><br>"
        f"{summary}"
    )
