import { useState, useEffect, useRef } from 'react'
import {
  fetchHealth,
  fetchAgents,
  fetchSchedulerAgents,
  fetchTasks,
  submitTask,
  fetchLeaderboard,
  API_BASE_URL,
} from './api'
import TaskDetail from './pages/TaskDetail.jsx'
import { useSSE } from './hooks/useSSE'

const IconRobot = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="11" width="18" height="10" rx="2" /><circle cx="12" cy="5" r="2" /><path d="M12 7v4" /><line x1="8" y1="16" x2="8" y2="16" /><line x1="16" y1="16" x2="16" y2="16" />
  </svg>
)
const IconDollar = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="1" x2="12" y2="23" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
  </svg>
)
const IconTrendingUp = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" /><polyline points="17 6 23 6 23 12" />
  </svg>
)
const IconWallet = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" /><path d="M3 5v14a2 2 0 0 0 2 2h16v-5" /><path d="M18 12a2 2 0 0 0-2 2v1a2 2 0 0 0 2 2h3v-5z" />
  </svg>
)
const IconSend = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
  </svg>
)
const IconRefresh = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
  </svg>
)
const IconActivity = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
  </svg>
)
const IconClock = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
  </svg>
)
const IconPlus = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
  </svg>
)
const IconChevronRight = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="9 18 15 12 9 6" />
  </svg>
)

function StatCard({ icon, label, value, color, suffix, loading }) {
  const colorMap = {
    blue: { bg: 'rgba(59,130,246,0.1)', text: '#60a5fa', border: 'rgba(59,130,246,0.2)' },
    green: { bg: 'rgba(16,185,129,0.1)', text: '#34d399', border: 'rgba(16,185,129,0.2)' },
    purple: { bg: 'rgba(139,92,246,0.1)', text: '#a78bfa', border: 'rgba(139,92,246,0.2)' },
    orange: { bg: 'rgba(245,158,11,0.1)', text: '#fbbf24', border: 'rgba(245,158,11,0.2)' },
  }
  const c = colorMap[color] || colorMap.blue
  return (
    <div className="card-glow" style={{
      background: 'var(--bg-card)',
      border: '1px solid var(--border-color)',
      borderRadius: '16px', padding: '20px 24px',
      display: 'flex', alignItems: 'flex-start', gap: '16px',
      animation: 'slide-up 0.5s ease-out forwards',
    }}>
      <div style={{ background: c.bg, borderRadius: '12px', padding: '10px', color: c.text, border: `1px solid ${c.border}`, display: 'flex', }}>{icon}</div>
      <div>
        <div style={{ fontSize: '13px', color: 'var(--text-muted)', fontWeight: 500, marginBottom: '4px' }}>{label}</div>
        <div style={{ fontSize: '26px', fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.2 }}>
          {value}{suffix && <span style={{ fontSize: '14px', fontWeight: 400, color: 'var(--text-secondary)', marginLeft: '4px' }}>{suffix}</span>}
        </div>
      </div>
    </div>
  )
}

function AgentCard({ agent }) {
  const statusColor = agent.survival_status === 'alive' ? 'var(--accent-green)' : agent.survival_status === 'warning' ? 'var(--accent-orange)' : '#ef4444'
  return (
    <div className="card-glow" style={{
      background: 'var(--bg-card)', border: '1px solid var(--border-color)',
      borderRadius: '14px', padding: '18px 20px',
      animation: 'slide-up 0.5s ease-out forwards',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{
            width: '36px', height: '36px', borderRadius: '10px',
            background: 'linear-gradient(135deg, var(--accent-blue), var(--accent-purple))',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'white', fontSize: '16px', fontWeight: 700,
          }}>{agent.signature?.charAt(0)?.toUpperCase() || 'A'}</div>
          <div>
            <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)' }}>{agent.signature}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '2px' }}>
              <span className={`status-dot ${agent.survival_status === 'alive' ? 'connected' : 'disconnected'}`} />
              <span style={{ fontSize: '12px', color: statusColor }}>{agent.survival_status || 'unknown'}</span>
            </div>
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: '18px', fontWeight: 700, color: 'var(--accent-green)' }}>${(agent.balance || 0).toFixed(2)}</div>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>余额</div>
        </div>
      </div>
      {agent.current_activity && (
        <div style={{ fontSize: '11px', color: 'var(--text-muted)', borderTop: '1px solid var(--border-color)', paddingTop: '8px', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
          <IconActivity /> {agent.current_activity}
        </div>
      )}
    </div>
  )
}

