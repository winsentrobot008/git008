import { useState, useEffect } from 'react'
import { fetchTaskDetail, resubmitTask, deleteTask, API_BASE_URL } from '../api'
import { useNavigate } from 'react-router-dom'

const TaskDetail = ({ taskId, onBack }) => {
  const [detail, setDetail] = useState(null)
  const [loading, setLoading] = useState(true)
  const [editPrompt, setEditPrompt] = useState('')
  const [editing, setEditing] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    if (taskId) {
      setLoading(true)
      fetchTaskDetail(taskId)
        .then(d => { setDetail(d); setEditPrompt(d.prompt || '') })
        .catch(e => setMsg('加载失败: ' + e.message))
        .finally(() => setLoading(false))
    }
  }, [taskId])

  const handleResubmit = async () => {
    if (!editPrompt.trim()) return
    setSubmitting(true)
    try {
      const result = await resubmitTask(taskId, editPrompt.trim())
      setMsg(`✅ 已重新提交！新任务ID: ${result.task_id}`)
      setTimeout(() => setMsg(''), 5000)
    } catch (e) {
      setMsg(`❌ 提交失败: ${e.message}`)
    } finally { setSubmitting(false) }
  }

  const handleDelete = async () => {
    // 乐观 UI：立即关闭并返回，防止挂起网络请求阻塞布局
    onBack()
    try {
      await deleteTask(taskId)
    } catch {
      // 静默抑制：后端不可用时不产生错误级联循环
    }
  }

  const formatTime = (ts) => {
    if (!ts) return ''
    return new Date(ts).toLocaleString('zh-CN')
  }

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-600" />
    </div>
  )

  if (!detail) return (
    <div className="p-8 text-center text-gray-500">
      <p>任务未找到</p>
      <button onClick={onBack} className="mt-4 btn-primary px-4 py-2 rounded-lg">返回</button>
    </div>
  )

  const codeSnippets = detail.code_generated || []
  const thinkingLog = detail.thinking_log || []
  const artifacts = detail.artifacts || []

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      {/* 顶部操作栏 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button onClick={onBack}
            className="p-2 hover:bg-gray-100 rounded-lg transition"
            title="返回列表"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <div>
            <h1 className="text-xl font-bold text-gray-900">任务详情</h1>
            <p className="text-xs text-gray-500 font-mono">{detail.task_id}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className={`px-3 py-1 rounded-full text-xs font-semibold ${
            detail.status === 'completed' ? 'bg-green-100 text-green-700 border border-green-300' :
            detail.status === 'running' ? 'bg-blue-100 text-blue-700 border border-blue-300 animate-pulse' :
            detail.status === 'error' ? 'bg-red-100 text-red-700 border border-red-300' :
            'bg-yellow-100 text-yellow-700 border border-yellow-300'
          }`}>
            {detail.status === 'completed' ? '已完成' :
             detail.status === 'running' ? '运行中' :
             detail.status === 'error' ? '失败' : '等待中'}
          </span>
          <button onClick={handleDelete}
            className="px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 border border-red-200 rounded-lg transition"
          >
            删除
          </button>
        </div>
      </div>

      {msg && (
        <div className={`p-3 rounded-lg text-sm ${
          msg.startsWith('✅') ? 'bg-green-50 text-green-700 border border-green-200' :
          msg.startsWith('❌') ? 'bg-red-50 text-red-700 border border-red-200' :
          'bg-blue-50 text-blue-700 border border-blue-200'
        }`}>
          {msg}
        </div>
      )}

      {/* 基本信息 */}
      <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-200">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div>
            <p className="text-gray-500">Agent</p>
            <p className="font-medium text-gray-900">{detail.agent || '-'}</p>
          </div>
          <div>
            <p className="text-gray-500">职业</p>
            <p className="font-medium text-gray-900">{detail.occupation || '-'}</p>
          </div>
          <div>
            <p className="text-gray-500">行业</p>
            <p className="font-medium text-gray-900">{detail.sector || '-'}</p>
          </div>
          <div>
            <p className="text-gray-500">创建时间</p>
            <p className="font-medium text-gray-900">{formatTime(detail.created_at)}</p>
          </div>
          <div>
            <p className="text-gray-500">支付</p>
            <p className="font-semibold text-green-600">${(detail.payment || 0).toFixed(2)}</p>
          </div>
          <div>
            <p className="text-gray-500">评分</p>
            <p className={`font-semibold ${(detail.evaluation_score || 0) >= 0.6 ? 'text-blue-600' : 'text-orange-500'}`}>
              {detail.evaluation_score != null ? (detail.evaluation_score * 100).toFixed(1) + '%' : '-'}
            </p>
          </div>
        </div>
      </div>

      {/* 提示词编辑 */}
      <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-200">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold text-gray-900">提示词</h2>
          <button onClick={() => setEditing(!editing)}
            className="text-xs text-blue-600 hover:text-blue-800"
          >
            {editing ? '取消' : '编辑'}
          </button>
        </div>
        {editing ? (
          <div className="space-y-3">
            <textarea
              className="w-full border border-gray-300 rounded-xl p-3 text-sm font-mono"
              rows={4}
              value={editPrompt}
              onChange={e => setEditPrompt(e.target.value)}
            />
            <div className="flex gap-2">
              <button onClick={handleResubmit} disabled={submitting}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
              >
                {submitting ? '提交中...' : '重新提交'}
              </button>
            </div>
          </div>
        ) : (
          <p className="text-sm text-gray-700 whitespace-pre-wrap bg-gray-50 rounded-xl p-3">
            {detail.prompt || '-'}
          </p>
        )}
      </div>

      {/* 错误信息 */}
      {detail.error && (
        <div className="bg-red-50 rounded-2xl p-5 border border-red-200">
          <h2 className="text-base font-semibold text-red-800 mb-2">错误</h2>
          <p className="text-sm text-red-700 font-mono whitespace-pre-wrap">{detail.error}</p>
        </div>
      )}

      {/* 思考日志 */}
      {thinkingLog.length > 0 && (
        <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-200">
          <h2 className="text-base font-semibold text-gray-900 mb-3">
            Agent 思考日志 ({thinkingLog.length} 条)
          </h2>
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {thinkingLog.map((entry, i) => (
              <div key={i} className="flex gap-3 text-sm">
                <span className="text-gray-400 font-mono text-xs mt-1 shrink-0">#{i + 1}</span>
                <div className="bg-gray-50 rounded-xl p-3 flex-1">
                  {entry.text && (
                    <p className="text-gray-700 whitespace-pre-wrap font-mono text-xs leading-relaxed">
                      {entry.text}
                    </p>
                  )}
                  {entry.timestamp && (
                    <p className="text-xs text-gray-400 mt-1">{formatTime(entry.timestamp)}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 代码生成 */}
      {codeSnippets.length > 0 && (
        <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-200">
          <h2 className="text-base font-semibold text-gray-900 mb-3">
            生成的代码 ({codeSnippets.length} 段)
          </h2>
          <div className="space-y-3 max-h-80 overflow-y-auto">
            {codeSnippets.map((s, i) => (
              <pre key={i} className="bg-gray-900 text-green-300 rounded-xl p-4 text-xs font-mono overflow-x-auto leading-relaxed">
                {s.code || s}
              </pre>
            ))}
          </div>
        </div>
      )}

      {/* Artifacts */}
      {artifacts.length > 0 && (
        <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-200">
          <h2 className="text-base font-semibold text-gray-900 mb-3">
            产出文件 ({artifacts.length})
          </h2>
          <div className="space-y-2">
            {artifacts.map((f, i) => (
              <div key={i} className="flex items-center gap-3 px-3 py-2 bg-gray-50 rounded-xl">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-gray-400 shrink-0">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
                </svg>
                <span className="text-sm text-gray-700 truncate flex-1">{f}</span>
                <span className="text-xs text-gray-400 shrink-0">保存路径: data/agent_data/...</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 保存路径说明 */}
      <div className="bg-gray-50 rounded-2xl p-4 border border-gray-200 text-xs text-gray-500">
        <p>📁 产出的文件保存在本地目录: <code className="bg-gray-200 px-2 py-0.5 rounded">livebench/data/agent_data/</code></p>
        <p className="mt-1">🔄 WebSocket 实时推送任务状态变化</p>
      </div>
    </div>
  )
}

export default TaskDetail