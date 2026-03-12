import { useState, useEffect, useCallback, useRef } from 'react'

const DEFAULT_POLL_INTERVAL_MS = 1500

/**
 * Hook to poll download progress during model downloads.
 * Only polls when a download is active — no idle polling.
 */
export function useDownloadProgress(pollIntervalMs = DEFAULT_POLL_INTERVAL_MS) {
  const [progress, setProgress] = useState(null)
  const [isDownloading, setIsDownloading] = useState(false)
  const pollRef = useRef(null)
  const abortControllerRef = useRef(null)

  const fetchProgress = useCallback(async (signal) => {
    try {
      const opts = signal ? { signal } : {}
      const response = await fetch('/api/models/download-status', opts)
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
      // Don't set error state if request was aborted
      if (err.name === 'AbortError') return
      // Silently fail - API might not be available
    }
  }, [])

  // Start polling — call this when a download begins
  const startPolling = useCallback(() => {
    if (pollRef.current) return // Already polling
    
    // Create abort controller for this polling session
    const abortController = new AbortController()
    abortControllerRef.current = abortController
    
    fetchProgress(abortController.signal) // Immediate first check
    pollRef.current = setInterval(() => {
      if (!abortController.signal.aborted) {
        fetchProgress(abortController.signal)
      }
    }, pollIntervalMs)
  }, [fetchProgress, pollIntervalMs])

  // Do a single check on mount to catch in-progress downloads
  useEffect(() => {
    const abortController = new AbortController()
    abortControllerRef.current = abortController
    
    fetchProgress(abortController.signal)
    
    return () => {
      abortController.abort()
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
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
