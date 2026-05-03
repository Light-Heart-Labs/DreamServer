/**
 * Projects Page — Vikunja-backed project & task overview.
 *
 * Talks to the dashboard-api `/api/projects/*` proxy (which forwards to Vikunja
 * with the server-side VIKUNJA_API_TOKEN). The browser never sees the token.
 *
 * Features:
 *  - Lists all Vikunja projects
 *  - Click a project → tasks table with done-toggle
 *  - Quick-add task input
 *  - Health banner when Vikunja is unreachable / token missing
 */

import {
  ListChecks,
  Loader2,
  AlertCircle,
  CheckCircle,
  Plus,
  RefreshCw,
  ExternalLink,
  Square,
  CheckSquare,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

// Auth: nginx injects Authorization for /api/ requests.

function StatusBanner({ status, onRefresh }) {
  if (!status) return null

  if (status.available && status.configured) {
    return (
      <div className="mb-6 p-4 bg-green-500/10 border border-green-500/30 rounded-xl flex items-center justify-between">
        <div className="flex items-center gap-3">
          <CheckCircle size={18} className="text-green-400" />
          <span className="text-sm text-green-400">
            Vikunja ready{status.version ? ` (v${status.version})` : ''}
          </span>
        </div>
        <button onClick={onRefresh} className="text-green-400 hover:text-green-300" title="Refresh">
          <RefreshCw size={16} />
        </button>
      </div>
    )
  }

  if (!status.configured) {
    return (
      <div className="mb-6 p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-xl">
        <div className="flex items-start gap-3">
          <AlertCircle size={18} className="text-yellow-400 shrink-0 mt-0.5" />
          <div className="text-sm text-yellow-400">
            <p className="font-medium">VIKUNJA_API_TOKEN not configured</p>
            <p className="text-xs text-theme-text-muted mt-1">
              Open Vikunja, go to <em>Settings → API Tokens</em>, create a token with{' '}
              <code className="text-theme-text-secondary">write</code> scope on{' '}
              <code className="text-theme-text-secondary">projects</code> +{' '}
              <code className="text-theme-text-secondary">tasks</code>, then add it to{' '}
              <code className="text-theme-text-secondary">.env</code> as{' '}
              <code className="text-theme-text-secondary">VIKUNJA_API_TOKEN=tk_…</code>{' '}
              and run <code className="text-theme-text-secondary">dream restart vikunja dashboard-api</code>.
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="mb-6 p-4 bg-red-500/10 border border-red-500/30 rounded-xl flex items-center justify-between">
      <div className="flex items-center gap-3">
        <AlertCircle size={18} className="text-red-400" />
        <span className="text-sm text-red-400">{status.message || 'Vikunja unavailable'}</span>
      </div>
      <button onClick={onRefresh} className="text-red-400 hover:text-red-300" title="Refresh">
        <RefreshCw size={16} />
      </button>
    </div>
  )
}

function ProjectList({ projects, selectedId, onSelect }) {
  if (!projects?.length) {
    return (
      <div className="p-6 text-sm text-theme-text-muted">
        No projects yet. Create one in Vikunja to get started.
      </div>
    )
  }
  return (
    <ul className="divide-y divide-theme-border">
      {projects.map((p) => (
        <li key={p.id}>
          <button
            onClick={() => onSelect(p.id)}
            className={`w-full text-left px-4 py-3 hover:bg-theme-surface-hover transition-colors ${
              selectedId === p.id ? 'bg-theme-surface-hover' : ''
            }`}
          >
            <div className="text-sm text-theme-text font-medium truncate">{p.title || `Project #${p.id}`}</div>
            {p.description ? (
              <div className="text-xs text-theme-text-muted mt-0.5 line-clamp-1">{p.description}</div>
            ) : null}
          </button>
        </li>
      ))}
    </ul>
  )
}

function TaskRow({ task, onToggleDone }) {
  const Icon = task.done ? CheckSquare : Square
  return (
    <li className="flex items-start gap-3 px-4 py-3 border-b border-theme-border">
      <button
        onClick={() => onToggleDone(task)}
        className="mt-0.5 text-theme-text-muted hover:text-theme-accent transition-colors shrink-0"
        title={task.done ? 'Mark as open' : 'Mark as done'}
      >
        <Icon size={18} />
      </button>
      <div className="flex-1 min-w-0">
        <p
          className={`text-sm ${task.done ? 'line-through text-theme-text-muted' : 'text-theme-text'}`}
        >
          {task.title}
        </p>
        {task.description ? (
          <p className="text-xs text-theme-text-muted mt-0.5 line-clamp-2">{task.description}</p>
        ) : null}
      </div>
    </li>
  )
}

function QuickAddTask({ projectId, onAdded, disabled }) {
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  const submit = async (e) => {
    e.preventDefault()
    if (!title.trim() || disabled) return
    setBusy(true)
    setErr(null)
    const res = await fetch(`/api/projects/${projectId}/tasks`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: title.trim() }),
    })
    setBusy(false)
    if (!res.ok) {
      setErr(`Failed (HTTP ${res.status})`)
      return
    }
    setTitle('')
    onAdded()
  }

  return (
    <form onSubmit={submit} className="p-4 border-b border-theme-border bg-theme-card">
      <div className="flex gap-2">
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="New task…"
          disabled={disabled || busy}
          className="flex-1 bg-theme-card border border-theme-border rounded-lg px-3 py-2 text-sm text-theme-text disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={disabled || busy || !title.trim()}
          className="px-4 py-2 bg-theme-accent hover:bg-theme-accent-hover disabled:opacity-50 text-white rounded-lg text-sm flex items-center gap-1"
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
          Add
        </button>
      </div>
      {err ? <p className="text-xs text-red-400 mt-2">{err}</p> : null}
    </form>
  )
}

