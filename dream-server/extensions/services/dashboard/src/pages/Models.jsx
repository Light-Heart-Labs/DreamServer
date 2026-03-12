import { useState, useCallback, useMemo } from 'react'
import {
  Box, Download, Trash2, Check, AlertCircle, Loader2, Play,
  RefreshCw, HardDrive, Zap, Cloud, Server, ChevronDown,
  Eye, EyeOff, ExternalLink, X, Sparkles, Search, Info,
  AlertTriangle
} from 'lucide-react'
import { useModels, useProviders, useOllama } from '../hooks/useModels'
import { useDownloadProgress } from '../hooks/useDownloadProgress'

const BACKEND_LABELS = {
  'llama-server': 'Local (GGUF)',
  'ollama': 'Ollama',
  'openai': 'OpenAI',
  'anthropic': 'Anthropic',
  'google': 'Google AI',
}

const BACKEND_ICONS = {
  'llama-server': Server,
  'ollama': Box,
  'openai': Cloud,
  'anthropic': Cloud,
  'google': Cloud,
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
  { id: 'ollama', label: 'Ollama' },
  { id: 'cloud', label: 'Cloud Providers' },
]

export default function Models() {
  const downloadProgress = useDownloadProgress()
  const {
    models, gpu, activeModel, loading, error, actionLoading,
    filter, setFilter, downloadModel, loadModel, deleteModel, refresh
  } = useModels()
  const ollama = useOllama()

  // Search state
  const [search, setSearch] = useState('')

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

  const handleConfirmDelete = useCallback(async () => {
    if (confirmDialog?.onConfirm) await confirmDialog.onConfirm()
    setConfirmDialog(null)
    showToast('Model deleted successfully')
  }, [confirmDialog, showToast])

  // Filter models by search
  const filteredModels = useMemo(() => {
    if (!search.trim()) return models
    const q = search.toLowerCase()
    return models.filter(m =>
      m.name.toLowerCase().includes(q) ||
      m.family?.toLowerCase().includes(q) ||
      m.description?.toLowerCase().includes(q) ||
      m.specialty?.toLowerCase().includes(q)
    )
  }, [models, search])

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
          title="Refresh"
        >
          <RefreshCw size={20} />
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-6 p-4 bg-red-500/10 border border-red-500/30 rounded-xl flex items-start gap-3">
          <AlertCircle size={18} className="text-red-400 mt-0.5 flex-shrink-0" />
          <p className="text-red-400 text-sm">{error}</p>
        </div>
      )}

      {/* Active Model Banner */}
      {activeModel && (
        <ActiveModelBanner model={activeModel} gpu={gpu} />
      )}

      {/* VRAM Meter */}
      {gpu && <VramMeter gpu={gpu} />}

      {/* Filter Tabs */}
      <div className="mb-6 flex items-center gap-1 bg-zinc-900/50 border border-zinc-800 rounded-lg p-1">
        {FILTER_TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setFilter(tab.id)}
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

      {/* Search Bar (hidden in cloud tab) */}
      {filter !== 'cloud' && (
        <div className="mb-5 relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search models by name, family, or specialty..."
            className="w-full pl-10 pr-4 py-2.5 bg-zinc-900/50 border border-zinc-800 rounded-lg text-sm text-white placeholder:text-zinc-600 focus:border-indigo-500 focus:outline-none transition-colors"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-white"
            >
              <X size={14} />
            </button>
          )}
        </div>
      )}

      {/* Download Progress */}
      {downloadProgress.isDownloading && downloadProgress.progress && (
        <DownloadProgressBar progress={downloadProgress.progress} helpers={downloadProgress} />
      )}

      {/* Ollama Pull Progress */}
      {Object.keys(ollama.pulls).length > 0 && (
        <OllamaPullProgress pulls={ollama.pulls} onClear={ollama.clearPull} />
      )}

      {/* Ollama Section (shown in ollama tab) */}
      {filter === 'ollama' && (
        <OllamaSection ollama={ollama} onRefresh={refresh} />
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
              onDownload={() => { downloadModel(model.id); downloadProgress.startPolling() }}
              onLoad={() => {
                if (model.backend === 'ollama') {
                  ollama.loadOllamaModel(model.id.replace('ollama:', ''))
                } else {
                  loadModel(model.id)
                }
              }}
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

      {/* Confirmation Dialog */}
      {confirmDialog && (
        <ConfirmDialog
          title={confirmDialog.title}
          message={confirmDialog.message}
          onConfirm={handleConfirmDelete}
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
          <div className="p-3 bg-red-500/15 rounded-xl flex-shrink-0">
            <AlertTriangle size={22} className="text-red-400" />
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
            className="px-4 py-2.5 bg-red-600 hover:bg-red-500 text-white rounded-lg text-sm font-medium flex items-center gap-2 transition-colors shadow-lg shadow-red-500/20 disabled:opacity-50"
          >
            {loading ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Trash2 size={14} />
            )}
            Delete
          </button>
        </div>
      </div>
    </div>
  )
}


/* ------------------------------------------------------------------ */
/* Active Model Banner                                                 */
/* ------------------------------------------------------------------ */

function ActiveModelBanner({ model, gpu }) {
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
                {model.backend || 'llama-server'}
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
          <span className="px-3 py-1.5 bg-green-500/15 text-green-400 rounded-lg text-xs font-semibold border border-green-500/20">
            <Check size={12} className="inline mr-1" />
            Running
          </span>
        </div>
      </div>
    </div>
  )
}


