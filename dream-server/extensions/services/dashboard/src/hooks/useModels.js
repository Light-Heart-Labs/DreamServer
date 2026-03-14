import { useState, useEffect, useCallback, useMemo, useRef } from 'react'

/**
 * Hook for the Model Hub — fetches unified model list from the API,
 * supports backend filtering, and provides model actions (download/load/delete).
 */
export function useModels() {
  const [allModels, setAllModels] = useState([])
  const [gpu, setGpu] = useState(null)
  const [currentModel, setCurrentModel] = useState(null)
  const [activeModel, setActiveModel] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [actionLoading, setActionLoading] = useState(null)
  const [filter, setFilter] = useState('all')
  const [llmBackend, setLlmBackend] = useState(null)
  const [backendCapabilities, setBackendCapabilities] = useState(null)
  const [isRestarting, setIsRestarting] = useState(false)
  const [backendStatus, setBackendStatus] = useState(null)
  const [backends, setBackends] = useState([])
  const [isSwitchingBackend, setIsSwitchingBackend] = useState(false)
  const [isTesting, setIsTesting] = useState(false)
  const [testResult, setTestResult] = useState(null)

  // Abort controller for cancelling pending fetches on unmount
  const abortControllerRef = useRef(null)

  const fetchBackends = useCallback(async (signal) => {
    try {
      const opts = signal ? { signal } : {}
      const res = await fetch('/api/models/backends', opts)
      if (signal?.aborted) return
      if (res.ok) {
        const data = await res.json()
        setBackends(data.backends || [])
      }
    } catch (err) {
      if (err.name === 'AbortError') return
      // Degrade gracefully — backends might not be available yet
    }
  }, [])

  const fetchModels = useCallback(async (signal) => {
    try {
      const opts = signal ? { signal } : {}
      const [modelsRes, activeRes] = await Promise.all([
        fetch('/api/models', opts),
        fetch('/api/models/active', opts),
        fetchBackends(signal),
      ])

      // Check if request was aborted
      if (signal?.aborted) return

      if (!modelsRes.ok) throw new Error('Failed to fetch models')
      const modelsData = await modelsRes.json()
      setAllModels(modelsData.models || [])
      setGpu(modelsData.gpu)
      setCurrentModel(modelsData.currentModel)
      setLlmBackend(modelsData.llmBackend || null)
      setBackendCapabilities(modelsData.backendCapabilities || null)

      if (activeRes.ok) {
        const activeData = await activeRes.json()
        setActiveModel(activeData.id ? activeData : null)
      }

      setError(null)
    } catch (err) {
      // Don't set error if request was aborted
      if (err.name === 'AbortError') return
      setError(err.message)
    } finally {
      if (!signal?.aborted) {
        setLoading(false)
      }
    }
  }, [fetchBackends])

  useEffect(() => {
    // Create new abort controller for this effect
    const abortController = new AbortController()
    abortControllerRef.current = abortController

    fetchModels(abortController.signal)
    const interval = setInterval(() => {
      fetchModels(abortController.signal)
    }, 30000)

    return () => {
      abortController.abort()
      clearInterval(interval)
    }
  }, [fetchModels])

  // Filter models by backend type
  const models = useMemo(() => {
    if (filter === 'all') return allModels
    if (filter === 'local') return allModels.filter(m => m.backend === 'llama-server')
    if (filter === 'vllm') return allModels.filter(m => m.backend === 'vllm')
    if (filter === 'ollama') return allModels.filter(m => m.backend === 'ollama')
    if (filter === 'cloud') return allModels.filter(m => !['llama-server', 'vllm', 'ollama'].includes(m.backend))
    return allModels
  }, [allModels, filter])

  const downloadModel = async (modelId) => {
    setActionLoading(modelId)
    try {
      const response = await fetch(`/api/models/${encodeURIComponent(modelId)}/download`, {
        method: 'POST'
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.detail || 'Failed to start download')
      }
      await fetchModels()
    } catch (err) {
      setError(err.message)
    } finally {
      setActionLoading(null)
    }
  }

  const loadModel = async (modelId) => {
    setActionLoading(modelId)
    try {
      const response = await fetch(`/api/models/${encodeURIComponent(modelId)}/load`, {
        method: 'POST'
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.detail || 'Failed to load model')
      }
      await fetchModels()
    } catch (err) {
      setError(err.message)
    } finally {
      setActionLoading(null)
    }
  }

  const switchModel = async (modelFile, backend = 'llama-server') => {
    setIsRestarting(true)
    setBackendStatus({ status: 'switching', message: 'Sending switch request...' })
    try {
      const response = await fetch('/api/models/backend/switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model_file: modelFile, backend }),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.detail || 'Failed to switch model')
      }
      const result = await response.json()
      setBackendStatus({ status: 'restarting', message: result.message || 'Container restarting...' })

      await _pollHealth(120000)
      await fetchModels()
    } catch (err) {
      setError(err.message)
      setBackendStatus({ status: 'error', message: err.message })
    } finally {
      setIsRestarting(false)
    }
  }

  const switchBackend = async (backendId, model = null) => {
    setIsSwitchingBackend(true)
    setIsRestarting(true)
    setBackendStatus({ status: 'switching', message: `Switching to ${backendId}...` })
    try {
      const payload = { backend: backendId }
      if (model) payload.model = model

      const response = await fetch('/api/models/backends/switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.detail || 'Failed to switch backend')
      }
      const result = await response.json()
      setBackendStatus({
        status: 'restarting',
        message: result.message || 'Services updating...',
      })

      // vLLM cold starts can take 5+ minutes
      const timeout = backendId === 'vllm' ? 300000 : 120000
      await _pollHealth(timeout)
      await fetchModels()
    } catch (err) {
      setError(err.message)
      setBackendStatus({ status: 'error', message: err.message })
    } finally {
      setIsSwitchingBackend(false)
      setIsRestarting(false)
    }
  }

  // Shared health polling helper
  const _pollHealth = (maxWait = 120000) => {
    const pollInterval = 2000
    const startTime = Date.now()
    return new Promise((resolve, reject) => {
      const check = async () => {
        if (Date.now() - startTime > maxWait) {
          reject(new Error('Operation timed out. Check the container status.'))
          return
        }
        try {
          const statusRes = await fetch('/api/models/backend/status')
          if (statusRes.ok) {
            const status = await statusRes.json()
            setBackendStatus({
              status: status.healthy ? 'healthy' : 'starting',
              message: status.healthy ? 'Backend ready!' : 'Loading model...',
              model: status.model,
              container: status.container,
            })
            if (status.healthy) {
              resolve(status)
              return
            }
          }
        } catch {
          setBackendStatus({ status: 'restarting', message: 'Waiting for services...' })
        }
        setTimeout(check, pollInterval)
      }
      setTimeout(check, pollInterval)
    })
  }

  const deleteModel = async (modelId) => {
    setActionLoading(modelId)
    try {
      const response = await fetch(`/api/models/${encodeURIComponent(modelId)}`, {
        method: 'DELETE'
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.detail || 'Failed to delete model')
      }
      await fetchModels()
    } catch (err) {
      setError(err.message)
    } finally {
      setActionLoading(null)
    }
  }

  const addCustomModel = async (modelData) => {
    try {
      const response = await fetch('/api/models/custom', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(modelData),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.detail || 'Failed to add custom model')
      }
      await fetchModels()
      return await response.json()
    } catch (err) {
      setError(err.message)
      return null
    }
  }

  const removeCustomModel = async (modelId) => {
    try {
      const id = modelId.replace('custom:', '')
      const response = await fetch(`/api/models/custom/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.detail || 'Failed to remove custom model')
      }
      await fetchModels()
    } catch (err) {
      setError(err.message)
    }
  }

  const unloadModel = useCallback(async () => {
    setActionLoading('unload')
    try {
      const res = await fetch('/api/models/unload', { method: 'POST' })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: 'Unload failed' }))
        setError(err.detail || 'Unload failed')
        return false
      }
      setActiveModel(null)  // Clear active model — container is stopped
      await fetchModels()
      return true
    } catch (err) {
      setError(err.message)
      return false
    } finally {
      setActionLoading(null)
    }
  }, [fetchModels])

  const testModel = useCallback(async (prompt) => {
    setIsTesting(true)
    setTestResult(null)
    try {
      const res = await fetch('/api/models/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(prompt ? { prompt } : {}),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: 'Test failed' }))
        setTestResult({ success: false, error: err.detail || 'Test failed' })
        return null
      }
      const data = await res.json()
      setTestResult(data)
      return data
    } catch (err) {
      setTestResult({ success: false, error: err.message })
      return null
    } finally {
      setIsTesting(false)
    }
  }, [])

  return {
    models,
    allModels,
    gpu,
    currentModel,
    activeModel,
    loading,
    error,
    actionLoading,
    filter,
    setFilter,
    llmBackend,
    backendCapabilities,
    isRestarting,
    isSwitchingBackend,
    isTesting,
    testResult,
    backendStatus,
    backends,
    downloadModel,
    loadModel,
    switchModel,
    switchBackend,
    deleteModel,
    addCustomModel,
    removeCustomModel,
    unloadModel,
    testModel,
    refresh: () => fetchModels()
  }
}


/**
 * Hook for Ollama model management: pull, delete, progress, info.
 */
export function useOllama() {
  const [info, setInfo] = useState(null)
  const [pulls, setPulls] = useState({})
  const [pulling, setPulling] = useState(false)
  const [error, setError] = useState(null)
  const pollRef = useRef(null)

  // Fetch Ollama server info
  const fetchInfo = useCallback(async () => {
    try {
      const res = await fetch('/api/models/ollama/info')
      if (!res.ok) return
      setInfo(await res.json())
    } catch {
      // Ollama might not be running
    }
  }, [])

  useEffect(() => {
    fetchInfo()
  }, [fetchInfo])

  // Poll pull status
  const pollPullStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/models/ollama/pull-status')
      if (!res.ok) return
      const data = await res.json()
      setPulls(data.pulls || {})

      const hasActive = Object.values(data.pulls || {}).some(p => p.status === 'pulling')
      if (!hasActive && pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
        setPulling(false)
      }
    } catch {
      // ignore
    }
  }, [])

  const startPolling = useCallback(() => {
    if (pollRef.current) return
    setPulling(true)
    pollRef.current = setInterval(pollPullStatus, 1000)
  }, [pollPullStatus])

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [])

  const pullModel = async (modelName) => {
    if (!modelName?.trim()) return
    setError(null)
    try {
      const res = await fetch('/api/models/ollama/pull', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: modelName.trim() }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.detail || 'Failed to start pull')
      }
      startPolling()
      await pollPullStatus()
    } catch (err) {
      setError(err.message)
    }
  }

  const deleteOllamaModel = async (modelName) => {
    setError(null)
    try {
      const res = await fetch(`/api/models/ollama/${encodeURIComponent(modelName)}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.detail || 'Failed to delete model')
      }
      return true
    } catch (err) {
      setError(err.message)
      return false
    }
  }

  const clearPull = (modelName) => {
    setPulls(prev => {
      const next = { ...prev }
      delete next[modelName]
      return next
    })
  }

  return {
    info,
    pulls,
    pulling,
    error,
    pullModel,
    deleteOllamaModel,
    clearPull,
    refreshInfo: fetchInfo,
    loadOllamaModel: async (modelName) => {
      setError(null)
      try {
        const res = await fetch('/api/models/ollama/load', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: modelName }),
        })
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          throw new Error(data.detail || 'Failed to load model')
        }
        return await res.json()
      } catch (err) {
        setError(err.message)
        return null
      }
    },
    unloadOllamaModel: async (modelName) => {
      setError(null)
      try {
        const res = await fetch('/api/models/ollama/unload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: modelName }),
        })
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          throw new Error(data.detail || 'Failed to unload model')
        }
        return await res.json()
      } catch (err) {
        setError(err.message)
        return null
      }
    },
  }
}


