import { useState, useEffect, useCallback, useRef } from 'react'

/**
 * Hook to poll download progress during model downloads.
 * Only polls when a download is active — no idle polling.
 */
export function useDownloadProgress(pollIntervalMs = 1500) {
  const [progress, setProgress] = useState(null)
  const [isDownloading, setIsDownloading] = useState(false)
  const pollRef = useRef(null)

  const fetchProgress = useCallback(async () => {
    try {
      const response = await fetch('/api/models/download-status')
      if (!response.ok) return

      const data = await response.json()

      if (data.status === 'downloading') {
        setIsDownloading(true)
        setProgress({
          model: data.model,
          percent: data.percent || 0,
          bytesDownloaded: data.bytesDownloaded || 0,
          bytesTotal: data.bytesTotal || 0,
          speedMbps: data.speedBytesPerSec ? data.speedBytesPerSec / (1024 * 1024) : 0,
          eta: data.eta,
          startedAt: data.startedAt
        })
      } else if (data.status === 'complete' || data.status === 'idle') {
        setIsDownloading(false)
        setProgress(null)
        // Stop polling when idle/complete
        if (pollRef.current) {
          clearInterval(pollRef.current)
          pollRef.current = null
        }
      } else if (data.status === 'error') {
        setIsDownloading(false)
        setProgress({
          error: data.message || 'Download failed',
          model: data.model
        })
        // Stop polling on error too
        if (pollRef.current) {
          clearInterval(pollRef.current)
          pollRef.current = null
        }
      }
    } catch (err) {
      // Silently fail - API might not be available
    }
  }, [])

  // Start polling — call this when a download begins
  const startPolling = useCallback(() => {
    if (pollRef.current) return // Already polling
    fetchProgress() // Immediate first check
    pollRef.current = setInterval(fetchProgress, pollIntervalMs)
  }, [fetchProgress, pollIntervalMs])

  // Do a single check on mount to catch in-progress downloads
  useEffect(() => {
    fetchProgress()
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [fetchProgress])

  // Format helpers
  const formatBytes = (bytes) => {
    if (!bytes) return '0 B'
    const gb = bytes / (1024 ** 3)
    if (gb >= 1) return `${gb.toFixed(2)} GB`
    const mb = bytes / (1024 ** 2)
    if (mb >= 1) return `${mb.toFixed(1)} MB`
    return `${(bytes / 1024).toFixed(0)} KB`
  }

  const formatEta = (eta) => {
    if (!eta || eta === 'calculating...') return 'calculating...'
    if (typeof eta === 'number') {
      const mins = Math.floor(eta / 60)
      const secs = eta % 60
      if (mins > 0) return `${mins}m ${secs}s`
      return `${secs}s`
    }
    return eta
  }

  return {
    isDownloading,
    progress,
    formatBytes,
    formatEta,
    startPolling,
    refresh: fetchProgress
  }
}