function TaskRow({ task, onClick, onUpgrade }) {
  const status = (task.status || 'pending').toLowerCase()
  const badgeClass = status === 'completed' || status === 'success' ? 'badge-completed'
    : status === 'running' || status === 'processing' ? 'badge-running'
    : status === 'failed' || status === 'error' ? 'badge-failed'
    : 'badge-pending'
  const statusLabel = status === 'completed' ? '已完成' : status === 'running' ? '运行中' : status === 'failed' ? '失败' : '等待中'

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '10px 14px', borderBottom: '1px solid var(--border-color)',
      fontSize: '13px', transition: 'background 0.2s', cursor: 'pointer',
    }}
      onClick={() => onClick?.(task.task_id)}
      onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-card-hover)'}
      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: 1, minWidth: 0 }}>
        <span className={badgeClass}>{statusLabel}</span>
        <span style={{ color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '300px' }}>
          {task.prompt || task.task_id || '-'}
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', color: 'var(--text-secondary)', flexShrink: 0 }}>
        {task.agent && <span>{task.agent}</span>}
        {task.created_at && (
          <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <IconClock />{new Date(task.created_at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
          </span>
        )}
        {/* 升级到 Deep Mode 按钮 — 仅在 Fast Mode 已完成任务上显示 */}
        {status === 'completed' && task.mode === 'fast' && onUpgrade && (
          <button
            onClick={(e) => { e.stopPropagation(); onUpgrade(task); }}
            style={{
              padding: '4px 10px', borderRadius: '6px', border: 'none',
              fontSize: '11px', fontWeight: 600, cursor: 'pointer',
              background: 'linear-gradient(135deg, #6366f1, #3b82f6)',
              color: '#fff', display: 'flex', alignItems: 'center', gap: '4px',
              whiteSpace: 'nowrap', transition: 'opacity 0.2s',
            }}
            onMouseEnter={e => e.currentTarget.style.opacity = '0.85'}
            onMouseLeave={e => e.currentTarget.style.opacity = '1'}
            title="将此任务升级到 Deep Mode 进行深度优化"
          >
            ✨ 发送到深度模式
          </button>
        )}
      </div>
    </div>
  )
}

function EventLog({ events }) {
  const scrollRef = useRef(null)
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [events])

  return (
    <div ref={scrollRef} style={{
      background: '#1a1b2e', borderRadius: '12px', padding: '14px',
      maxHeight: '300px', overflowY: 'auto', fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      fontSize: '12px', lineHeight: 1.6, border: '1px solid rgba(99,102,241,0.15)',
    }}>
      {events.length === 0 ? (
        <div style={{ color: 'rgba(255,255,255,0.3)', textAlign: 'center', padding: '20px' }}>
          等待任务事件...
        </div>
      ) : (
        events.map((evt, i) => {
          const type = evt.type || 'message'
          const color = type === 'task_completed' ? '#34d399'
            : type === 'task_error' ? '#ef4444'
            : type === 'agent_thinking' ? '#60a5fa'
            : type === 'code_generated' ? '#f59e0b'
            : type === 'work_submitted' ? '#a78bfa'
            : type === 'connected' ? '#34d399'
            : 'rgba(255,255,255,0.5)'
          const icon = type === 'task_completed' ? '✅'
            : type === 'task_error' ? '❌'
            : type === 'agent_thinking' ? '🤔'
            : type === 'code_generated' ? '💻'
            : type === 'artifact_created' ? '📄'
            : type === 'work_submitted' ? '📤'
            : type === 'connected' ? '🔗'
            : '•'
          const msg = evt.thought || evt.message || evt.text || (evt.type === 'connected' ? 'SSE 流已连接' : JSON.stringify(evt).slice(0, 120))
          return (
            <div key={i} style={{
              display: 'flex', gap: '8px', padding: '2px 0',
              borderBottom: i < events.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none',
            }}>
              <span style={{ color, flexShrink: 0 }}>{icon}</span>
              <span style={{ color: 'rgba(255,255,255,0.8)', wordBreak: 'break-word' }}>{msg}</span>
            </div>
          )
        })
      )}
    </div>
  )
}

