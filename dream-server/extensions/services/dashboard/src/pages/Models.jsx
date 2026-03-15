import { useState, useCallback, useMemo } from 'react'
import {
  Box, Download, Trash2, Check, AlertCircle, Loader2, Play,
  RefreshCw, HardDrive, Zap, Cloud, Server, ChevronDown,
  Eye, EyeOff, ExternalLink, X, Sparkles, Search, Info,
  AlertTriangle, Plus, Square, Upload, ArrowUpDown, RotateCcw,
  Power, Terminal
} from 'lucide-react'
import { useModels, useProviders, useOllama } from '../hooks/useModels'
import { useDownloadWS, formatBytes, formatSpeed } from '../hooks/useDownloadWS'

const BACKEND_LABELS = {
  'llama-server': 'Local (GGUF)',
  'vllm': 'vLLM',
  'ollama': 'Ollama',
  'openai': 'OpenAI',
  'anthropic': 'Anthropic',
  'google': 'Google AI',
}

const BACKEND_ICONS = {
  'llama-server': Server,
  'llamacpp': Server,
  'vllm': Zap,
  'ollama': Cloud,
  'openai': Cloud,
  'anthropic': Cloud,
  'google': Cloud,
}

const BACKEND_DISPLAY_NAMES = {
  'llama-server': 'llama.cpp',
  'llamacpp': 'llama.cpp',
  'vllm': 'vLLM',
  'ollama': 'Ollama',
}

const SPECIALTY_STYLES = {
  'General': 'bg-indigo-500/20 text-indigo-400',
  'Fast': 'bg-green-500/20 text-green-400',
  'Code': 'bg-purple-500/20 text-purple-400',
  'Balanced': 'bg-blue-500/20 text-blue-400',
  'Quality': 'bg-amber-500/20 text-amber-400',
  'Reasoning': 'bg-pink-500/20 text-pink-400',
}

const FILTER_TABS = [
  { id: 'all', label: 'All' },
  { id: 'local', label: 'Local (GGUF)' },
  { id: 'vllm', label: 'vLLM' },
  { id: 'ollama', label: 'Ollama' },
  { id: 'cloud', label: 'Cloud Providers' },
]

const BACKEND_CARD_META = {
  llamacpp: {
    icon: Server,
    activeCard: 'bg-gradient-to-br from-indigo-500/20 to-indigo-600/5 border-indigo-500/40 shadow-lg shadow-indigo-500/10',
    activeIcon: 'bg-indigo-500/20',
    activeIconColor: 'text-indigo-400',
  },
  vllm: {
    icon: Zap,
    activeCard: 'bg-gradient-to-br from-amber-500/20 to-amber-600/5 border-amber-500/40 shadow-lg shadow-amber-500/10',
    activeIcon: 'bg-amber-500/20',
    activeIconColor: 'text-amber-400',
  },
  ollama: {
    icon: Box,
    activeCard: 'bg-gradient-to-br from-emerald-500/20 to-emerald-600/5 border-emerald-500/40 shadow-lg shadow-emerald-500/10',
    activeIcon: 'bg-emerald-500/20',
    activeIconColor: 'text-emerald-400',
  },
}

