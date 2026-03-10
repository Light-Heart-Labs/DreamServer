/**
 * Shared formatting utilities for Dream Server Dashboard
 */

/**
 * Format large numbers: 1234 → "1.2k", 1500000 → "1.5M"
 */
export function formatTokenCount(n) {
  if (n == null || isNaN(n)) return '—'
  const num = Number(n)
  if (num >= 1_000_000_000) return `${(num / 1_000_000_000).toFixed(1)}B`
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}k`
  return `${num}`
}

/**
 * Format uptime: 90061 → "1d 1h 1m"
 */
export function formatUptime(seconds) {
  if (seconds == null || isNaN(seconds) || seconds <= 0) return '—'
  const s = Math.floor(Number(seconds))
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (d > 0) return `${d}d ${h}h ${m}m`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

/**
 * Format bytes to human-readable: 1073741824 → "1.0 GB"
 */
export function formatBytes(bytes) {
  if (bytes == null || isNaN(bytes) || bytes < 0) return '0 B'
  const b = Number(bytes)
  if (b >= 1e12) return `${(b / 1e12).toFixed(1)} TB`
  if (b >= 1e9) return `${(b / 1e9).toFixed(1)} GB`
  if (b >= 1e6) return `${(b / 1e6).toFixed(1)} MB`
  if (b >= 1e3) return `${(b / 1e3).toFixed(1)} KB`
  return `${b} B`
}

/**
 * Format latency: 1234 → "1.2s", 45 → "45ms"
 */
export function formatLatency(ms) {
  if (ms == null || isNaN(ms) || ms < 0) return '—'
  const m = Number(ms)
  if (m >= 1000) return `${(m / 1000).toFixed(1)}s`
  return `${Math.round(m)}ms`
}

/**
 * Format percent with optional decimal places
 */
export function formatPercent(value, decimals = 1) {
  if (value == null || isNaN(value)) return '—'
  return `${Number(value).toFixed(decimals)}%`
}
