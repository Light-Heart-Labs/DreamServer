import { useState, useEffect, useCallback } from 'react'
import {
  Network, Play, Trash2, RefreshCw, AlertCircle, Check,
  Loader2, ChevronDown, ChevronUp, Clock, Zap
} from 'lucide-react'

const CATEGORY_COLORS = {
  automation: 'bg-indigo-500/20 text-indigo-400',
  ai: 'bg-purple-500/20 text-purple-400',
  data: 'bg-blue-500/20 text-blue-400',
  general: 'bg-zinc-700 text-zinc-300',
  communication: 'bg-green-500/20 text-green-400',
  monitoring: 'bg-amber-500/20 text-amber-400',
}

const STATUS_CONFIG = {
  active: { label: 'Active', color: 'bg-green-500/20 text-green-400', dot: 'bg-green-400' },
  installed: { label: 'Installed', color: 'bg-indigo-500/20 text-indigo-400', dot: 'bg-indigo-400' },
  available: { label: 'Available', color: 'bg-zinc-700 text-zinc-300', dot: 'bg-zinc-400' },
}

const FILTER_TABS = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'installed', label: 'Installed' },
  { key: 'available', label: 'Available' },
]

export default function Workflows() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [actionLoading, setActionLoading] = useState(null)
  const [filter, setFilter] = useState('all')

  const fetchWorkflows = useCallback(async () => {
    try {
      const resp = await fetch('/api/workflows')
      if (!resp.ok) throw new Error(`API error: ${resp.status}`)
      setData(await resp.json())
      setError(null)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchWorkflows() }, [fetchWorkflows])

  const handleAction = async (workflowId, url, method) => {
    setActionLoading(workflowId)
    try {
      const resp = await fetch(url, { method })
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}))
        throw new Error(body.detail || 'Request failed')
      }
      await fetchWorkflows()
    } catch (e) {
      setError(e.message)
    } finally {
      setActionLoading(null)
    }
  }

  const enableWorkflow = (id) => handleAction(id, `/api/workflows/${id}/enable`, 'POST')
  const disableWorkflow = (id) => handleAction(id, `/api/workflows/${id}`, 'DELETE')

  if (loading) {
    return (
      <div className="p-8">
        <div className="animate-pulse">
          <div className="h-8 bg-zinc-800 rounded w-1/3 mb-8" />
          <div className="space-y-4">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-40 bg-zinc-800 rounded-xl" />
            ))}
          </div>
        </div>
      </div>
    )
  }

  const workflows = data?.workflows || []
  const categories = data?.categories || {}
  const n8nAvailable = data?.n8nAvailable ?? false

  const filtered = filter === 'all'
    ? workflows
    : workflows.filter(wf => wf.status === filter)

  return (
    <div className="p-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Workflows</h1>
          <p className="text-zinc-400 mt-1">
            Automate tasks with pre-built n8n workflows.
          </p>
        </div>
        <button
          onClick={() => { setLoading(true); fetchWorkflows() }}
          className="p-2 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-lg transition-colors"
          title="Refresh"
        >
          <RefreshCw size={20} />
        </button>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-500/10 border border-red-500/30 rounded-xl text-red-400 text-sm flex items-center gap-2">
          <AlertCircle size={16} />
          {error}
          <button onClick={() => setError(null)} className="ml-auto text-red-400/60 hover:text-red-400">
            dismiss
          </button>
        </div>
      )}

      <div className={`mb-6 p-4 rounded-xl border ${
        n8nAvailable
          ? 'bg-green-500/5 border-green-500/30'
          : 'bg-yellow-500/5 border-yellow-500/30'
      }`}>
        <div className="flex items-center gap-3">
          <div className={`w-2.5 h-2.5 rounded-full ${n8nAvailable ? 'bg-green-400' : 'bg-yellow-400 animate-pulse'}`} />
          <span className={`text-sm ${n8nAvailable ? 'text-green-400' : 'text-yellow-400'}`}>
            {n8nAvailable ? 'n8n is running' : 'n8n is not reachable — workflows may be unavailable'}
          </span>
        </div>
      </div>

      <div className="flex gap-2 mb-6">
        {FILTER_TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => setFilter(tab.key)}
            className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
              filter === tab.key
                ? 'bg-indigo-600 text-white'
                : 'text-zinc-400 hover:text-white hover:bg-zinc-800'
            }`}
          >
            {tab.label}
            <span className="ml-1.5 text-xs opacity-60">
              {tab.key === 'all' ? workflows.length : workflows.filter(w => w.status === tab.key).length}
            </span>
          </button>
        ))}
      </div>

      <div className="grid gap-4">
        {filtered.map(wf => (
          <WorkflowCard
            key={wf.id}
            workflow={wf}
            categories={categories}
            isLoading={actionLoading === wf.id}
            onEnable={() => enableWorkflow(wf.id)}
            onDisable={() => disableWorkflow(wf.id)}
            n8nAvailable={n8nAvailable}
          />
        ))}
      </div>

      {filtered.length === 0 && (
        <div className="text-center py-12 text-zinc-500">
          {filter === 'all'
            ? 'No workflows found. Check your workflow catalog.'
            : `No ${filter} workflows.`}
        </div>
      )}
    </div>
  )
}

function WorkflowCard({ workflow, categories, isLoading, onEnable, onDisable, n8nAvailable }) {
  const [expanded, setExpanded] = useState(false)
  const statusCfg = STATUS_CONFIG[workflow.status] || STATUS_CONFIG.available
  const categoryLabel = categories[workflow.category]?.name || workflow.category
  const canEnable = workflow.allDependenciesMet && n8nAvailable
  const isRemovable = workflow.status === 'active' || workflow.status === 'installed'

  return (
    <div className={`p-6 bg-zinc-900/50 border rounded-xl transition-all ${
      workflow.status === 'active' ? 'border-green-500/30 bg-green-500/5' :
      workflow.status === 'installed' ? 'border-indigo-500/30' : 'border-zinc-800'
    }`}>
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-4">
          <div className={`p-3 rounded-lg ${
            workflow.status === 'active' ? 'bg-green-500/20' : 'bg-zinc-800'
          }`}>
            <Network size={24} className={
              workflow.status === 'active' ? 'text-green-400' : 'text-indigo-400'
            } />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h3 className="text-lg font-semibold text-white">{workflow.name}</h3>
              {workflow.featured && (
                <span className="px-1.5 py-0.5 text-xs bg-amber-500/20 text-amber-400 rounded flex items-center gap-1">
                  <Zap size={10} /> Featured
                </span>
              )}
            </div>

            <p className="text-sm text-zinc-500 mt-1">{workflow.description}</p>

            <div className="flex items-center gap-3 mt-3 text-sm text-zinc-400">
              <span className={`px-2 py-0.5 text-xs rounded ${CATEGORY_COLORS[workflow.category] || CATEGORY_COLORS.general}`}>
                {categoryLabel}
              </span>
              <span className={`px-2 py-0.5 text-xs rounded ${statusCfg.color}`}>
                {statusCfg.label}
              </span>
              {workflow.setupTime && (
                <span className="flex items-center gap-1 text-xs text-zinc-500">
                  <Clock size={12} /> {workflow.setupTime}
                </span>
              )}
              {workflow.executions > 0 && (
                <span className="text-xs text-zinc-500">
                  {workflow.executions} executions
                </span>
              )}
            </div>

            {workflow.dependencies?.length > 0 && (
              <div className="flex items-center gap-2 mt-3">
                <span className="text-xs text-zinc-500">Requires:</span>
                {workflow.dependencies.map(dep => {
                  const met = workflow.dependencyStatus?.[dep]
                  return (
                    <span key={dep} className={`px-2 py-0.5 text-xs rounded flex items-center gap-1 ${
                      met ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
                    }`}>
                      {met ? <Check size={10} /> : <AlertCircle size={10} />}
                      {dep}
                    </span>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 ml-4">
          {isLoading ? (
            <div className="px-4 py-2 bg-zinc-700 text-white rounded-lg">
              <Loader2 size={16} className="animate-spin" />
            </div>
          ) : isRemovable ? (
            <button
              onClick={onDisable}
              className="p-2 text-zinc-400 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
              title="Remove workflow"
            >
              <Trash2 size={16} />
            </button>
          ) : (
            <button
              onClick={onEnable}
              disabled={!canEnable}
              className={`px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors ${
                canEnable
                  ? 'bg-indigo-600 hover:bg-indigo-700 text-white'
                  : 'bg-zinc-700 text-zinc-500 cursor-not-allowed'
              }`}
              title={
                !n8nAvailable ? 'n8n is not available' :
                !workflow.allDependenciesMet ? 'Missing dependencies' :
                'Enable workflow'
              }
            >
              <Play size={16} />
              Enable
            </button>
          )}
        </div>
      </div>

      {workflow.diagram && Object.keys(workflow.diagram).length > 0 && (
        <div className="mt-4">
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            {expanded ? 'Hide' : 'Show'} workflow diagram
          </button>
          {expanded && (
            <div className="mt-3 p-4 bg-zinc-800/50 rounded-lg border border-zinc-700">
              <div className="flex items-center gap-2 flex-wrap font-mono text-xs text-zinc-400">
                {workflow.diagram.nodes?.map((node, i) => (
                  <span key={i} className="flex items-center gap-2">
                    {i > 0 && <span className="text-zinc-600">&rarr;</span>}
                    <span className="px-2 py-1 bg-zinc-700 rounded">{node}</span>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
