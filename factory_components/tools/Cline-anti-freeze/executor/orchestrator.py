import os, json, time, threading
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
import uvicorn

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
APP = FastAPI()
POLL_INTERVAL = 10

def project_path(project):
    return os.path.join(ROOT, "projects", project)

def read_json_safe(path):
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except:
        return None

@APP.post("/factory/events")
async def receive_event(req: Request):
    body = await req.json()
    project = body.get("project")
    agent = body.get("agent")
    payload = body.get("payload")
    rpt_dir = os.path.join(project_path(project), "reports")
    os.makedirs(rpt_dir, exist_ok=True)
    with open(os.path.join(rpt_dir, "events_received.log"), "a", encoding="utf-8") as f:
        f.write(json.dumps({"ts": time.time(), "agent": agent, "payload": payload}, ensure_ascii=False) + "\n")
    return JSONResponse({"ok": True})

def aggregate_loop(project):
    proj = project_path(project)
    reports_dir = os.path.join(proj, "reports")
    os.makedirs(reports_dir, exist_ok=True)
    while True:
        summary = {"project": project, "agents": {}, "updated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ")}
        agents_dir = os.path.join(proj, "agents")
        if os.path.exists(agents_dir):
            for agent in os.listdir(agents_dir):
                status_path = os.path.join(agents_dir, agent, "status.json")
                status = read_json_safe(status_path)
                summary["agents"][agent] = status or {"status": "unknown"}
        with open(os.path.join(reports_dir, "status_summary.json"), "w", encoding="utf-8") as f:
            json.dump(summary, f, indent=2, ensure_ascii=False)
        time.sleep(POLL_INTERVAL)

def start_aggregator_for(project):
    t = threading.Thread(target=aggregate_loop, args=(project,), daemon=True)
    t.start()

if __name__ == "__main__":
    projects_dir = os.path.join(ROOT, "projects")
    if os.path.exists(projects_dir):
        for p in os.listdir(projects_dir):
            start_aggregator_for(p)
    uvicorn.run(APP, host="0.0.0.0", port=4000)
