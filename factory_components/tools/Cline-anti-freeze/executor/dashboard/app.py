from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
import os, json

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
APP = FastAPI()
static_dir = os.path.join(os.path.dirname(__file__), "static")
os.makedirs(static_dir, exist_ok=True)
APP.mount("/static", StaticFiles(directory=static_dir), name="static")

def load_summary(project):
    path = os.path.join(ROOT, "projects", project, "reports", "status_summary.json")
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except:
        return None

@APP.get("/factory/dashboard", response_class=HTMLResponse)
async def dashboard(request: Request, project: str = "MediaIndexerPro"):
    summary = load_summary(project)
    html = "<html><head><meta charset='utf-8'><title>Factory Dashboard</title></head><body>"
    html += f"<h1>Factory Dashboard - {project}</h1>"
    if not summary:
        html += "<p>No summary yet</p></body></html>"
        return HTMLResponse(html)
    html += "<ul>"
    for agent, st in summary.get('agents', {}).items():
        status = st.get('status','unknown')
        html += f"<li><b>{agent}</b>: {status}</li>"
    html += "</ul></body></html>"
    return HTMLResponse(html)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(APP, host="0.0.0.0", port=4001)
