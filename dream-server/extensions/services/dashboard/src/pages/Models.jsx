import { useState, useEffect } from 'react'
import { Box, Download, Trash2, Check, AlertCircle, Loader2, Play, RefreshCw, HardDrive } from 'lucide-react'
import { useModels } from '../hooks/useModels'
import { useDownloadProgress } from '../hooks/useDownloadProgress'

export default function Models() {
  const downloadProgress = useDownloadProgress()
  const {
    models,
    gpu,
    currentModel,
    loading,
    error,
    actionLoading,
    downloadModel,
    loadModel,
    deleteModel,
    refresh
  } = useModels()

  // Optimistic state: tracks which model had Download clicked before
  // the progress poller picks up real data (up to 10s gap otherwise).
  const [downloadStarting, setDownloadStarting] = useState(null)

  useEffect(() => {
    if (downloadProgress.isDownloading || error) {
      setDownloadStarting(null)
    }
  }, [downloadProgress.isDownloading, error])

  const handleDownload = async (modelId) => {
    setDownloadStarting(modelId)
    await downloadModel(modelId)
    // Kick the progress poller immediately instead of waiting up to 10s
    downloadProgress.refresh()
  }

  if (loading) {
    return (
      <div className="p-8">
        <div className="animate-pulse">
          <div className="h-8 bg-theme-card rounded w-1/3 mb-8" />
          <div className="h-24 bg-theme-card rounded-xl mb-8" />
          <div className="space-y-4">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-32 bg-theme-card rounded-xl" />
            ))}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="p-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-theme-text">Models</h1>
          <p className="text-theme-text-muted mt-1">
            Download, switch, and manage your AI models.
          </p>
        </div>
        <button 
          onClick={refresh}
          className="p-2 text-theme-text-muted hover:text-theme-text hover:bg-theme-surface-hover rounded-lg transition-colors"
          title="Refresh"
        >
          <RefreshCw size={20} />
        </button>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-500/10 border border-red-500/30 rounded-xl text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* VRAM Indicator */}
      {gpu && (
        <div className="mb-8 p-4 bg-theme-card border border-theme-border rounded-xl">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-theme-text-muted">GPU VRAM</span>
            <span className="text-sm text-theme-text">
              {gpu.vramUsed?.toFixed(1)} / {gpu.vramTotal?.toFixed(0)} GB used
            </span>
          </div>
          <div className="h-2 bg-theme-border rounded-full overflow-hidden">
            <div 
              className={`h-full rounded-full transition-all ${
                (gpu.vramTotal > 0 ? gpu.vramUsed / gpu.vramTotal : 0) > 0.9 ? 'bg-red-500' :
                (gpu.vramTotal > 0 ? gpu.vramUsed / gpu.vramTotal : 0) > 0.7 ? 'bg-yellow-500' : 'bg-theme-accent'
              }`}
              style={{ width: `${gpu.vramTotal > 0 ? (gpu.vramUsed / gpu.vramTotal) * 100 : 0}%` }} 
            />
          </div>
          <p className="text-xs text-theme-text-muted mt-2">
            {gpu.vramFree?.toFixed(1)} GB free • Models with green badges fit your GPU
          </p>
        </div>
      )}

      {/* Download Progress */}
      {downloadProgress.isDownloading && downloadProgress.progress && (
        <DownloadProgressBar progress={downloadProgress.progress} helpers={downloadProgress} />
      )}

      {/* Current Model */}
      {currentModel && (
        <div className="mb-6 p-3 bg-green-500/10 border border-green-500/30 rounded-lg">
          <span className="text-sm text-green-400">
            <Check size={14} className="inline mr-2" />
            Currently running: <strong>{currentModel}</strong>
          </span>
        </div>
      )}

      {/* Models Grid */}
      <div className="grid gap-4">
        {models.map(model => (
          <ModelCard
            key={model.id}
            model={model}
            isLoading={actionLoading === model.id}
            loadBusy={!!actionLoading}
            downloadBusy={downloadProgress.isDownloading || !!downloadStarting}
            downloadStarting={downloadStarting === model.id}
            onDownload={() => handleDownload(model.id)}
            onLoad={() => loadModel(model.id)}
            onDelete={() => deleteModel(model.id)}
          />
        ))}
      </div>

      {models.length === 0 && (
        <div className="text-center py-12 text-theme-text-muted">
          No models found. Check your connection to the API.
        </div>
      )}
    </div>
  )
}

