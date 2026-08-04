import os


INDEX_HTML = """<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>White Dragon Horse · CEO Console</title>
  <link rel="stylesheet" href="style.css" />
</head>
<body>
  <header class="topbar">
    <div class="brand">
      <span class="brand-mark">🐎</span>
      <div>
        <h1>White Dragon Horse</h1>
        <p class="sub">Local AGI Orchestrator · CEO Console</p>
      </div>
    </div>
    <div class="conn" id="conn"><span class="dot"></span> connecting…</div>
  </header>

  <main>
    <section class="cards" id="cards">
      <div class="card" data-key="pipeline"><h3>Pipeline</h3><p class="val">--</p></div>
      <div class="card" data-key="zoo"><h3>ZOO</h3><p class="val">--</p></div>
      <div class="card" data-key="trae"><h3>TRAE</h3><p class="val">--</p></div>
      <div class="card" data-key="huginn"><h3>Huginn</h3><p class="val">--</p></div>
    </section>

    <section class="pipeline">
      <h2>Pipeline Graph</h2>
      <svg class="pipe" viewBox="0 0 900 120" preserveAspectRatio="none">
        <defs>
          <linearGradient id="neon" x1="0" x2="1">
            <stop offset="0" stop-color="#00e5ff"/>
            <stop offset=".5" stop-color="#7c4dff"/>
            <stop offset="1" stop-color="#ff2d95"/>
          </linearGradient>
        </defs>
        <path class="pline" d="M20,60 H240 S280,20 330,60 H540 S580,100 640,60 H880"/>
        <circle cx="20" cy="60" r="8" class="pnode" data-i="0"/>
        <circle cx="280" cy="60" r="8" class="pnode" data-i="1"/>
        <circle cx="540" cy="60" r="8" class="pnode" data-i="2"/>
        <circle cx="880" cy="60" r="8" class="pnode" data-i="3"/>
      </svg>
      <div class="psteps">
        <span>AGI</span><span>ZOO</span><span>TRAE</span><span>Huginn</span>
      </div>
    </section>

    <section class="actions">
      <h2>Task Buttons</h2>
      <div class="btns" id="btns">
        <button class="btn neon" data-action="full">▶ Run Full Pipeline</button>
        <button class="btn" data-action="zoo">⚙ ZOO Generate</button>
        <button class="btn" data-action="trae">🔧 TRAE Execute</button>
        <button class="btn" data-action="browser">🌐 TagUI Browser</button>
        <button class="btn" data-action="daily">📅 Daily Tasks</button>
      </div>
    </section>

    <section class="terminal">
      <h2>Log Terminal</h2>
      <div class="logs" id="logs"><div class="log-line muted">[WhiteDragonHorse] waiting for connection…</div></div>
    </section>
  </main>

  <script src="app.js"></script>
</body>
</html>
"""


STYLE_CSS = """/* White minimal + neon cyberpunk */
:root {
  --bg: #f6f7fb;
  --card: #ffffff;
  --ink: #0d0f1a;
  --muted: #8a8fa3;
  --neon-cyan: #00e5ff;
  --neon-purple: #7c4dff;
  --neon-pink: #ff2d95;
}
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
  background: var(--bg);
  color: var(--ink);
  font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
  min-height: 100vh;
}
.topbar {
  display: flex; justify-content: space-between; align-items: center;
  padding: 18px 28px; background: var(--card);
  border-bottom: 1px solid #ececf4;
}
.brand { display: flex; align-items: center; gap: 14px; }
.brand-mark { font-size: 30px; }
.brand h1 { font-size: 20px; letter-spacing: .5px; }
.sub { font-size: 12px; color: var(--muted); }
.conn { font-size: 13px; color: var(--muted); display: flex; align-items: center; gap: 8px; }
.conn .dot { width: 9px; height: 9px; border-radius: 50%; background: #ffb020; box-shadow: 0 0 8px #ffb020; }
.conn.online .dot { background: #22c55e; box-shadow: 0 0 10px #22c55e; }

main { max-width: 1060px; margin: 26px auto; padding: 0 20px; display: grid; gap: 22px; }
section { background: var(--card); border-radius: 14px; padding: 20px 22px;
  border: 1px solid #ececf4; }
section h2 { font-size: 14px; color: var(--muted); text-transform: uppercase; letter-spacing: 1.2px; margin-bottom: 14px; }

/* status cards */
.cards { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; }
.card { background: var(--card); border: 1px solid #ececf4; border-radius: 12px; padding: 16px;
  transition: transform .18s ease, box-shadow .18s ease; }
.card:hover { transform: translateY(-3px); box-shadow: 0 0 0 1px var(--neon-cyan), 0 0 18px rgba(0,229,255,.35); }
.card h3 { font-size: 12px; color: var(--muted); margin-bottom: 8px; }
.card .val { font-size: 22px; font-weight: 700; }
.card.ok .val { color: #22c55e; }
.card.run .val { color: var(--neon-purple); text-shadow: 0 0 12px rgba(124,77,255,.6); }

/* pipeline graph */
.pipeline svg { width: 100%; }
.pline { fill: none; stroke: url(#neon); stroke-width: 3; stroke-dasharray: 12 8;
  animation: flow 1.6s linear infinite; }
@keyframes flow { to { stroke-dashoffset: -40; } }
.pnode { fill: #fff; stroke: url(#neon); stroke-width: 4; transition: all .3s ease; }
.pnode.on { fill: var(--neon-pink); filter: drop-shadow(0 0 8px var(--neon-pink)); }
.psteps { display: flex; justify-content: space-between; margin-top: 10px; font-size: 12px; color: var(--muted); }

/* buttons */
.btns { display: flex; flex-wrap: wrap; gap: 12px; }
.btn { padding: 12px 20px; border-radius: 10px; border: 1px solid #e2e4ee; background: #fff;
  font-size: 14px; color: var(--ink); cursor: pointer; transition: all .18s ease; }
.btn:hover { box-shadow: 0 0 0 1px var(--neon-purple), 0 0 16px rgba(124,77,255,.45); transform: translateY(-2px); }
.btn:disabled { opacity: .5; cursor: not-allowed; }
.btn.neon { background: linear-gradient(135deg, var(--neon-cyan), var(--neon-purple));
  color: #fff; border: none; box-shadow: 0 0 14px rgba(0,229,255,.4); }
.btn.neon:hover { box-shadow: 0 0 24px rgba(0,229,255,.7); }

/* terminal */
.logs { height: 200px; overflow-y: auto; background: #0d0f1a; border-radius: 10px;
  padding: 12px 14px; font-family: Consolas, monospace; font-size: 12.5px; }
.log-line { color: #b8ffdd; line-height: 1.7; }
.log-line.warn { color: #ffd166; }
.log-line.err { color: #ff6b6b; }
.log-line.muted { color: #5a6072; }

@media (max-width: 720px) {
  .cards { grid-template-columns: repeat(2, 1fr); }
  .topbar { padding: 14px 16px; }
}
"""


