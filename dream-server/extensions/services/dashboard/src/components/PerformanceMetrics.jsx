import { Activity, Zap } from 'lucide-react'
import { usePerformanceMetrics } from '../hooks/usePerformanceMetrics'
import { formatLatency } from '../utils/format'

/**
 * Performance metrics panel for Dashboard/Settings.
 * compact: minimal inline display for header strip
 * embedded: full grid without outer card (for Settings section)
 * full: full card with header
 */
export function PerformanceMetrics({ compact = false, embedded = false }) {
  const { lastLatencyMs, avgLatencyMs, successCount, lastUpdated } = usePerformanceMetrics(true)

  if (compact) {
    return (
      <div className="flex items-center gap-4 text-xs text-zinc-500 font-mono">
        {lastLatencyMs != null && (
          <span className="flex items-center gap-1" title="Last API response time">
            <Zap size={12} className="text-indigo-400" />
            {formatLatency(lastLatencyMs)}
          </span>
        )}
        {avgLatencyMs != null && (
          <span title="Average latency (last 20 polls)">
            avg {formatLatency(avgLatencyMs)}
          </span>
        )}
      </div>
    )
  }

  const content = (
    <div className="grid grid-cols-2 gap-4 text-sm">
        <div>
          <span className="text-zinc-500">Last response</span>
          <p className="text-white font-mono">
            {lastLatencyMs != null ? formatLatency(lastLatencyMs) : '—'}
          </p>
        </div>
        <div>
          <span className="text-zinc-500">Avg (20 polls)</span>
          <p className="text-white font-mono">
            {avgLatencyMs != null ? formatLatency(avgLatencyMs) : '—'}
          </p>
        </div>
        <div>
          <span className="text-zinc-500">Successful polls</span>
          <p className="text-white font-mono">{successCount}</p>
        </div>
        <div>
          <span className="text-zinc-500">Last updated</span>
          <p className="text-white font-mono">
            {lastUpdated ? (
              <span title={new Date(lastUpdated).toISOString()}>
                {formatRelativeTime(lastUpdated)}
              </span>
            ) : (
              '—'
            )}
          </p>
        </div>
      </div>
  )

  if (embedded) {
    return content
  }

  return (
    <div className="p-4 bg-zinc-900/50 border border-zinc-800 rounded-xl">
      <div className="flex items-center gap-2 mb-3">
        <Activity size={18} className="text-indigo-400" />
        <span className="text-sm font-medium text-white">API Performance</span>
      </div>
      {content}
    </div>
  )
}

function formatRelativeTime(timestamp) {
  const sec = Math.floor((Date.now() - timestamp) / 1000)
  if (sec < 60) return `${sec}s ago`
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`
  return `${Math.floor(sec / 3600)}h ago`
}
