import {
  Database, Cpu, Workflow, Plug, Image, MessageSquare, Code,
  FileText, Shield, Globe, Music, Video, Search, Puzzle,
  Box, Loader2, RefreshCw, ChevronDown, ChevronUp, Package, Info, X, Download, Trash2, ExternalLink, Terminal, Copy, Check,
} from 'lucide-react'
import { useState, useEffect, useRef } from 'react'

// Auth: nginx injects "Authorization: Bearer ${DASHBOARD_API_KEY}" via
// proxy_set_header for all /api/ requests (see nginx.conf).  All fetches
// use relative URLs so they route through the nginx proxy which adds the
// header before forwarding to dashboard-api.  No explicit auth in JS.

const fetchJson = async (url, ms = 8000) => {
  const c = new AbortController()
  const t = setTimeout(() => c.abort(), ms)
  try {
    return await fetch(url, { signal: c.signal })
  } finally {
    clearTimeout(t)
  }
}

const ICON_MAP = {
  Database, Cpu, Workflow, Plug, Image, MessageSquare, Code,
  FileText, Shield, Globe, Music, Video, Search, Puzzle, Box,
}

const friendlyError = (detail) => {
  if (!detail || typeof detail !== 'string') return detail
  if (detail.includes('build context') || detail.includes('local build'))
    return 'This extension requires a local build and cannot be installed through the portal yet.'
  if (detail.includes('already installed'))
    return 'This extension is already installed.'
  if (detail.includes('already enabled'))
    return 'This extension is already enabled.'
  if (detail.includes('already disabled'))
    return 'This extension is already disabled.'
  if (detail.includes('Disable extension before'))
    return 'Please disable this extension before removing it.'
  if (detail.includes('still enabled'))
    return 'Please disable this extension before purging its data.'
  if (detail.includes('No data directory'))
    return 'No data directory found for this extension.'
  if (detail.includes('Missing dependencies'))
    return detail
  return detail
}

const STATUS_STYLES = {
  enabled:       'bg-green-500/20 text-green-400',
  stopped:       'bg-red-500/20 text-red-400',
  disabled:      'bg-theme-border text-theme-text-muted',
  not_installed: 'border border-theme-border text-theme-text-muted',
  incompatible:  'bg-orange-500/20 text-orange-400',
}

