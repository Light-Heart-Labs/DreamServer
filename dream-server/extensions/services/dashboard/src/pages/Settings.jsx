import { Settings as SettingsIcon, Server, HardDrive, RefreshCw, Download, Loader2, Network } from 'lucide-react'
import { useState, useEffect } from 'react'

const API_BASE = import.meta.env.VITE_API_URL || ''

// Fetch with timeout to avoid hanging requests
const fetchJson = async (url, ms = 8000) => {
  const c = new AbortController()
  const t = setTimeout(() => c.abort(), ms)
  try {
    return await fetch(url, { signal: c.signal })
  } finally {
    clearTimeout(t)
  }
}

export default function Settings() {
  const [version, setVersion] = useState(null)
  const [storage, setStorage] = useState(null)
  const [services, setServices] = useState([])
  const [statusCache, setStatusCache] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)

  useEffect(() => {
    fetchSettings()
  }, [])

  const fetchSettings = async () => {
    try {
      setLoading(true)
      setError(null)
      const [versionRes, storageRes, statusRes] = await Promise.all([
        fetchJson(`${API_BASE}/api/version`),
        fetchJson(`${API_BASE}/api/storage`),
        fetchJson(`${API_BASE}/api/status`)
      ])

      const versionData = versionRes.ok ? await versionRes.json() : {}
      if (statusRes.ok) {
        const statusData = await statusRes.json()
        setStatusCache(statusData)
        const secs = statusData.uptime || 0
        const hours = Math.floor(secs / 3600)
        const mins = Math.floor((secs % 3600) / 60)
        setVersion({
          ...versionData,
          version: versionData.current || statusData.version,
          tier: statusData.tier,
          uptime: hours > 0 ? `${hours}h ${mins}m` : `${mins}m`,
        })
        if (statusData.services) {
          setServices(statusData.services)
        }
      } else {
        setVersion(versionData)
      }
      if (storageRes.ok) {
        setStorage(await storageRes.json())
      }
    } catch (err) {
      setError(err.name === 'AbortError' ? 'Request timed out' : 'Failed to load settings')
      console.error('Settings fetch error:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleCheckUpdates = () => {
    setNotice({ type: 'info', text: 'Update channel not wired yet (v2.0).' })
  }

  const handleExportConfig = async () => {
    try {
      const data = statusCache || (await (await fetchJson(`${API_BASE}/api/status`)).json())
      const config = {
        exported_at: new Date().toISOString(),
        version: data.version,
        tier: data.tier,
        gpu: data.gpu,
        services: data.services?.map(s => ({ name: s.name, port: s.port, status: s.status })),
        model: data.model
      }
      const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `dream-server-config-${new Date().toISOString().slice(0,10)}.json`
      a.click()
      URL.revokeObjectURL(url)
      setNotice({ type: 'info', text: 'Configuration exported.' })
    } catch (err) {
      setNotice({ type: 'danger', text: 'Export failed: ' + err.message })
    }
  }

  // Status dot colors
  const dotColor = (status) => ({
    healthy: 'bg-green-500',
    degraded: 'bg-yellow-500',
    unhealthy: 'bg-red-500',
    down: 'bg-red-500',
    unknown: 'bg-zinc-600'
  }[status] || 'bg-zinc-600')

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center h-64">
        <Loader2 className="animate-spin text-theme-accent" size={32} />
      </div>
    )
  }

  return (
    <div className="p-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-theme-text">Settings</h1>
          <p className="text-theme-text-muted mt-1">
            Configure your Dream Server installation.
          </p>
        </div>
        <button
          onClick={fetchSettings}
          className="text-sm text-theme-accent-light hover:text-theme-accent-light flex items-center gap-1.5 transition-colors"
        >
          <RefreshCw size={14} />
          Refresh
        </button>
      </div>

      {/* Error state */}
      {error && (
        <div className="mb-6 rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-200">
          {error} — <button className="underline" onClick={fetchSettings}>Retry</button>
        </div>
      )}

      {/* In-page notice */}
      {notice && (
        <div className={`mb-6 rounded-xl border p-4 text-sm flex items-center justify-between ${
          notice.type === 'danger' ? 'border-red-500/20 bg-red-500/10 text-red-200' :
          notice.type === 'warn' ? 'border-yellow-500/20 bg-yellow-500/10 text-yellow-100' :
          'border-theme-accent/20 bg-theme-accent/10 text-theme-text'
        }`}>
          <span>{notice.text}</span>
          <button onClick={() => setNotice(null)} className="ml-4 opacity-60 hover:opacity-100">×</button>
        </div>
      )}

      <div className="max-w-2xl space-y-6">
        {/* System Identity */}
        <SettingsSection title="System Identity" icon={Server}>
          <div className="grid grid-cols-2 gap-4">
            <InfoRow label="Version" value={version?.version || 'Unknown'} />
            <InfoRow label="Install Date" value={version?.install_date || 'Unknown'} />
            <InfoRow label="Tier" value={version?.tier || 'Community'} />
            <InfoRow label="Uptime" value={version?.uptime || 'Unknown'} />
          </div>
        </SettingsSection>

        {/* Routing Table */}
        {services.length > 0 && (
          <SettingsSection title="Routing Table" icon={Network}>
            <p className="text-xs text-theme-text-muted mb-3 font-mono">
              host: {typeof window !== 'undefined' ? window.location.hostname : 'localhost'}
            </p>
            <div className="space-y-1">
              {services.map((svc) => (
                <div key={svc.name} className="flex items-center justify-between py-1.5">
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${dotColor(svc.status)}`} />
                    <span className="text-sm text-theme-text-muted">{svc.name}</span>
                  </div>
                  {svc.port ? (
                    <a
                      className="text-sm text-theme-accent-light hover:text-theme-accent-light font-mono transition-colors"
                      href={`http://${typeof window !== 'undefined' ? window.location.hostname : 'localhost'}:${svc.port}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      :{svc.port}
                    </a>
                  ) : (
                    <span className="text-sm text-theme-text-muted font-mono">systemd</span>
                  )}
                </div>
              ))}
            </div>
          </SettingsSection>
        )}

        {/* Storage */}
        <SettingsSection title="Storage" icon={HardDrive}>
          <div className="space-y-4">
            <div>
              <div className="flex items-center justify-between text-sm mb-2">
                <span className="text-theme-text-muted">Models</span>
                <span className="text-theme-text">{storage?.models?.formatted || 'Unknown'}</span>
              </div>
              <div className="h-2 bg-theme-border rounded-full overflow-hidden">
                <div className="h-full bg-theme-accent rounded-full" style={{ width: `${storage?.models?.percent || 0}%` }} />
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between text-sm mb-2">
                <span className="text-theme-text-muted">Vector Database</span>
                <span className="text-theme-text">{storage?.vector_db?.formatted || 'Unknown'}</span>
              </div>
              <div className="h-2 bg-theme-border rounded-full overflow-hidden">
                <div className="h-full bg-purple-500 rounded-full" style={{ width: `${storage?.vector_db?.percent || 0}%` }} />
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between text-sm mb-2">
                <span className="text-theme-text-muted">Total Data</span>
                <span className="text-theme-text">{storage?.total_data?.formatted || 'Unknown'}</span>
              </div>
              <div className="h-2 bg-theme-border rounded-full overflow-hidden">
                <div className="h-full bg-green-500 rounded-full" style={{ width: `${storage?.total_data?.percent || 0}%` }} />
              </div>
            </div>
          </div>
        </SettingsSection>

        {/* Updates */}
        <SettingsSection title="Updates" icon={RefreshCw}>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-theme-text">You're up to date</p>
              <p className="text-sm text-theme-text-muted">Last checked: just now</p>
            </div>
            <button
              onClick={handleCheckUpdates}
              className="px-4 py-2 bg-theme-border hover:bg-theme-border text-theme-text rounded-lg text-sm flex items-center gap-2 transition-colors"
            >
              <RefreshCw size={16} />
              Check for Updates
            </button>
          </div>
        </SettingsSection>

        {/* Commands */}
        <SettingsSection title="Commands" icon={SettingsIcon}>
          <div className="space-y-3">
            <ActionButton
              icon={Download}
              label="Export Configuration"
              description="Download your settings as a JSON file"
              onClick={handleExportConfig}
            />
          </div>
        </SettingsSection>
      </div>
    </div>
  )
}