/**
 * Hook for cloud provider management.
 */
export function useProviders() {
  const [providers, setProviders] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(null)

  const fetchProviders = useCallback(async () => {
    try {
      const res = await fetch('/api/models/providers')
      if (!res.ok) return
      const data = await res.json()
      setProviders(data.providers || [])
    } catch {
      // Degrade gracefully
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchProviders()
  }, [fetchProviders])

  const saveProvider = async (providerId, apiKey, defaultModel) => {
    setSaving(providerId)
    try {
      const res = await fetch(`/api/models/providers/${providerId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: apiKey, default_model: defaultModel }),
      })
      if (!res.ok) throw new Error('Failed to save provider')
      await fetchProviders()
      return true
    } catch {
      return false
    } finally {
      setSaving(null)
    }
  }

  const deleteProvider = async (providerId) => {
    setSaving(providerId)
    try {
      const res = await fetch(`/api/models/providers/${providerId}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to remove provider')
      await fetchProviders()
      return true
    } catch {
      return false
    } finally {
      setSaving(null)
    }
  }

  const testConnection = async (providerId) => {
    setSaving(providerId)
    try {
      const res = await fetch(`/api/models/providers/${providerId}/test-connection`, {
        method: 'POST',
      })
      if (!res.ok) throw new Error('Test failed')
      return await res.json()
    } catch {
      return { status: 'error', message: 'Connection failed' }
    } finally {
      setSaving(null)
    }
  }

  return { providers, loading, saving, saveProvider, deleteProvider, testConnection, refresh: fetchProviders }
}