export default function Extensions() {
  const [catalog, setCatalog] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [expanded, setExpanded] = useState(null)
  const [mutating, setMutating] = useState(null)
  const [confirm, setConfirm] = useState(null)
  const [toast, setToast] = useState(null)
  const [consoleExt, setConsoleExt] = useState(null)
  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => {
    fetchCatalog()
  }, [])

  useEffect(() => {
    if (toast && toast.type !== 'info') {
      const t = setTimeout(() => setToast(null), 5000)
      return () => clearTimeout(t)
    }
  }, [toast])

  useEffect(() => {
    if (!confirm) return
    const handler = (e) => { if (e.key === 'Escape') setConfirm(null) }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [confirm])

  const fetchCatalog = async () => {
    try {
      if (!catalog) setLoading(true)
      setRefreshing(true)
      setError(null)
      const res = await fetchJson(`/api/extensions/catalog`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setCatalog(await res.json())
    } catch (err) {
      setError(err.name === 'AbortError' ? 'Request timed out' : 'Failed to load extensions catalog')
      console.error('Extensions fetch error:', err)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  const handleMutation = async (serviceId, action) => {
    setMutating(serviceId)
    setConfirm(null)
    try {
      const url = action === 'uninstall'
        ? `/api/extensions/${serviceId}`
        : action === 'purge'
        ? `/api/extensions/${serviceId}/data`
        : `/api/extensions/${serviceId}/${action}`
      const opts = {
        method: action === 'uninstall' || action === 'purge' ? 'DELETE' : 'POST',
        signal: AbortSignal.timeout(120000),
      }
      if (action === 'purge') {
        opts.headers = { 'Content-Type': 'application/json' }
        opts.body = JSON.stringify({ confirm: true })
      }
      const res = await fetch(url, opts)
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.detail || `Failed to ${action}`)
      }
      const data = await res.json()
      let successText = data.message || (
        action === 'uninstall' ? 'Extension removed' :
        action === 'purge' ? `Data purged — ${data.size_gb_freed ?? 0} GB freed` :
        `Extension ${action}d`
      )
      if (data.data_info) {
        successText += ` Data preserved (${data.data_info.size_gb} GB) — purge to remove.`
      }
      if (data.restart_required) {
        setToast({ type: 'info', text: `${successText} — restart needed to apply.` })
      } else {
        setToast({ type: 'success', text: successText })
      }
      await fetchCatalog()
    } catch (err) {
      setToast({ type: 'error', text: friendlyError(err.message) || `Failed to ${action} extension` })
    } finally {
      setMutating(null)
    }
  }

  const requestAction = (ext, action) => {
    const messages = {
      install: `Install ${ext.name}? This will download and start the service.`,
      enable: `Enable ${ext.name}? The service will be started.`,
      disable: `Disable ${ext.name}? The service will be stopped.`,
      uninstall: `Remove ${ext.name}? You can reinstall it from the library.`,
      purge: `Permanently delete all data for ${ext.name}? This cannot be undone.`,
    }
    setConfirm({ action, ext, message: messages[action] })
  }

  if (loading && !catalog) {
    return (
      <div className="p-8 flex items-center justify-center h-64">
        <Loader2 className="animate-spin text-theme-accent" size={32} />
      </div>
    )
  }

  const extensions = catalog?.extensions || []
  const summary = catalog?.summary || {}

  // Derive unique categories from features
  const categories = ['all', ...new Set(
    extensions
      .flatMap(ext => ext.features?.map(f => f.category) || [])
      .filter(Boolean)
  )]

  const STATUS_FILTERS = ['all', 'enabled', 'stopped', 'disabled', 'not_installed', 'incompatible']
  const STATUS_LABELS = { all: 'All', enabled: 'Enabled', stopped: 'Stopped', disabled: 'Disabled', not_installed: 'Not Installed', incompatible: 'Incompatible' }

  // Filter extensions
  const query = search.toLowerCase()
  const filtered = extensions.filter(ext => {
    if (statusFilter !== 'all' && ext.status !== statusFilter) return false
    if (category !== 'all' && !ext.features?.some(f => f.category === category)) return false
    if (query && !ext.name.toLowerCase().includes(query) && !ext.description?.toLowerCase().includes(query)) return false
    return true
  })

  return (
    <div className="p-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-theme-text">Extensions</h1>
          <p className="text-theme-text-muted mt-1">
            Browse and discover add-on services.
          </p>
        </div>
        <div className="flex items-center gap-4">
          {catalog?.agent_available !== undefined && (
            <div className="flex items-center gap-1.5 text-xs">
              <span className={`w-1.5 h-1.5 rounded-full ${catalog.agent_available ? 'bg-green-500' : 'bg-theme-border'}`} />
              <span className={catalog.agent_available ? 'text-green-400' : 'text-theme-text-muted'}>
                {catalog.agent_available ? 'Agent' : 'Agent offline'}
              </span>
            </div>
          )}
          <button
            onClick={fetchCatalog}
            disabled={refreshing}
            className="text-sm text-theme-accent-light hover:text-theme-accent flex items-center gap-1.5 transition-colors disabled:opacity-50"
          >
            <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div className="mb-6 rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-200">
          {error} — <button className="underline" onClick={fetchCatalog}>Retry</button>
        </div>
      )}

      {/* Summary bar */}
      <div className="bg-theme-card border border-theme-border rounded-xl p-4 mb-6 liquid-metal-frame liquid-metal-frame--soft">
        <div className="flex items-center gap-6 text-sm">
          <SummaryItem label="Total" value={summary.total || extensions.length} color="bg-theme-text-muted" />
          <SummaryItem label="Installed" value={summary.installed ?? 0} color="bg-green-500" />
          <SummaryItem label="Stopped" value={summary.stopped ?? 0} color="bg-red-500" />
          <SummaryItem label="Available" value={summary.not_installed ?? 0} color="bg-theme-accent" />
          <SummaryItem label="Incompatible" value={summary.incompatible ?? 0} color="bg-orange-500" />
        </div>
      </div>

      {/* Status filter row */}
      <div className="flex flex-wrap gap-2 mb-3">
        {STATUS_FILTERS.map(s => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`px-3 py-1 rounded-lg text-sm border transition-colors ${
              statusFilter === s
                ? 'bg-theme-accent/20 text-theme-accent-light border-theme-accent/30'
                : 'bg-theme-card text-theme-text-muted hover:bg-theme-surface-hover border-transparent'
            }`}
          >
            {STATUS_LABELS[s]}
          </button>
        ))}
      </div>

      {/* Category filter row */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 mb-6">
        <div className="flex flex-wrap gap-2">
          {categories.map(cat => (
            <button
              key={cat}
              onClick={() => setCategory(cat)}
              className={`px-3 py-1 rounded-lg text-xs border transition-colors ${
                category === cat
                  ? 'bg-theme-surface-hover text-theme-text border-theme-border'
                  : 'bg-theme-card/50 text-theme-text-muted hover:bg-theme-surface-hover border-transparent'
              }`}
            >
              {cat === 'all' ? 'All Categories' : cat}
            </button>
          ))}
        </div>
        <input
          type="text"
          placeholder="Search extensions..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="bg-theme-card border border-theme-border text-theme-text placeholder-theme-text-muted rounded-lg px-3 py-1.5 text-sm w-full sm:w-64 outline-none focus:border-theme-accent/50"
        />
      </div>

      {/* Agent offline banner */}
      {catalog?.agent_available === false && (
        <div className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200 flex items-center gap-2">
          <span className="shrink-0">⚠</span>
          <span>Host agent is offline — install, enable, and disable operations are unavailable. Container logs cannot be fetched.</span>
        </div>
      )}

      {/* Card grid */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-theme-text-muted">
          <Package size={48} className="mb-4 opacity-40" />
          <p className="text-lg">No extensions available</p>
          <p className="text-sm mt-1">Try adjusting your search or filters.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 liquid-metal-sequence-grid liquid-metal-sequence-grid--services">
          {filtered.map(ext => (
            <ExtensionCard
              key={ext.id}
              ext={ext}
              gpuBackend={catalog?.gpu_backend}
              agentAvailable={catalog?.agent_available}
              onDetails={() => setExpanded(ext.id)}
              onConsole={() => setConsoleExt(ext)}
              onAction={requestAction}
              mutating={mutating}
            />
          ))}
        </div>
      )}

      {/* Detail modal */}
      {expanded && (
        <DetailModal ext={extensions.find(e => e.id === expanded)} gpuBackend={catalog?.gpu_backend} onClose={() => setExpanded(null)} />
      )}

      {/* Console modal */}
      {consoleExt && (
        <ConsoleModal ext={consoleExt} onClose={() => setConsoleExt(null)} />
      )}

      {/* Confirmation dialog */}
      {confirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setConfirm(null)}>
          <div className="bg-theme-card border border-theme-border rounded-xl p-6 max-w-md mx-4" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Confirm action">
            <h3 className="text-lg font-semibold text-theme-text mb-2">
              {confirm.action === 'uninstall' ? 'Remove' : confirm.action === 'purge' ? 'Purge Data —' : confirm.action.charAt(0).toUpperCase() + confirm.action.slice(1)} Extension
            </h3>
            <p className="text-sm text-theme-text-muted mb-4">{confirm.message}</p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setConfirm(null)} autoFocus className="px-4 py-2 text-sm text-theme-text-muted hover:text-theme-text transition-colors">Cancel</button>
              <button
                onClick={() => handleMutation(confirm.ext.id, confirm.action)}
                className={`px-4 py-2 text-sm rounded-lg transition-colors ${
                  confirm.action === 'uninstall' || confirm.action === 'purge' ? 'bg-red-500/20 text-red-300 hover:bg-red-500/30' :
                  'bg-theme-accent/20 text-theme-accent-light hover:bg-theme-accent/30'
                }`}
              >
                {confirm.action === 'uninstall' ? 'Remove' : confirm.action === 'purge' ? 'Purge' : confirm.action.charAt(0).toUpperCase() + confirm.action.slice(1)}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast notification */}
      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 rounded-xl border p-4 text-sm max-w-sm shadow-lg ${
          toast.type === 'error' ? 'border-red-500/20 bg-red-500/10 text-red-200' :
          toast.type === 'info' ? 'border-theme-accent/20 bg-theme-accent/10 text-theme-accent-light' :
          'border-green-500/20 bg-green-500/10 text-green-200'
        }`}>
          <div className="flex items-center justify-between gap-3">
            <span>{toast.text}</span>
            <button onClick={() => setToast(null)} className="opacity-60 hover:opacity-100">×</button>
          </div>
        </div>
      )}
    </div>
  )
}

function SummaryItem({ label, value, color }) {
  return (
    <div className="flex items-center gap-2">
      <span className={`w-2 h-2 rounded-full ${color}`} />
      <span className="text-theme-text-muted">{label}</span>
      <span className="text-theme-text font-medium">{value}</span>
    </div>
  )
}

function ExtensionCard({ ext, gpuBackend, agentAvailable, onDetails, onConsole, onAction, mutating }) {
  const iconName = ext.features?.[0]?.icon
  const Icon = (iconName && ICON_MAP[iconName]) || Package
  const status = ext.status || 'not_installed'
  const statusStyle = STATUS_STYLES[status] || STATUS_STYLES.not_installed
  const isMutating = mutating === ext.id
  const anyMutating = !!mutating
  const agentOffline = agentAvailable === false
  const actionDisabled = anyMutating || agentOffline
  const disabledTitle = agentOffline ? 'Host agent is offline' : anyMutating ? 'Another operation is in progress' : undefined

  const isCore = ext.source === 'core'
  const isUserExt = ext.source === 'user'
  const isStopped = status === 'stopped'
  const isToggleable = isUserExt && (status === 'enabled' || status === 'disabled' || isStopped)
  const showRemove = isUserExt && status === 'disabled'
  const showInstall = status === 'not_installed' && ext.installable

  return (
    <div className={`bg-theme-card border rounded-xl transition-all liquid-metal-frame liquid-metal-sequence-card ${
      isCore ? 'border-theme-border/60 opacity-70' : 'border-theme-border'
    }`}>
      {/* Card body */}
      <div className="p-4 pb-3">
        <div className="flex items-start justify-between mb-2">
          <div className="flex items-center gap-2.5">
            <div className={`p-1.5 rounded-lg ${
              status === 'enabled' ? 'bg-green-500/10' :
              status === 'stopped' ? 'bg-red-500/10' :
              status === 'incompatible' ? 'bg-orange-500/10' :
              'bg-theme-card'
            }`}>
              <Icon size={16} className={
                status === 'enabled' ? 'text-green-400' :
                status === 'stopped' ? 'text-red-400' :
                status === 'incompatible' ? 'text-orange-400' :
                'text-theme-text-muted'
              } />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-theme-text leading-tight">{ext.name}</h3>
              {ext.features?.[0]?.category && (
                <span className="text-[10px] text-theme-text-muted uppercase tracking-wider">{ext.features[0].category}</span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isCore ? (
              <span
                className="text-[10px] px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/15 uppercase tracking-wider cursor-help"
                title="Built-in service — managed by DreamServer"
              >
                core
              </span>
            ) : (
              <span
                className={`text-[10px] px-2 py-0.5 rounded-full uppercase tracking-wider ${statusStyle} ${(status === 'incompatible' || status === 'stopped') ? 'cursor-help' : ''}`}
                title={status === 'incompatible' ? `Requires ${ext.gpu_backends?.join(' or ') || 'specific GPU'} — your system: ${gpuBackend || 'unknown'}` : status === 'stopped' ? 'Enabled but container not running' : undefined}
              >
                {status.replace('_', ' ')}
              </span>
            )}
            {isToggleable && (
              <button
                disabled={actionDisabled}
                title={disabledTitle}
                onClick={() => onAction(ext, status === 'enabled' ? 'disable' : 'enable')}
                className={`relative inline-flex h-[18px] w-[32px] shrink-0 rounded-full transition-colors disabled:opacity-50 ${
                  status === 'enabled' ? 'bg-green-500' : 'bg-theme-border'
                }`}
              >
                {isMutating ? (
                  <Loader2 size={8} className="animate-spin absolute top-[3px] left-[10px] text-white" />
                ) : (
                  <span className={`pointer-events-none inline-block h-[14px] w-[14px] rounded-full bg-white shadow-sm transform transition-transform mt-[2px] ${
                    status === 'enabled' ? 'translate-x-[16px]' : 'translate-x-[2px]'
                  }`} />
                )}
              </button>
            )}
          </div>
        </div>
        <p className="text-xs text-theme-text-muted line-clamp-2 leading-relaxed">{ext.description || 'No description available.'}</p>
      </div>

      {/* Card footer */}
      <div className="border-t border-theme-border/60 px-4 py-2.5 flex items-center justify-between bg-theme-card/30">
        <div className="flex gap-1.5">
          {showInstall && (
            <button
              disabled={actionDisabled}
              title={disabledTitle}
              onClick={() => onAction(ext, 'install')}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-theme-accent text-white hover:bg-theme-accent-hover transition-colors disabled:opacity-50 shadow-sm shadow-theme-accent/20"
            >
              {isMutating ? <Loader2 size={12} className="animate-spin" /> : <><Download size={12} /> Install</>}
            </button>
          )}
          {isUserExt && isStopped && (
            <button
              disabled={actionDisabled}
              title={disabledTitle}
              onClick={() => onAction(ext, 'enable')}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-green-500/20 text-green-300 hover:bg-green-500/30 transition-colors disabled:opacity-50"
            >
              {isMutating ? <Loader2 size={12} className="animate-spin" /> : 'Start'}
            </button>
          )}
          {showRemove && (
            <button
              disabled={actionDisabled}
              title={disabledTitle}
              onClick={() => onAction(ext, 'uninstall')}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-theme-card text-red-400 hover:bg-red-500/20 hover:text-red-300 transition-colors disabled:opacity-50"
            >
              {isMutating ? <Loader2 size={12} className="animate-spin" /> : <><Trash2 size={12} /> Remove</>}
            </button>
          )}
          {showRemove && (
            <button
              disabled={actionDisabled}
              title={disabledTitle || 'Permanently delete service data'}
              onClick={() => onAction(ext, 'purge')}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-theme-card text-amber-400 hover:bg-amber-500/20 hover:text-amber-300 transition-colors disabled:opacity-50"
            >
              {isMutating ? <Loader2 size={12} className="animate-spin" /> : <><Database size={12} /> Purge Data</>}
            </button>
          )}
          {isUserExt && status === 'enabled' && (
            <span className="text-[10px] text-theme-text-muted">Disable to remove</span>
          )}
          {!showInstall && !showRemove && !isToggleable && (
            <div className="flex items-center gap-1" title={status === 'incompatible' && gpuBackend ? `Your system: ${gpuBackend}` : undefined}>
              {status === 'incompatible' && <span className="text-[10px] text-theme-text-muted mr-0.5">Requires:</span>}
              {ext.gpu_backends?.slice(0, 3).map(gpu => (
                <span key={gpu} className="text-[10px] px-1.5 py-0.5 rounded bg-theme-card/80 text-theme-text-muted">{gpu}</span>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1">
          {status === 'enabled' && (ext.external_port_default || ext.port) && (ext.external_port_default || ext.port) !== 0 ? (
            <a
              href={`http://${window.location.hostname}:${ext.external_port_default || ext.port}`}
              target="_blank"
              rel="noopener noreferrer"
              onClick={e => e.stopPropagation()}
              className="flex items-center gap-1 px-2 py-1.5 text-xs text-theme-accent-light hover:text-theme-accent hover:bg-theme-accent/10 rounded-lg transition-colors"
              title={`Open on port ${ext.external_port_default || ext.port}`}
            >
              <ExternalLink size={11} />
              :{ext.external_port_default || ext.port}
            </a>
          ) : null}
          {(isUserExt || isCore) && status !== 'not_installed' && (
            <button
              onClick={onConsole}
              disabled={agentOffline}
              className={`flex items-center gap-1 px-2 py-1.5 text-xs rounded-lg transition-colors ${
                agentOffline ? 'text-theme-text-muted cursor-not-allowed' : 'text-theme-text-muted hover:text-green-400 hover:bg-green-500/10'
              }`}
              title={agentOffline ? 'Agent offline' : 'View logs'}
            >
              <Terminal size={11} />
            </button>
          )}
          <button
            onClick={onDetails}
            className="flex items-center gap-1 px-2 py-1.5 text-xs text-theme-text-muted hover:text-theme-text hover:bg-theme-surface-hover rounded-lg transition-colors"
          >
            <Info size={11} />
          </button>
        </div>
      </div>
    </div>
  )
}