function SettingsSection({ title, icon: Icon, children }) {
  return (
    <div className="bg-theme-card border border-theme-border rounded-xl">
      <div className="flex items-center gap-3 p-4 border-b border-theme-border">
        <Icon size={20} className="text-theme-text-muted" />
        <h2 className="text-lg font-semibold text-theme-text">{title}</h2>
      </div>
      <div className="p-4">
        {children}
      </div>
    </div>
  )
}

function InfoRow({ label, value }) {
  return (
    <div className="flex items-center justify-between py-2">
      <span className="text-sm text-theme-text-muted">{label}</span>
      <span className="text-sm text-theme-text font-medium font-mono">{value}</span>
    </div>
  )
}

function ActionButton({ icon: Icon, label, description, variant = 'default', onClick }) {
  const variants = {
    default: 'hover:bg-theme-surface-hover',
    warning: 'hover:bg-yellow-500/10',
    danger: 'hover:bg-red-500/10'
  }

  const iconColors = {
    default: 'text-theme-text-muted',
    warning: 'text-yellow-500',
    danger: 'text-red-500'
  }

  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-4 p-3 rounded-lg transition-colors ${variants[variant]}`}
    >
      <Icon size={20} className={iconColors[variant]} />
      <div className="text-left">
        <p className="text-sm text-theme-text font-medium">{label}</p>
        <p className="text-xs text-theme-text-muted">{description}</p>
      </div>
    </button>
  )
}
