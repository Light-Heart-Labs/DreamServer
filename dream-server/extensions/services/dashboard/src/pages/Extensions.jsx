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
  if (detail.includes('Missing dependencies'))
    return detail
  return detail
}

const STATUS_STYLES = {
  enabled:       'bg-green-500/20 text-green-400',
  disabled:      'bg-zinc-700 text-zinc-400',
  not_installed: 'border border-zinc-700 text-zinc-500',
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

  useEffect(() => {
    fetchCatalog()
  }, [])

  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(null), 5000)
      return () => clearTimeout(t)
    }
  }, [toast])

  const fetchCatalog = async () => {
    try {
      setLoading(true)
      setError(null)
      const res = await fetchJson(`/api/extensions/catalog`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setCatalog(await res.json())
    } catch (err) {
      setError(err.name === 'AbortError' ? 'Request timed out' : 'Failed to load extensions catalog')
      console.error('Extensions fetch error:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleMutation = async (serviceId, action) => {
    setMutating(serviceId)
    setConfirm(null)
    try {
      const url = action === 'uninstall'
        ? `/api/extensions/${serviceId}`
        : `/api/extensions/${serviceId}/${action}`
      const res = await fetch(url, {
        method: action === 'uninstall' ? 'DELETE' : 'POST',
        signal: AbortSignal.timeout(15000),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.detail || `Failed to ${action}`)
      }
      const data = await res.json()
      const successText = data.message || (action === 'uninstall' ? 'Extension removed' : `Extension ${action}d`)
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
      install: `Install ${ext.name}? This copies extension files to your server.`,
      enable: `Enable ${ext.name}?`,
      disable: `Disable ${ext.name}?`,
      uninstall: `Remove ${ext.name}? You can reinstall it from the library.`,
    }
    setConfirm({ action, ext, message: messages[action] })
  }

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center h-64">
        <Loader2 className="animate-spin text-indigo-500" size={32} />
      </div>
    )
  }

  const extensions = catalog?.extensions || []
  const summary = catalog?.summary || {}

  // Derive unique categories from features
  const categories = ['all', ...new Set(
    extensions
      .map(ext => ext.features?.[0]?.category)
      .filter(Boolean)
  )]

  const STATUS_FILTERS = ['all', 'enabled', 'disabled', 'not_installed', 'incompatible']
  const STATUS_LABELS = { all: 'All', enabled: 'Enabled', disabled: 'Disabled', not_installed: 'Not Installed', incompatible: 'Incompatible' }

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
          <h1 className="text-2xl font-bold text-white">Extensions</h1>
          <p className="text-zinc-400 mt-1">
            Browse and discover add-on services.
          </p>
        </div>
        <div className="flex items-center gap-4">
          {catalog?.agent_available !== undefined && (
            <div className="flex items-center gap-1.5 text-xs">
              <span className={`w-1.5 h-1.5 rounded-full ${catalog.agent_available ? 'bg-green-500' : 'bg-zinc-600'}`} />
              <span className={catalog.agent_available ? 'text-green-400' : 'text-zinc-500'}>
                {catalog.agent_available ? 'Agent' : 'Agent offline'}
              </span>
            </div>
          )}
          <button
            onClick={fetchCatalog}
            className="text-sm text-indigo-300 hover:text-indigo-200 flex items-center gap-1.5 transition-colors"
          >
            <RefreshCw size={14} />
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
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-4 mb-6">
        <div className="flex items-center gap-6 text-sm">
          <SummaryItem label="Total" value={summary.total || extensions.length} color="bg-zinc-400" />
          <SummaryItem label="Installed" value={summary.installed ?? 0} color="bg-green-500" />
          <SummaryItem label="Available" value={summary.not_installed ?? 0} color="bg-indigo-500" />
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
                ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30'
                : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700 border-transparent'
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
                  ? 'bg-zinc-700 text-zinc-200 border-zinc-600'
                  : 'bg-zinc-800/50 text-zinc-500 hover:bg-zinc-800 border-transparent'
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
          className="bg-zinc-800 border border-zinc-700 text-white placeholder-zinc-500 rounded-lg px-3 py-1.5 text-sm w-full sm:w-64 outline-none focus:border-zinc-600"
        />
      </div>

      {/* Card grid */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-zinc-500">
          <Package size={48} className="mb-4 opacity-40" />
          <p className="text-lg">No extensions available</p>
          <p className="text-sm mt-1">Try adjusting your search or filters.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(ext => (
            <ExtensionCard
              key={ext.id}
              ext={ext}
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
        <DetailModal ext={extensions.find(e => e.id === expanded)} onClose={() => setExpanded(null)} />
      )}

      {/* Console modal */}
      {consoleExt && (
        <ConsoleModal ext={consoleExt} onClose={() => setConsoleExt(null)} />
      )}

      {/* Confirmation dialog */}
      {confirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-6 max-w-md mx-4">
            <h3 className="text-lg font-semibold text-white mb-2">
              {confirm.action === 'uninstall' ? 'Remove' : confirm.action.charAt(0).toUpperCase() + confirm.action.slice(1)} Extension
            </h3>
            <p className="text-sm text-zinc-400 mb-4">{confirm.message}</p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setConfirm(null)} className="px-4 py-2 text-sm text-zinc-400 hover:text-white transition-colors">Cancel</button>
              <button
                onClick={() => handleMutation(confirm.ext.id, confirm.action)}
                className={`px-4 py-2 text-sm rounded-lg transition-colors ${
                  confirm.action === 'uninstall' ? 'bg-red-500/20 text-red-300 hover:bg-red-500/30' :
                  'bg-indigo-500/20 text-indigo-300 hover:bg-indigo-500/30'
                }`}
              >
                {confirm.action === 'uninstall' ? 'Remove' : confirm.action.charAt(0).toUpperCase() + confirm.action.slice(1)}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast notification */}
      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 rounded-xl border p-4 text-sm max-w-sm shadow-lg ${
          toast.type === 'error' ? 'border-red-500/20 bg-red-500/10 text-red-200' :
          toast.type === 'info' ? 'border-indigo-500/20 bg-indigo-500/10 text-indigo-200' :
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
      <span className="text-zinc-400">{label}</span>
      <span className="text-white font-medium">{value}</span>
    </div>
  )
}

