import { useState, useEffect, useCallback } from 'react'
import {
  UserPlus, Copy, Check, Trash2, RefreshCw, QrCode, Share2, X,
  Loader2, AlertCircle, Clock, Users,
} from 'lucide-react'

// Auth: nginx injects "Authorization: Bearer ${DASHBOARD_API_KEY}" via
// proxy_set_header for all /api/ requests (see nginx.conf). All fetches
// use relative URLs so the proxy adds the header before forwarding to
// dashboard-api. No explicit auth in JS.

const fetchJson = async (url, init = {}, ms = 8000) => {
  const c = new AbortController()
  const t = setTimeout(() => c.abort(), ms)
  try {
    return await fetch(url, { ...init, signal: c.signal })
  } finally {
    clearTimeout(t)
  }
}

const SCOPES = [
  { value: 'chat', label: 'Chat only', help: 'Recipient can use the chat surface.' },
  { value: 'dashboard', label: 'Dashboard + chat', help: 'Recipient also sees the admin dashboard. Use sparingly.' },
  { value: 'all', label: 'Full access', help: 'Everything. Treat like a co-admin invite.' },
]

const EXPIRY_PRESETS = [
  { value: 900, label: '15 minutes' },
  { value: 3600, label: '1 hour' },
  { value: 86400, label: '24 hours' },
]

function formatRelative(iso) {
  if (!iso) return null
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return null
  const diff = t - Date.now()
  const abs = Math.abs(diff)
  const minutes = Math.round(abs / 60_000)
  const hours = Math.round(abs / 3_600_000)
  const future = diff > 0
  if (minutes < 1) return future ? 'in seconds' : 'just now'
  if (minutes < 60) return future ? `in ${minutes}m` : `${minutes}m ago`
  if (hours < 24) return future ? `in ${hours}h` : `${hours}h ago`
  const days = Math.round(abs / 86_400_000)
  return future ? `in ${days}d` : `${days}d ago`
}

function tokenStatus(token) {
  if (token.revoked_at) return { label: 'revoked', tone: 'bg-theme-border text-theme-text-muted' }
  if (new Date(token.expires_at).getTime() < Date.now()) {
    return { label: 'expired', tone: 'bg-theme-border text-theme-text-muted' }
  }
  if (token.redemption_count > 0 && !token.reusable) {
    return { label: 'used', tone: 'bg-theme-border text-theme-text-muted' }
  }
  if (token.redemption_count > 0) {
    return { label: `reused × ${token.redemption_count}`, tone: 'bg-blue-500/20 text-blue-400' }
  }
  return { label: 'active', tone: 'bg-green-500/20 text-green-400' }
}