// 基线 Agent 列表 — 后端不可用时作为降级兜底
const baselineAgents = [
  { signature: 'ClawAgent-01', survival_status: 'offline', balance: 0, current_activity: '未连接到服务器' },
  { signature: 'deepseek-agent', survival_status: 'offline', balance: 0, current_activity: '未连接到服务器' },
  { signature: 'deepseek-local-test', survival_status: 'offline', balance: 0, current_activity: '未连接到服务器' },
]

export default function App() {
  const [connectionStatus, setConnectionStatus] = useState('connecting')
  const [agents, setAgents] = useState(baselineAgents)
  const [tasks, setTasks] = useState([])
  const [stats, setStats] = useState({ agentCount: 0, totalRevenue: 0, totalCost: 0, totalBalance: 0 })
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [submitMsg, setSubmitMsg] = useState('')
  const [prompt, setPrompt] = useState('')
  const [selectedTask, setSelectedTask] = useState(null)
  const [liveTaskId, setLiveTaskId] = useState(null)
  const [showLiveLog, setShowLiveLog] = useState(false)
  const [engineMode, setEngineMode] = useState('fast') // 'fast' (2层) 或 'deep' (5层)
  const wsRef = useRef(null)
  const { events, connectionStatus: sseStatus, connect: connectSSE, disconnect: disconnectSSE } = useSSE()

  // ── SSE 流完成时自动刷新任务列表并关闭日志面板 ──
  useEffect(() => {
    if (sseStatus === 'done' || sseStatus === 'error') {
      // 延迟 500ms 让后端完成磁盘写入
      const timer = setTimeout(() => {
        fetchAll()
        // 在 Fast Mode 下，任务完成后自动关闭实时日志面板
        setShowLiveLog(false)
      }, 500)
      return () => clearTimeout(timer)
    }
  }, [sseStatus])

  const fetchAll = async () => {
    try {
      const [health, agentData, taskData, leaderData] = await Promise.allSettled([
        fetchHealth(), fetchAgents(), fetchTasks(), fetchLeaderboard(),
      ])
      if (health.status === 'fulfilled') setConnectionStatus('connected')
      if (agentData.status === 'fulfilled') {
        const fetched = agentData.value.agents || []
        setAgents(fetched.length > 0 ? fetched : baselineAgents)
      } else {
        setAgents(baselineAgents)
      }
      if (taskData.status === 'fulfilled') setTasks(taskData.value.tasks || [])
      if (leaderData.status === 'fulfilled') {
        const a = leaderData.value.agents || []
        setStats({
          agentCount: a.length,
          totalRevenue: a.reduce((s, x) => s + (x.total_work_income || 0), 0),
          totalCost: a.reduce((s, x) => s + (x.total_token_cost || 0), 0),
          totalBalance: a.reduce((s, x) => s + (x.current_balance || x.balance || 0), 0),
        })
      }
    } catch {
      setConnectionStatus('disconnected')
      setAgents(baselineAgents)
    }
    finally { setLoading(false) }
  }

  useEffect(() => { fetchAll(); const i = setInterval(fetchAll, 10000); return () => clearInterval(i) }, [])

  // WebSocket — 连接后端 8010 端口而不是前端 3000
  useEffect(() => {
    let t
    const connect = () => {
      // 直接从 API_BASE_URL 提取 WebSocket URL
      const wsBase = API_BASE_URL.replace(/^http/, 'ws')
      const s = new WebSocket(`${wsBase}/ws`)
      wsRef.current = s
      s.onopen = () => setConnectionStatus('connected')
      s.onmessage = (e) => { try { const d = JSON.parse(e.data); if (['balance_update','activity_update','task_update'].includes(d.type)) fetchAll() } catch {} }
      s.onclose = () => { setConnectionStatus('disconnected'); t = setTimeout(connect, 5000) }
      s.onerror = () => s.close()
    }
    connect()
    return () => { clearTimeout(t); if (wsRef.current) wsRef.current.close() }
  }, [])

  const handleSubmit = async (extraParams) => {
    if (!prompt.trim() && !extraParams) return
    setSubmitting(true)
    setSubmitMsg('')
    setShowLiveLog(true)
    try {
      const payload = extraParams || { prompt: prompt.trim(), mode: engineMode }
      const r = await submitTask(payload)
      const taskId = r.task_id
      const label = extraParams ? '✨ 深度升级任务已提交' : '✅ 已提交'
      setSubmitMsg(label + '！ID: ' + taskId)
      setLiveTaskId(taskId)
      if (!extraParams) setPrompt('')
      // 通过 SSE 连接实时流
      connectSSE(taskId)
      fetchAll()
    } catch (e) {
      setSubmitMsg('❌ 失败: ' + e.message)
    }
    finally { setSubmitting(false); setTimeout(() => setSubmitMsg(''), 8000) }
  }

  // ── 处理 "发送到深度模式" 升级操作 ──
  const handleUpgrade = async (fastTask) => {
    // 将已完成的 Fast Mode 任务升级到 Deep Mode
    // payload 包含原始 prompt，但强制 mode='deep' 并附带 parent_task_id
    const upgradePayload = {
      prompt: fastTask.prompt || fastTask.task_id,
      mode: 'deep',
      parent_task_id: fastTask.task_id,
      occupation: fastTask.occupation || 'Software Engineer',
      sector: fastTask.sector || 'Technology',
    }
    setPrompt('') // 清空当前输入
    setEngineMode('deep') // 切换到 Deep Mode 标签
    setSubmitMsg(`✨ 正在将任务 ${fastTask.task_id} 发送到深度模式...`)
    await handleSubmit(upgradePayload) // 复用提交逻辑
  }

  const fmt = (v) => (v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  if (selectedTask) {
    return <TaskDetail taskId={selectedTask} onBack={() => { setSelectedTask(null); fetchAll() }} />
  }

  const isLiveRunning = sseStatus === 'connecting' || sseStatus === 'connected'

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <header className="glass" style={{
        position: 'sticky', top: 0, zIndex: 50,
        borderBottom: '1px solid var(--border-color)',
        padding: '12px 32px', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{
            width: '36px', height: '36px', borderRadius: '10px',
            background: 'linear-gradient(135deg, var(--accent-cyan), var(--accent-blue), var(--accent-purple))',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'white', fontWeight: 800, fontSize: '18px',
          }}>C</div>
          <div>
            <h1 style={{ fontSize: '18px', fontWeight: 700, margin: 0 }}>ClawAI</h1>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 500 }}>AI Agent 任务平台</span>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          {isLiveRunning && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: '6px', padding: '4px 12px',
              borderRadius: '20px', background: 'rgba(96,165,250,0.12)', border: '1px solid rgba(96,165,250,0.25)',
              fontSize: '12px', color: '#60a5fa', fontWeight: 500,
            }}>
              <span className="pulse-dot" /> 运行中
            </div>
          )}
          {/* Force Reset 按钮 — 当 UI 卡在 Submitting/Connecting 时手动解锁 */}
          {(submitting || sseStatus === 'connecting') && (
            <button
              onClick={() => {
                setSubmitting(false)
                setShowLiveLog(false)
                disconnectSSE()
                setSubmitMsg('')
                setLiveTaskId(null)
              }}
              style={{
                padding: '8px 14px', fontSize: '13px', borderRadius: '8px',
                background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)',
                color: '#ef4444', cursor: 'pointer', fontWeight: 600,
                display: 'flex', alignItems: 'center', gap: '6px',
              }}
              title="当任务卡住时强制重置 UI 状态"
            >
              🔓 重置 UI
            </button>
          )}
          <button className="btn-secondary" onClick={fetchAll} style={{ padding: '8px 14px', fontSize: '13px', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <IconRefresh /> 刷新
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', fontWeight: 500 }}>
            <span className={`status-dot ${connectionStatus === 'connected' ? 'connected' : 'disconnected'}`} />
            <span style={{ color: connectionStatus === 'connected' ? 'var(--accent-green)' : '#ef4444' }}>
              {connectionStatus === 'connected' ? '已连接' : '已断开'}
            </span>
          </div>
        </div>
      </header>

      <main style={{ flex: 1, padding: '28px 32px', maxWidth: '1280px', width: '100%', margin: '0 auto' }}>
        <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px', marginBottom: '32px' }}>
          <StatCard icon={<IconRobot />} label="Agent 数量" value={stats.agentCount} color="blue" />
          <StatCard icon={<IconDollar />} label="总收益" value={`$${fmt(stats.totalRevenue)}`} color="green" />
          <StatCard icon={<IconTrendingUp />} label="总成本" value={`$${fmt(stats.totalCost)}`} color="orange" />
          <StatCard icon={<IconWallet />} label="总余额" value={`$${fmt(stats.totalBalance)}`} color="purple" />
        </section>

        {/* 实时进度日志面板 */}
        {showLiveLog && (
          <section style={{ marginBottom: '24px' }}>
            <div className="card-glow" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '16px', overflow: 'hidden' }}>
              <div style={{
                padding: '14px 20px', borderBottom: '1px solid var(--border-color)',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              }}>
                <h2 style={{ fontSize: '14px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ color: '#60a5fa' }}>⚡</span> 5层Agent实时进度
                  {isLiveRunning && <span style={{ fontSize: '11px', fontWeight: 400, color: 'var(--text-muted)' }}>(运行中...)</span>}
                </h2>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{
                    fontSize: '11px', padding: '2px 8px', borderRadius: '10px',
                    background: sseStatus === 'done' ? 'rgba(52,211,153,0.15)' : sseStatus === 'error' ? 'rgba(239,68,68,0.15)' : 'rgba(96,165,250,0.15)',
                    color: sseStatus === 'done' ? '#34d399' : sseStatus === 'error' ? '#ef4444' : '#60a5fa',
                    fontWeight: 500,
                  }}>
                    {sseStatus === 'done' ? '已完成' : sseStatus === 'error' ? '失败' : sseStatus === 'connecting' ? '连接中...' : sseStatus === 'connected' ? '已连接' : '空闲'}
                  </span>
                  <button
                    onClick={() => { setShowLiveLog(false); disconnectSSE() }}
                    style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '16px', padding: '2px 6px' }}
                    title="关闭实时日志"
                  >×</button>
                </div>
              </div>
              <div style={{ padding: '14px 20px' }}>
                <EventLog events={events} />
              </div>
              {/* 已完成的步骤计数 */}
              {events.length > 0 && (
                <div style={{
                  padding: '10px 20px', borderTop: '1px solid var(--border-color)',
                  fontSize: '11px', color: 'var(--text-muted)', display: 'flex', gap: '16px',
                }}>
                  <span>🤔 思考: {events.filter(e => e.type === 'agent_thinking').length}</span>
                  <span>💻 代码: {events.filter(e => e.type === 'code_generated').length}</span>
                  <span>📄 产出: {events.filter(e => e.type === 'artifact_created').length}</span>
                </div>
              )}
            </div>
          </section>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', marginBottom: '32px' }}>
          <section>
            <div className="card-glow" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '16px', padding: '24px' }}>
              <h2 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <IconPlus /> 提交任务
              </h2>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '16px' }}>描述需求，AI Agent 自动执行</p>
              <textarea
                className="input-dark"
                value={prompt}
                onChange={e => setPrompt(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSubmit() }}
                placeholder="例如：帮我开发一个 3D 投掷游戏 HTML 页面..."
                rows={6}
                style={{ width: '100%', borderRadius: '10px', padding: '14px', fontSize: '14px', lineHeight: 1.6, resize: 'vertical', fontFamily: 'inherit' }}
              />
              {/* 引擎模式切换开关 */}
              <div style={{
                marginTop: '14px', padding: '6px', borderRadius: '12px',
                background: 'var(--bg-secondary)', border: '1px solid var(--border-color)',
                display: 'flex', gap: '4px',
              }}>
                <button
                  onClick={() => setEngineMode('fast')}
                  style={{
                    flex: 1, padding: '8px 12px', borderRadius: '8px', border: 'none',
                    fontSize: '12px', fontWeight: 600, cursor: 'pointer', transition: 'all 0.25s',
                    background: engineMode === 'fast'
                      ? 'linear-gradient(135deg, #f59e0b, #f97316)'
                      : 'transparent',
                    color: engineMode === 'fast' ? '#fff' : 'var(--text-muted)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
                  }}
                >
                  <span style={{ fontSize: '14px' }}>🚀</span>
                  <span>Fast Mode (2层Demo)</span>
                  <span style={{
                    fontSize: '10px', opacity: 0.7, fontWeight: 400,
                    color: engineMode === 'fast' ? 'rgba(255,255,255,0.8)' : 'var(--text-muted)',
                  }}>~45秒</span>
                </button>
                <button
                  onClick={() => setEngineMode('deep')}
                  style={{
                    flex: 1, padding: '8px 12px', borderRadius: '8px', border: 'none',
                    fontSize: '12px', fontWeight: 600, cursor: 'pointer', transition: 'all 0.25s',
                    background: engineMode === 'deep'
                      ? 'linear-gradient(135deg, #6366f1, #3b82f6)'
                      : 'transparent',
                    color: engineMode === 'deep' ? '#fff' : 'var(--text-muted)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
                  }}
                >
                  <span style={{ fontSize: '14px' }}>🧠</span>
                  <span>Deep Mode (5层Agent)</span>
                  <span style={{
                    fontSize: '10px', opacity: 0.7, fontWeight: 400,
                    color: engineMode === 'deep' ? 'rgba(255,255,255,0.8)' : 'var(--text-muted)',
                  }}>自主执行</span>
                </button>
              </div>

              {submitMsg && (
                <div style={{
                  marginTop: '12px', padding: '10px 14px', borderRadius: '8px', fontSize: '13px',
                  background: submitMsg.startsWith('✅') ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)',
                  color: submitMsg.startsWith('✅') ? 'var(--accent-green)' : '#ef4444',
                  border: `1px solid ${submitMsg.startsWith('✅') ? 'rgba(16,185,129,0.2)' : 'rgba(239,68,68,0.2)'}`,
                }}>{submitMsg}</div>
              )}
              <button className="btn-primary" disabled={submitting || !prompt.trim()} onClick={() => handleSubmit()}
                style={{ marginTop: '12px', padding: '12px 24px', borderRadius: '10px', fontSize: '14px', display: 'flex', alignItems: 'center', gap: '8px', width: '100%', justifyContent: 'center' }}>
                {submitting ? '提交中...' : <><IconSend /> 提交任务</>}
              </button>
              <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '8px', textAlign: 'center' }}>⌘+Enter 快捷提交</p>
            </div>
          </section>

          <section>
            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '16px', padding: '20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <h2 style={{ fontSize: '16px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <IconRobot /> Agent 列表
                </h2>
                <span style={{ fontSize: '12px', color: 'var(--text-muted)', background: 'var(--bg-card-hover)', padding: '4px 10px', borderRadius: '6px' }}>
                  {agents.length} 在线
                </span>
              </div>
              {agents.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-muted)', fontSize: '14px' }}>
                  <p>暂无 Agent 数据</p>
                  <p style={{ fontSize: '12px' }}>提交任务后自动创建</p>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {agents.map(a => <AgentCard key={a.signature} agent={a} />)}
                </div>
              )}
            </div>
          </section>
        </div>

        <section>
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '16px', overflow: 'hidden' }}>
            <div style={{ padding: '18px 20px', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ fontSize: '16px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
                任务记录
              </h2>
              <span style={{ fontSize: '12px', color: 'var(--text-muted)', background: 'var(--bg-card-hover)', padding: '4px 10px', borderRadius: '6px' }}>
                {tasks.length} 条
              </span>
            </div>
            {tasks.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-muted)', fontSize: '14px' }}>
                <IconClock />
                <p style={{ marginTop: '8px' }}>暂无任务记录</p>
                <p style={{ fontSize: '12px' }}>提交任务后将显示在这里</p>
              </div>
            ) : (
              <div>
                {tasks.slice().reverse().map((task) => (
                  <TaskRow key={task.task_id} task={task} onClick={(id) => setSelectedTask(id)} onUpgrade={handleUpgrade} />
                ))}
              </div>
            )}
          </div>
        </section>
      </main>

      <footer style={{ borderTop: '1px solid var(--border-color)', padding: '16px 32px', textAlign: 'center', fontSize: '12px', color: 'var(--text-muted)' }}>
        ClawAI · AI Agent Task Platform · {new Date().getFullYear()}
      </footer>
    </div>
  )
}