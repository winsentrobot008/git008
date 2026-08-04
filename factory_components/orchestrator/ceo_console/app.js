const connEl = document.getElementById('conn');
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

ws.onopen = () => { connEl.className = 'conn online'; connEl.innerHTML = '<span class=\"dot\"></span> online';
  log('WebSocket connected', 'muted'); };
ws.onclose = () => { connEl.className = 'conn'; connEl.innerHTML = '<span class=\"dot\"></span> offline'; };
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