export default function Projects() {
  const [status, setStatus] = useState(null)
  const [projects, setProjects] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [tasks, setTasks] = useState([])
  const [loading, setLoading] = useState(true)
  const [tasksLoading, setTasksLoading] = useState(false)
  const [error, setError] = useState(null)

  const fetchStatus = useCallback(async () => {
    const res = await fetch('/api/projects/status')
    if (res.ok) setStatus(await res.json())
  }, [])

  const fetchProjects = useCallback(async () => {
    setLoading(true)
    setError(null)
    const res = await fetch('/api/projects')
    setLoading(false)
    if (!res.ok) {
      setError(`Failed to load projects (HTTP ${res.status})`)
      return
    }
    const data = await res.json()
    const list = Array.isArray(data) ? data : []
    setProjects(list)
    if (!selectedId && list.length) setSelectedId(list[0].id)
  }, [selectedId])

  const fetchTasks = useCallback(async (id) => {
    if (!id) return
    setTasksLoading(true)
    const res = await fetch(`/api/projects/${id}/tasks`)
    setTasksLoading(false)
    if (!res.ok) {
      setTasks([])
      return
    }
    const data = await res.json()
    setTasks(Array.isArray(data) ? data : [])
  }, [])

  useEffect(() => {
    fetchStatus()
    fetchProjects()
  }, [fetchStatus, fetchProjects])

  useEffect(() => {
    fetchTasks(selectedId)
  }, [selectedId, fetchTasks])

  const refresh = () => {
    fetchStatus()
    fetchProjects()
    if (selectedId) fetchTasks(selectedId)
  }

  const toggleDone = async (task) => {
    const res = await fetch(`/api/projects/tasks/${task.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ done: !task.done }),
    })
    if (res.ok) fetchTasks(selectedId)
  }

  const vikunjaUrl = status?.url || ''

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="p-6 border-b border-theme-border">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <ListChecks size={24} className="text-theme-accent" />
            <div>
              <h1 className="text-2xl font-bold text-theme-text">Projects</h1>
              <p className="text-theme-text-muted mt-1 text-sm">
                AI-managed projects & tasks (powered by Vikunja)
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={refresh}
              className="text-theme-text-muted hover:text-theme-text transition-colors"
              title="Refresh"
            >
              <RefreshCw size={18} />
            </button>
            {vikunjaUrl ? (
              <a
                href={vikunjaUrl}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1 text-sm text-theme-accent hover:underline"
              >
                Open Vikunja <ExternalLink size={14} />
              </a>
            ) : null}
          </div>
        </div>
      </div>

      <div className="px-6 pt-4">
        <StatusBanner status={status} onRefresh={refresh} />
      </div>

      {/* Error */}
      {error ? (
        <div className="mx-6 mb-4 p-4 bg-red-500/10 border border-red-500/30 rounded-xl flex items-start gap-3">
          <AlertCircle size={18} className="text-red-400 shrink-0 mt-0.5" />
          <p className="text-sm text-red-400">{error}</p>
        </div>
      ) : null}

      {/* Two-pane layout */}
      <div className="flex-1 flex min-h-0 px-6 pb-6 gap-6">
        {/* Project list */}
        <div className="w-72 shrink-0 bg-theme-card border border-theme-border rounded-xl overflow-y-auto">
          <div className="px-4 py-3 border-b border-theme-border text-xs uppercase tracking-wider text-theme-text-muted">
            Projects
          </div>
          {loading ? (
            <div className="flex items-center gap-2 p-4 text-sm text-theme-text-muted">
              <Loader2 size={14} className="animate-spin" /> Loading…
            </div>
          ) : (
            <ProjectList projects={projects} selectedId={selectedId} onSelect={setSelectedId} />
          )}
        </div>

        {/* Task pane */}
        <div className="flex-1 bg-theme-card border border-theme-border rounded-xl flex flex-col min-w-0">
          {selectedId ? (
            <>
              <QuickAddTask
                projectId={selectedId}
                onAdded={() => fetchTasks(selectedId)}
                disabled={!status?.available || !status?.configured}
              />
              <div className="flex-1 overflow-y-auto">
                {tasksLoading ? (
                  <div className="flex items-center gap-2 p-4 text-sm text-theme-text-muted">
                    <Loader2 size={14} className="animate-spin" /> Loading tasks…
                  </div>
                ) : tasks.length === 0 ? (
                  <div className="p-6 text-sm text-theme-text-muted">
                    No tasks yet. Add one above or create them via Open Claw.
                  </div>
                ) : (
                  <ul>
                    {tasks.map((t) => (
                      <TaskRow key={t.id} task={t} onToggleDone={toggleDone} />
                    ))}
                  </ul>
                )}
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-sm text-theme-text-muted">
              Select a project on the left.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

