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

  const fetchModels = useCallback(async () => {
    try {
      const [modelsRes, activeRes] = await Promise.all([
        fetch('/api/models'),
        fetch('/api/models/active'),
      ])

      if (!modelsRes.ok) throw new Error('Failed to fetch models')
      const modelsData = await modelsRes.json()
      setAllModels(modelsData.models || [])
      setGpu(modelsData.gpu)
      setCurrentModel(modelsData.currentModel)

      if (activeRes.ok) {
        const activeData = await activeRes.json()
        setActiveModel(activeData.id ? activeData : null)
      }

      setError(null)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchModels()
    const interval = setInterval(fetchModels, 30000)
    return () => clearInterval(interval)
  }, [fetchModels])

  // Filter models by backend type
  const models = useMemo(() => {
    if (filter === 'all') return allModels
    if (filter === 'local') return allModels.filter(m => m.backend === 'llama-server')
    if (filter === 'ollama') return allModels.filter(m => m.backend === 'ollama')
    if (filter === 'cloud') return allModels.filter(m => m.backend !== 'llama-server' && m.backend !== 'ollama')
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

  const deleteModel = async (modelId) => {
    if (!confirm(`Delete ${modelId}? This cannot be undone.`)) return

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
    downloadModel,
    loadModel,
    deleteModel,
    refresh: fetchModels
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
    if (!confirm(`Delete Ollama model "${modelName}"? This cannot be undone.`)) return false
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

  return { providers, loading, saving, saveProvider, deleteProvider, refresh: fetchProviders }
}
