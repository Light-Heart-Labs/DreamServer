import { useState, useEffect, useRef, useCallback } from 'react'

const API_BASE = import.meta.env.VITE_API_URL || ''
const POLL_INTERVAL = 15000 // 15s for metrics (less frequent than status)

/**
 * Hook to track API performance metrics (latency, success rate).
 * Polls /api/ping (unauthenticated) to measure API responsiveness.
 */
export function usePerformanceMetrics(enabled = true) {
  const [metrics, setMetrics] = useState({
    lastLatencyMs: null,
    avgLatencyMs: null,
    successCount: 0,
    failCount: 0,
    lastUpdated: null,
  })
  const historyRef = useRef([])
  const maxHistory = 20

  const measure = useCallback(async () => {
    const url = `${API_BASE}/api/ping`
    const start = performance.now()
    try {
      const res = await fetch(url)
      const latencyMs = Math.round(performance.now() - start)
      const ok = res.ok
      if (ok) {
        await res.json().catch(() => null)
      }
      return { latencyMs, ok }
    } catch {
      return { latencyMs: null, ok: false }
    }
  }, [])

  useEffect(() => {
    if (!enabled) return

    const run = async () => {
      const { latencyMs, ok } = await measure()
      const prev = historyRef.current
      if (ok && latencyMs != null) {
        prev.push(latencyMs)
        if (prev.length > maxHistory) prev.shift()
      }
      const successCount = prev.length
      setMetrics((m) => ({
        lastLatencyMs: ok ? latencyMs : m.lastLatencyMs,
        avgLatencyMs: prev.length ? Math.round(prev.reduce((a, b) => a + b, 0) / prev.length) : null,
        successCount,
        failCount: m.failCount + (ok ? 0 : 1),
        lastUpdated: Date.now(),
      }))
    }

    run()
    const id = setInterval(run, POLL_INTERVAL)
    return () => clearInterval(id)
  }, [enabled, measure])

  return metrics
}
