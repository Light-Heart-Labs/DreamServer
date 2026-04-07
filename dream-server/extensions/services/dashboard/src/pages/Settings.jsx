import {
  Settings as SettingsIcon,
  Server,
  HardDrive,
  RefreshCw,
  Download,
  Network,
} from 'lucide-react'
import { useEffect, useState } from 'react'

const fetchJson = async (url, ms = 8000, options = {}) => {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), ms)
  try {
    return await fetch(url, {
      ...options,
      headers: options.headers || undefined,
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timeout)
  }
}

const buildErrorFromResponse = async (response) => {
  let detail = null
  try {
    const payload = await response.json()
    detail = payload?.detail ?? payload
  } catch {}

  const error = new Error(
    typeof detail === 'string' ? detail : (detail?.message || `Request failed (${response.status})`)
  )
  error.details = typeof detail === 'object' && detail ? detail : null
  return error
}

const fetchPayload = async (url, ms = 8000, options = {}) => {
  const response = await fetchJson(url, ms, options)
  if (!response.ok) throw await buildErrorFromResponse(response)
  return response.json()
}

const formatUptime = (secs = 0) => {
  const hours = Math.floor(secs / 3600)
  const mins = Math.floor((secs % 3600) / 60)
  return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`
}

const formatDateTime = (value) => {
  if (!value) return 'Unknown'
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString()
}

const getErrorText = (err) => (
  err?.name === 'AbortError'
    ? 'Request timed out'
    : (err?.details?.message || err?.message || 'Failed to load settings')
)

const getDashboardHost = () => (
  typeof window !== 'undefined' ? window.location.hostname : 'localhost'
)

const getExternalUrl = (port) => (port ? `http://${getDashboardHost()}:${port}` : null)

const ROUTE_GROUP_STYLES = {
  inactive: {
    dot: 'bg-red-500',
    text: 'text-theme-text-secondary',
    line: 'rgba(239,68,68,0.26)',
  },
  degraded: {
    dot: 'bg-amber-400',
    text: 'text-theme-text-secondary',
    line: 'rgba(245,158,11,0.24)',
  },
  online: {
    dot: 'bg-emerald-400',
    text: 'text-theme-text-secondary',
    line: 'rgba(52,211,153,0.22)',
  },
}

const routeSeverityOrder = {
  down: 0,
  unhealthy: 1,
  degraded: 2,
  unknown: 3,
  healthy: 4,
}

const sortRoutesBySeverity = (items) => (
  [...(items || [])].sort((a, b) => (routeSeverityOrder[a.status] ?? 9) - (routeSeverityOrder[b.status] ?? 9))
)

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

  const fetchVersionInfo = async ({ announce = false } = {}) => {
    try {
      const versionData = await fetchPayload('/api/version', 4000)
      setVersion((prev) => ({
        ...(prev || {}),
        current: versionData.current,
        version: versionData.current && versionData.current !== '0.0.0'
          ? versionData.current
          : (prev?.version || 'Unknown'),
        latest: versionData.latest || null,
        update_available: Boolean(
          versionData.update_available &&
          versionData.latest &&
          versionData.current &&
          versionData.current !== '0.0.0' &&
          versionData.latest !== versionData.current
        ),
        changelog_url: versionData.changelog_url || null,
        checked_at: versionData.checked_at || null,
      }))

      if (announce) {
        setNotice({
          type: versionData.update_available ? 'warn' : 'info',
          text: versionData.update_available && versionData.latest
            ? `Update available: v${versionData.latest}`
            : 'You are already on the latest available release.',
        })
      }
    } catch (err) {
      if (announce) {
        setNotice({
          type: 'warn',
          text: `Could not check updates right now: ${getErrorText(err)}`,
        })
      }
    }
  }

  const fetchSettings = async () => {
    const failures = []

    try {
      setLoading(true)
      setError(null)
      setNotice(null)

      const [summaryResult, storageResult] = await Promise.allSettled([
        fetchPayload('/api/settings/summary', 10000),
        fetchPayload('/api/storage', 12000),
      ])

      if (summaryResult.status === 'fulfilled') {
        const statusData = summaryResult.value
        setStatusCache(statusData)
        setVersion({
          version: statusData.version || 'Unknown',
          install_date: formatDateTime(statusData.install_date),
          tier: statusData.tier,
          uptime: formatUptime(statusData.uptime || 0),
        })
        setServices(statusData.services || [])
      } else {
        failures.push(summaryResult.reason)
      }

      if (storageResult.status === 'fulfilled') {
        setStorage(storageResult.value)
      } else {
        failures.push(storageResult.reason)
      }

      if (failures.length === 2) {
        setError(getErrorText(failures[0]))
      } else if (failures.length > 0) {
        setNotice({
          type: 'warn',
          text: 'Some settings details are temporarily unavailable. Showing the data that loaded successfully.',
        })
      }
    } catch (err) {
      setError(getErrorText(err))
      console.error('Settings fetch error:', err)
    } finally {
      setLoading(false)
    }

    void fetchVersionInfo()
  }

  const handleExportConfig = async () => {
    try {
      const data = statusCache || (await (await fetchJson('/api/status')).json())
      const config = {
        exported_at: new Date().toISOString(),
        version: data.version,
        tier: data.tier,
        gpu: data.gpu,
        services: data.services?.map((service) => ({
          name: service.name,
          port: service.port,
          status: service.status,
        })),
        model: data.model,
      }

      const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `dream-server-config-${new Date().toISOString().slice(0, 10)}.json`
      anchor.click()
      URL.revokeObjectURL(url)
      setNotice({ type: 'info', text: 'Configuration exported.' })
    } catch (err) {
      setNotice({ type: 'danger', text: `Export failed: ${err.message}` })
    }
  }

  const routingGroups = [
    {
      key: 'online',
      label: 'Online',
      tone: 'online',
      services: sortRoutesBySeverity(services).filter((service) => service.status === 'healthy'),
    },
    {
      key: 'degraded',
      label: 'Degraded',
      tone: 'degraded',
      services: sortRoutesBySeverity(services).filter((service) => service.status === 'degraded'),
    },
    {
      key: 'inactive',
      label: 'Inactive',
      tone: 'inactive',
      services: sortRoutesBySeverity(services).filter((service) => ['down', 'unhealthy', 'unknown'].includes(service.status)),
    },
  ]

  if (loading) {
    return (
      <div className="p-8 animate-pulse">
        <div className="mb-8 flex items-start justify-between">
          <div>
            <div className="mb-3 h-8 w-1/3 rounded bg-theme-card" />
            <div className="h-4 w-80 rounded bg-theme-card" />
          </div>
          <div className="h-10 w-28 rounded-lg bg-theme-card" />
        </div>
        <div className="max-w-5xl space-y-6">
          {[...Array(5)].map((_, index) => (
            <div key={index} className="h-36 rounded-xl bg-theme-card" />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="p-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-theme-text">Settings</h1>
          <p className="mt-1 text-theme-text-muted">Configure your Dream Server installation.</p>
        </div>
        <button
          onClick={fetchSettings}
          className="flex items-center gap-1.5 text-sm text-theme-accent-light transition-colors hover:text-theme-accent-light"
        >
          <RefreshCw size={14} />
          Refresh
        </button>
      </div>

      {error ? (
        <Banner tone="danger">
          {error} — <button className="underline" onClick={fetchSettings}>Retry</button>
        </Banner>
      ) : null}

      {notice ? (
        <Banner tone={notice.type} onClose={() => setNotice(null)}>
          {notice.text}
        </Banner>
      ) : null}

      <div className="max-w-5xl space-y-6 liquid-metal-sequence-grid liquid-metal-sequence-grid--services">
        <SettingsSection title="System Identity" icon={Server}>
          <div className="grid gap-4 sm:grid-cols-2">
            <InfoRow label="Version" value={version?.version || 'Unknown'} />
            <InfoRow label="Install Date" value={version?.install_date || 'Unknown'} />
            <InfoRow label="Tier" value={version?.tier || 'Community'} />
            <InfoRow label="Uptime" value={version?.uptime || 'Unknown'} />
          </div>
        </SettingsSection>

        {services.length > 0 ? (
          <SettingsSection title="Routing Table" icon={Network}>
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-theme-text-muted/60">
                  route surfaces
                </p>
                <span className="rounded-full border border-white/10 bg-black/[0.12] px-2.5 py-1 text-[10px] font-mono uppercase tracking-[0.16em] text-theme-text">
                  {getDashboardHost()}
                </span>
              </div>
              <div className="grid gap-3 xl:grid-cols-3">
                {routingGroups.map((group) => (
                  <RoutingGroup key={group.key} {...group} />
                ))}
              </div>
            </div>
          </SettingsSection>
        ) : null}

        <SettingsSection title="Storage" icon={HardDrive}>
          <StorageBlock storage={storage} />
        </SettingsSection>

        <SettingsSection title="Updates" icon={RefreshCw}>
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-theme-text">
                {version?.update_available && version?.latest
                  ? `Update available: v${version.latest}`
                  : `Installed version: v${version?.version || 'Unknown'}`}
              </p>
              <p className="text-sm text-theme-text-muted">
                {version?.checked_at
                  ? `Last checked: ${new Date(version.checked_at).toLocaleString()}`
                  : 'Checks GitHub in the background to avoid blocking the page.'}
              </p>
            </div>
            <button
              onClick={() => {
                setNotice({ type: 'info', text: 'Checking for updates...' })
                void fetchVersionInfo({ announce: true })
              }}
              className="liquid-metal-button flex items-center gap-2 rounded-lg px-4 py-2 text-sm text-white"
            >
              <RefreshCw size={16} />
              Check for Updates
            </button>
          </div>
        </SettingsSection>

        <SettingsSection title="Commands" icon={SettingsIcon}>
          <ActionButton
            icon={Download}
            label="Export Configuration"
            description="Download your settings as a JSON file"
            onClick={handleExportConfig}
          />
        </SettingsSection>
      </div>
    </div>
  )
}

function SettingsSection({ title, icon: Icon, children }) {
  return (
    <div className="liquid-metal-frame liquid-metal-sequence-card rounded-xl border border-theme-border bg-theme-card">
      <div className="flex items-center gap-3 border-b border-theme-border p-4">
        <Icon size={20} className="text-theme-text-muted" />
        <h2 className="text-lg font-semibold text-theme-text">{title}</h2>
      </div>
      <div className="p-4">{children}</div>
    </div>
  )
}

function InfoRow({ label, value }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <span className="text-sm text-theme-text-muted">{label}</span>
      <span className="break-all text-right font-mono text-sm font-medium text-theme-text">{value}</span>
    </div>
  )
}

function Banner({ tone = 'info', children, onClose }) {
  const classes = tone === 'danger'
    ? 'border-red-500/20 bg-red-500/10 text-red-200'
    : tone === 'warn'
      ? 'border-yellow-500/20 bg-yellow-500/10 text-yellow-100'
      : 'border-theme-accent/20 bg-theme-accent/10 text-theme-text'

  return (
    <div className={`mb-6 flex items-center justify-between rounded-xl border p-4 text-sm ${classes}`}>
      <span>{children}</span>
      {onClose ? (
        <button onClick={onClose} className="ml-4 opacity-60 hover:opacity-100">×</button>
      ) : null}
    </div>
  )
}

function RoutingGroup({ label, tone, services }) {
  const styles = ROUTE_GROUP_STYLES[tone]
  const [expanded, setExpanded] = useState(false)
  const primary = tone === 'online'
  const visible = primary ? (expanded ? services : services.slice(0, 4)) : (expanded ? services : [])
  const hiddenCount = Math.max(services.length - visible.length, 0)
  const summary = services.slice(0, 2).map((service) => service.name).join(' · ')

  return (
    <div
      className="self-start rounded-2xl border bg-theme-card px-3 py-2.5"
      style={{
        borderColor: 'rgba(255,255,255,0.08)',
        boxShadow: `inset 2px 0 0 ${styles.line}`,
      }}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className={`h-1.5 w-1.5 rounded-full ${styles.dot}`} />
          <p className={`text-[10px] font-semibold uppercase tracking-[0.18em] ${styles.text}`}>{label}</p>
          <span className="text-[10px] text-theme-text-muted/60">
            {services.length} {services.length === 1 ? 'route' : 'routes'}
          </span>
        </div>
        {services.length > 0 ? (
          <button
            type="button"
            onClick={() => setExpanded((current) => !current)}
            className="text-[10px] font-mono uppercase tracking-[0.16em] text-theme-text-muted/65 transition-colors hover:text-theme-text"
          >
            {expanded ? 'Collapse' : 'Show all'}
          </button>
        ) : null}
      </div>

      {visible.length > 0 ? (
        <div className="mt-2 space-y-1">
          {visible.map((service) => (
            <RoutingRow key={`${tone}-${service.name}`} service={service} tone={tone} />
          ))}
          {!expanded && hiddenCount > 0 ? (
            <p className="px-1 pt-0.5 text-[10px] uppercase tracking-[0.14em] text-theme-text-muted/45">
              +{hiddenCount} more
            </p>
          ) : null}
        </div>
      ) : services.length === 0 ? (
        <p className="mt-2 text-[10px] uppercase tracking-[0.14em] text-theme-text-muted/40">Clear</p>
      ) : (
        <div className="mt-1.5 min-h-[1.75rem]">
          <p className="truncate text-[10px] uppercase tracking-[0.14em] text-theme-text-muted/52">
            {summary}
            {services.length > 2 ? ` +${services.length - 2} more` : ''}
          </p>
        </div>
      )}
    </div>
  )
}

function RoutingRow({ service, tone }) {
  const styles = ROUTE_GROUP_STYLES[tone]
  const href = getExternalUrl(service.port)

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-white/6 bg-black/[0.1] px-2 py-1.5">
      <div className="flex min-w-0 items-center gap-2">
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${styles.dot}`} />
        <span className="truncate text-[11px] font-medium text-theme-text">{service.name}</span>
      </div>
      <div className="flex shrink-0 items-center gap-2 text-[9px] text-theme-text-muted/75">
        {href ? (
          <a
            className="font-mono uppercase tracking-[0.14em] text-theme-accent-light transition-colors hover:text-theme-text"
            href={href}
            target="_blank"
            rel="noopener noreferrer"
          >
            :{service.port}
          </a>
        ) : (
          <span className="font-mono uppercase tracking-[0.14em]">internal</span>
        )}
      </div>
    </div>
  )
}

function StorageBlock({ storage }) {
  const items = [
    ['Models', storage?.models],
    ['Vector Database', storage?.vector_db],
    ['Total Data', storage?.total_data],
  ]

  return (
    <div className="space-y-4">
      {items.map(([label, data]) => (
        <div key={label}>
          <div className="mb-2 flex items-center justify-between text-sm">
            <span className="text-theme-text-muted">{label}</span>
            <span className="text-theme-text">{data?.formatted || 'Unknown'}</span>
          </div>
          <div className="liquid-metal-progress-track h-2 overflow-hidden rounded-full">
            <div
              className="liquid-metal-progress-fill h-full rounded-full"
              style={{ width: `${data?.percent || 0}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  )
}

function ActionButton({ icon: Icon, label, description, onClick }) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-4 rounded-lg p-3 transition-colors hover:bg-theme-surface-hover"
    >
      <Icon size={20} className="text-theme-text-muted" />
      <div className="text-left">
        <p className="text-sm font-medium text-theme-text">{label}</p>
        <p className="text-xs text-theme-text-muted">{description}</p>
      </div>
    </button>
  )
}