export default function Models() {
  const wsDownload = useDownloadWS()
  const {
    models, gpu, activeModel, loading, error, actionLoading,
    filter, setFilter, downloadModel, loadModel, switchModel,
    deleteModel, addCustomModel, removeCustomModel, refresh,
    llmBackend, backendCapabilities, isRestarting, backendStatus,
    backends, switchBackend, isSwitchingBackend,
    testModel, isTesting, testResult, unloadModel
  } = useModels()
  const ollama = useOllama()

  // Search state
  const [search, setSearch] = useState('')

  // Sort state
  const [sort, setSort] = useState('name-asc')

  // Add custom model form
  const [showAddForm, setShowAddForm] = useState(false)

  // Toast notifications
  const [toast, setToast] = useState(null)
  const showToast = useCallback((message, type = 'success') => {
    setToast({ message, type })
    setTimeout(() => setToast(null), 4000)
  }, [])

  // Confirmation dialog state
  const [confirmDialog, setConfirmDialog] = useState(null)

  const showConfirm = useCallback((title, message, onConfirm) => {
    setConfirmDialog({ title, message, onConfirm })
  }, [])

  const handleConfirmAction = useCallback(async () => {
    if (confirmDialog?.onConfirm) await confirmDialog.onConfirm()
    setConfirmDialog(null)
  }, [confirmDialog])

  // Filter and sort models
  const filteredModels = useMemo(() => {
    let result = models

    // Search filter
    if (search.trim()) {
      const q = search.toLowerCase()
      result = result.filter(m =>
        m.name.toLowerCase().includes(q) ||
        m.family?.toLowerCase().includes(q) ||
        m.description?.toLowerCase().includes(q) ||
        m.specialty?.toLowerCase().includes(q)
      )
    }

    // Tab filter — filter by backend source
    if (filter === 'local') {
      result = result.filter(m => m.backend === 'llama-server')
    } else if (filter === 'vllm') {
      result = result.filter(m => m.backend === 'vllm')
    } else if (filter === 'ollama') {
      result = result.filter(m => m.backend === 'ollama')
    }

    // Sort
    const sorted = [...result]
    switch (sort) {
      case 'name-asc':
        sorted.sort((a, b) => a.name.localeCompare(b.name))
        break
      case 'name-desc':
        sorted.sort((a, b) => b.name.localeCompare(a.name))
        break
      case 'size-asc':
        sorted.sort((a, b) => (a.size_gb || 0) - (b.size_gb || 0))
        break
      case 'size-desc':
        sorted.sort((a, b) => (b.size_gb || 0) - (a.size_gb || 0))
        break
      case 'vram-asc':
        sorted.sort((a, b) => (a.vram_required_gb || 0) - (b.vram_required_gb || 0))
        break
      case 'vram-desc':
        sorted.sort((a, b) => (b.vram_required_gb || 0) - (a.vram_required_gb || 0))
        break
      default:
        break
    }
    return sorted
  }, [models, search, sort, filter])

  if (loading) {
    return (
      <div className="p-8">
        <div className="animate-pulse">
          <div className="h-8 bg-zinc-800 rounded w-1/3 mb-4" />
          <div className="h-20 bg-zinc-800 rounded-xl mb-6" />
          <div className="h-10 bg-zinc-800 rounded-lg mb-6 w-2/3" />
          <div className="space-y-4">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-36 bg-zinc-800 rounded-xl" />
            ))}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Model Hub</h1>
          <p className="text-zinc-400 mt-1">
            Manage models across all inference backends.
          </p>
        </div>
        <button
          onClick={refresh}
          className="p-2.5 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-lg transition-colors"
          aria-label="Refresh models list"
          title="Refresh"
        >
          <RefreshCw size={20} />
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-6 p-4 bg-red-500/10 border border-red-500/30 rounded-xl flex items-start gap-3">
          <AlertCircle size={18} className="text-red-400 mt-0.5 flex-shrink-0" />
          <p className="text-red-400 text-sm flex-1">{error}</p>
          <button onClick={() => refresh()} className="text-red-400 hover:text-red-300 flex-shrink-0">
            <X size={14} />
          </button>
        </div>
      )}

      {/* Active Model Banner */}
      {activeModel && (
        <ActiveModelBanner
          model={activeModel}
          gpu={gpu}
          onUnload={async () => {
            const ok = await unloadModel()
            if (ok) {
              showToast(`${activeModel.name} unloaded from VRAM`)
            }
          }}
          onTest={testModel}
          isTesting={isTesting}
          testResult={testResult}
        />
      )}

      {/* VRAM Meter */}
      {gpu && <VramMeter gpu={gpu} />}

      {/* Backend Cards */}
      {backends.length > 0 && (
        <BackendCards
          backends={backends}
          isSwitching={isSwitchingBackend}
          onSwitch={switchBackend}
        />
      )}

      {/* Filter Tabs */}
      <div className="mb-6 flex items-center gap-1 bg-zinc-900/50 border border-zinc-800 rounded-lg p-1" role="tablist" aria-label="Filter models by backend">
        {FILTER_TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setFilter(tab.id)}
            role="tab"
            aria-selected={filter === tab.id}
            aria-controls={`models-panel-${tab.id}`}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
              filter === tab.id
                ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/20'
                : 'text-zinc-400 hover:text-white hover:bg-zinc-800'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Search Bar + Sort (hidden in cloud tab) */}
      {filter !== 'cloud' && (
        <div className="mb-5 flex gap-3">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" aria-hidden="true" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search models by name, family, or specialty..."
              aria-label="Search models"
              className="w-full pl-10 pr-4 py-2.5 bg-zinc-900/50 border border-zinc-800 rounded-lg text-sm text-white placeholder:text-zinc-600 focus:border-indigo-500 focus:outline-none transition-colors"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-white"
                aria-label="Clear search"
              >
                <X size={14} />
              </button>
            )}
          </div>
          <div className="relative">
            <ArrowUpDown size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" aria-hidden="true" />
            <select
              value={sort}
              onChange={e => setSort(e.target.value)}
              aria-label="Sort models"
              className="pl-9 pr-8 py-2.5 bg-zinc-900/50 border border-zinc-800 rounded-lg text-sm text-zinc-300 appearance-none cursor-pointer focus:border-indigo-500 focus:outline-none transition-colors"
            >
              <option value="name-asc">Name A→Z</option>
              <option value="name-desc">Name Z→A</option>
              <option value="size-asc">Size ↑</option>
              <option value="size-desc">Size ↓</option>
              <option value="vram-asc">VRAM ↑</option>
              <option value="vram-desc">VRAM ↓</option>
            </select>
            <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" aria-hidden="true" />
          </div>
        </div>
      )}



      {/* Ollama Pull Progress */}
      {Object.keys(ollama.pulls).length > 0 && (
        <OllamaPullProgress pulls={ollama.pulls} onClear={ollama.clearPull} />
      )}

      {/* Ollama Section (shown in ollama tab) */}
      {filter === 'ollama' && (
        <OllamaSection ollama={ollama} onRefresh={refresh} />
      )}

      {/* Add Custom Model Button (shown in GGUF tab) */}
      {filter === 'local' && (
        <div className="mb-5">
          <button
            onClick={() => setShowAddForm(true)}
            className="flex items-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm font-medium transition-colors"
          >
            <Plus size={16} />
            Add Custom Model
          </button>
        </div>
      )}

      {/* Add Custom Model Dialog */}
      {showAddForm && (
        <AddCustomModelForm
          onAdd={async (data) => {
            const result = await addCustomModel(data)
            if (result) {
              showToast('Custom model added successfully')
              setShowAddForm(false)
            }
          }}
          onClose={() => setShowAddForm(false)}
        />
      )}

      {/* Cloud Providers (shown in cloud tab) */}
      {filter === 'cloud' && <CloudProvidersSection />}

      {/* Model Grid */}
      {filter !== 'cloud' && (
        <div className="grid gap-4">
          {filteredModels.map(model => (
            <ModelCard
              key={model.id}
              model={model}
              isLoading={actionLoading === model.id}
              isRestarting={isRestarting}
              onDownload={() => wsDownload.startDownload(model.id).catch(e => showToast(e.message, 'error'))}
              downloadState={wsDownload.getDownload(model.id)}
              onLoad={() => {
                if (model.backend === 'ollama') {
                  ollama.loadOllamaModel(model.id.replace('ollama:', ''))
                } else {
                  loadModel(model.id)
                }
              }}
              onSwitch={
                (model.backend === 'llama-server' || model.backend === 'vllm') && model.status === 'downloaded' && backendCapabilities?.requiresRestart
                  ? () => {
                      const modelFile = model.backend === 'vllm'
                        ? model.id  // vLLM uses the HF repo name
                        : (model.gguf?.filename || model.id)
                      showConfirm(
                        'Switch & Restart',
                        `Switch to "${model.name}"? This will restart the LLM server container (~30s downtime).`,
                        async () => {
                          await switchModel(modelFile, model.backend)
                          showToast(`Switched to ${model.name}`, 'success')
                        }
                      )
                    }
                  : null
              }
              onDelete={
                model.backend === 'ollama'
                  ? () => showConfirm(
                      'Delete Ollama Model',
                      `Are you sure you want to delete "${model.name}"? This will remove the model from your local Ollama installation.`,
                      async () => {
                        const ok = await ollama.deleteOllamaModel(model.id.replace('ollama:', ''))
                        if (ok) refresh()
                      }
                    )
                  : () => showConfirm(
                      'Delete Model',
                      `Are you sure you want to delete "${model.name}"? This cannot be undone.`,
                      () => deleteModel(model.id)
                    )
              }
            />
          ))}
          {filteredModels.length === 0 && (
            <div className="text-center py-16 text-zinc-500">
              <Box size={40} className="mx-auto mb-3 opacity-40" />
              <p className="text-lg">{search ? 'No matching models' : 'No models found'}</p>
              <p className="text-sm mt-1">
                {search
                  ? `No models match "${search}". Try a different search.`
                  : filter === 'all' ? 'Check your API connection.' : `No ${FILTER_TABS.find(t => t.id === filter)?.label || ''} models available.`
                }
              </p>
            </div>
          )}
        </div>
      )}

      {/* Restart Progress Overlay */}
      {isRestarting && backendStatus && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-zinc-900 border border-zinc-700 rounded-2xl p-8 max-w-sm w-full mx-4 shadow-2xl text-center">
            <div className="mb-4">
              {backendStatus.status === 'healthy' ? (
                <div className="w-14 h-14 mx-auto bg-green-500/20 rounded-full flex items-center justify-center">
                  <Check size={28} className="text-green-400" />
                </div>
              ) : backendStatus.status === 'error' ? (
                <div className="w-14 h-14 mx-auto bg-red-500/20 rounded-full flex items-center justify-center">
                  <AlertCircle size={28} className="text-red-400" />
                </div>
              ) : (
                <div className="w-14 h-14 mx-auto bg-amber-500/20 rounded-full flex items-center justify-center">
                  <Loader2 size={28} className="text-amber-400 animate-spin" />
                </div>
              )}
            </div>
            <h3 className="text-lg font-semibold text-white mb-1">
              {backendStatus.status === 'healthy' ? 'Model Loaded!' : backendStatus.status === 'error' ? 'Restart failed' : 'Switching Model...'}
            </h3>
            <p className="text-sm text-zinc-400 mb-2">
              {backendStatus.message}
            </p>
            {backendStatus.model && (
              <p className="text-xs text-zinc-500 font-mono">{backendStatus.model}</p>
            )}
          </div>
        </div>
      )}

      {/* Confirmation Dialog */}
      {confirmDialog && (
        <ConfirmDialog
          title={confirmDialog.title}
          message={confirmDialog.message}
          onConfirm={handleConfirmAction}
          onCancel={() => setConfirmDialog(null)}
        />
      )}

      {/* Toast Notification */}
      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 px-4 py-3 rounded-xl shadow-2xl shadow-black/40 flex items-center gap-3 text-sm font-medium ${
          toast.type === 'error'
            ? 'bg-red-950/90 border border-red-500/30 text-red-300'
            : 'bg-green-950/90 border border-green-500/30 text-green-300'
        }`}>
          {toast.type === 'error' ? <AlertCircle size={16} /> : <Check size={16} />}
          {toast.message}
          <button onClick={() => setToast(null)} className="ml-2 opacity-50 hover:opacity-100">
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  )
}


/* ------------------------------------------------------------------ */
/* Confirm Dialog                                                      */
/* ------------------------------------------------------------------ */

function ConfirmDialog({ title, message, onConfirm, onCancel }) {
  const [loading, setLoading] = useState(false)
  const isDelete = title?.toLowerCase().includes('delete')

  const handleConfirm = async () => {
    setLoading(true)
    try {
      await onConfirm()
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onCancel}
      />

      {/* Dialog */}
      <div className="relative bg-zinc-900 border border-zinc-700 rounded-2xl shadow-2xl shadow-black/50 p-6 max-w-md w-full mx-4 animate-in fade-in zoom-in-95">
        <div className="flex items-start gap-4">
          <div className={`p-3 rounded-xl flex-shrink-0 ${isDelete ? 'bg-red-500/15' : 'bg-amber-500/15'}`}>
            {isDelete
              ? <AlertTriangle size={22} className="text-red-400" />
              : <RefreshCw size={22} className="text-amber-400" />
            }
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-lg font-semibold text-white">{title}</h3>
            <p className="text-sm text-zinc-400 mt-2 leading-relaxed">{message}</p>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 mt-6">
          <button
            onClick={onCancel}
            disabled={loading}
            className="px-4 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={loading}
            className={`px-4 py-2.5 text-white rounded-lg text-sm font-medium flex items-center gap-2 transition-colors disabled:opacity-50 ${
              isDelete
                ? 'bg-red-600 hover:bg-red-500 shadow-lg shadow-red-500/20'
                : 'bg-amber-600 hover:bg-amber-500 shadow-lg shadow-amber-500/20'
            }`}
          >
            {loading ? (
              <Loader2 size={14} className="animate-spin" />
            ) : isDelete ? (
              <Trash2 size={14} />
            ) : (
              <RefreshCw size={14} />
            )}
            {isDelete ? 'Delete' : 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  )
}


/* ------------------------------------------------------------------ */
/* ------------------------------------------------------------------ */
/* Backend Cards                                                       */
/* ------------------------------------------------------------------ */

function BackendCards({ backends, isSwitching, onSwitch }) {
  const [confirmBackend, setConfirmBackend] = useState(null)

  const handleActivate = async (backend) => {
    setConfirmBackend(null)
    await onSwitch(backend.id)
  }

  return (
    <div className="mb-6">
      <h3 className="text-xs uppercase tracking-wider text-zinc-500 font-medium mb-3">
        LLM Backend
      </h3>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {backends.map(backend => {
          const meta = BACKEND_CARD_META[backend.id] || BACKEND_CARD_META.llamacpp
          const Icon = meta.icon
          const isActive = backend.active
          const isInstalled = backend.installed

          return (
            <div
              key={backend.id}
              className={`relative p-4 rounded-xl border transition-all ${
                isActive
                  ? meta.activeCard
                  : 'bg-zinc-900/50 border-zinc-800 hover:border-zinc-600'
              }`}
            >
              <div className="flex items-start justify-between mb-2">
                <div className={`p-2 rounded-lg ${
                  isActive ? meta.activeIcon : 'bg-zinc-800'
                }`}>
                  <Icon size={18} className={
                    isActive ? meta.activeIconColor : 'text-zinc-500'
                  } />
                </div>
                {isActive && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-500/20 text-green-400">
                    <Check size={12} /> Active
                  </span>
                )}
                {!isActive && isInstalled && (
                  <button
                    onClick={() => setConfirmBackend(backend)}
                    disabled={isSwitching}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isSwitching ? (
                      <><Loader2 size={12} className="animate-spin" /> Switching...</>
                    ) : (
                      <><Power size={12} /> Activate</>
                    )}
                  </button>
                )}
              </div>
              <h4 className={`text-sm font-semibold mb-0.5 ${
                isActive ? 'text-white' : 'text-zinc-300'
              }`}>
                {backend.name}
              </h4>
              <p className={`text-xs leading-relaxed ${
                isActive ? 'text-zinc-400' : 'text-zinc-600'
              }`}>
                {backend.description}
              </p>
            </div>
          )
        })}
      </div>

      {/* Confirm switch dialog */}
      {confirmBackend && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-zinc-900 border border-zinc-700 rounded-2xl p-6 max-w-md mx-4 shadow-2xl">
            <h3 className="text-lg font-bold text-white mb-2">Switch Backend?</h3>
            <p className="text-zinc-400 text-sm mb-1">
              Switch from the current backend to <strong className="text-white">{confirmBackend.name}</strong>?
            </p>
            <p className="text-amber-400 text-xs mb-4 flex items-center gap-1.5">
              <AlertTriangle size={14} />
              This will restart the inference service. Active conversations will be interrupted.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setConfirmBackend(null)}
                className="px-4 py-2 text-sm text-zinc-400 hover:text-white rounded-lg hover:bg-zinc-800 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => handleActivate(confirmBackend)}
                className="px-4 py-2 text-sm font-medium text-black bg-amber-500 hover:bg-amber-400 rounded-lg transition-colors"
              >
                Switch to {confirmBackend.name}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}


/* ------------------------------------------------------------------ */
/* Active Model Banner                                                 */
/* ------------------------------------------------------------------ */

function ActiveModelBanner({ model, gpu, onUnload, onTest, isTesting, testResult }) {
  const [unloading, setUnloading] = useState(false)
  const isStopped = model.status === 'stopped'
  const isRunning = model.status === 'running'

  return (
    <div className="mb-6 p-5 bg-gradient-to-r from-indigo-900/30 to-purple-900/20 border border-indigo-500/30 rounded-xl">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-green-500/20 rounded-xl">
            <Sparkles size={24} className="text-green-400" />
          </div>
          <div>
            <p className="text-xs text-zinc-500 uppercase tracking-wider font-medium mb-1">Active Model</p>
            <h2 className="text-lg font-bold text-white">{model.name}</h2>
            <div className="flex items-center gap-3 mt-1.5 text-sm">
              <span className="flex items-center gap-1.5 text-zinc-400">
                <Server size={14} className="text-indigo-400" />
                {BACKEND_DISPLAY_NAMES[model.backend] || model.backend || 'llama.cpp'}
              </span>
              {model.context_length && (
                <span className="text-zinc-500 font-mono">
                  {(model.context_length / 1024).toFixed(0)}K ctx
                </span>
              )}
              {model.tokens_per_sec > 0 && (
                <span className="flex items-center gap-1 text-zinc-400">
                  <Zap size={14} className="text-amber-400" />
                  {model.tokens_per_sec} tok/s
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {onTest && (
            <button
              onClick={() => onTest()}
              disabled={isTesting || isStopped}
              className="px-3 py-1.5 bg-amber-500/15 hover:bg-amber-500/25 text-amber-400 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5 border border-amber-500/20 disabled:opacity-50"
              title={isStopped ? 'Start the model first' : 'Send a quick prompt and measure token speed'}
            >
              {isTesting ? (
                <><Loader2 size={12} className="animate-spin" /> Testing...</>
              ) : (
                <><Zap size={12} /> Quick Test</>
              )}
            </button>
          )}
          {onUnload && (
            <button
              onClick={async () => {
                setUnloading(true)
                try { await onUnload() } finally { setUnloading(false) }
              }}
              disabled={unloading}
              className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5 border border-zinc-700"
            >
              {unloading ? (
                <><Loader2 size={12} className="animate-spin" /> Unloading...</>
              ) : (
                <><Square size={12} /> Unload</>  
              )}
            </button>
          )}
          {isRunning ? (
            <span className="px-3 py-1.5 bg-green-500/15 text-green-400 rounded-lg text-xs font-semibold border border-green-500/20">
              <Check size={12} className="inline mr-1" />
              Running
            </span>
          ) : isStopped ? (
            <span className="px-3 py-1.5 bg-red-500/15 text-red-400 rounded-lg text-xs font-semibold border border-red-500/20">
              <Square size={12} className="inline mr-1" />
              Stopped
            </span>
          ) : (
            <span className="px-3 py-1.5 bg-amber-500/15 text-amber-400 rounded-lg text-xs font-semibold border border-amber-500/20">
              <Loader2 size={12} className="inline mr-1 animate-spin" />
              Connecting...
            </span>
          )}
        </div>
      </div>

      {/* Test Results */}
      {testResult && (
        <div className={`mt-4 p-3 rounded-lg border ${
          testResult.success
            ? 'bg-zinc-900/60 border-zinc-700'
            : 'bg-red-500/10 border-red-500/30'
        }`}>
          {testResult.success ? (
            <div>
              <div className="flex items-center gap-4 mb-2">
                <div className="flex items-center gap-1.5">
                  <Zap size={14} className="text-amber-400" />
                  <span className="text-lg font-bold text-white">{testResult.tok_per_sec}</span>
                  <span className="text-xs text-zinc-500">tok/s</span>
                </div>
                <div className="text-xs text-zinc-500">
                  TTFT: <span className="text-zinc-300 font-mono">{testResult.ttft_ms}ms</span>
                </div>
                <div className="text-xs text-zinc-500">
                  Tokens: <span className="text-zinc-300 font-mono">{testResult.tokens}</span>
                </div>
                <div className="text-xs text-zinc-500">
                  Total: <span className="text-zinc-300 font-mono">{(testResult.total_time_ms / 1000).toFixed(1)}s</span>
                </div>
              </div>
              <p className="text-xs text-zinc-500 leading-relaxed line-clamp-3">
                {testResult.response}
              </p>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <AlertCircle size={14} className="text-red-400" />
              <span className="text-sm text-red-400">{testResult.error}</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}


/* ------------------------------------------------------------------ */
/* VRAM Meter                                                          */
/* ------------------------------------------------------------------ */

function VramMeter({ gpu }) {
  const [expanded, setExpanded] = useState(false)
  const pct = gpu.vramTotal > 0 ? (gpu.vramUsed / gpu.vramTotal) * 100 : 0
  const barColor = pct > 90 ? 'from-red-500 to-red-600'
    : pct > 70 ? 'from-yellow-500 to-amber-500'
    : 'from-indigo-500 to-purple-500'

  const processes = gpu.processes || []
  const hasProcesses = processes.length > 0

  // Colors for process segments
  const processColors = [
    'bg-indigo-500', 'bg-purple-500', 'bg-emerald-500', 'bg-amber-500',
    'bg-cyan-500', 'bg-rose-500', 'bg-teal-500', 'bg-orange-500',
  ]

  return (
    <div className="mb-6 p-4 bg-zinc-900/50 border border-zinc-800 rounded-xl">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm text-zinc-400 flex items-center gap-2">
          <HardDrive size={14} /> GPU VRAM
        </span>
        <span className="text-sm text-white font-mono">
          {gpu.vramUsed?.toFixed(1)} / {gpu.vramTotal?.toFixed(0)} GB
        </span>
      </div>

      {/* Main VRAM bar */}
      {hasProcesses ? (
        <div className="h-2.5 bg-zinc-700 rounded-full overflow-hidden flex">
          {processes.map((proc, i) => {
            const procPct = gpu.vramTotal > 0 ? ((proc.memoryMb / 1024) / gpu.vramTotal) * 100 : 0
            return (
              <div
                key={proc.pid}
                className={`h-full ${processColors[i % processColors.length]} transition-all duration-500`}
                style={{ width: `${Math.min(procPct, 100)}%` }}
                title={`${proc.name} (PID ${proc.pid}): ${(proc.memoryMb / 1024).toFixed(1)} GB`}
              />
            )
          })}
        </div>
      ) : (
        <div className="h-2.5 bg-zinc-700 rounded-full overflow-hidden">
          <div
            className={`h-full bg-gradient-to-r ${barColor} rounded-full transition-all duration-500`}
            style={{ width: `${Math.min(pct, 100)}%` }}
          />
        </div>
      )}

      <div className="flex items-center justify-between mt-2">
        <p className="text-xs text-zinc-500">
          {gpu.vramFree?.toFixed(1)} GB free • Models with <span className="text-green-400">Fits GPU</span> badge can be loaded
        </p>
        {hasProcesses && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-xs text-zinc-500 hover:text-zinc-300 flex items-center gap-1 transition-colors"
          >
            {processes.length} process{processes.length !== 1 ? 'es' : ''}
            <ChevronDown size={12} className={`transition-transform ${expanded ? 'rotate-180' : ''}`} />
          </button>
        )}
      </div>

      {/* Per-process breakdown */}
      {expanded && hasProcesses && (
        <div className="mt-3 pt-3 border-t border-zinc-800 space-y-2">
          {processes.map((proc, i) => (
            <div key={proc.pid} className="flex items-center gap-3 text-xs">
              <div className={`w-2.5 h-2.5 rounded-full ${processColors[i % processColors.length]} flex-shrink-0`} />
              <span className="text-zinc-300 font-medium flex-1 truncate">{proc.name === '[Not Found]' ? 'GPU Process' : proc.name}</span>
              <span className="text-zinc-500 font-mono">PID {proc.pid}</span>
              <span className="text-white font-mono min-w-[60px] text-right">
                {proc.memoryMb >= 1024
                  ? `${(proc.memoryMb / 1024).toFixed(1)} GB`
                  : `${proc.memoryMb} MB`
                }
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}


/* ------------------------------------------------------------------ */
/* Model Card                                                          */
/* ------------------------------------------------------------------ */

function ModelCard({ model, isLoading, isRestarting, onDownload, onLoad, onSwitch, onDelete, downloadState }) {
  const isLoaded = model.status === 'loaded'
  const isDownloaded = model.status === 'downloaded'
  const BackendIcon = BACKEND_ICONS[model.backend] || Server

  const borderClass = isLoaded
    ? 'border-green-500/30 bg-green-500/5'
    : isDownloaded
      ? 'border-indigo-500/20'
      : model.fits_vram === false
        ? 'border-zinc-800 opacity-60'
        : 'border-zinc-800'

  return (
    <div className={`p-5 bg-zinc-900/50 border rounded-xl transition-all hover:border-zinc-700 ${borderClass}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-4 flex-1 min-w-0">
          {/* Icon */}
          <div className={`p-3 rounded-xl flex-shrink-0 ${
            isLoaded ? 'bg-green-500/20' : 'bg-zinc-800'
          }`}>
            <Box size={22} className={isLoaded ? 'text-green-400' : 'text-indigo-400'} />
          </div>

          {/* Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-base font-semibold text-white">{model.name}</h3>
              {model.quantization && (
                <span className="px-1.5 py-0.5 text-[11px] bg-zinc-700 text-zinc-300 rounded font-mono">
                  {model.quantization}
                </span>
              )}
              <span className="px-2 py-0.5 text-[11px] bg-zinc-800 text-zinc-400 rounded flex items-center gap-1">
                <BackendIcon size={11} />
                {BACKEND_LABELS[model.backend] || model.backend}
              </span>
            </div>

            <p className="text-sm text-zinc-500 mt-1 line-clamp-1">{model.description}</p>

            {/* Stats */}
            <div className="flex items-center gap-3 mt-2.5 text-xs text-zinc-400 font-mono flex-wrap">
              {model.size_gb > 0 && <span>{model.size_gb} GB</span>}
              {model.vram_required_gb > 0 && (
                <>
                  <span className="text-zinc-600">•</span>
                  <span>{model.vram_required_gb} GB VRAM</span>
                </>
              )}
              {model.tokens_per_sec_estimate > 0 && (
                <>
                  <span className="text-zinc-600">•</span>
                  <span>~{model.tokens_per_sec_estimate} tok/s</span>
                </>
              )}
              {model.context_length > 0 && (
                <>
                  <span className="text-zinc-600">•</span>
                  <span>{(model.context_length / 1024).toFixed(0)}K ctx</span>
                </>
              )}
            </div>

            {/* Tags */}
            <div className="flex items-center gap-2 mt-2.5 flex-wrap">
              <span className={`px-2 py-0.5 text-[11px] rounded ${
                SPECIALTY_STYLES[model.specialty] || 'bg-zinc-700 text-zinc-300'
              }`}>
                {model.specialty}
              </span>

              {model.fits_vram === true && (
                <span className="px-2 py-0.5 text-[11px] bg-green-500/15 text-green-400 rounded flex items-center gap-1">
                  <Check size={10} /> Fits GPU
                </span>
              )}
              {model.fits_vram === false && (
                <span className="px-2 py-0.5 text-[11px] bg-red-500/15 text-red-400 rounded flex items-center gap-1">
                  <AlertCircle size={10} /> Too large
                </span>
              )}

              {isLoaded && (
                <span className="px-2 py-0.5 text-[11px] bg-green-500/15 text-green-400 rounded font-medium">
                  Active
                </span>
              )}
              {isDownloaded && !isLoaded && (
                <span className="px-2 py-0.5 text-[11px] bg-indigo-500/15 text-indigo-400 rounded">
                  Downloaded
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {isLoading ? (
            <div className="px-4 py-2 bg-zinc-700 text-zinc-400 rounded-lg">
              <Loader2 size={16} className="animate-spin" />
            </div>
          ) : isLoaded ? (
            <span className="px-4 py-2 bg-green-600/15 text-green-400 rounded-lg text-sm font-medium border border-green-500/20">
              Active
            </span>
          ) : model.backend === 'ollama' ? (
            /* Ollama models — Load (VRAM warm) + Delete */
            <>
              <button
                onClick={onLoad}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm font-medium flex items-center gap-2 transition-all shadow-lg shadow-indigo-500/20 hover:shadow-indigo-500/30"
                title="Load model into VRAM"
              >
                <Play size={14} />
                Load
              </button>
              <button
                onClick={onDelete}
                className="p-2 text-zinc-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                title="Delete model from Ollama"
              >
                <Trash2 size={16} />
              </button>
            </>
          ) : isDownloaded ? (
            <>
              {onSwitch ? (
                <button
                  onClick={onSwitch}
                  disabled={model.fits_vram === false || isRestarting}
                  className={`px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-all ${
                    model.fits_vram !== false && !isRestarting
                      ? 'bg-amber-600 hover:bg-amber-500 text-white shadow-lg shadow-amber-500/20 hover:shadow-amber-500/30'
                      : 'bg-zinc-700 text-zinc-500 cursor-not-allowed'
                  }`}
                  title={isRestarting ? 'Restart in progress...' : model.fits_vram !== false ? 'Switch model & restart container' : 'Not enough VRAM'}
                >
                  <RotateCcw size={14} />
                  Switch & Restart
                </button>
              ) : (
                <button
                  onClick={onLoad}
                  disabled={model.fits_vram === false}
                  className={`px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-all ${
                    model.fits_vram !== false
                      ? 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-500/20 hover:shadow-indigo-500/30'
                      : 'bg-zinc-700 text-zinc-500 cursor-not-allowed'
                  }`}
                  title={model.fits_vram !== false ? 'Load this model' : 'Not enough VRAM'}
                >
                  <Play size={14} />
                  Load
                </button>
              )}
              <button
                onClick={onDelete}
                className="p-2 text-zinc-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                title="Delete model"
              >
                <Trash2 size={16} />
              </button>
            </>
          ) : downloadState?.status === 'downloading' ? (
            <div className="flex-1 min-w-[200px]">
              <div className="flex items-center justify-between text-xs text-zinc-400 mb-1">
                <span className="flex items-center gap-1">
                  <Loader2 size={12} className="animate-spin" />
                  Downloading {downloadState.percent?.toFixed(1)}%
                </span>
                {downloadState.speedBytesPerSec > 0 && (
                  <span>{formatSpeed(downloadState.speedBytesPerSec)}</span>
                )}
              </div>
              <div className="w-full h-2 bg-zinc-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-indigo-500 rounded-full transition-all duration-300"
                  style={{ width: `${downloadState.percent || 0}%` }}
                />
              </div>
              {downloadState.bytesTotal > 0 && (
                <div className="text-xs text-zinc-500 mt-1">
                  {formatBytes(downloadState.bytesDownloaded)} / {formatBytes(downloadState.bytesTotal)}
                </div>
              )}
            </div>
          ) : downloadState?.status === 'complete' ? (
            <span className="text-sm text-green-400 flex items-center gap-1">
              <Check size={14} /> Downloaded
            </span>
          ) : downloadState?.status === 'error' ? (
            <div className="flex items-center gap-2">
              <span className="text-sm text-red-400 flex items-center gap-1">
                <AlertCircle size={14} /> Failed
              </span>
              <button
                onClick={onDownload}
                className="text-xs text-zinc-400 hover:text-white underline"
              >
                Retry
              </button>
            </div>
          ) : (
            <button
              onClick={onDownload}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm font-medium flex items-center gap-2 transition-all shadow-lg shadow-indigo-500/20 hover:shadow-indigo-500/30"
            >
              <Download size={14} />
              Download
            </button>
          )}
        </div>
      </div>
    </div>
  )
}


