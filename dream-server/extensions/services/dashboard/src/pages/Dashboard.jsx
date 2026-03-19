import {
  Activity,
  Cpu,
  HardDrive,
  Thermometer,
  Power,
  Zap,
  Clock,
  Hash,
  Brain,
  Brackets,
  MessageSquare,
  Mic,
  FileText,
  Workflow,
  Image,
  Code,
} from 'lucide-react'
import { memo, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { FeatureDiscoveryBanner } from '../components/FeatureDiscovery'

// Helper to build external service URLs from current host
const getExternalUrl = (port) =>
  typeof window !== 'undefined'
    ? `http://${window.location.hostname}:${port}`
    : `http://localhost:${port}`

// Compute overall health from services (excludes not_deployed from counts)
function computeHealth(services) {
  if (!services?.length) return { text: 'Waiting for telemetry...', color: 'text-zinc-400' }
  const deployed = services.filter(s => s.status !== 'not_deployed')
  if (!deployed.length) return { text: 'No services deployed', color: 'text-zinc-400' }
  const healthy = deployed.filter(s => s.status === 'healthy').length
  return { text: `${healthy}/${deployed.length} services online.`, color: healthy === deployed.length ? 'text-green-400' : 'text-zinc-400' }
}

const FEATURE_ICONS = {
  MessageSquare,
  Mic,
  FileText,
  Workflow,
  Image,
  Code,
}

function pickFeatureLink(feature, services) {
  const svc = services || []
  const req = feature?.requirements || {}
  const wanted = [...(req.servicesAll || req.services || []), ...(req.servicesAny || req.services_any || [])]

  // Match by name substring since status API uses display names, not IDs
  const matchService = (needle) =>
    svc.find(s => s.status === 'healthy' && s.port &&
      (s.name || '').toLowerCase().includes(needle.toLowerCase()))

  const firstHealthy = wanted.map(matchService).find(Boolean)
  if (firstHealthy) {
    return getExternalUrl(firstHealthy.port)
  }

  const fallbackWebUi = matchService('webui') || matchService('open webui')
  return fallbackWebUi ? getExternalUrl(fallbackWebUi.port) : null
}

function normalizeFeatureStatus(featureStatus) {
  switch (featureStatus) {
    case 'enabled':
      return 'ready'
    case 'available':
      return 'ready'
    case 'services_needed':
    case 'insufficient_vram':
      return 'disabled'
    default:
      return 'disabled'
  }
}

// Sort services: down/unhealthy first, then degraded, then healthy; exclude not_deployed
const severityOrder = { down: 0, unhealthy: 1, degraded: 2, unknown: 3, healthy: 4 }
function sortBySeverity(services) {
  return [...(services || [])]
    .filter(s => s.status !== 'not_deployed')
    .sort((a, b) =>
      (severityOrder[a.status] ?? 9) - (severityOrder[b.status] ?? 9)
    )
}

// Format large token counts: 1234 → "1.2k", 1500000 → "1.5M", 1500000000 → "1.5B"
function formatTokenCount(n) {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return `${n}`
}

// Format uptime: 90061 → "1d 1h 1m"
function formatUptime(seconds) {
  if (!seconds) return '—'
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (d > 0) return `${d}d ${h}h ${m}m`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

export default function Dashboard({ status, loading }) {
  const [featuresData, setFeaturesData] = useState(null)

  useEffect(() => {
    let mounted = true

    const fetchFeatures = async () => {
      try {
        const res = await fetch('/api/features')
        if (!res.ok) return
        const data = await res.json()
        if (mounted) setFeaturesData(data)
      } catch {
        // Feature cards degrade gracefully to status-only view when API fails.
      }
    }

    fetchFeatures()
    const timer = setInterval(fetchFeatures, 15000)
    return () => {
      mounted = false
      clearInterval(timer)
    }
  }, [])

  // All hooks must be called before any conditional returns (React rules of hooks)
  const features = useMemo(() => {
    if (featuresData?.features?.length) {
      return [...featuresData.features].sort((a, b) => (a.priority || 999) - (b.priority || 999))
    }
    return []
  }, [featuresData])

  if (loading) {
    return (
      <div className="p-8 animate-pulse">
        <div className="h-8 bg-zinc-800 rounded w-1/3 mb-4" />
        <p className="text-sm text-zinc-500 mb-8">Linking modules... reading telemetry...</p>
        <div className="grid grid-cols-3 gap-6">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-40 bg-zinc-800 rounded-xl" />
          ))}
        </div>
      </div>
    )
  }

  const health = computeHealth(status?.services)
  const servicesSorted = sortBySeverity(status?.services)

  return (
    <div className="p-8">
      {/* Header with live meta strip */}
      <div className="mb-8 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Dashboard</h1>
          <p className={`mt-1 ${health.color}`}>
            {health.text}
          </p>
        </div>
        <div className="flex items-center gap-4 text-xs text-zinc-500 font-mono bg-zinc-900/50 border border-zinc-800 rounded-lg px-3 py-2">
          {status?.tier && <span className="text-indigo-300">{status.tier}</span>}
          {status?.model?.name && <span>{status.model.name}</span>}
          {status?.version && <span>v{status.version}</span>}
        </div>
      </div>

      {/* Feature Discovery Banner */}
      <FeatureDiscoveryBanner />

      {/* Feature Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
        {features.length > 0 ? (
          features.map(feature => (
            <FeatureCard
              key={feature.id}
              icon={FEATURE_ICONS[feature.icon] || MessageSquare}
              title={feature.name}
              description={feature.description}
              href={pickFeatureLink(feature, status?.services)}
              status={normalizeFeatureStatus(feature.status)}
              hint={
                feature.status === 'services_needed'
                  ? `Needs services: ${(feature.requirements?.servicesMissing || []).join(', ')}`
                  : feature.status === 'insufficient_vram'
                    ? `Needs ${feature.requirements?.vramGb || 0}GB VRAM`
                    : undefined
              }
            />
          ))
        ) : (
          <FeatureCard
            icon={MessageSquare}
            title="AI Chat"
            description="Feature metadata is loading..."
            href={null}
            status="disabled"
            hint="Waiting for /api/features"
          />
        )}
      </div>

      {/* System Status */}
      <h2 className="text-lg font-semibold text-white mb-4">System Status</h2>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-8">
        {status?.gpu && (
          <>
            <MetricCard
              icon={Activity}
              label="GPU"
              value={`${status.gpu.utilization}%`}
              subvalue={status.gpu.name.replace('NVIDIA ', '').replace('AMD ', '')}
            />
            {status.gpu.memoryType === 'unified' ? (
              status?.ram && (
                <>
                  <MetricCard
                    icon={HardDrive}
                    label="Mem Used"
                    value={`${status.ram.used_gb} GB`}
                    subvalue={`of ${status.ram.total_gb} GB`}
                    percent={status.ram.percent}
                  />
                  <MetricCard
                    icon={HardDrive}
                    label="Mem Free"
                    value={`${(status.ram.total_gb - status.ram.used_gb).toFixed(1)} GB`}
                    subvalue={`of ${status.ram.total_gb} GB`}
                    percent={((status.ram.total_gb - status.ram.used_gb) / status.ram.total_gb) * 100}
                  />
                </>
              )
            ) : (
              <MetricCard
                icon={HardDrive}
                label="VRAM"
                value={`${status.gpu.vramUsed.toFixed(1)} GB`}
                subvalue={`of ${status.gpu.vramTotal} GB`}
                percent={(status.gpu.vramUsed / status.gpu.vramTotal) * 100}
              />
            )}
            <MetricCard
              icon={Thermometer}
              label="GPU Temp"
              value={`${status.gpu.temperature}°C`}
              subvalue={status.gpu.temperature < 70 ? 'Normal' : status.gpu.temperature < 85 ? 'Warm' : 'Hot'}
              alert={status.gpu.temperature >= 85}
            />
          </>
        )}
        {status?.cpu && (
          <>
            <MetricCard
              icon={Cpu}
              label="CPU"
              value={`${status.cpu.percent}%`}
              subvalue="utilization"
              percent={status.cpu.percent}
            />
            {status.cpu.temp_c != null && (
              <MetricCard
                icon={Thermometer}
                label="CPU Temp"
                value={`${status.cpu.temp_c}°C`}
                subvalue={status.cpu.temp_c < 70 ? 'Normal' : status.cpu.temp_c < 85 ? 'Warm' : 'Hot'}
                alert={status.cpu.temp_c >= 85}
              />
            )}
          </>
        )}
        {status?.ram && status?.gpu?.memoryType !== 'unified' && (
          <MetricCard
            icon={HardDrive}
            label="RAM"
            value={`${status.ram.used_gb} GB`}
            subvalue={`of ${status.ram.total_gb} GB`}
            percent={status.ram.percent}
          />
        )}
        {status?.gpu?.powerDraw != null && (
          <MetricCard
            icon={Power}
            label="GPU Power"
            value={`${status.gpu.powerDraw}W`}
            subvalue="live"
          />
        )}
        {/* Inference & System badges */}
        <MetricCard
          icon={Zap}
          label="Tokens/sec"
          value={status?.inference?.tokensPerSecond > 0 ? `${status.inference.tokensPerSecond}` : '—'}
          subvalue="inference speed"
        />
        <MetricCard
          icon={Hash}
          label="Tokens Generated"
          value={formatTokenCount(status?.inference?.lifetimeTokens || 0)}
          subvalue="all time"
        />
        <MetricCard
          icon={Clock}
          label="Uptime"
          value={formatUptime(status?.uptime || 0)}
          subvalue="system"
        />
        <MetricCard
          icon={Brain}
          label="Model"
          value={status?.inference?.loadedModel || '—'}
          subvalue="loaded"
        />
        <MetricCard
          icon={Brackets}
          label="Context"
          value={status?.inference?.contextSize ? `${(status.inference.contextSize / 1024).toFixed(0)}k` : '—'}
          subvalue="max tokens"
        />
      </div>

      {/* Services Grid — sorted by severity */}
      <h2 className="text-lg font-semibold text-white mb-4">Services</h2>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-8">
        {servicesSorted.map(service => (
          <ServiceCard key={service.name} service={service} />
        ))}
      </div>

      {/* Feature Discovery is already shown at the top */}
    </div>
  )
}