function ExtensionCard({ ext, onDetails, onConsole, onAction, mutating }) {
  const iconName = ext.features?.[0]?.icon
  const Icon = (iconName && ICON_MAP[iconName]) || Package
  const status = ext.status || 'not_installed'
  const statusStyle = STATUS_STYLES[status] || STATUS_STYLES.not_installed
  const isMutating = mutating === ext.id
  const anyMutating = !!mutating

  const isCore = ext.source === 'core'
  const isUserExt = ext.source === 'user'
  const isToggleable = isUserExt && (status === 'enabled' || status === 'disabled')
  const showRemove = isUserExt && status === 'disabled'
  const showInstall = status === 'not_installed' && ext.installable

  return (
    <div className={`bg-zinc-900/50 border rounded-xl overflow-hidden transition-all ${
      isCore ? 'border-zinc-800/60 opacity-70' : 'border-zinc-800 hover:border-zinc-600'
    }`}>
      {/* Card body */}
      <div className="p-4 pb-3">
        <div className="flex items-start justify-between mb-2">
          <div className="flex items-center gap-2.5">
            <div className={`p-1.5 rounded-lg ${
              status === 'enabled' ? 'bg-green-500/10' :
              status === 'incompatible' ? 'bg-orange-500/10' :
              'bg-zinc-800'
            }`}>
              <Icon size={16} className={
                status === 'enabled' ? 'text-green-400' :
                status === 'incompatible' ? 'text-orange-400' :
                'text-zinc-400'
              } />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-white leading-tight">{ext.name}</h3>
              {ext.features?.[0]?.category && (
                <span className="text-[10px] text-zinc-600 uppercase tracking-wider">{ext.features[0].category}</span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isCore ? (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/15 uppercase tracking-wider">
                core
              </span>
            ) : (
              <span className={`text-[10px] px-2 py-0.5 rounded-full uppercase tracking-wider ${statusStyle}`}>
                {status.replace('_', ' ')}
              </span>
            )}
            {isToggleable && (
              <button
                disabled={anyMutating}
                onClick={() => onAction(ext, status === 'enabled' ? 'disable' : 'enable')}
                className={`relative inline-flex h-[18px] w-[32px] shrink-0 rounded-full transition-colors disabled:opacity-50 ${
                  status === 'enabled' ? 'bg-green-500' : 'bg-zinc-600'
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
        <p className="text-xs text-zinc-500 line-clamp-2 leading-relaxed">{ext.description || 'No description available.'}</p>
      </div>

      {/* Card footer */}
      <div className="border-t border-zinc-800/60 px-4 py-2.5 flex items-center justify-between bg-zinc-900/30">
        <div className="flex gap-1.5">
          {showInstall && (
            <button
              disabled={anyMutating}
              onClick={() => onAction(ext, 'install')}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-indigo-500 text-white hover:bg-indigo-400 transition-colors disabled:opacity-50 shadow-sm shadow-indigo-500/20"
            >
              {isMutating ? <Loader2 size={12} className="animate-spin" /> : <><Download size={12} /> Install</>}
            </button>
          )}
          {showRemove && (
            <button
              disabled={anyMutating}
              onClick={() => onAction(ext, 'uninstall')}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-zinc-800 text-red-400 hover:bg-red-500/20 hover:text-red-300 transition-colors disabled:opacity-50"
            >
              {isMutating ? <Loader2 size={12} className="animate-spin" /> : <><Trash2 size={12} /> Remove</>}
            </button>
          )}
          {!showInstall && !showRemove && !isToggleable && (
            <div className="flex gap-1">
              {ext.gpu_backends?.slice(0, 3).map(gpu => (
                <span key={gpu} className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800/80 text-zinc-600">{gpu}</span>
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
              className="flex items-center gap-1 px-2 py-1.5 text-xs text-indigo-400 hover:text-indigo-300 hover:bg-indigo-500/10 rounded-lg transition-colors"
              title={`Open on port ${ext.external_port_default || ext.port}`}
            >
              <ExternalLink size={11} />
              :{ext.external_port_default || ext.port}
            </a>
          ) : null}
          {(isUserExt || isCore) && status !== 'not_installed' && (
            <button
              onClick={onConsole}
              className="flex items-center gap-1 px-2 py-1.5 text-xs text-zinc-500 hover:text-green-400 hover:bg-green-500/10 rounded-lg transition-colors"
              title="View logs"
            >
              <Terminal size={11} />
            </button>
          )}
          <button
            onClick={onDetails}
            className="flex items-center gap-1 px-2 py-1.5 text-xs text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 rounded-lg transition-colors"
          >
            <Info size={11} />
          </button>
        </div>
      </div>
    </div>
  )
}

function DetailModal({ ext, onClose }) {
  if (!ext) return null

  const iconName = ext.features?.[0]?.icon
  const Icon = (iconName && ICON_MAP[iconName]) || Package
  const envVars = ext.env_vars || []
  const deps = ext.depends_on || []
  const features = ext.features || []
  const statusStyle = STATUS_STYLES[ext.status] || STATUS_STYLES.not_installed

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-zinc-900 border border-zinc-700 rounded-xl w-full max-w-lg max-h-[80vh] overflow-y-auto mx-4"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 bg-zinc-900 border-b border-zinc-800 p-4 flex items-center justify-between rounded-t-xl">
          <div className="flex items-center gap-3">
            <Icon size={22} className="text-zinc-400" />
            <div>
              <h3 className="text-lg font-semibold text-white">{ext.name}</h3>
              <span className={`text-xs px-2 py-0.5 rounded-full ${statusStyle}`}>
                {(ext.status || 'not_installed').replace('_', ' ')}
              </span>
            </div>
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 transition-colors p-1">
            <X size={18} />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {/* Description */}
          <p className="text-sm text-zinc-400">{ext.description || 'No description available.'}</p>

          {/* Info grid */}
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="bg-zinc-800/50 rounded-lg p-3">
              <span className="text-zinc-500 text-xs block mb-1">Port</span>
              <span className="text-white font-mono">{ext.external_port_default || ext.port || '—'}</span>
            </div>
            <div className="bg-zinc-800/50 rounded-lg p-3">
              <span className="text-zinc-500 text-xs block mb-1">GPU</span>
              <span className="text-white">{ext.gpu_backends?.join(', ') || 'none'}</span>
            </div>
            <div className="bg-zinc-800/50 rounded-lg p-3">
              <span className="text-zinc-500 text-xs block mb-1">Category</span>
              <span className="text-white">{ext.category || '—'}</span>
            </div>
            <div className="bg-zinc-800/50 rounded-lg p-3">
              <span className="text-zinc-500 text-xs block mb-1">Health</span>
              <span className="text-white font-mono text-xs">{ext.health_endpoint || '—'}</span>
            </div>
          </div>

          {/* Dependencies */}
          {deps.length > 0 && (
            <div>
              <h4 className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2">Dependencies</h4>
              <div className="flex flex-wrap gap-2">
                {deps.map(dep => (
                  <span key={dep} className="bg-zinc-800 text-zinc-400 rounded px-2 py-1 text-xs">{dep}</span>
                ))}
              </div>
            </div>
          )}

          {/* Environment variables */}
          {envVars.length > 0 && (
            <div>
              <h4 className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2">Environment Variables</h4>
              <div className="bg-zinc-800/50 rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-zinc-700">
                      <th className="text-left px-3 py-2 text-zinc-500 font-medium text-xs">Key</th>
                      <th className="text-left px-3 py-2 text-zinc-500 font-medium text-xs">Description</th>
                    </tr>
                  </thead>
                  <tbody>
                    {envVars.map(v => (
                      <tr key={v.key || v.name} className="border-b border-zinc-700/50 last:border-0">
                        <td className="px-3 py-2 text-indigo-300 font-mono text-xs">{v.key || v.name}</td>
                        <td className="px-3 py-2 text-zinc-400 text-xs">{v.description || '-'}</td>
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
              <h4 className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2">Features</h4>
              <div className="space-y-1">
                {features.map(feat => (
                  <div key={feat.name} className="flex items-center gap-2 text-sm">
                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
                    <span className="text-zinc-300">{feat.name}</span>
                    {feat.category && <span className="text-xs text-zinc-600">({feat.category})</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Login / Credentials */}
          {envVars.some(v => /password|secret|token|key/i.test(v.key || '')) && (
            <div>
              <h4 className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2">Login Credentials</h4>
              <p className="text-xs text-zinc-500 mb-2">Run this in your terminal to see login info:</p>
              <CopyableCommand command={
                `docker exec dream-${ext.id} env | grep -iE "${envVars.filter(v => /username|password|secret|token|key|user|email/i.test(v.key || '')).map(v => v.key).join('|')}"`
              } />
              <p className="text-xs text-zinc-600 mt-1.5">Or check your .env file directly:</p>
              <CopyableCommand command={
                `grep -E "${envVars.filter(v => /username|password|secret|token|key|user|email/i.test(v.key || '')).map(v => v.key).join('|')}" .env`
              } />
            </div>
          )}

          {/* CLI Commands */}
          <div>
            <h4 className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2">CLI Commands</h4>
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
  const logRef = useRef(null)

  const fetchLogs = async () => {
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
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchLogs()
    const interval = setInterval(fetchLogs, 2000)
    return () => clearInterval(interval)
  }, [ext.id])

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [logs])

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-[#0d0d11] border border-zinc-700 rounded-xl w-full max-w-3xl h-[70vh] flex flex-col mx-4"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
          <div className="flex items-center gap-2">
            <Terminal size={16} className="text-green-400" />
            <span className="text-sm font-medium text-white">{ext.name}</span>
            <span className="text-xs text-zinc-600">logs</span>
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" title="Live" />
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 transition-colors p-1">
            <X size={16} />
          </button>
        </div>
        <div
          ref={el => { logRef.current = el }}
          className="flex-1 overflow-y-auto p-4 font-mono text-xs leading-relaxed text-zinc-300 whitespace-pre-wrap break-all"
        >
          {loading && !logs ? (
            <div className="flex items-center gap-2 text-zinc-500">
              <Loader2 size={14} className="animate-spin" /> Loading logs...
            </div>
          ) : error && !logs ? (
            <div className="text-red-400">{error}</div>
          ) : (
            logs
          )}
        </div>
        <div className="border-t border-zinc-800 px-4 py-2 flex items-center justify-between">
          <span className="text-[10px] text-zinc-600">Auto-refreshing every 2s</span>
          <button onClick={fetchLogs} className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors">
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
    <div className="group flex items-center justify-between bg-zinc-800 rounded px-3 py-1.5 font-mono text-sm text-zinc-300">
      <span className="truncate mr-2">{command}</span>
      <button
        onClick={handleCopy}
        className="shrink-0 text-zinc-600 hover:text-zinc-300 transition-colors"
        title="Copy to clipboard"
      >
        {copied ? <Check size={13} className="text-green-400" /> : <Copy size={13} />}
      </button>
    </div>
  )
}