/* ------------------------------------------------------------------ */
/* Download Progress Bar                                               */
/* ------------------------------------------------------------------ */

function DownloadProgressBar({ progress, helpers }) {
  const { formatBytes, formatEta } = helpers

  if (progress.error) {
    return (
      <div 
        className="mb-6 p-4 bg-red-500/10 border border-red-500/30 rounded-xl"
        role="alert"
        aria-live="assertive"
      >
        <div className="flex items-center gap-3">
          <AlertCircle size={20} className="text-red-400" aria-hidden="true" />
          <div>
            <p className="text-red-400 font-medium">Download Failed</p>
            <p className="text-sm text-red-400/70">{progress.error}</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div 
      className="mb-6 p-5 bg-indigo-500/10 border border-indigo-500/30 rounded-xl"
      role="status"
      aria-live="polite"
      aria-label={`Downloading ${progress.model}, ${progress.percent?.toFixed(0) || 0}% complete`}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className="relative">
            <HardDrive size={20} className="text-indigo-400" aria-hidden="true" />
            <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-indigo-400 rounded-full animate-pulse" />
          </div>
          <div>
            <p className="text-white font-medium">Downloading {progress.model}</p>
            <p className="text-sm text-zinc-400">
              {formatBytes(progress.bytesDownloaded)} / {formatBytes(progress.bytesTotal)}
              {progress.speedMbps > 0 && ` • ${progress.speedMbps.toFixed(1)} MB/s`}
              {progress.eta && ` • ETA: ${formatEta(progress.eta)}`}
            </p>
          </div>
        </div>
        <span className="text-2xl font-bold text-indigo-400 font-mono" aria-label={`${progress.percent?.toFixed(0) || 0} percent`}>
          {progress.percent?.toFixed(0) || 0}%
        </span>
      </div>

      <div className="h-3 bg-zinc-700 rounded-full overflow-hidden" role="progressbar" aria-valuenow={progress.percent || 0} aria-valuemin={0} aria-valuemax={100}>
        <div
          className="h-full bg-gradient-to-r from-indigo-500 to-purple-500 rounded-full transition-all duration-300 relative"
          style={{ width: `${progress.percent || 0}%` }}
        >
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent animate-shimmer" />
        </div>
      </div>
    </div>
  )
}


/* ------------------------------------------------------------------ */
/* Ollama Section — Server info + Pull input                           */
/* ------------------------------------------------------------------ */

function OllamaSection({ ollama, onRefresh }) {
  const [pullInput, setPullInput] = useState('')
  const { info, error: ollamaError } = ollama

  const handlePull = async (e) => {
    e.preventDefault()
    if (!pullInput.trim()) return
    await ollama.pullModel(pullInput)
    setPullInput('')
    // Refresh model list after 2s to give pull time to start
    setTimeout(onRefresh, 2000)
  }

  return (
    <div className="mb-6 space-y-4">
      {/* Server Info */}
      {info && info.reachable && (
        <div className="flex items-center gap-3 text-sm">
          <span className="flex items-center gap-1.5 px-3 py-1.5 bg-green-500/10 border border-green-500/20 rounded-lg text-green-400">
            <Check size={14} />
            Ollama v{info.version}
          </span>
          <span className="px-3 py-1.5 bg-zinc-800 rounded-lg text-zinc-400">
            {info.modelCount} models installed
          </span>
          {info.runningModels.length > 0 && (
            <span className="px-3 py-1.5 bg-indigo-500/10 border border-indigo-500/20 rounded-lg text-indigo-400">
              {info.runningModels.map(m => m.name).join(', ')} running
            </span>
          )}
          {info.cloudHints?.hasCloudModels && (
            <span className="px-3 py-1.5 bg-purple-500/10 border border-purple-500/20 rounded-lg text-purple-400 flex items-center gap-1.5">
              <Cloud size={14} />
              Cloud subscription detected
            </span>
          )}
        </div>
      )}

      {info && !info.reachable && (
        <div className="flex items-center gap-2 text-sm text-amber-400">
          <AlertCircle size={14} />
          Ollama server not reachable
        </div>
      )}

      {/* Pull Model Input */}
      <form onSubmit={handlePull} className="flex gap-2">
        <div className="flex-1 relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
          <input
            type="text"
            value={pullInput}
            onChange={(e) => setPullInput(e.target.value)}
            placeholder="Pull a model... e.g. llama3.3, qwen3:14b, deepseek-r1"
            className="w-full pl-10 pr-4 py-2.5 bg-zinc-900/50 border border-zinc-700 rounded-lg text-white text-sm placeholder-zinc-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30 transition-colors"
          />
        </div>
        <button
          type="submit"
          disabled={!pullInput.trim() || ollama.pulling}
          className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white rounded-lg text-sm font-medium flex items-center gap-2 transition-all shadow-lg shadow-indigo-500/20 hover:shadow-indigo-500/30 disabled:shadow-none"
        >
          {ollama.pulling ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Download size={14} />
          )}
          Pull
        </button>
      </form>

      {/* Ollama Error */}
      {ollamaError && (
        <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg flex items-center gap-2">
          <AlertCircle size={14} className="text-red-400" />
          <p className="text-red-400 text-sm">{ollamaError}</p>
        </div>
      )}
    </div>
  )
}