function ModelCard({ model, isLoading, loadBusy, downloadBusy, downloadStarting, onDownload, onLoad, onDelete }) {
  const isLoaded = model.status === 'loaded'
  const isDownloaded = model.status === 'downloaded'
  const isAvailable = model.status === 'available'

  const specialtyColors = {
    'General': 'bg-theme-accent/20 text-theme-accent',
    'Fast': 'bg-green-500/20 text-green-400',
    'Code': 'bg-purple-500/20 text-purple-400',
    'Balanced': 'bg-blue-500/20 text-blue-400',
    'Quality': 'bg-amber-500/20 text-amber-400',
    'Reasoning': 'bg-pink-500/20 text-pink-400',
    'Bootstrap': 'bg-cyan-500/20 text-cyan-400'
  }

  return (
    <div className={`p-6 bg-theme-card border rounded-xl transition-all ${
      isLoaded ? 'border-green-500/30 bg-green-500/5' :
      isDownloaded ? 'border-theme-accent/30' : 'border-theme-border'
    }`}>
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-4">
          <div className={`p-3 rounded-lg ${
            isLoaded ? 'bg-green-500/20' : 'bg-theme-card'
          }`}>
            <Box size={24} className={isLoaded ? 'text-green-400' : 'text-theme-accent'} />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h3 className="text-lg font-semibold text-theme-text">{model.name}</h3>
              {model.quantization && (
                <span className="px-1.5 py-0.5 text-xs bg-theme-border text-theme-text rounded">
                  {model.quantization}
                </span>
              )}
            </div>
            
            <p className="text-sm text-theme-text-muted mt-1">{model.description}</p>
            
            <div className="flex items-center gap-3 mt-3 text-sm text-theme-text-muted">
              <span>{model.size}</span>
              <span>•</span>
              <span>{model.vramRequired} GB VRAM</span>
              <span>•</span>
              <span>~{model.tokensPerSec} tok/s</span>
              <span>•</span>
              <span>{(model.contextLength / 1024).toFixed(0)}K context</span>
            </div>
            
            <div className="flex items-center gap-2 mt-3">
              <span className={`px-2 py-0.5 text-xs rounded ${specialtyColors[model.specialty] || 'bg-theme-border text-theme-text'}`}>
                {model.specialty}
              </span>
              
              {model.fitsVram ? (
                <span className="px-2 py-0.5 text-xs bg-green-500/20 text-green-400 rounded flex items-center gap-1">
                  <Check size={12} /> Fits GPU
                </span>
              ) : (
                <span className="px-2 py-0.5 text-xs bg-red-500/20 text-red-400 rounded flex items-center gap-1">
                  <AlertCircle size={12} /> Too large
                </span>
              )}
              
              {isLoaded && (
                <span className="px-2 py-0.5 text-xs bg-green-500/20 text-green-400 rounded">
                  Active
                </span>
              )}
              {isDownloaded && !isLoaded && (
                <span className="px-2 py-0.5 text-xs bg-theme-accent/20 text-theme-accent rounded">
                  Downloaded
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2 ml-4">
          {isLoading ? (
            <div className="px-4 py-2 bg-theme-accent/20 text-theme-accent rounded-lg text-sm font-medium flex items-center gap-2">
              <Loader2 size={16} className="animate-spin" />
              Loading...
            </div>
          ) : isLoaded ? (
            <span className="px-4 py-2 bg-green-600/20 text-green-400 rounded-lg text-sm font-medium">
              Active
            </span>
          ) : isDownloaded ? (
            <>
              <button
                onClick={onLoad}
                disabled={!model.fitsVram || loadBusy}
                className={`px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors ${
                  model.fitsVram && !loadBusy
                    ? 'bg-theme-accent hover:bg-theme-accent-hover text-white'
                    : 'bg-theme-border text-theme-text-muted cursor-not-allowed'
                }`}
                title={loadBusy ? 'Another model is loading' : model.fitsVram ? 'Load this model' : 'Not enough VRAM'}
              >
                <Play size={16} />
                Load
              </button>
              <button 
                onClick={onDelete}
                className="p-2 text-theme-text-muted hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                title="Delete model"
              >
                <Trash2 size={16} />
              </button>
            </>
          ) : downloadStarting ? (
            <button
              disabled
              className="px-4 py-2 bg-theme-accent/20 text-theme-accent rounded-lg text-sm font-medium flex items-center gap-2 cursor-not-allowed"
            >
              <Loader2 size={16} className="animate-spin" />
              Starting...
            </button>
          ) : downloadBusy ? (
            <button
              disabled
              className="px-4 py-2 bg-theme-border text-theme-text-muted rounded-lg text-sm font-medium flex items-center gap-2 cursor-not-allowed"
            >
              <Loader2 size={16} className="animate-spin" />
              Waiting
            </button>
          ) : (
            <button
              onClick={onDownload}
              className="px-4 py-2 bg-theme-accent hover:bg-theme-accent-hover text-white rounded-lg text-sm font-medium flex items-center gap-2 transition-colors"
            >
              <Download size={16} />
              Download
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

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
    <div className="mb-6 p-4 bg-theme-accent/10 border border-theme-accent/30 rounded-xl">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className="relative">
            <HardDrive size={20} className="text-theme-accent" />
            <span className="absolute -top-1 -right-1 w-2 h-2 bg-theme-accent rounded-full animate-pulse" />
          </div>
          <div>
            <p className="text-theme-text font-medium">
              {progress.status === 'verifying' ? 'Verifying' : 'Downloading'} {progress.model}
            </p>
            <p className="text-sm text-theme-text-muted">
              {formatBytes(progress.bytesDownloaded)} / {formatBytes(progress.bytesTotal)}
              {progress.speedMbps > 0 && ` • ${progress.speedMbps.toFixed(1)} MB/s`}
              {progress.eta && ` • ETA: ${formatEta(progress.eta)}`}
            </p>
          </div>
        </div>
        <span className="text-lg font-bold text-theme-accent">
          {progress.percent?.toFixed(0) || 0}%
        </span>
      </div>
      
      <div className="h-3 bg-theme-border rounded-full overflow-hidden">
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
