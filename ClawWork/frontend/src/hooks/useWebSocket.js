import { useEffect, useState, useRef } from 'react'
import { IS_STATIC, API_BASE_URL } from '../api'

export const useWebSocket = () => {
  const [lastMessage, setLastMessage]       = useState(null)
  const [connectionStatus, setConnectionStatus] = useState(IS_STATIC ? 'github-pages' : 'connecting')
  const ws = useRef(null)

  useEffect(() => {
    // No WebSocket on GitHub Pages — it's a static deployment
    if (IS_STATIC) return

    const connectWebSocket = () => {
      // 使用相对路径 /ws，通过 Vite 代理转发到后端 ws://localhost:8010/ws
      // 避免在前端 dev 环境下因 API_BASE_URL 指向 localhost:3000 而连接自身
      const wsUrl = '/ws'

      ws.current = new WebSocket(wsUrl)

      ws.current.onopen = () => {
        setConnectionStatus('connected')
      }

      ws.current.onmessage = (event) => {
        try {
          setLastMessage(JSON.parse(event.data))
        } catch {}
      }

      ws.current.onerror = () => {
        setConnectionStatus('error')
      }

      ws.current.onclose = () => {
        setConnectionStatus('disconnected')
        setTimeout(connectWebSocket, 3000)
      }
    }

    connectWebSocket()

    return () => {
      if (ws.current) ws.current.close()
    }
  }, [])

  return { lastMessage, connectionStatus }
}
