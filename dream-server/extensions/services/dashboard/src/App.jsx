import { Routes, Route } from 'react-router-dom'
import { useState, useEffect, Suspense, useMemo, useCallback } from 'react'
import Sidebar from './components/Sidebar'
import SetupWizard from './components/SetupWizard'
import { useSystemStatus } from './hooks/useSystemStatus'
import { useVersion } from './hooks/useVersion'
import { getInternalRoutes } from './plugins/registry'

function App() {
  const { status, loading, error } = useSystemStatus()
  const { version, dismissUpdate } = useVersion()
  const [firstRun, setFirstRun] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    return localStorage.getItem('dream-sidebar-collapsed') === 'true'
  })

  useEffect(() => {
    const hasVisited = localStorage.getItem('dream-dashboard-visited')
    if (!hasVisited) {
      setFirstRun(true)
    }
  }, [])

  useEffect(() => {
    localStorage.setItem('dream-sidebar-collapsed', sidebarCollapsed)
  }, [sidebarCollapsed])

  const dismissFirstRun = () => {
    localStorage.setItem('dream-dashboard-visited', 'true')
    setFirstRun(false)
  }

  const routes = useMemo(() => getInternalRoutes({ status, loading }), [status, loading])
  const handleToggle = useCallback(() => setSidebarCollapsed(c => !c), [])

  return (
    <div className="flex min-h-screen bg-[#0f0f13]">
      <Sidebar
        status={status}
        collapsed={sidebarCollapsed}
        onToggle={handleToggle}
      />

      <main className={`flex-1 transition-all duration-200 ${sidebarCollapsed ? 'ml-20' : 'ml-64'}`}>
        {firstRun && (
          <SetupWizard onComplete={dismissFirstRun} />
        )}

        {status?.bootstrap?.active && (
          <BootstrapBanner bootstrap={status.bootstrap} />
        )}

        <Suspense fallback={
          <div className="p-8 animate-pulse">
            <div className="h-8 bg-zinc-800 rounded w-1/3 mb-4" />
            <div className="grid grid-cols-3 gap-6">
              {[...Array(6)].map((_, i) => <div key={i} className="h-40 bg-zinc-800 rounded-xl" />)}
            </div>
          </div>
        }>
          <Routes>
            {routes.map(route => {
              const Component = route.component
              const props = typeof route.getProps === 'function' ? route.getProps({ status, loading }) : {}
              return (
                <Route
                  key={route.id || route.path}
                  path={route.path}
                  element={<Component {...props} />}
                />
              )
            })}
          </Routes>
        </Suspense>
      </main>
    </div>
  )
}

function BootstrapBanner({ bootstrap }) {
  const formatEta = (seconds) => {
    if (!seconds || seconds <= 0) return 'calculating...'
    if (seconds < 60) return `${seconds}s`
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
    const hours = Math.floor(seconds / 3600)
    const mins = Math.floor((seconds % 3600) / 60)
    return `${hours}h ${mins}m`
  }

  const formatBytes = (bytes) => {
    if (!bytes) return '0'
    return (bytes / 1e9).toFixed(1)
  }

  return (
    <div className="bg-gradient-to-r from-indigo-900/40 to-purple-900/40 border-b border-indigo-500/30 p-4">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <div className="w-3 h-3 bg-indigo-400 rounded-full animate-pulse" />
            <div>
              <h3 className="text-sm font-semibold text-white">Downloading Full Model</h3>
              <p className="text-xs text-zinc-400">
                Chat now with lightweight model • <span className="text-indigo-300">{bootstrap.model}</span> downloading
              </p>
            </div>
          </div>
          <div className="text-right">
            <span className="text-xl font-bold text-indigo-400">{bootstrap.percent?.toFixed(1) || 0}%</span>
            {bootstrap.speedMbps && (
              <p className="text-xs text-zinc-500">{bootstrap.speedMbps.toFixed(1)} MB/s</p>
            )}
          </div>
        </div>
        <div className="h-2 bg-zinc-700 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-indigo-500 to-purple-500 rounded-full transition-all duration-500"
            style={{ width: `${bootstrap.percent || 0}%` }}
          />
        </div>
        <p className="text-xs text-zinc-500 mt-2">
          ETA: {formatEta(bootstrap.eta)} • {formatBytes(bootstrap.bytesDownloaded)} / {formatBytes(bootstrap.bytesTotal)} GB
        </p>
      </div>
    </div>
  )
}

export default App