/* ------------------------------------------------------------------ */
/* VRAM Meter                                                          */
/* ------------------------------------------------------------------ */

function VramMeter({ gpu }) {
  const pct = gpu.vramTotal > 0 ? (gpu.vramUsed / gpu.vramTotal) * 100 : 0
  const barColor = pct > 90 ? 'from-red-500 to-red-600'
    : pct > 70 ? 'from-yellow-500 to-amber-500'
    : 'from-indigo-500 to-purple-500'

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
      <div className="h-2.5 bg-zinc-700 rounded-full overflow-hidden">
        <div
          className={`h-full bg-gradient-to-r ${barColor} rounded-full transition-all duration-500`}
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>
      <p className="text-xs text-zinc-500 mt-2">
        {gpu.vramFree?.toFixed(1)} GB free • Models with <span className="text-green-400">Fits GPU</span> badge can be loaded
      </p>
    </div>
  )
}


/* ------------------------------------------------------------------ */
/* Model Card                                                          */
/* ------------------------------------------------------------------ */

function ModelCard({ model, isLoading, onDownload, onLoad, onDelete }) {
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
            /* Ollama models are managed by Ollama — show Ready + Delete */
            <>
              <span className="px-4 py-2 bg-indigo-600/15 text-indigo-400 rounded-lg text-sm font-medium border border-indigo-500/20">
                Ready
              </span>
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
              <button
                onClick={onDelete}
                className="p-2 text-zinc-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                title="Delete model"
              >
                <Trash2 size={16} />
              </button>
            </>
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
      <div className="mb-6 p-4 bg-red-500/10 border border-red-500/30 rounded-xl">
        <div className="flex items-center gap-3">
          <AlertCircle size={20} className="text-red-400" />
          <div>
            <p className="text-red-400 font-medium">Download Failed</p>
            <p className="text-sm text-red-400/70">{progress.error}</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="mb-6 p-5 bg-indigo-500/10 border border-indigo-500/30 rounded-xl">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className="relative">
            <HardDrive size={20} className="text-indigo-400" />
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
        <span className="text-2xl font-bold text-indigo-400 font-mono">
          {progress.percent?.toFixed(0) || 0}%
        </span>
      </div>

      <div className="h-3 bg-zinc-700 rounded-full overflow-hidden">
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