export default function Invites() {
  const [tokens, setTokens] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showCreate, setShowCreate] = useState(false)
  const [generated, setGenerated] = useState(null)
  const [refreshing, setRefreshing] = useState(false)

  const refresh = useCallback(async () => {
    setRefreshing(true)
    try {
      const resp = await fetchJson('/api/auth/magic-link/list')
      if (!resp.ok) throw new Error(`list failed: ${resp.status}`)
      const data = await resp.json()
      setTokens(data.tokens || [])
      setError(null)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const handleRevoke = async (prefix) => {
    try {
      const resp = await fetchJson(`/api/auth/magic-link/${prefix}`, { method: 'DELETE' })
      if (!resp.ok && resp.status !== 404) {
        const body = await resp.json().catch(() => ({}))
        throw new Error(body.detail || `revoke failed: ${resp.status}`)
      }
      await refresh()
    } catch (err) {
      setError(err.message)
    }
  }

  if (loading) {
    return (
      <div className="p-8">
        <div className="animate-pulse">
          <div className="h-8 bg-theme-card rounded w-1/3 mb-8" />
          <div className="h-24 bg-theme-card rounded-xl mb-4" />
          <div className="space-y-3">
            {[...Array(3)].map((_, i) => <div key={i} className="h-20 bg-theme-card rounded-xl" />)}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="p-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-theme-text">Invites</h1>
          <p className="text-theme-text-muted mt-1">
            Share single-use magic links so other people can reach Dream Server without an account flow.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={refresh}
            disabled={refreshing}
            className="p-2 text-theme-text-muted hover:text-theme-text hover:bg-theme-surface-hover rounded-lg transition-colors disabled:opacity-50"
            title="Refresh"
            aria-label="Refresh invites"
          >
            <RefreshCw size={20} className={refreshing ? 'animate-spin' : ''} />
          </button>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 bg-theme-accent text-white px-4 py-2 rounded-lg hover:opacity-90 transition-opacity"
          >
            <UserPlus size={18} />
            New invite
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-500/10 border border-red-500/30 rounded-xl text-red-400 text-sm flex items-start gap-2">
          <AlertCircle size={18} className="flex-shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {tokens.length === 0 ? (
        <EmptyState onCreate={() => setShowCreate(true)} />
      ) : (
        <div className="space-y-3">
          {tokens.map(t => (
            <InviteRow key={t.token_hash_prefix} token={t} onRevoke={() => handleRevoke(t.token_hash_prefix)} />
          ))}
        </div>
      )}

      {showCreate && (
        <CreateInviteModal
          onClose={() => setShowCreate(false)}
          onCreated={(record) => {
            setShowCreate(false)
            setGenerated(record)
            refresh()
          }}
        />
      )}

      {generated && (
        <GeneratedInviteModal
          record={generated}
          onClose={() => setGenerated(null)}
        />
      )}
    </div>
  )
}

function EmptyState({ onCreate }) {
  return (
    <div className="bg-theme-card border border-theme-border rounded-xl p-12 text-center">
      <Users size={40} className="mx-auto mb-4 text-theme-text-muted" />
      <h3 className="text-lg font-semibold text-theme-text mb-2">No invites yet</h3>
      <p className="text-sm text-theme-text-muted mb-6 max-w-md mx-auto">
        Generate a magic link to let someone reach the chat surface from their phone.
        They scan a QR or tap a link — no account, no password, no app store.
      </p>
      <button
        onClick={onCreate}
        className="inline-flex items-center gap-2 bg-theme-accent text-white px-4 py-2 rounded-lg hover:opacity-90 transition-opacity"
      >
        <UserPlus size={18} />
        Create your first invite
      </button>
    </div>
  )
}

function InviteRow({ token, onRevoke }) {
  const status = tokenStatus(token)
  const expires = formatRelative(token.expires_at)
  const lastRedeemed = formatRelative(token.last_redeemed_at)
  const isActive = status.label === 'active' || status.label.startsWith('reused')

  return (
    <div className="bg-theme-card border border-theme-border rounded-xl p-4 flex items-center justify-between gap-4">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <span className="font-medium text-theme-text">{token.target_username}</span>
          <span className={`text-xs px-2 py-0.5 rounded ${status.tone}`}>{status.label}</span>
          {token.reusable && (
            <span className="text-xs px-2 py-0.5 rounded bg-purple-500/20 text-purple-300">reusable</span>
          )}
          <span className="text-xs text-theme-text-muted">scope: {token.scope}</span>
        </div>
        {token.note && (
          <p className="text-xs text-theme-text-muted mb-1 truncate">{token.note}</p>
        )}
        <div className="flex items-center gap-3 text-xs text-theme-text-muted">
          <span className="inline-flex items-center gap-1">
            <Clock size={12} />
            expires {expires}
          </span>
          {lastRedeemed && (
            <span>last used {lastRedeemed}</span>
          )}
          <span className="font-mono opacity-70">{token.token_hash_prefix}…</span>
        </div>
      </div>
      {isActive && (
        <button
          onClick={onRevoke}
          className="p-2 text-theme-text-muted hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
          title="Revoke"
          aria-label={`Revoke invite for ${token.target_username}`}
        >
          <Trash2 size={18} />
        </button>
      )}
    </div>
  )
}

function CreateInviteModal({ onClose, onCreated }) {
  const [username, setUsername] = useState('')
  const [scope, setScope] = useState('chat')
  const [expiresIn, setExpiresIn] = useState(3600)
  const [reusable, setReusable] = useState(false)
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState(null)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setFormError(null)
    const trimmed = username.trim()
    if (!/^[A-Za-z0-9._-]+$/.test(trimmed)) {
      setFormError('Username may only contain letters, numbers, dot, dash, and underscore.')
      return
    }
    setSubmitting(true)
    try {
      const resp = await fetchJson('/api/auth/magic-link/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          target_username: trimmed,
          scope,
          expires_in: expiresIn,
          reusable,
          note: note.trim() || null,
        }),
      })
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}))
        const detail = Array.isArray(body.detail) ? body.detail[0]?.msg : body.detail
        throw new Error(detail || `generate failed: ${resp.status}`)
      }
      const data = await resp.json()
      onCreated(data)
    } catch (err) {
      setFormError(err.message)
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <form
        onSubmit={handleSubmit}
        className="bg-theme-card border border-theme-border rounded-xl p-6 w-full max-w-md"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Create invite"
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-theme-text">Create invite</h2>
          <button type="button" onClick={onClose} className="text-theme-text-muted hover:text-theme-text" aria-label="Close">
            <X size={20} />
          </button>
        </div>

        <label className="block mb-3">
          <span className="text-sm text-theme-text-muted">Username</span>
          <input
            type="text"
            value={username}
            onChange={e => setUsername(e.target.value)}
            required
            autoFocus
            placeholder="alice"
            className="mt-1 w-full bg-theme-bg border border-theme-border rounded-lg px-3 py-2 text-theme-text focus:outline-none focus:border-theme-accent"
            maxLength={64}
          />
          <span className="text-xs text-theme-text-muted">
            Open WebUI will use this as the display name when the recipient lands on chat.
          </span>
        </label>

        <label className="block mb-3">
          <span className="text-sm text-theme-text-muted">Access scope</span>
          <select
            value={scope}
            onChange={e => setScope(e.target.value)}
            className="mt-1 w-full bg-theme-bg border border-theme-border rounded-lg px-3 py-2 text-theme-text focus:outline-none focus:border-theme-accent"
          >
            {SCOPES.map(s => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
          <span className="text-xs text-theme-text-muted">
            {SCOPES.find(s => s.value === scope)?.help}
          </span>
        </label>

        <label className="block mb-3">
          <span className="text-sm text-theme-text-muted">Expires in</span>
          <select
            value={expiresIn}
            onChange={e => setExpiresIn(parseInt(e.target.value, 10))}
            className="mt-1 w-full bg-theme-bg border border-theme-border rounded-lg px-3 py-2 text-theme-text focus:outline-none focus:border-theme-accent"
          >
            {EXPIRY_PRESETS.map(p => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>
        </label>

        <label className="flex items-start gap-2 mb-3 cursor-pointer">
          <input
            type="checkbox"
            checked={reusable}
            onChange={e => setReusable(e.target.checked)}
            className="mt-1"
          />
          <span className="text-sm">
            <span className="text-theme-text">Reusable</span>
            <span className="block text-xs text-theme-text-muted">
              Multiple people can redeem this link until it expires (e.g. a family share poster).
              Each redemption is logged.
            </span>
          </span>
        </label>

        <label className="block mb-4">
          <span className="text-sm text-theme-text-muted">Note (optional)</span>
          <input
            type="text"
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="for mom's iPad"
            maxLength={200}
            className="mt-1 w-full bg-theme-bg border border-theme-border rounded-lg px-3 py-2 text-theme-text focus:outline-none focus:border-theme-accent"
          />
        </label>

        {formError && (
          <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm flex items-start gap-2">
            <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
            <span>{formError}</span>
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-theme-text-muted hover:text-theme-text"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting || !username.trim()}
            className="flex items-center gap-2 bg-theme-accent text-white px-4 py-2 rounded-lg hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {submitting && <Loader2 size={16} className="animate-spin" />}
            Generate
          </button>
        </div>
      </form>
    </div>
  )
}

function GeneratedInviteModal({ record, onClose }) {
  const [copied, setCopied] = useState(false)
  const [qrDataUrl, setQrDataUrl] = useState(null)
  const [qrError, setQrError] = useState(null)

  useEffect(() => {
    let cancelled = false
    const loadQr = async () => {
      try {
        const resp = await fetchJson(
          `/api/auth/magic-link/qr?url=${encodeURIComponent(record.url)}`,
        )
        if (!resp.ok) {
          // 503 means the qrcode python lib isn't installed — fall back gracefully.
          setQrError('QR generation unavailable on the server.')
          return
        }
        const data = await resp.json()
        if (!cancelled) setQrDataUrl(data.data_url)
      } catch (err) {
        if (!cancelled) setQrError(err.message)
      }
    }
    loadQr()
    return () => { cancelled = true }
  }, [record.url])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(record.url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Fallback: select the input so the user can ctrl-c manually.
    }
  }

  const share = async () => {
    if (!navigator.share) {
      copy()
      return
    }
    try {
      await navigator.share({
        title: `Dream Server invite for ${record.target_username}`,
        text: 'Tap to open Dream Server',
        url: record.url,
      })
    } catch {
      // User cancelled the share sheet — no-op.
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-theme-card border border-theme-border rounded-xl p-6 w-full max-w-lg"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Invite created"
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-theme-text">Invite ready for {record.target_username}</h2>
          <button onClick={onClose} className="text-theme-text-muted hover:text-theme-text" aria-label="Close">
            <X size={20} />
          </button>
        </div>

        <p className="text-sm text-theme-text-muted mb-4">
          Share this link <strong className="text-theme-text">once</strong> — the recipient&apos;s first tap consumes it.
          {record.reusable && ' This is a reusable invite; every redemption is logged.'}
        </p>

        {qrDataUrl ? (
          <div className="bg-white p-4 rounded-xl flex justify-center mb-4">
            <img src={qrDataUrl} alt="QR code for invite link" className="w-56 h-56" />
          </div>
        ) : (
          <div className="bg-theme-bg border border-theme-border rounded-xl p-6 flex flex-col items-center justify-center mb-4 min-h-56">
            <QrCode size={48} className="text-theme-text-muted mb-2" />
            <p className="text-xs text-theme-text-muted text-center">
              {qrError || 'Generating QR code…'}
            </p>
          </div>
        )}

        <label className="block mb-4">
          <span className="text-xs text-theme-text-muted">Invite URL</span>
          <div className="mt-1 flex gap-2">
            <input
              type="text"
              readOnly
              value={record.url}
              onFocus={e => e.target.select()}
              className="flex-1 bg-theme-bg border border-theme-border rounded-lg px-3 py-2 text-theme-text font-mono text-xs"
            />
            <button
              onClick={copy}
              className="flex items-center gap-1 px-3 py-2 bg-theme-bg border border-theme-border rounded-lg text-theme-text hover:bg-theme-surface-hover text-sm"
              title="Copy link"
            >
              {copied ? <Check size={16} className="text-green-400" /> : <Copy size={16} />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        </label>

        <div className="flex justify-between items-center">
          <p className="text-xs text-theme-text-muted">
            Expires {formatRelative(record.expires_at)}
          </p>
          <div className="flex gap-2">
            {typeof navigator !== 'undefined' && navigator.share && (
              <button
                onClick={share}
                className="flex items-center gap-2 px-4 py-2 bg-theme-bg border border-theme-border rounded-lg text-theme-text hover:bg-theme-surface-hover text-sm"
              >
                <Share2 size={16} />
                Share
              </button>
            )}
            <button
              onClick={onClose}
              className="px-4 py-2 bg-theme-accent text-white rounded-lg hover:opacity-90 text-sm"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
