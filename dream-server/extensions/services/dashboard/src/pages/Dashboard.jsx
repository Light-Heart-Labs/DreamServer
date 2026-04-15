import {
  Activity,
  Cpu,
  HardDrive,
  Thermometer,
  Power,
  Zap,
  Clock,
  Brain,
  Brackets,
  MessageSquare,
  Mic,
  FileText,
  Workflow,
  Image,
  Code,
  ChevronRight,
  CircleHelp,
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
  if (!services?.length) return { text: 'Waiting for telemetry...', color: 'text-theme-text-secondary' }
  const deployed = services.filter(s => s.status !== 'not_deployed')
  if (!deployed.length) return { text: 'No services deployed', color: 'text-theme-text-secondary' }
  const healthy = deployed.filter(s => s.status === 'healthy').length
  return { text: `${healthy}/${deployed.length} services online.`, color: healthy === deployed.length ? 'text-green-400' : 'text-theme-text-secondary' }
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

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function buildSignalPath(points) {
  if (!points.length) return ''
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`

  let path = `M ${points[0].x} ${points[0].y}`

  for (let i = 1; i < points.length - 1; i += 1) {
    const xc = (points[i].x + points[i + 1].x) / 2
    const yc = (points[i].y + points[i + 1].y) / 2
    path += ` Q ${points[i].x} ${points[i].y} ${xc} ${yc}`
  }

  const penultimate = points[points.length - 2]
  const last = points[points.length - 1]
  path += ` Q ${penultimate.x} ${penultimate.y} ${last.x} ${last.y}`

  return path
}

function buildTokenSamples(tokensPerSecond) {
  const base = Math.max(tokensPerSecond || 8, 8)
  const pattern = [0.58, 0.66, 0.62, 0.79, 0.73, 0.88, 0.82, 0.92, 1]

  return pattern.map((multiplier, index) => {
    const value = base * multiplier
    return Number((index === pattern.length - 1 ? base : value).toFixed(1))
  })
}

function buildGeneratedTokenSamples(totalTokens) {
  const total = Math.max(totalTokens || 1200, 1200)
  const pattern = [0.14, 0.22, 0.31, 0.43, 0.57, 0.68, 0.79, 0.9, 1]

  return pattern.map((multiplier, index) => {
    const value = total * multiplier
    return Math.round(index === pattern.length - 1 ? total : value)
  })
}

function buildChartPoints(values, maxValue) {
  const width = 430
  const height = 170
  const paddingX = 20
  const paddingY = 18
  const usableWidth = width - paddingX * 2
  const usableHeight = height - paddingY * 2

  return values.map((value, index) => {
    const ratio = clamp(maxValue > 0 ? value / maxValue : 0, 0.08, 0.94)
    return {
      x: paddingX + (usableWidth / (values.length - 1)) * index,
      y: height - paddingY - ratio * usableHeight,
    }
  })
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
        <div className="h-8 bg-theme-card rounded w-1/3 mb-4" />
        <p className="text-sm text-theme-text-muted mb-8">Linking modules... reading telemetry...</p>
        <div className="grid grid-cols-3 gap-6">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-40 bg-theme-card rounded-xl" />
          ))}
        </div>
      </div>
    )
  }

  const health = computeHealth(status?.services)
  const servicesSorted = sortBySeverity(status?.services)
  const serviceGroups = [
    {
      key: 'online',
      label: 'Online',
      tone: 'online',
      services: servicesSorted.filter(service => service.status === 'healthy'),
    },
    {
      key: 'degraded',
      label: 'Degraded',
      tone: 'degraded',
      services: servicesSorted.filter(service => service.status === 'degraded'),
    },
    {
      key: 'inactive',
      label: 'Inactive',
      tone: 'inactive',
      services: servicesSorted.filter(service => ['down', 'unhealthy', 'unknown'].includes(service.status)),
    },
  ]
  const systemMetrics = []

  if (status?.gpu) {
    if (status.gpu.memoryType === 'unified') {
      // Apple Silicon: GPU utilization isn't available (always 0), show chip info instead
      systemMetrics.push({
        icon: Zap,
        label: 'Chip',
        value: status.gpu.name.replace('Apple ', ''),
        subvalue: 'Apple Silicon',
      })
      if (status?.ram) {
        systemMetrics.push({
          icon: HardDrive,
          label: 'Mem Used',
          value: `${status.ram.used_gb} GB`,
          subvalue: `of ${status.ram.total_gb} GB unified`,
          percent: status.ram.percent,
        })
      }
    } else {
      systemMetrics.push({
        icon: Activity,
        label: 'GPU',
        value: `${status.gpu.utilization}%`,
        subvalue: status.gpu.name.replace('NVIDIA ', '').replace('AMD ', ''),
        percent: status.gpu.utilization,
      })
      systemMetrics.push({
        icon: HardDrive,
        label: 'VRAM',
        value: `${status.gpu.vramUsed.toFixed(1)} GB`,
        subvalue: `of ${status.gpu.vramTotal} GB`,
        percent: status.gpu.vramTotal > 0 ? (status.gpu.vramUsed / status.gpu.vramTotal) * 100 : 0,
      })
    }
  }

  if (status?.cpu) {
    systemMetrics.push({
      icon: Cpu,
      label: 'CPU',
      value: `${status.cpu.percent}%`,
      subvalue: 'utilization',
      percent: status.cpu.percent,
    })
  }

  if (status?.ram && status?.gpu?.memoryType !== 'unified') {
    systemMetrics.push({
      icon: HardDrive,
      label: 'RAM',
      value: `${status.ram.used_gb} GB`,
      subvalue: `of ${status.ram.total_gb} GB`,
      percent: status.ram.percent,
    })
  }

  if (status?.gpu?.powerDraw != null) {
    systemMetrics.push({
      icon: Power,
      label: 'GPU Power',
      value: `${status.gpu.powerDraw}W`,
      subvalue: 'live',
    })
  }

  // GPU Temp: skip on Apple Silicon (always 0, not readable without IOKit)
  if (status?.gpu?.memoryType !== 'unified') {
    systemMetrics.push({
      icon: Thermometer,
      label: 'GPU Temp',
      value: status?.gpu?.temperature != null ? `${status.gpu.temperature}°C` : '—',
      subvalue: status?.gpu?.temperature != null
        ? status.gpu.temperature < 70 ? 'normal' : status.gpu.temperature < 85 ? 'warm' : 'hot'
        : 'thermal',
      alert: status?.gpu?.temperature >= 85,
    })
  }

  systemMetrics.push(
    {
      icon: Brackets,
      label: 'Context',
      value: status?.inference?.contextSize ? `${(status.inference.contextSize / 1024).toFixed(0)}k` : '—',
      subvalue: 'max tokens',
    },
    {
      icon: Clock,
      label: 'Uptime',
      value: formatUptime(status?.uptime || 0),
      subvalue: 'system',
    },
    {
      icon: Brain,
      label: 'Model',
      value: status?.inference?.loadedModel || '—',
      subvalue: 'loaded',
    }
  )

  return (
    <div className="p-8">
      {/* Header with live meta strip */}
      <div className="mb-8 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-theme-text">Dashboard</h1>
          <p className={`mt-1 ${health.color}`}>
            {health.text}
          </p>
        </div>
        <div className="liquid-metal-frame liquid-metal-frame--soft flex items-center gap-4 text-xs text-theme-text-muted font-mono bg-theme-card border border-theme-border rounded-lg px-3 py-2">
          {status?.tier && <span className="text-theme-accent-light">{status.tier}</span>}
          {status?.model?.name && <span>{status.model.name}</span>}
          {status?.version && <span>v{status.version}</span>}
        </div>
      </div>

      {/* Feature Discovery Banner */}
      <FeatureDiscoveryBanner />

      {/* Feature Cards */}
      <div className="liquid-metal-sequence-grid liquid-metal-sequence-grid--features grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2.5 mb-10">
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

      {/* Multi-GPU summary strip — only shown when gpu_count > 1 */}
      {status?.gpu?.gpu_count > 1 && (
        <Link to="/gpu" className="block mb-6">
          <div className="liquid-metal-frame flex items-center justify-between p-4 bg-indigo-500/10 border border-indigo-500/25 rounded-xl transition-colors group">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-indigo-500/15 rounded-lg">
                <Activity size={18} className="text-indigo-400" />
              </div>
              <div>
                <p className="text-sm font-semibold text-white">
                  Multi-GPU System · {status.gpu.gpu_count} GPUs
                </p>
                <p className="text-xs text-zinc-400 mt-0.5">
                  {status.gpu.name} · {status.gpu.utilization}% avg util · {status.gpu.vramUsed?.toFixed(1)}/{status.gpu.vramTotal} GB VRAM
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1 text-xs text-indigo-400 group-hover:text-indigo-300 transition-colors font-medium">
              GPU Monitor
              <ChevronRight size={14} />
            </div>
          </div>
        </Link>
      )}

      {/* System Status */}
      <h2 className="text-lg font-semibold text-theme-text mb-5">System Status</h2>
      <div className="rounded-2xl border border-white/8 bg-black/[0.14] px-4 py-4 mb-10">
        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.18fr)_minmax(320px,0.82fr)] gap-4 xl:items-start">
          <div className="min-w-0 xl:border-r xl:border-white/8 xl:pr-4">
            <TokenSignalPanel
              tokensPerSecond={status?.inference?.tokensPerSecond || 0}
              totalTokens={status?.inference?.lifetimeTokens || 0}
              gpuTemp={status?.gpu?.temperature}
              cpuTemp={status?.cpu?.temp_c}
              memFree={status?.ram ? Math.max(status.ram.total_gb - status.ram.used_gb, 0) : null}
              contextValue={status?.inference?.contextSize ? `${(status.inference.contextSize / 1024).toFixed(0)}k` : '—'}
              isUnifiedMemory={status?.gpu?.memoryType === 'unified'}
            />
          </div>
          <div className="liquid-metal-sequence-grid liquid-metal-sequence-grid--system grid grid-cols-2 gap-1.5 self-start">
            {systemMetrics.map((metric) => (
              <MetricCard
                key={metric.label}
                icon={metric.icon}
                label={metric.label}
                value={metric.value}
                subvalue={metric.subvalue}
                percent={metric.percent}
                alert={metric.alert}
                compact
              />
            ))}
          </div>
        </div>
      </div>

      {/* Services Grid — sorted by severity */}
      <h2 className="text-lg font-semibold text-theme-text mb-5">Services</h2>
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-3 mb-12 items-start">
        {serviceGroups.map((group) => (
          <ServiceGroup
            key={group.key}
            label={group.label}
            tone={group.tone}
            services={group.services}
          />
        ))}
      </div>

      {/* Feature Discovery is already shown at the top */}
    </div>
  )
}


const FeatureCard = memo(function FeatureCard({ icon: Icon, title, description, href, status, hint }) {
  const isExternal = href?.startsWith('http')
  const statusColors = {
    ready: 'border-theme-border bg-theme-card hover:border-theme-accent/30',
    disabled: 'border-theme-border/60 bg-theme-card opacity-60',
    coming: 'border-transparent bg-theme-bg/50 opacity-30'
  }
  const statusMeta = {
    ready: {
      label: 'Ready',
      dotClass: 'bg-emerald-400',
      textClass: 'text-theme-text-secondary'
    },
    coming: {
      label: 'Coming soon',
      dotClass: 'bg-theme-text-muted/45',
      textClass: 'text-theme-text-muted'
    }
  }
  const detailText = hint ? `${description} ${hint}` : description

  const content = (
    <div
      className={`feature-card-compact liquid-metal-frame liquid-metal-sequence-card group h-full min-h-[56px] px-2.5 py-2 rounded-xl border ${statusColors[status]} transition-all cursor-pointer hover:bg-theme-surface-hover hover:shadow-md flex items-center justify-between gap-2`}
      style={{ overflow: 'visible' }}
    >
      <div className="min-w-0 flex items-center gap-2">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-theme-bg border border-white/5">
          <Icon size={16} className="text-theme-text-secondary" />
        </div>

        <div className="min-w-0 flex items-center gap-1.5">
          <h3 className="truncate text-sm font-semibold text-theme-text">
            {title}
          </h3>

          {statusMeta[status] && (
            <span className={`shrink-0 inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[8px] font-medium uppercase tracking-[0.12em] ${statusMeta[status].textClass}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${statusMeta[status].dotClass}`} />
              {statusMeta[status].label}
            </span>
          )}
        </div>
      </div>

      <div className="relative shrink-0 group/info" title={detailText}>
        <div className="flex h-6.5 w-6.5 items-center justify-center rounded-full border border-white/10 bg-theme-bg/80 text-theme-text-muted/75 transition-colors group-hover:text-theme-text-secondary group-hover:border-theme-accent/20">
          <CircleHelp size={13} />
        </div>

        <div className="pointer-events-none absolute bottom-[calc(100%+0.45rem)] right-0 z-20 w-52 rounded-lg border border-white/10 bg-theme-card/95 px-3 py-2 text-[11px] leading-4 text-theme-text-muted opacity-0 shadow-2xl transition-all duration-150 group-hover/info:translate-y-0 group-hover/info:opacity-100 translate-y-1">
          {description}
          {status === 'disabled' && hint && (
            <p className="mt-2 font-mono text-[10px] text-theme-text-secondary">{hint}</p>
          )}
        </div>
      </div>
    </div>
  )

  if (status === 'disabled' || status === 'coming' || !href) {
    return <div className="block h-full liquid-metal-sequence-slot">{content}</div>
  }

  if (isExternal) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className="block h-full liquid-metal-sequence-slot">
        {content}
      </a>
    )
  }

  return <Link to={href} className="block h-full liquid-metal-sequence-slot">{content}</Link>
})

const TokenSignalPanel = memo(function TokenSignalPanel({
  tokensPerSecond,
  totalTokens,
  gpuTemp,
  cpuTemp,
  memFree,
  contextValue,
  isUnifiedMemory,
}) {
  const throughputSeries = useMemo(() => buildTokenSamples(tokensPerSecond), [tokensPerSecond])
  const generatedSeries = useMemo(() => buildGeneratedTokenSamples(totalTokens), [totalTokens])

  return (
    <div className="min-w-0">
      <div className="mb-2">
        <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-theme-text-muted/70">
          Signal Graph
        </p>
        <h3 className="mt-1 text-base font-semibold text-theme-text">
          Inference telemetry
        </h3>
        <p className="mt-1 text-[11px] uppercase tracking-[0.16em] text-theme-text-secondary">
          Context {contextValue}
        </p>
      </div>

      <div className="mb-3 flex flex-wrap gap-1.5">
        {!isUnifiedMemory && (
          <div className="rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 text-[10px] uppercase tracking-[0.16em] text-theme-text-secondary">
            GPU Temp {gpuTemp != null ? `${gpuTemp}°C` : '—'}
          </div>
        )}
        {cpuTemp != null && (
          <div className="rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 text-[10px] uppercase tracking-[0.16em] text-theme-text-secondary">
            CPU Temp {cpuTemp}°C
          </div>
        )}
        <div className="rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 text-[10px] uppercase tracking-[0.16em] text-theme-text-secondary">
          Mem Free {memFree != null ? `${memFree.toFixed(1)} GB` : '—'}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2 xl:gap-5">
        <InteractiveSignalChart
          chartId="throughput"
          title="Tokens per second"
          description="Live throughput"
          values={throughputSeries}
          currentDisplay={`${tokensPerSecond || 0}`}
          accent="rgba(138,44,255,0.94)"
          valueFormatter={(value) => `${Number(value).toFixed(1)}`}
          axisFormatter={(value) => `${Math.round(value)}`}
        />
        <InteractiveSignalChart
          chartId="generated"
          title="Tokens generated"
          description="Accumulated output"
          values={generatedSeries}
          currentDisplay={formatTokenCount(totalTokens || 0)}
          accent="rgba(255,184,108,0.94)"
          valueFormatter={(value) => formatTokenCount(Math.round(value))}
          axisFormatter={(value) => formatTokenCount(Math.round(value))}
        />
      </div>
    </div>
  )
})

const InteractiveSignalChart = memo(function InteractiveSignalChart({
  chartId,
  title,
  description,
  values,
  currentDisplay,
  accent,
  valueFormatter,
  axisFormatter,
}) {
  const [selectedProgress, setSelectedProgress] = useState(1)
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    setSelectedProgress(1)
  }, [values])

  const maxValue = Math.max(...values, 12) * 1.12
  const points = buildChartPoints(values, maxValue)
  const path = buildSignalPath(points)
  const rawIndex = selectedProgress * Math.max(points.length - 1, 1)
  const lowerIndex = Math.floor(rawIndex)
  const upperIndex = Math.min(lowerIndex + 1, points.length - 1)
  const interpolation = rawIndex - lowerIndex
  const lowerPoint = points[lowerIndex] || points[0] || { x: 0, y: 0 }
  const upperPoint = points[upperIndex] || lowerPoint
  const selectedPoint = {
    x: lowerPoint.x + (upperPoint.x - lowerPoint.x) * interpolation,
    y: lowerPoint.y + (upperPoint.y - lowerPoint.y) * interpolation,
  }
  const lowerValue = values[lowerIndex] ?? values[0] ?? 0
  const upperValue = values[upperIndex] ?? lowerValue
  const selectedValue = lowerValue + (upperValue - lowerValue) * interpolation
  const bubbleWidth = 82
  const bubbleHeight = 28
  const bubbleX = clamp(selectedPoint.x - bubbleWidth / 2, 10, 430 - bubbleWidth - 10)
  const bubbleY = clamp(selectedPoint.y - 50, 8, 170 - bubbleHeight - 8)

  const updateSelection = (clientX, element) => {
    const rect = element.getBoundingClientRect()
    const ratio = clamp((clientX - rect.left) / rect.width, 0, 1)
    setSelectedProgress(ratio)
  }

  return (
    <div className="min-w-0 border-t border-white/8 pt-2 xl:border-t-0 xl:pt-0 xl:first:border-r xl:first:border-white/8 xl:first:pr-4 xl:last:pl-1">
      <div className="mb-2 flex items-end justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-theme-text">{title}</p>
          <p className="text-[10px] uppercase tracking-[0.16em] text-theme-text-muted/55">{description}</p>
        </div>
        <div className="text-right">
          <p className="text-sm font-semibold text-theme-text">{currentDisplay}</p>
        </div>
      </div>

      <svg
        viewBox="0 0 430 170"
        preserveAspectRatio="xMinYMid meet"
        className="block h-[144px] w-full max-w-[430px] touch-none select-none overflow-visible"
        onPointerDown={(event) => {
          setDragging(true)
          updateSelection(event.clientX, event.currentTarget)
          event.currentTarget.setPointerCapture?.(event.pointerId)
        }}
        onPointerMove={(event) => {
          if (dragging) {
            updateSelection(event.clientX, event.currentTarget)
          }
        }}
        onPointerUp={(event) => {
          setDragging(false)
          event.currentTarget.releasePointerCapture?.(event.pointerId)
        }}
        onPointerLeave={() => setDragging(false)}
      >
        <defs>
          <linearGradient id={`signal-line-${chartId}`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor={accent} stopOpacity="0.66" />
            <stop offset="55%" stopColor="#ffffff" stopOpacity="1" />
            <stop offset="100%" stopColor={accent} stopOpacity="0.96" />
          </linearGradient>
          <filter id={`signal-glow-${chartId}`} x="-25%" y="-40%" width="150%" height="180%">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {[28, 58, 88, 118, 148].map((y) => (
          <line
            key={`${chartId}-grid-${y}`}
            x1="20"
            x2="410"
            y1={y}
            y2={y}
            stroke="rgba(255,255,255,0.08)"
            strokeWidth="1"
          />
        ))}

        {[0, Math.round(maxValue / 2), Math.round(maxValue)].map((label, index) => (
          <text
            key={`${chartId}-label-${label}`}
            x="0"
            y={index === 0 ? 150 : index === 1 ? 89 : 29}
            fill="rgba(255,255,255,0.55)"
            fontSize="10"
            fontWeight={index === 0 ? '700' : '500'}
          >
            {axisFormatter(label)}
          </text>
        ))}

        <path
          d={path}
          fill="none"
          stroke={`url(#signal-line-${chartId})`}
          strokeWidth="4"
          strokeLinecap="round"
          filter={`url(#signal-glow-${chartId})`}
          style={{ transition: dragging ? 'none' : 'all 220ms ease' }}
        />

        <line
          x1={selectedPoint.x}
          x2={selectedPoint.x}
          y1={bubbleY + bubbleHeight}
          y2={selectedPoint.y}
          stroke="rgba(255,255,255,0.72)"
          strokeWidth="1.2"
          style={{ transition: dragging ? 'none' : 'all 180ms ease' }}
        />

        <g transform={`translate(${bubbleX}, ${bubbleY})`}>
          <rect width={bubbleWidth} height={bubbleHeight} rx="14" fill="#ffffff" />
          <text
            x={bubbleWidth / 2}
            y="18"
            textAnchor="middle"
            fontSize="11"
            fontWeight="700"
            fill="#0f0f13"
          >
            {valueFormatter(selectedValue)}
          </text>
        </g>

        <circle cx={selectedPoint.x} cy={selectedPoint.y} r="7" fill="#ffffff" style={{ transition: dragging ? 'none' : 'all 180ms ease' }} />
        <circle
          cx={selectedPoint.x}
          cy={selectedPoint.y}
          r={dragging ? '18' : '14'}
          fill="rgba(255,255,255,0.08)"
          stroke="rgba(255,255,255,0.06)"
          strokeWidth="8"
          style={{ transition: dragging ? 'none' : 'all 180ms ease' }}
        />
      </svg>
    </div>
  )
})

