import { useState, useEffect, useCallback, useRef } from 'react'

/**
 * WebSocket hook for real-time download progress from the model-controller.
 * 
 * Connects to /api/ws/ws and receives events:
 *   download:started   — a new download was kicked off
 *   download:progress  — bytes/percent/speed update
 *   download:complete  — download finished successfully
 *   download:error     — download failed
 *   download:cancelled — download was cancelled
 *   download:info      — informational message (e.g. vLLM restart)
 */
export function useDownloadWS() {
  const [downloads, setDownloads] = useState({})
  const [connected, setConnected] = useState(false)
  const wsRef = useRef(null)
  const reconnectRef = useRef(null)

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const ws = new WebSocket(`${protocol}//${window.location.host}/api/ws/ws`)

    ws.onopen = () => {
      setConnected(true)
      if (reconnectRef.current) {
        clearTimeout(reconnectRef.current)
        reconnectRef.current = null
      }
    }

    ws.onclose = () => {
      setConnected(false)
      wsRef.current = null
      // Auto-reconnect after 2s
      reconnectRef.current = setTimeout(connect, 2000)
    }

    ws.onerror = () => {
      ws.close()
    }

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        const { type, jobId, modelId, ...rest } = data

        if (!jobId) return

        setDownloads(prev => {
          const updated = { ...prev }

          switch (type) {
            case 'download:started':
              updated[modelId] = {
                jobId,
                modelId,
                status: 'downloading',
                percent: 0,
                bytesDownloaded: 0,
                bytesTotal: 0,
                speedBytesPerSec: 0,
                ...rest,
              }
              break

            case 'download:progress':
              updated[modelId] = {
                ...updated[modelId],
                jobId,
                modelId,
                status: 'downloading',
                ...rest,
              }
              break

            case 'download:complete':
              updated[modelId] = {
                ...updated[modelId],
                jobId,
                modelId,
                status: 'complete',
                percent: 100,
                ...rest,
              }
              // Auto-clear after 5s
              setTimeout(() => {
                setDownloads(p => {
                  const next = { ...p }
                  delete next[modelId]
                  return next
                })
              }, 5000)
              break

            case 'download:error':
              updated[modelId] = {
                ...updated[modelId],
                jobId,
                modelId,
                status: 'error',
                ...rest,
              }
              break

            case 'download:cancelled':
              updated[modelId] = {
                ...updated[modelId],
                jobId,
                modelId,
                status: 'cancelled',
                ...rest,
              }
              setTimeout(() => {
                setDownloads(p => {
                  const next = { ...p }
                  delete next[modelId]
                  return next
                })
              }, 3000)
              break

            case 'download:info':
              // Informational — update message field
              if (updated[modelId]) {
                updated[modelId] = {
                  ...updated[modelId],
                  message: rest.message,
                }
              }
              break

            default:
              break
          }

          return updated
        })
      } catch {
        // Ignore malformed messages
      }
    }

    wsRef.current = ws
  }, [])

  // Connect on mount
  useEffect(() => {
    connect()
    return () => {
      if (reconnectRef.current) clearTimeout(reconnectRef.current)
      if (wsRef.current) {
        wsRef.current.onclose = null // prevent reconnect on unmount
        wsRef.current.close()
      }
    }
  }, [connect])

  // Trigger a download via the model-controller (through dashboard-api proxy)
  const startDownload = useCallback(async (modelId) => {
    try {
      const res = await fetch('/api/models/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modelId }),
      })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.detail || data.error || 'Download failed')
      }
      return data
    } catch (err) {
      throw err
    }
  }, [])

  // Cancel an active download
  const cancelDownload = useCallback(async (modelId) => {
    const dl = downloads[modelId]
    if (!dl?.jobId) return
    try {
      await fetch(`/api/models/download/${dl.jobId}`, { method: 'DELETE' })
    } catch {
      // ignore
    }
  }, [downloads])

  // Helper: get download state for a specific model
  const getDownload = useCallback((modelId) => {
    return downloads[modelId] || null
  }, [downloads])

  return {
    downloads,
    connected,
    startDownload,
    cancelDownload,
    getDownload,
  }
}

/**
 * Format bytes to human-readable string
 */
export function formatBytes(bytes, decimals = 1) {
  if (!bytes || bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(decimals))} ${sizes[i]}`
}

/**
 * Format speed to human-readable string
 */
export function formatSpeed(bytesPerSec) {
  if (!bytesPerSec || bytesPerSec === 0) return '0 B/s'
  return `${formatBytes(bytesPerSec)}/s`
}