/* ------------------------------------------------------------------ */
/* Ollama Pull Progress                                                */
/* ------------------------------------------------------------------ */

function OllamaPullProgress({ pulls, onClear }) {
  const entries = Object.entries(pulls)
  if (entries.length === 0) return null

  return (
    <div className="mb-6 space-y-3">
      {entries.map(([name, pull]) => (
        <div
          key={name}
          className={`p-4 border rounded-xl ${
            pull.status === 'error'
              ? 'bg-red-500/10 border-red-500/30'
              : pull.status === 'complete'
                ? 'bg-green-500/10 border-green-500/30'
                : 'bg-indigo-500/10 border-indigo-500/30'
          }`}
        >
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              {pull.status === 'pulling' && (
                <Loader2 size={14} className="text-indigo-400 animate-spin" />
              )}
              {pull.status === 'complete' && (
                <Check size={14} className="text-green-400" />
              )}
              {pull.status === 'error' && (
                <AlertCircle size={14} className="text-red-400" />
              )}
              <span className="text-sm font-medium text-white">{pull.model}</span>
              <span className={`text-xs ${
                pull.status === 'error' ? 'text-red-400'
                : pull.status === 'complete' ? 'text-green-400'
                : 'text-zinc-400'
              }`}>
                {pull.detail}
              </span>
            </div>
            <div className="flex items-center gap-2">
              {pull.status === 'pulling' && (
                <span className="text-sm font-bold text-indigo-400 font-mono">
                  {pull.percent?.toFixed(0)}%
                </span>
              )}
              {(pull.status === 'complete' || pull.status === 'error') && (
                <button
                  onClick={() => onClear(name)}
                  className="p-1 text-zinc-500 hover:text-white rounded transition-colors"
                >
                  <X size={14} />
                </button>
              )}
            </div>
          </div>

          {pull.status === 'pulling' && (
            <div className="h-2 bg-zinc-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-indigo-500 to-purple-500 rounded-full transition-all duration-300 relative"
                style={{ width: `${pull.percent || 0}%` }}
              >
                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent animate-shimmer" />
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}


/* ------------------------------------------------------------------ */
/* Cloud Providers Section                                             */
/* ------------------------------------------------------------------ */

function CloudProvidersSection() {
  const { providers, loading, saving, saveProvider, deleteProvider, testConnection } = useProviders()

  if (loading) {
    return (
      <div className="grid gap-4">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-36 bg-zinc-800 rounded-xl animate-pulse" />
        ))}
      </div>
    )
  }

  return (
    <div className="grid gap-4">
      <p className="text-sm text-zinc-400 mb-2">
        Configure API keys to use cloud models through Open WebUI and LiteLLM.
      </p>
      {providers.map(provider => (
        <ProviderCard
          key={provider.id}
          provider={provider}
          isSaving={saving === provider.id}
          onSave={(key, model) => saveProvider(provider.id, key, model)}
          onDelete={() => deleteProvider(provider.id)}
          onTestConnection={() => testConnection(provider.id)}
        />
      ))}
      {providers.length === 0 && (
        <div className="text-center py-12 text-zinc-500">
          <Cloud size={40} className="mx-auto mb-3 opacity-40" />
          <p>No cloud providers available in catalog.</p>
        </div>
      )}
    </div>
  )
}


function ProviderCard({ provider, isSaving, onSave, onDelete, onTestConnection }) {
  const [editing, setEditing] = useState(!provider.configured)
  const [apiKey, setApiKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [selectedModel, setSelectedModel] = useState(provider.default_model || '')
  const [testResult, setTestResult] = useState(null)
  const [testing, setTesting] = useState(false)

  const handleSave = async () => {
    if (!apiKey.trim()) return
    const success = await onSave(apiKey.trim(), selectedModel || null)
    if (success) {
      setEditing(false)
      setApiKey('')
    }
  }

  const handleTest = async () => {
    setTesting(true)
    setTestResult(null)
    const result = await onTestConnection()
    setTestResult(result)
    setTesting(false)
    // Clear result after 5 seconds
    setTimeout(() => setTestResult(null), 5000)
  }

  const handleDelete = async () => {
    await onDelete()
    setEditing(true)
  }

  return (
    <div className={`p-5 bg-zinc-900/50 border rounded-xl transition-all ${
      provider.configured ? 'border-green-500/20' : 'border-zinc-800'
    }`}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <div className={`p-3 rounded-xl ${provider.configured ? 'bg-green-500/15' : 'bg-zinc-800'}`}>
            <Cloud size={22} className={provider.configured ? 'text-green-400' : 'text-zinc-400'} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base font-semibold text-white">{provider.name}</h3>
              {provider.configured && (
                <span className="px-2 py-0.5 text-[11px] bg-green-500/15 text-green-400 rounded flex items-center gap-1">
                  <Check size={10} /> Connected
                </span>
              )}
            </div>
            <p className="text-sm text-zinc-500 mt-0.5">{provider.description}</p>
            {provider.docs_url && (
              <a
                href={provider.docs_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-indigo-400 hover:text-indigo-300 mt-1 inline-flex items-center gap-1"
              >
                Get API key <ExternalLink size={10} />
              </a>
            )}
          </div>
        </div>

        {provider.configured && !editing && (
          <div className="flex items-center gap-2">
            <button
              onClick={handleTest}
              disabled={testing}
              className="px-3 py-1.5 text-xs text-indigo-400 hover:text-indigo-300 hover:bg-indigo-500/10 rounded-lg transition-colors flex items-center gap-1.5"
            >
              {testing ? <Loader2 size={12} className="animate-spin" /> : <Zap size={12} />}
              Test
            </button>
            <button
              onClick={() => setEditing(true)}
              className="px-3 py-1.5 text-xs text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-lg transition-colors"
            >
              Update
            </button>
            <button
              onClick={handleDelete}
              className="p-1.5 text-zinc-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
              title="Remove API key"
            >
              <Trash2 size={14} />
            </button>
          </div>
        )}
      </div>

      {/* Test Result */}
      {testResult && (
        <div className={`mt-3 px-3 py-2 rounded-lg text-sm flex items-center gap-2 ${
          testResult.status === 'ok'
            ? 'bg-green-500/10 text-green-400 border border-green-500/20'
            : 'bg-red-500/10 text-red-400 border border-red-500/20'
        }`}>
          {testResult.status === 'ok' ? <Check size={14} /> : <AlertCircle size={14} />}
          {testResult.message}
        </div>
      )}

      {/* Edit Form */}
      {editing && (
        <div className="mt-4 pt-4 border-t border-zinc-800 space-y-3">
          <div>
            <label className="text-xs text-zinc-400 mb-1 block">API Key</label>
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <input
                  type={showKey ? 'text' : 'password'}
                  value={apiKey}
                  onChange={e => setApiKey(e.target.value)}
                  placeholder="sk-..."
                  className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-white text-sm font-mono placeholder:text-zinc-600 focus:border-indigo-500 focus:outline-none pr-10"
                />
                <button
                  onClick={() => setShowKey(!showKey)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
                >
                  {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>
          </div>

          {provider.available_models?.length > 0 && (
            <div>
              <label className="text-xs text-zinc-400 mb-1 block">Default Model</label>
              <div className="relative">
                <select
                  value={selectedModel}
                  onChange={e => setSelectedModel(e.target.value)}
                  className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-white text-sm appearance-none focus:border-indigo-500 focus:outline-none cursor-pointer"
                >
                  <option value="">Select a model...</option>
                  {provider.available_models.map(m => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
                <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" />
              </div>
            </div>
          )}

          <div className="flex items-center gap-2">
            <button
              onClick={handleSave}
              disabled={!apiKey.trim() || isSaving}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                apiKey.trim()
                  ? 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-500/20'
                  : 'bg-zinc-700 text-zinc-500 cursor-not-allowed'
              }`}
            >
              {isSaving ? <Loader2 size={14} className="animate-spin" /> : 'Save'}
            </button>
            {provider.configured && (
              <button
                onClick={() => setEditing(false)}
                className="px-4 py-2 text-zinc-400 hover:text-white text-sm rounded-lg hover:bg-zinc-800 transition-colors"
              >
                Cancel
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}


/* ------------------------------------------------------------------ */
/* Add Custom Model Form                                               */
/* ------------------------------------------------------------------ */

function AddCustomModelForm({ onAdd, onClose }) {
  const [form, setForm] = useState({
    name: '',
    huggingface_repo: '',
    huggingface_file: '',
    family: '',
    description: '',
    size_gb: '',
    vram_required_gb: '',
    context_length: '',
    quantization: '',
    specialty: 'General',
  })
  const [submitting, setSubmitting] = useState(false)

  const updateField = (field, value) => setForm(prev => ({ ...prev, [field]: value }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.name || !form.huggingface_repo || !form.huggingface_file) return

    setSubmitting(true)
    try {
      await onAdd({
        ...form,
        size_gb: form.size_gb ? parseFloat(form.size_gb) : null,
        vram_required_gb: form.vram_required_gb ? parseFloat(form.vram_required_gb) : null,
        context_length: form.context_length ? parseInt(form.context_length) : null,
      })
    } finally {
      setSubmitting(false)
    }
  }

  const inputClass = "w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-white text-sm placeholder:text-zinc-600 focus:border-indigo-500 focus:outline-none"

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl w-full max-w-lg max-h-[80vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-zinc-800 flex items-center justify-between sticky top-0 bg-zinc-900 z-10 rounded-t-xl">
          <h3 className="text-lg font-semibold text-white flex items-center gap-2">
            <Upload size={18} className="text-indigo-400" />
            Add Custom Model
          </h3>
          <button onClick={onClose} className="text-zinc-400 hover:text-white p-1">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Required Fields */}
          <div>
            <label className="block text-xs text-zinc-400 mb-1.5 font-medium">
              Model Name <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={form.name}
              onChange={e => updateField('name', e.target.value)}
              placeholder="e.g. Phi-4 Mini 3.8B"
              className={inputClass}
              required
            />
          </div>

          <div>
            <label className="block text-xs text-zinc-400 mb-1.5 font-medium">
              HuggingFace Repository <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={form.huggingface_repo}
              onChange={e => updateField('huggingface_repo', e.target.value)}
              placeholder="e.g. bartowski/Phi-4-mini-instruct-GGUF"
              className={inputClass}
              required
            />
            <p className="text-xs text-zinc-600 mt-1">Format: username/repository-name</p>
          </div>

          <div>
            <label className="block text-xs text-zinc-400 mb-1.5 font-medium">
              GGUF Filename <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={form.huggingface_file}
              onChange={e => updateField('huggingface_file', e.target.value)}
              placeholder="e.g. Phi-4-mini-instruct-Q4_K_M.gguf"
              className={inputClass}
              required
            />
          </div>

          {/* Optional Fields */}
          <div className="pt-3 border-t border-zinc-800">
            <p className="text-xs text-zinc-500 mb-3 font-medium uppercase tracking-wider">Optional Details</p>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-zinc-400 mb-1">Family</label>
                <input
                  type="text"
                  value={form.family}
                  onChange={e => updateField('family', e.target.value)}
                  placeholder="e.g. Phi"
                  className={inputClass}
                />
              </div>
              <div>
                <label className="block text-xs text-zinc-400 mb-1">Quantization</label>
                <input
                  type="text"
                  value={form.quantization}
                  onChange={e => updateField('quantization', e.target.value)}
                  placeholder="e.g. Q4_K_M"
                  className={inputClass}
                />
              </div>
              <div>
                <label className="block text-xs text-zinc-400 mb-1">Size (GB)</label>
                <input
                  type="number"
                  step="0.1"
                  value={form.size_gb}
                  onChange={e => updateField('size_gb', e.target.value)}
                  placeholder="e.g. 2.3"
                  className={inputClass}
                />
              </div>
              <div>
                <label className="block text-xs text-zinc-400 mb-1">VRAM Required (GB)</label>
                <input
                  type="number"
                  step="0.1"
                  value={form.vram_required_gb}
                  onChange={e => updateField('vram_required_gb', e.target.value)}
                  placeholder="e.g. 4"
                  className={inputClass}
                />
              </div>
              <div>
                <label className="block text-xs text-zinc-400 mb-1">Context Length</label>
                <input
                  type="number"
                  value={form.context_length}
                  onChange={e => updateField('context_length', e.target.value)}
                  placeholder="e.g. 131072"
                  className={inputClass}
                />
              </div>
              <div>
                <label className="block text-xs text-zinc-400 mb-1">Specialty</label>
                <select
                  value={form.specialty}
                  onChange={e => updateField('specialty', e.target.value)}
                  className={inputClass + ' appearance-none cursor-pointer'}
                >
                  {['General', 'Code', 'Reasoning', 'Fast', 'Balanced', 'Quality'].map(s => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="mt-3">
              <label className="block text-xs text-zinc-400 mb-1">Description</label>
              <input
                type="text"
                value={form.description}
                onChange={e => updateField('description', e.target.value)}
                placeholder="Short description of the model..."
                className={inputClass}
              />
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-3 pt-3 border-t border-zinc-800">
            <button
              type="submit"
              disabled={submitting || !form.name || !form.huggingface_repo || !form.huggingface_file}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white rounded-lg text-sm font-medium transition-colors"
            >
              {submitting ? (
                <><Loader2 size={16} className="animate-spin" /> Adding...</>
              ) : (
                <><Plus size={16} /> Add Model</>
              )}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 text-zinc-400 hover:text-white border border-zinc-700 hover:border-zinc-600 rounded-lg text-sm transition-colors"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