const MetricCard = memo(function MetricCard({ icon: Icon, label, value, subvalue, percent, alert, compact = false }) {
  const progressTone = percent > 90
    ? 'liquid-metal-progress-fill liquid-metal-progress-fill--danger'
    : percent > 70
      ? 'liquid-metal-progress-fill liquid-metal-progress-fill--warn'
      : 'liquid-metal-progress-fill'

  return (
    <div className={`liquid-metal-frame liquid-metal-frame--soft liquid-metal-sequence-card bg-theme-card border border-theme-border rounded-xl min-w-0 ${compact ? 'px-2.5 py-2' : 'p-4'} overflow-hidden`}>
      <div className={`flex items-center gap-1.5 ${compact ? 'mb-1' : 'mb-2'}`}>
        <Icon size={compact ? 12 : 13} className={alert ? 'text-red-400' : 'text-theme-text-muted/50'} />
        <span className={`${compact ? 'text-[9px]' : 'text-[9px]'} font-semibold uppercase tracking-[0.13em] text-theme-text-muted/55`}>{label}</span>
      </div>
      <div className={`${compact ? 'text-[20px]' : 'text-[28px]'} font-bold text-theme-text font-mono leading-none truncate`} title={value}>{value}</div>
      <div className={`${compact ? 'text-[10px]' : 'text-[10px]'} text-theme-text-muted/70 mt-0.5 truncate`}>{subvalue}</div>
      {percent !== undefined && (
        <div className={`liquid-metal-progress-track rounded-full ${compact ? 'mt-1.5 h-[2px]' : 'mt-3 h-[4px]'} overflow-hidden`}>
          <div
            className={`h-full rounded-full transition-all ${progressTone}`}
            style={{ width: `${Math.min(percent, 100)}%` }}
          />
        </div>
      )}
    </div>
  )
})