const FeatureCard = memo(function FeatureCard({ icon: Icon, title, description, href, status, hint }) {
  const isExternal = href?.startsWith('http')
  const statusColors = {
    ready: 'border-indigo-500/20 hover:border-indigo-500/35',
    disabled: 'border-zinc-700 opacity-60',
    coming: 'border-zinc-700 opacity-40'
  }

  const content = (
    <div className={`p-6 rounded-xl border-2 ${statusColors[status]} bg-zinc-900/50 transition-all cursor-pointer hover:bg-zinc-800/50`}>
      <div className="flex items-start justify-between mb-4">
        <div className="p-3 bg-zinc-800 rounded-lg">
          <Icon size={24} className="text-indigo-400" />
        </div>
        {status === 'ready' && (
          <span className="px-2 py-1 text-xs bg-green-500/20 text-green-400 rounded-full">
            Ready
          </span>
        )}
        {status === 'coming' && (
          <span className="px-2 py-1 text-xs bg-zinc-700 text-zinc-400 rounded-full">
            Coming
          </span>
        )}
      </div>
      <h3 className="text-lg font-semibold text-white mb-1">{title}</h3>
      <p className="text-sm text-zinc-400">{description}</p>
      {status === 'disabled' && hint && (
        <p className="text-xs text-zinc-500 mt-3 font-mono">{hint}</p>
      )}
    </div>
  )

  if (status === 'disabled' || status === 'coming' || !href) {
    return content
  }

  if (isExternal) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer">
        {content}
      </a>
    )
  }

  return <Link to={href}>{content}</Link>
})

