const API_BASE_URL = 'http://localhost:8010';
const BASE = `${API_BASE_URL}/api`;

const get = async (url) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`API error: ${res.status} ${res.statusText}`);
  return res.json();
};

const post = async (url, body) => {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`API error: ${res.status} ${res.statusText}`);
  return res.json();
};

const del = async (url) => {
  const res = await fetch(url, { method: 'DELETE' });
  if (!res.ok) throw new Error(`API error: ${res.status} ${res.statusText}`);
  return res.json();
};

export { API_BASE_URL };
export const fetchHealth = () => get(`${BASE}/health`);

export const fetchAgents = () => get(`${BASE}/agents`);

export const fetchSchedulerAgents = () => get(`${BASE}/scheduler/agents`);

export const fetchAgentDetail = (signature) => get(`${BASE}/agents/${encodeURIComponent(signature)}`);

export const fetchAgentEconomic = (signature) => get(`${BASE}/agents/${encodeURIComponent(signature)}/economic`);

export const fetchAgentTasks = (signature) => get(`${BASE}/agents/${encodeURIComponent(signature)}/tasks`);

export const fetchTasks = () => get(`${BASE}/tasks`);

export const fetchTaskStatus = (taskId) => get(`${BASE}/tasks/${encodeURIComponent(taskId)}`);

export const submitTask = (data) => post(`${BASE}/tasks`, data);

export const resubmitTask = (taskId, prompt) => post(`${BASE}/tasks/${encodeURIComponent(taskId)}/resubmit`, { prompt });

export const deleteTask = (taskId) => del(`${BASE}/tasks/${encodeURIComponent(taskId)}`);

export const fetchTaskDetail = (taskId) => get(`${BASE}/tasks/${encodeURIComponent(taskId)}/detail`);

export const fetchLeaderboard = () => get(`${BASE}/leaderboard`);

export const fetchHiddenAgents = () => get(`${BASE}/settings/hidden-agents`);

export const saveHiddenAgents = (hiddenArray) =>
  fetch(`${BASE}/settings/hidden-agents`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hidden: hiddenArray }),
  });

export const fetchDisplayNames = () => get(`${BASE}/settings/displaying-names`);