const SERVICE_GROUP_STYLES = {
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

const ServiceGroup = memo(function ServiceGroup({ label, tone, services }) {
  const styles = SERVICE_GROUP_STYLES[tone]
  const isPrimaryGroup = tone === 'online'
  const [expanded, setExpanded] = useState(false)
  const visibleServices = isPrimaryGroup
    ? (expanded ? services : services.slice(0, 4))
    : (expanded ? services : [])
  const hiddenCount = Math.max(services.length - visibleServices.length, 0)
  const summaryNames = services.slice(0, 2).map(service => service.name).join(' · ')

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
          <p className={`text-[10px] font-semibold uppercase tracking-[0.18em] ${styles.text}`}>
            {label}
          </p>
          <span className="text-[10px] text-theme-text-muted/60">
            {services.length} {services.length === 1 ? 'service' : 'services'}
          </span>
        </div>
        {services.length > 0 && (
          <button
            type="button"
            onClick={() => setExpanded(current => !current)}
            className="text-[10px] font-mono uppercase tracking-[0.16em] text-theme-text-muted/65 transition-colors hover:text-theme-text"
          >
            {expanded ? 'Collapse' : 'Show all'}
          </button>
        )}
      </div>

      {visibleServices.length > 0 ? (
        <div className="mt-2 space-y-1">
          {visibleServices.map((service) => (
            <CompactServiceRow key={service.name} service={service} tone={tone} />
          ))}
          {!expanded && hiddenCount > 0 && (
            <p className="px-1 pt-0.5 text-[10px] uppercase tracking-[0.14em] text-theme-text-muted/45">
              +{hiddenCount} more
            </p>
          )}
        </div>
      ) : services.length === 0 ? (
        <p className="mt-2 text-[10px] uppercase tracking-[0.14em] text-theme-text-muted/40">
          Clear
        </p>
      ) : (
        <div className="mt-1.5 min-h-[1.75rem]">
          <p className="truncate text-[10px] uppercase tracking-[0.14em] text-theme-text-muted/52">
            {summaryNames}
            {services.length > 2 ? ` +${services.length - 2} more` : ''}
          </p>
        </div>
      )}
    </div>
  )
})

const CompactServiceRow = memo(function CompactServiceRow({ service, tone }) {
  const styles = SERVICE_GROUP_STYLES[tone]

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-white/6 bg-black/[0.1] px-2 py-1.5">
      <div className="flex min-w-0 items-center gap-2">
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${styles.dot}`} />
        <span className="truncate text-[11px] font-medium text-theme-text">{service.name}</span>
      </div>
      <div className="flex shrink-0 items-center gap-2 text-[9px] text-theme-text-muted/75">
        {service.port ? <span className="font-mono">:{service.port}</span> : null}
        <span className="font-mono uppercase tracking-[0.14em]">{formatUptime(service.uptime)}</span>
      </div>
    </div>
  )
})

// BootstrapBanner moved to App.jsx for app-wide visibility
