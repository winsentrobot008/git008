/**
 * useSSE — 前端 SSE (Server-Sent Events) 流连接 Hook
 *
 * 替代 WebSocket 用于实时任务进度更新。
 * 与 Hugging Face 在线版的 SSEUtils.js 行为一致。
 *
 * 用法：
 *   const { events, connectionStatus, connect, disconnect } = useSSE()
 *   connect(taskId)
 *   // events 数组自动推入实时事件
 */

import { useState, useRef, useCallback } from 'react'
import { API_BASE_URL } from '../api'

export const useSSE = () => {
  const [events, setEvents] = useState([])
  const [connectionStatus, setConnectionStatus] = useState('idle') // idle | connecting | connected | error | done
  const eventSourceRef = useRef(null)
  const taskIdRef = useRef(null)
  // 标记是否已正常完成，避免 onerror 覆盖 done 状态
  const completedRef = useRef(false)

  const disconnect = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
      eventSourceRef.current = null
    }
    if (taskIdRef.current) {
      setConnectionStatus('idle')
      taskIdRef.current = null
    }
    completedRef.current = false
  }, [])

  const connect = useCallback((taskId) => {
    // 关闭之前的连接
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
    }

    taskIdRef.current = taskId
    setConnectionStatus('connecting')
    setEvents([])
    completedRef.current = false

    // 创建 EventSource 连接到 SSE 流端点
    const url = `${API_BASE_URL}/api/stream/task/${encodeURIComponent(taskId)}`
    const es = new EventSource(url)
    eventSourceRef.current = es

    // 标记为已完成并关闭 EventSource
    const markDone = () => {
      if (!completedRef.current) {
        completedRef.current = true
        setConnectionStatus('done')
        es.close()
        eventSourceRef.current = null
      }
    }

    es.addEventListener('connected', (event) => {
      setConnectionStatus('connected')
      try {
        const data = JSON.parse(event.data)
        setEvents(prev => [...prev, data])
      } catch {}
    })

    es.addEventListener('agent_thinking', (event) => {
      try {
        const data = JSON.parse(event.data)
        setEvents(prev => [...prev, data])
      } catch {}
    })

    es.addEventListener('code_generated', (event) => {
      try {
        const data = JSON.parse(event.data)
        setEvents(prev => [...prev, data])
      } catch {}
    })

    es.addEventListener('artifact_created', (event) => {
      try {
        const data = JSON.parse(event.data)
        setEvents(prev => [...prev, data])
      } catch {}
    })

    es.addEventListener('work_submitted', (event) => {
      try {
        const data = JSON.parse(event.data)
        setEvents(prev => [...prev, data])
      } catch {}
    })

    es.addEventListener('task_completed', (event) => {
      try {
        const data = JSON.parse(event.data)
        setEvents(prev => [...prev, data])
      } catch {}
      markDone()
    })

    es.addEventListener('task_error', (event) => {
      try {
        const data = JSON.parse(event.data)
        setEvents(prev => [...prev, data])
      } catch {}
      completedRef.current = true
      setConnectionStatus('error')
      es.close()
      eventSourceRef.current = null
    })

    es.addEventListener('heartbeat', () => {
      // 保持连接，不需要处理
    })

    es.addEventListener('done', () => {
      markDone()
    })

    es.addEventListener('complete', (event) => {
      // 标准化 complete 事件：检查 data.event === 'complete' 来解锁 UI
      try {
        const data = JSON.parse(event.data)
        if (data.event === 'complete') {
          markDone()
          return
        }
      } catch {}
      markDone()
    })

    es.addEventListener('close', () => {
      // 最终 close 事件（从 finally 块发出），确保状态为 done 而不是 error
      markDone()
    })

    es.onerror = () => {
      // 如果已经标记为 completed（收到了 done/task_completed/close 事件），
      // 忽略 onerror — 它只是连接自然关闭后的副作用
      if (!completedRef.current) {
        setConnectionStatus('error')
      }
      es.close()
      eventSourceRef.current = null
    }
  }, [])

  return {
    events,
    connectionStatus,
    connect,
    disconnect,
    /** 获取最新事件 */
    lastEvent: events.length > 0 ? events[events.length - 1] : null,
    /** 获取当前连接的任务 ID */
    taskId: taskIdRef.current,
  }
}