APP_JS = """const connEl = document.getElementById('conn');
const logsEl = document.getElementById('logs');
const cardMap = {};
document.querySelectorAll('.card').forEach(c => { cardMap[c.dataset.key] = c; });

function log(msg, cls = '') {
  const line = document.createElement('div');
  line.className = 'log-line ' + cls;
  line.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
  logsEl.appendChild(line);
  logsEl.scrollTop = logsEl.scrollHeight;
}

const proto = location.protocol === 'https:' ? 'wss' : 'ws';
const ws = new WebSocket(`${proto}://${location.host}/ws/logs`);

ws.onopen = () => { connEl.className = 'conn online'; connEl.innerHTML = '<span class=\\"dot\\"></span> online';
  log('WebSocket connected', 'muted'); };
ws.onclose = () => { connEl.className = 'conn'; connEl.innerHTML = '<span class=\\"dot\\"></span> offline'; };
ws.onmessage = (e) => {
  let msg;
  try { msg = JSON.parse(e.data); } catch { msg = { type: 'log', text: e.data }; }
  if (msg.type === 'status') {
    const [key, state] = [msg.key, msg.state];
    if (cardMap[key]) {
      cardMap[key].classList.toggle('run', state === 'run');
      cardMap[key].classList.toggle('ok', state === 'ok');
      cardMap[key].querySelector('.val').textContent = state;
    }
  } else if (msg.type === 'pipeline') {
    document.querySelectorAll('.pnode').forEach(n => n.classList.remove('on'));
    const idx = msg.step != null ? msg.step : -1;
    document.querySelectorAll('.pnode').forEach((n, i) => { if (i <= idx) n.classList.add('on'); });
  } else {
    log(msg.text || msg, msg.cls || '');
  }
};

document.querySelectorAll('.btn').forEach(btn => {
  btn.addEventListener('click', async () => {
    const action = btn.dataset.action;
    btn.disabled = true;
    log(`→ run ${action}`);
    try {
      const r = await fetch(`/api/run/${action}`, { method: 'POST' });
      const d = await r.json();
      log(d.message || JSON.stringify(d), d.ok ? '' : 'warn');
    } catch (err) {
      log('request failed: ' + err, 'err');
    }
    btn.disabled = false;
  });
});
"""


class ZooAuto:
    def open(self):
        print('[ZOO] Opening ZOO')

    def generate(self, tool, params):
        print(f'[ZOO] Generating with tool: {tool}, params: {params}')
        return {'result': 'generated', 'tool': tool}

    def export(self, path):
        print(f'[ZOO] Exporting to: {path}')

    def generate_frontend(self, project_root='ceo_console', style=None):
        """Generate a white-minimal + neon-cyberpunk CEO dashboard frontend."""
        style = style or {}
        root = os.path.join(os.getcwd(), project_root)
        os.makedirs(root, exist_ok=True)
        files = {
            'index.html': INDEX_HTML,
            'style.css': STYLE_CSS,
            'app.js': APP_JS,
        }
        for name, content in files.items():
            with open(os.path.join(root, name), 'w', encoding='utf-8') as f:
                f.write(content)
        print(f'[ZOO] Frontend generated at {root}/ (theme={style.get("theme", "default")})')
        return {'result': 'generated', 'path': root, 'files': list(files.keys())}