const MetricCard = memo(function MetricCard({ icon: Icon, label, value, subvalue, percent, alert }) {
  return (
    <div className="p-4 bg-zinc-900/50 border border-zinc-800 rounded-xl overflow-hidden min-w-0">
      <div className="flex items-center gap-3 mb-2">
        <Icon size={18} className={alert ? 'text-red-400' : 'text-zinc-400'} />
        <span className="text-sm text-zinc-400">{label}</span>
      </div>
      <div className="text-xl font-semibold text-white font-mono truncate" title={value}>{value}</div>
      <div className="text-xs text-zinc-500 mt-1">{subvalue}</div>
      {percent !== undefined && (
        <div className="h-1 bg-zinc-700 rounded-full mt-3 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${percent > 90 ? 'bg-red-500' : percent > 70 ? 'bg-yellow-500' : 'bg-indigo-500'}`}
            style={{ width: `${Math.min(percent, 100)}%` }}
          />
        </div>
      )}
    </div>
  )
})

const ServiceCard = memo(function ServiceCard({ service }) {
  const statusColors = {
    healthy: 'bg-green-500',
    degraded: 'bg-yellow-500',
    unhealthy: 'bg-red-500',
    down: 'bg-red-500',
    unknown: 'bg-zinc-500'
  }

  const formatUptime = (seconds) => {
    if (!seconds) return '—'
    const hours = Math.floor(seconds / 3600)
    const mins = Math.floor((seconds % 3600) / 60)
    return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`
  }

  return (
    <div className="p-4 bg-zinc-900/50 border border-zinc-800 rounded-xl">
      <div className="flex items-center gap-2 mb-2">
        <div className={`w-2 h-2 rounded-full ${statusColors[service.status] || 'bg-zinc-500'}`} />
        <span className="text-sm font-medium text-white">{service.name}</span>
      </div>
      <div className="text-xs text-zinc-500 font-mono">
        {service.port ? `:${service.port} · ` : ''}{formatUptime(service.uptime)}
      </div>
    </div>
  )
})

// BootstrapBanner moved to App.jsx for app-wide visibility
