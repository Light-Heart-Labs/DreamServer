import { NavLink } from 'react-router-dom'
import { useEffect, useMemo, useState } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  Palette
} from 'lucide-react'
import { getSidebarExternalLinks, getSidebarNavItems } from '../plugins/registry'
import { useTheme } from '../contexts/ThemeContext'

// Derive external service URLs from current host
const getExternalUrl = (port) =>
  typeof window !== 'undefined'
    ? `http://${window.location.hostname}:${port}`
    : `http://localhost:${port}`

export default function Sidebar({ status, collapsed, onToggle }) {
  const { theme, cycleTheme, labels } = useTheme()
  const [serviceTokens, setServiceTokens] = useState({})
  const [apiLinks, setApiLinks] = useState([])

  useEffect(() => {
    fetch('/api/service-tokens')
      .then(r => r.ok ? r.json() : {})
      .then(setServiceTokens)
      .catch(() => {})

    fetch('/api/external-links')
      .then(r => r.ok ? r.json() : [])
      .then(setApiLinks)
      .catch(() => {})
  }, [])

  const navItems = useMemo(
    () => getSidebarNavItems({ status }),
    [status]
  )

  // Compute external links with auto-auth tokens (e.g. OpenClaw ?token=xxx)
  const externalLinks = useMemo(() => {
    const links = getSidebarExternalLinks({ status, getExternalUrl, apiLinks })
    return links.map(link => {
      if (link.key === 'openclaw' && serviceTokens.openclaw) {
        return { ...link, url: `${link.url}/?token=${serviceTokens.openclaw}` }
      }
      return link
    })
  }, [status, serviceTokens, apiLinks])

  // Service counts with degraded nuance
  const services = status?.services || []
  const deployed = services.filter(s => s.status !== 'not_deployed')
  const onlineCount = deployed.filter(s => s.status === 'healthy' || s.status === 'degraded').length
  const degradedCount = deployed.filter(s => s.status === 'degraded').length
  const totalCount = deployed.length

  // Memory bar: use unified (RAM) stats on APUs, VRAM on discrete
  const isUnified = status?.gpu?.memoryType === 'unified'
  const memPct = isUnified
    ? (status?.ram?.percent || 0)
    : status?.gpu?.vramTotal > 0
      ? (status.gpu.vramUsed / status.gpu.vramTotal) * 100
      : 0
  const memUsed = isUnified ? (status?.ram?.used_gb || 0) : (status?.gpu?.vramUsed || 0)
  const memTotal = isUnified ? (status?.ram?.total_gb || 0) : (status?.gpu?.vramTotal || 0)
  const memLabel = isUnified ? 'Memory' : 'VRAM'
  const memColor = memPct > 90 ? 'bg-red-500' : memPct > 75 ? 'bg-yellow-500' : 'bg-theme-accent'

  // Footer status color
  const footerColor = degradedCount > 0
    ? 'text-yellow-500'
    : onlineCount === totalCount
      ? 'text-green-500'
      : totalCount > 0
        ? 'text-yellow-500'
        : 'text-theme-text-muted'

  return (
    <aside className={`fixed left-0 top-0 h-screen ${collapsed ? 'w-20' : 'w-64'} bg-theme-sidebar border-r border-theme-border flex flex-col transition-all duration-200`}>
      {/* Logo */}
      <div className="px-4 pt-5 pb-4 border-b border-theme-border overflow-hidden">
        {collapsed ? (
          <div className="flex flex-col items-center">
            <span className="text-lg font-extrabold text-theme-text font-mono tracking-tight">DS</span>
            <p className="text-[8px] text-theme-text-muted font-mono mt-0.5">
              v{status?.version || '...'}
            </p>
          </div>
        ) : (
          <>
            <pre aria-hidden="true" className="text-[7.5px] leading-[8px] text-theme-text font-mono whitespace-pre select-none">{`    ____
   / __ \\ _____ ___   ____ _ ____ ___
  / / / // ___// _ \\ / __ \`// __ \`__ \\
 / /_/ // /   /  __// /_/ // / / / / /
/_____//_/    \\___/ \\__,_//_/ /_/ /_/
    _____
   / ___/ ___   _____ _   __ ___   _____
   \\__ \\ / _ \\ / ___/| | / // _ \\ / ___/
  ___/ //  __// /    | |/ //  __// /
 /____/ \\___//_/     |___/ \\___//_/`}</pre>
            <p className="text-[8px] text-theme-text-secondary font-mono tracking-wider mt-1.5">
              LOCAL AI // SOVEREIGN INTELLIGENCE
            </p>
            <p className="text-[10px] text-theme-text-secondary mt-1">
              {status?.tier || 'Loading...'} • v{status?.version || '...'}
            </p>
          </>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-4 overflow-y-auto overflow-x-hidden">
        <ul className="space-y-1">
          {navItems.map(({ path, icon: Icon, label }) => (
            <li key={path}>
              <NavLink
                to={path}
                title={collapsed ? label : undefined}
                className={({ isActive }) =>
                  `flex items-center ${collapsed ? 'justify-center' : ''} gap-3 px-3 py-2.5 rounded-lg transition-colors ${
                    isActive
                      ? 'bg-theme-accent text-white relative before:content-[""] before:absolute before:left-0 before:top-2 before:bottom-2 before:w-1 before:bg-theme-accent-light before:rounded-r'
                      : 'text-theme-text-muted hover:text-theme-text hover:bg-theme-surface-hover'
                  }`
                }
              >
                <Icon size={20} />
                {!collapsed && <span>{label}</span>}
              </NavLink>
            </li>
          ))}
        </ul>

        {/* External Links — hidden when collapsed */}
        {!collapsed && (
          <div className="mt-6 pt-6 border-t border-theme-border">
            <p className="px-3 text-xs font-medium text-theme-text-muted uppercase mb-2">
              Quick Links
            </p>
            <ul className="space-y-1">
              {externalLinks.map(({ key, url, icon: Icon, label, healthy }) => (
                <li key={key}>
                  <a
                    href={healthy ? url : undefined}
                    onClick={(e) => { if (!healthy) e.preventDefault() }}
                    target={healthy ? '_blank' : undefined}
                    rel={healthy ? 'noopener noreferrer' : undefined}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors ${
                      healthy
                        ? 'text-theme-text-muted hover:text-theme-text hover:bg-theme-surface-hover'
                        : 'text-theme-text-muted opacity-40 cursor-not-allowed'
                    }`}
                  >
                    <Icon size={20} />
                    <span>{label}</span>
                    <span className={`ml-auto text-[10px] font-mono ${healthy ? 'text-theme-text-muted' : 'text-theme-text-muted'}`}>
                      {healthy ? 'OPEN' : 'OFFLINE'}
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}
      </nav>

      {/* Theme + Toggle buttons */}
      <div className="mx-4 mb-2 flex items-center gap-1">
        <button
          onClick={cycleTheme}
          className="flex items-center justify-center p-2 rounded-lg text-theme-text-muted hover:text-theme-text hover:bg-theme-surface-hover transition-colors"
          title={`Theme: ${labels[theme]} (click to cycle)`}
        >
          <Palette size={18} />
        </button>
        {!collapsed && (
          <span className="text-xs text-theme-text-muted">{labels[theme]}</span>
        )}
        <button
          onClick={onToggle}
          className="ml-auto flex items-center justify-center p-2 rounded-lg text-theme-text-muted hover:text-theme-text hover:bg-theme-surface-hover transition-colors"
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
        </button>
      </div>

      {/* Status Footer */}
      <div className="p-4 border-t border-theme-border">
        {!collapsed && (
          <div className="flex items-center justify-between text-sm mb-2">
            <span className="text-theme-text-muted">Services</span>
            <span className={footerColor}>
              {degradedCount > 0
                ? `Online: ${onlineCount}/${totalCount} · ${degradedCount} degraded`
                : `Online: ${onlineCount}/${totalCount}`
              }
            </span>
          </div>
        )}
        {(status?.gpu || (isUnified && status?.ram)) && (
          <div>
            {!collapsed && (
              <div className="flex items-center justify-between text-xs text-theme-text-muted mb-1">
                <span>{memLabel}</span>
                <span className="font-mono">{memUsed.toFixed ? memUsed.toFixed(1) : memUsed}/{memTotal.toFixed ? memTotal.toFixed(0) : memTotal} GB</span>
              </div>
            )}
            <div className="h-1.5 bg-theme-border rounded-full overflow-hidden" title={collapsed ? `${memLabel}: ${memUsed.toFixed ? memUsed.toFixed(1) : memUsed}/${memTotal.toFixed ? memTotal.toFixed(0) : memTotal} GB` : undefined}>
              <div
                className={`h-full ${memColor} rounded-full transition-all`}
                style={{ width: `${Math.min(memPct, 100)}%` }}
              />
            </div>
          </div>
        )}
      </div>
    </aside>
  )
}