function DetailModal({ ext, gpuBackend, onClose }) {
  useEffect(() => {
    if (!ext) return
    const handler = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [ext, onClose])

  if (!ext) return null

  const iconName = ext.features?.[0]?.icon
  const Icon = (iconName && ICON_MAP[iconName]) || Package
  const envVars = ext.env_vars || []
  const deps = ext.depends_on || []
  const features = ext.features || []
  const statusStyle = STATUS_STYLES[ext.status] || STATUS_STYLES.not_installed
  const isIncompatible = ext.status === 'incompatible'

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-theme-card border border-theme-border rounded-xl w-full max-w-lg max-h-[80vh] overflow-y-auto mx-4"
        onClick={e => e.stopPropagation()}
        role="dialog" aria-modal="true" aria-label={ext.name}
      >
        {/* Header */}
        <div className="sticky top-0 bg-theme-card border-b border-theme-border p-4 flex items-center justify-between rounded-t-xl">
          <div className="flex items-center gap-3">
            <Icon size={22} className="text-theme-text-muted" />
            <div>
              <h3 className="text-lg font-semibold text-theme-text">{ext.name}</h3>
              <span
                className={`text-xs px-2 py-0.5 rounded-full ${statusStyle}`}
                title={isIncompatible ? `Requires ${ext.gpu_backends?.join(' or ') || 'specific GPU'} — your system: ${gpuBackend || 'unknown'}` : ext.source === 'core' ? 'Built-in service — managed by DreamServer' : undefined}
              >
                {(ext.status || 'not_installed').replace('_', ' ')}
              </span>
            </div>
          </div>
          <button onClick={onClose} autoFocus className="text-theme-text-muted hover:text-theme-text-secondary transition-colors p-1">
            <X size={18} />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {/* Description */}
          <p className="text-sm text-theme-text-muted">{ext.description || 'No description available.'}</p>

          {/* Info grid */}
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="bg-theme-card/50 rounded-lg p-3">
              <span className="text-theme-text-muted text-xs block mb-1">Port</span>
              <span className="text-theme-text font-mono">{ext.external_port_default || ext.port || '—'}</span>
            </div>
            <div className="bg-theme-card/50 rounded-lg p-3">
              <span className="text-theme-text-muted text-xs block mb-1">GPU</span>
              <span className="text-theme-text">{ext.gpu_backends?.join(', ') || 'none'}</span>
              {isIncompatible && gpuBackend && (
                <span className="text-orange-400 text-[10px] block mt-1">Your system: {gpuBackend}</span>
              )}
            </div>
            <div className="bg-theme-card/50 rounded-lg p-3">
              <span className="text-theme-text-muted text-xs block mb-1">Category</span>
              <span className="text-theme-text">{ext.category || '—'}</span>
            </div>
            <div className="bg-theme-card/50 rounded-lg p-3">
              <span className="text-theme-text-muted text-xs block mb-1">Health</span>
              <span className="text-theme-text font-mono text-xs">{ext.health_endpoint || '—'}</span>
            </div>
          </div>

          {/* Dependencies */}
          {deps.length > 0 && (
            <div>
              <h4 className="text-xs font-medium text-theme-text-muted uppercase tracking-wider mb-2">Dependencies</h4>
              <div className="flex flex-wrap gap-2">
                {deps.map(dep => (
                  <span key={dep} className="bg-theme-card text-theme-text-muted rounded px-2 py-1 text-xs">{dep}</span>
                ))}
              </div>
            </div>
          )}

          {/* Environment variables */}
          {envVars.length > 0 && (
            <div>
              <h4 className="text-xs font-medium text-theme-text-muted uppercase tracking-wider mb-2">Environment Variables</h4>
              <div className="bg-theme-card/50 rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-theme-border">
                      <th className="text-left px-3 py-2 text-theme-text-muted font-medium text-xs">Key</th>
                      <th className="text-left px-3 py-2 text-theme-text-muted font-medium text-xs">Description</th>
                    </tr>
                  </thead>
                  <tbody>
                    {envVars.map(v => (
                      <tr key={v.key || v.name} className="border-b border-theme-border/50 last:border-0">
                        <td className="px-3 py-2 text-theme-accent-light font-mono text-xs">{v.key || v.name}</td>
                        <td className="px-3 py-2 text-theme-text-muted text-xs">{v.description || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Features */}
          {features.length > 0 && (
            <div>
              <h4 className="text-xs font-medium text-theme-text-muted uppercase tracking-wider mb-2">Features</h4>
              <div className="space-y-1">
                {features.map(feat => (
                  <div key={feat.name} className="flex items-center gap-2 text-sm">
                    <span className="w-1.5 h-1.5 rounded-full bg-theme-accent" />
                    <span className="text-theme-text-secondary">{feat.name}</span>
                    {feat.category && <span className="text-xs text-theme-text-muted">({feat.category})</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Login / Credentials */}
          {envVars.some(v => /password|secret|token|key/i.test(v.key || '')) && (
            <div>
              <h4 className="text-xs font-medium text-theme-text-muted uppercase tracking-wider mb-2">Login Credentials</h4>
              <p className="text-xs text-theme-text-muted mb-2">Run this in your terminal to see login info:</p>
              <CopyableCommand command={
                `docker exec dream-${ext.id} env | grep -iE "${envVars.filter(v => /username|password|secret|token|key|user|email/i.test(v.key || '')).map(v => v.key).join('|')}"`
              } />
              <p className="text-xs text-theme-text-muted mt-1.5">Or check your .env file directly:</p>
              <CopyableCommand command={
                `grep -E "${envVars.filter(v => /username|password|secret|token|key|user|email/i.test(v.key || '')).map(v => v.key).join('|')}" .env`
              } />
            </div>
          )}

          {/* CLI Commands */}
          <div>
            <h4 className="text-xs font-medium text-theme-text-muted uppercase tracking-wider mb-2">CLI Commands</h4>
            <div className="space-y-1">
              <CopyableCommand command={`dream enable ${ext.id}`} />
              <CopyableCommand command={`dream disable ${ext.id}`} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function ConsoleModal({ ext, onClose }) {
  const [logs, setLogs] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [disconnected, setDisconnected] = useState(false)
  const [atBottom, setAtBottom] = useState(true)
  const logRef = useRef(null)
  const isNearBottom = useRef(true)

  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  useEffect(() => {
    let active = true
    let fails = 0

    const poll = async () => {
      if (!active) return
      try {
        const res = await fetch(`/api/extensions/${ext.id}/logs`, {
          method: 'POST',
          signal: AbortSignal.timeout(8000),
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          throw new Error(err.detail || 'Failed to fetch logs')
        }
        const data = await res.json()
        setLogs(data.logs || 'No logs available.')
        setError(null)
        setDisconnected(false)
        fails = 0
      } catch (err) {
        fails++
        setError(err.message)
        if (fails >= 3) setDisconnected(true)
      } finally {
        setLoading(false)
      }
      if (active) {
        const delay = fails > 0 ? Math.min(2000 * Math.pow(2, fails - 1), 30000) : 2000
        setTimeout(poll, delay)
      }
    }
    poll()
    return () => { active = false }
  }, [ext.id])

  useEffect(() => {
    if (logRef.current && isNearBottom.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [logs])

  const handleScroll = () => {
    if (logRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = logRef.current
      const near = scrollHeight - scrollTop - clientHeight < 50
      isNearBottom.current = near
      setAtBottom(near)
    }
  }

  const scrollToBottom = () => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
      isNearBottom.current = true
      setAtBottom(true)
    }
  }

  const fetchLogsOnce = async () => {
    try {
      const res = await fetch(`/api/extensions/${ext.id}/logs`, {
        method: 'POST',
        signal: AbortSignal.timeout(8000),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.detail || 'Failed to fetch logs')
      }
      const data = await res.json()
      setLogs(data.logs || 'No logs available.')
      setError(null)
      setDisconnected(false)
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-theme-bg border border-theme-border rounded-xl w-full max-w-3xl h-[70vh] flex flex-col mx-4"
        onClick={e => e.stopPropagation()}
        role="dialog" aria-modal="true" aria-label={`${ext.name} logs`}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-theme-border">
          <div className="flex items-center gap-2">
            <Terminal size={16} className={disconnected ? 'text-red-400' : 'text-green-400'} />
            <span className="text-sm font-medium text-theme-text">{ext.name}</span>
            <span className="text-xs text-theme-text-muted">logs</span>
            {disconnected ? (
              <span className="w-1.5 h-1.5 rounded-full bg-red-500" title="Disconnected" />
            ) : (
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" title="Live" />
            )}
          </div>
          <button onClick={onClose} autoFocus className="text-theme-text-muted hover:text-theme-text-secondary transition-colors p-1">
            <X size={16} />
          </button>
        </div>
        <div className="relative flex-1">
          <div
            ref={el => { logRef.current = el }}
            onScroll={handleScroll}
            className="absolute inset-0 overflow-y-auto p-4 font-mono text-xs leading-relaxed text-theme-text-secondary whitespace-pre-wrap break-all"
          >
            {loading && !logs ? (
              <div className="flex items-center gap-2 text-theme-text-muted">
                <Loader2 size={14} className="animate-spin" /> Loading logs...
              </div>
            ) : (
              <>
                {logs}
                {error && logs && (
                  <div className="mt-2 text-red-400 border-t border-red-500/20 pt-2">
                    {disconnected ? 'Connection lost' : 'Fetch error'}: {error}
                  </div>
                )}
              </>
            )}
            {error && !logs && (
              <div className="text-red-400">{error}</div>
            )}
          </div>
          {!atBottom && (
            <button
              onClick={scrollToBottom}
              className="absolute bottom-2 right-4 bg-theme-card border border-theme-border text-theme-text-muted hover:text-theme-text rounded-full px-3 py-1 text-xs shadow-lg transition-colors"
            >
              ↓ Jump to bottom
            </button>
          )}
        </div>
        <div className="border-t border-theme-border px-4 py-2 flex items-center justify-between">
          <span className={`text-[10px] ${disconnected ? 'text-red-400' : 'text-theme-text-muted'}`}>
            {disconnected ? 'Reconnecting...' : 'Auto-refreshing every 2s'}
          </span>
          <button onClick={fetchLogsOnce} className="text-xs text-theme-text-muted hover:text-theme-text-secondary transition-colors" title="Refresh now">
            <RefreshCw size={12} />
          </button>
        </div>
      </div>
    </div>
  )
}

function CopyableCommand({ command }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    navigator.clipboard?.writeText(command)
      .then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000) })
      .catch(() => {})
  }

  return (
    <div className="group flex items-center justify-between bg-theme-card rounded px-3 py-1.5 font-mono text-sm text-theme-text-secondary">
      <span className="truncate mr-2">{command}</span>
      <button
        onClick={handleCopy}
        className="shrink-0 text-theme-text-muted hover:text-theme-text-secondary transition-colors"
        title="Copy to clipboard"
      >
        {copied ? <Check size={13} className="text-green-400" /> : <Copy size={13} />}
      </button>
    </div>
  )
}
