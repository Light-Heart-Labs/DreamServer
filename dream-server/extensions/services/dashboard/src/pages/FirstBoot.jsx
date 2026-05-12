// Phone-first first-boot wizard.
//
// Lives at /setup. App.jsx routes here when useFirstRun() says
// firstRun=true and locks all other routes out. Single-column,
// large tap targets, big text — the user is most likely on a
// phone scanning the device's setup link.
//
// Screens (non-AP-mode):
//   1. Welcome — name your device (DREAM_DEVICE_NAME)
//   2. First user — username for the initial magic-link invite
//   3. Pick your stack — chat-only / chat+agents / everything
//   4. Confirm + Finish → Done (magic-link QR)
//
// Screens when in AP mode (PR-10) — an extra step prepended:
//   0. WiFi handoff — collect home WiFi credentials (text inputs, no scan
//      since the AP interface is busy hosting). Applied at the END.
//   1-4 as above.
//   On Finish: generates the magic-link, flips the sentinel, AND triggers
//   the WiFi handoff via /api/setup/wifi-handoff. The Done screen shows
//   a "switching networks" notice — the user's phone will drop the AP
//   and rejoin its home network, then can scan the QR there.
//
// Progress is mirrored to localStorage so a phone refresh doesn't
// lose state mid-wizard. The server-side flip happens only on the
// final "Finish" tap, via /api/setup/complete.

import { useEffect, useMemo, useState } from 'react'
import {
  Sparkles, User, Layers, Check, ChevronRight, ChevronLeft,
  MessageSquare, Workflow, Boxes, Loader2, AlertCircle, Copy,
  QrCode, Share2, Wifi, ArrowRightLeft,
} from 'lucide-react'

const PROGRESS_KEY = 'dream-firstboot-progress'

const STACK_OPTIONS = [
  {
    id: 'chat',
    title: 'Chat only',
    blurb: 'Just the chat surface — fastest setup, smallest footprint.',
    Icon: MessageSquare,
  },
  {
    id: 'chat-agents',
    title: 'Chat + Agents',
    blurb: 'Adds n8n workflows and the agent runtime so models can do work for you.',
    Icon: Workflow,
  },
  {
    id: 'everything',
    title: 'Everything',
    blurb: 'Voice in/out, image generation, search, the whole stack. Take some time to download.',
    Icon: Boxes,
  },
]

// Step counts vary by AP-mode flag. The WiFi step is step 0 (prepended)
// when present, then welcome / user / stack / confirm follow as 1-4.
const TOTAL_STEPS_NORMAL = 4
const TOTAL_STEPS_AP = 5

function readProgress() {
  try {
    const raw = globalThis.localStorage?.getItem(PROGRESS_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function writeProgress(progress) {
  try {
    globalThis.localStorage?.setItem(PROGRESS_KEY, JSON.stringify(progress))
  } catch {
    // localStorage may be blocked in private windows — wizard still works.
  }
}

function clearProgress() {
  try {
    globalThis.localStorage?.removeItem(PROGRESS_KEY)
  } catch {
    // Ignore.
  }
}

export default function FirstBoot({ onComplete }) {
  const initial = useMemo(() => readProgress() || {}, [])
  const [step, setStep] = useState(initial.step || 1)
  const [deviceName, setDeviceName] = useState(initial.deviceName || 'dream')
  const [username, setUsername] = useState(initial.username || '')
  const [stack, setStack] = useState(initial.stack || 'chat')
  // Home WiFi credentials — only collected when in AP mode. We collect them
  // BEFORE the rest of the wizard runs and APPLY them at the very end so
  // the network handoff happens after the magic-link is generated (and
  // shown to the user, who needs to save it before connectivity drops).
  const [homeSsid, setHomeSsid] = useState(initial.homeSsid || '')
  const [homePassword, setHomePassword] = useState(initial.homePassword || '')
  const [finishing, setFinishing] = useState(false)
  const [finishError, setFinishError] = useState(null)
  const [invite, setInvite] = useState(null)
  const [apMode, setApMode] = useState(null)  // null = unknown, {} = inactive, {...} = active

  // Detect whether the wizard is being served by a device that's hosting
  // its own setup AP. If so, we add a WiFi-handoff step at the start.
  useEffect(() => {
    let cancelled = false
    fetch('/api/setup/ap-mode-status')
      .then(r => r.ok ? r.json() : { status: 'inactive' })
      .then(data => { if (!cancelled) setApMode(data) })
      .catch(() => { if (!cancelled) setApMode({ status: 'inactive' }) })
    return () => { cancelled = true }
  }, [])

  const inApMode = apMode?.status === 'active'
  const totalSteps = inApMode ? TOTAL_STEPS_AP : TOTAL_STEPS_NORMAL

  // Persist progress whenever the user moves forward.
  useEffect(() => {
    writeProgress({ step, deviceName, username, stack, homeSsid, homePassword })
  }, [step, deviceName, username, stack, homeSsid, homePassword])

  const next = () => setStep(s => Math.min(s + 1, totalSteps))
  const prev = () => setStep(s => Math.max(s - 1, 1))

  const finish = async () => {
    setFinishing(true)
    setFinishError(null)
    try {
      // Generate the first magic-link for the named user. Reuses PR-4's
      // backend; this is the same endpoint /Invites consumes.
      const genResp = await fetch('/api/auth/magic-link/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          target_username: username,
          scope: 'chat',
          expires_in: 86400, // 24h — the wizard target may not redeem immediately
          reusable: false,
          note: 'First-boot invite',
        }),
      })
      if (!genResp.ok) {
        const body = await genResp.json().catch(() => ({}))
        throw new Error(body.detail || `generate failed: ${genResp.status}`)
      }
      const inviteData = await genResp.json()

      // Flip the server-side sentinel so this device is "configured".
      await fetch('/api/setup/complete', { method: 'POST' })

      // AP-mode only: trigger the home-WiFi handoff. The host-agent does
      // this on a background thread and returns 202 immediately; the wizard
      // shell will lose connectivity a few seconds later when the AP tears
      // down. The Done screen tells the user what to expect.
      let handoffStarted = false
      if (inApMode && homeSsid) {
        try {
          await fetch('/api/setup/wifi-handoff', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ssid: homeSsid, password: homePassword }),
          })
          handoffStarted = true
        } catch {
          // Handoff scheduling failure is non-fatal — show the invite anyway.
          // The user can connect manually from their existing network.
        }
      }

      setInvite({ ...inviteData, handoffStarted })
      clearProgress()
      // Stay on the success screen until the user taps "Open chat" or "Done"
      // — calling onComplete() immediately would route them away before they
      // can copy the QR. onComplete fires on the final tap.
    } catch (err) {
      setFinishError(err.message)
    } finally {
      setFinishing(false)
    }
  }

  const handleDone = () => {
    onComplete?.()
  }

  // Step mapping. When in AP mode, step 1 is the WiFi-handoff step and
  // everything shifts by 1. When NOT in AP mode, step 1 is Welcome and
  // there are 4 total steps.
  const shift = inApMode ? 1 : 0
  return (
    <div className="min-h-screen bg-theme-bg flex flex-col">
      <header className="px-6 pt-8 pb-4 flex items-center justify-between">
        <div className="font-mono text-sm font-bold text-theme-accent tracking-widest">DREAM SERVER</div>
        {!invite && <StepDots step={step} total={totalSteps} />}
      </header>

      {inApMode && !invite && (
        <div className="mx-6 mb-2 px-4 py-2 rounded-lg bg-theme-accent/15 text-theme-accent text-sm flex items-center gap-2">
          <Wifi size={16} />
          <span>You&apos;re on Dream&apos;s setup Wi-Fi. We&apos;ll switch you to your home network at the end.</span>
        </div>
      )}

      <main className="flex-1 flex items-stretch px-6 pb-8">
        <div className="w-full max-w-md mx-auto flex flex-col justify-center">
          {invite ? (
            <DoneScreen invite={invite} onDone={handleDone} deviceName={deviceName.trim() || 'dream'} />
          ) : (
            <>
              {inApMode && step === 1 && (
                <WifiStep
                  homeSsid={homeSsid}
                  setHomeSsid={setHomeSsid}
                  homePassword={homePassword}
                  setHomePassword={setHomePassword}
                  onNext={next}
                />
              )}
              {step === 1 + shift && (
                <WelcomeStep
                  deviceName={deviceName}
                  setDeviceName={setDeviceName}
                  onNext={next}
                  onBack={inApMode ? prev : undefined}
                />
              )}
              {step === 2 + shift && (
                <UserStep
                  username={username}
                  setUsername={setUsername}
                  onNext={next}
                  onBack={prev}
                />
              )}
              {step === 3 + shift && (
                <StackStep
                  stack={stack}
                  setStack={setStack}
                  onNext={next}
                  onBack={prev}
                />
              )}
              {step === 4 + shift && (
                <ConfirmStep
                  deviceName={deviceName}
                  username={username}
                  stack={stack}
                  inApMode={inApMode}
                  homeSsid={homeSsid}
                  onBack={prev}
                  onFinish={finish}
                  finishing={finishing}
                  error={finishError}
                />
              )}
            </>
          )}
        </div>
      </main>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Step (AP-mode only) — collect home WiFi credentials
// ---------------------------------------------------------------------------

function WifiStep({ homeSsid, setHomeSsid, homePassword, setHomePassword, onNext }) {
  const valid = homeSsid.trim().length >= 1 && homeSsid.trim().length <= 32
  return (
    <div>
      <div className="w-16 h-16 rounded-2xl bg-theme-accent/15 text-theme-accent flex items-center justify-center mb-6">
        <Wifi size={32} />
      </div>
      <h1 className="text-3xl font-bold text-theme-text mb-3">Your home Wi-Fi.</h1>
      <p className="text-theme-text-muted mb-6 leading-relaxed">
        Tell us which network this device should join after setup. We&apos;ll switch over at the very end —
        your phone will drop the setup Wi-Fi and reconnect to {homeSsid.trim() || 'your home network'} too.
      </p>

      <label className="block mb-4">
        <span className="text-sm text-theme-text-muted">Network name (SSID)</span>
        <input
          type="text"
          value={homeSsid}
          onChange={e => setHomeSsid(e.target.value)}
          autoFocus
          maxLength={32}
          placeholder="MyHomeWiFi"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          className="mt-2 w-full bg-theme-card border border-theme-border rounded-xl px-4 py-3 text-lg text-theme-text focus:outline-none focus:border-theme-accent"
        />
      </label>

      <label className="block mb-6">
        <span className="text-sm text-theme-text-muted">Password</span>
        <input
          type="password"
          value={homePassword}
          onChange={e => setHomePassword(e.target.value)}
          maxLength={63}
          placeholder="(leave blank for open networks)"
          autoComplete="new-password"
          className="mt-2 w-full bg-theme-card border border-theme-border rounded-xl px-4 py-3 text-lg text-theme-text font-mono focus:outline-none focus:border-theme-accent"
        />
        <span className="text-xs text-theme-text-muted mt-2 block">
          Stored only long enough to join. Never logged.
        </span>
      </label>

      <button
        onClick={onNext}
        disabled={!valid}
        className="w-full flex items-center justify-center gap-2 bg-theme-accent text-white py-4 rounded-xl text-base font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
      >
        Continue
        <ChevronRight size={18} />
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Step dots
// ---------------------------------------------------------------------------

function StepDots({ step, total }) {
  return (
    <div className="flex items-center gap-2">
      {Array.from({ length: total }).map((_, i) => {
        const n = i + 1
        const active = n === step
        const done = n < step
        return (
          <div
            key={n}
            className={`w-2 h-2 rounded-full transition-colors ${
              done ? 'bg-theme-accent' : active ? 'bg-theme-accent ring-2 ring-theme-accent/40' : 'bg-theme-border'
            }`}
          />
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Step 1 — Welcome / device name
// ---------------------------------------------------------------------------

function WelcomeStep({ deviceName, setDeviceName, onNext, onBack }) {
  const valid = /^[a-z0-9-]{1,32}$/i.test(deviceName.trim())
  return (
    <div>
      <div className="w-16 h-16 rounded-2xl bg-theme-accent/15 text-theme-accent flex items-center justify-center mb-6">
        <Sparkles size={32} />
      </div>
      <h1 className="text-3xl font-bold text-theme-text mb-3">Welcome to Dream.</h1>
      <p className="text-theme-text-muted mb-8 leading-relaxed">
        Let&apos;s get you set up in about a minute. First, give this device a name so it&apos;s easy to find on your network.
      </p>

      <label className="block mb-6">
        <span className="text-sm text-theme-text-muted">Device name</span>
        <input
          type="text"
          value={deviceName}
          onChange={e => setDeviceName(e.target.value)}
          autoFocus
          maxLength={32}
          className="mt-2 w-full bg-theme-card border border-theme-border rounded-xl px-4 py-3 text-lg text-theme-text focus:outline-none focus:border-theme-accent"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
        />
        <span className="text-xs text-theme-text-muted mt-2 block">
          Reachable at <code className="text-theme-accent">{deviceName.trim() || 'dream'}.local</code> on your network. Letters, numbers, and dashes only.
        </span>
      </label>

      <div className="flex gap-3">
        {onBack && (
          <button
            onClick={onBack}
            className="flex items-center justify-center gap-2 bg-theme-card border border-theme-border text-theme-text py-4 px-5 rounded-xl"
          >
            <ChevronLeft size={18} />
          </button>
        )}
        <button
          onClick={onNext}
          disabled={!valid}
          className="flex-1 flex items-center justify-center gap-2 bg-theme-accent text-white py-4 rounded-xl text-base font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          Continue
          <ChevronRight size={18} />
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Step 2 — First user
// ---------------------------------------------------------------------------

function UserStep({ username, setUsername, onNext, onBack }) {
  const trimmed = username.trim()
  const valid = /^[A-Za-z0-9._-]{1,64}$/.test(trimmed)
  return (
    <div>
      <div className="w-16 h-16 rounded-2xl bg-theme-accent/15 text-theme-accent flex items-center justify-center mb-6">
        <User size={32} />
      </div>
      <h1 className="text-3xl font-bold text-theme-text mb-3">Who&apos;s the first user?</h1>
      <p className="text-theme-text-muted mb-8 leading-relaxed">
        We&apos;ll generate a magic link for them at the end. They scan it once and they&apos;re in.
      </p>

      <label className="block mb-6">
        <span className="text-sm text-theme-text-muted">Username</span>
        <input
          type="text"
          value={username}
          onChange={e => setUsername(e.target.value)}
          autoFocus
          maxLength={64}
          placeholder="alice"
          className="mt-2 w-full bg-theme-card border border-theme-border rounded-xl px-4 py-3 text-lg text-theme-text focus:outline-none focus:border-theme-accent"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
        />
        <span className="text-xs text-theme-text-muted mt-2 block">
          Open WebUI will display this name when they land on chat.
        </span>
      </label>

      <div className="flex gap-3">
        <button
          onClick={onBack}
          className="flex items-center justify-center gap-2 bg-theme-card border border-theme-border text-theme-text py-4 px-5 rounded-xl"
        >
          <ChevronLeft size={18} />
        </button>
        <button
          onClick={onNext}
          disabled={!valid}
          className="flex-1 flex items-center justify-center gap-2 bg-theme-accent text-white py-4 rounded-xl text-base font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          Continue
          <ChevronRight size={18} />
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Step 3 — Stack picker
// ---------------------------------------------------------------------------

function StackStep({ stack, setStack, onNext, onBack }) {
  return (
    <div>
      <div className="w-16 h-16 rounded-2xl bg-theme-accent/15 text-theme-accent flex items-center justify-center mb-6">
        <Layers size={32} />
      </div>
      <h1 className="text-3xl font-bold text-theme-text mb-3">Pick your stack.</h1>
      <p className="text-theme-text-muted mb-6 leading-relaxed">
        You can change this later. Start small if you want and add things as you go.
      </p>

      <div className="space-y-3 mb-8">
        {STACK_OPTIONS.map(opt => {
          const Icon = opt.Icon
          const selected = stack === opt.id
          return (
            <button
              key={opt.id}
              onClick={() => setStack(opt.id)}
              className={`w-full text-left p-4 rounded-xl border-2 transition-colors flex gap-4 ${
                selected
                  ? 'border-theme-accent bg-theme-accent/10'
                  : 'border-theme-border bg-theme-card hover:border-theme-text-muted'
              }`}
            >
              <div className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 ${
                selected ? 'bg-theme-accent text-white' : 'bg-theme-border text-theme-text-muted'
              }`}>
                <Icon size={24} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-theme-text">{opt.title}</span>
                  {selected && <Check size={18} className="text-theme-accent flex-shrink-0" />}
                </div>
                <p className="text-sm text-theme-text-muted mt-1">{opt.blurb}</p>
              </div>
            </button>
          )
        })}
      </div>

      <div className="flex gap-3">
        <button
          onClick={onBack}
          className="flex items-center justify-center gap-2 bg-theme-card border border-theme-border text-theme-text py-4 px-5 rounded-xl"
        >
          <ChevronLeft size={18} />
        </button>
        <button
          onClick={onNext}
          className="flex-1 flex items-center justify-center gap-2 bg-theme-accent text-white py-4 rounded-xl text-base font-medium hover:opacity-90 transition-opacity"
        >
          Continue
          <ChevronRight size={18} />
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Step 4 — Confirm & finish
// ---------------------------------------------------------------------------

function ConfirmStep({ deviceName, username, stack, inApMode, homeSsid, onBack, onFinish, finishing, error }) {
  const stackTitle = STACK_OPTIONS.find(s => s.id === stack)?.title || stack
  return (
    <div>
      <h1 className="text-3xl font-bold text-theme-text mb-6">Ready?</h1>
      <p className="text-theme-text-muted mb-6 leading-relaxed">
        Tap Finish and we&apos;ll generate the first invite.
        {inApMode && ' Right after, this device drops the setup Wi-Fi and joins your home network.'}
      </p>

      <dl className="bg-theme-card border border-theme-border rounded-xl divide-y divide-theme-border mb-6">
        <Row label="Device name" value={deviceName.trim() || 'dream'} hint={`.local on your network`} />
        <Row label="First user" value={username.trim()} />
        <Row label="Stack" value={stackTitle} />
        {inApMode && <Row label="Home Wi-Fi" value={homeSsid.trim()} />}
      </dl>

      {inApMode && (
        <div className="mb-6 p-4 bg-theme-accent/10 border border-theme-accent/30 rounded-xl text-theme-text text-sm flex items-start gap-2">
          <ArrowRightLeft size={18} className="flex-shrink-0 mt-0.5 text-theme-accent" />
          <span>
            <strong>Heads up — your phone is about to lose this connection.</strong> When the AP shuts
            down, your phone will reconnect to {homeSsid.trim() || 'your home network'} automatically.
            From there, scan the QR we&apos;re about to show you to open chat.
          </span>
        </div>
      )}

      {error && (
        <div className="mb-6 p-4 bg-red-500/10 border border-red-500/30 rounded-xl text-red-400 text-sm flex items-start gap-2">
          <AlertCircle size={18} className="flex-shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      <div className="flex gap-3">
        <button
          onClick={onBack}
          disabled={finishing}
          className="flex items-center justify-center gap-2 bg-theme-card border border-theme-border text-theme-text py-4 px-5 rounded-xl disabled:opacity-50"
        >
          <ChevronLeft size={18} />
        </button>
        <button
          onClick={onFinish}
          disabled={finishing}
          className="flex-1 flex items-center justify-center gap-2 bg-theme-accent text-white py-4 rounded-xl text-base font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          {finishing && <Loader2 size={18} className="animate-spin" />}
          {finishing ? 'Finishing…' : 'Finish'}
        </button>
      </div>
    </div>
  )
}

function Row({ label, value, hint }) {
  return (
    <div className="px-4 py-3 flex items-center justify-between gap-4">
      <span className="text-sm text-theme-text-muted">{label}</span>
      <span className="text-theme-text font-medium text-right">
        {value}
        {hint && <span className="text-xs text-theme-text-muted block font-normal">{hint}</span>}
      </span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Done — show generated invite
// ---------------------------------------------------------------------------

function DoneScreen({ invite, onDone, deviceName }) {
  const [copied, setCopied] = useState(false)
  const [qrDataUrl, setQrDataUrl] = useState(null)
  const [qrError, setQrError] = useState(null)

  useEffect(() => {
    let cancelled = false
    const loadQr = async () => {
      try {
        const resp = await fetch(
          `/api/auth/magic-link/qr?url=${encodeURIComponent(invite.url)}`,
        )
        if (!resp.ok) {
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
  }, [invite.url])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(invite.url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Fallback: a visible input would let the user select manually.
    }
  }

  const share = async () => {
    if (!navigator.share) {
      copy()
      return
    }
    try {
      await navigator.share({
        title: `Dream Server invite for ${invite.target_username}`,
        text: 'Tap to open Dream Server',
        url: invite.url,
      })
    } catch {
      // User cancelled.
    }
  }

  return (
    <div>
      <div className="w-16 h-16 rounded-2xl bg-green-500/15 text-green-400 flex items-center justify-center mb-6">
        <Check size={32} />
      </div>
      <h1 className="text-3xl font-bold text-theme-text mb-3">You&apos;re set.</h1>
      <p className="text-theme-text-muted mb-6 leading-relaxed">
        Here&apos;s the magic link for <strong className="text-theme-text">{invite.target_username}</strong>.
        They scan or tap it to land straight in chat.
      </p>

      {invite.handoffStarted && (
        <div className="mb-6 p-4 bg-theme-accent/10 border border-theme-accent/30 rounded-xl text-theme-text text-sm">
          <div className="flex items-start gap-2">
            <ArrowRightLeft size={18} className="flex-shrink-0 mt-0.5 text-theme-accent" />
            <div>
              <strong className="block mb-1">Switching networks now.</strong>
              The setup Wi-Fi is shutting down — your phone will reconnect to your home network in a few seconds.
              Save the QR (long-press → Save Image, or use Share / Copy) before that happens.
              When you&apos;re back on your home Wi-Fi, scan the QR or open{' '}
              <code className="text-theme-accent">{deviceName}.local</code>.
            </div>
          </div>
        </div>
      )}

      {qrDataUrl ? (
        <div className="bg-white p-4 rounded-xl flex justify-center mb-6">
          <img src={qrDataUrl} alt="QR code for invite link" className="w-56 h-56" />
        </div>
      ) : (
        <div className="bg-theme-card border border-theme-border rounded-xl p-8 flex flex-col items-center justify-center mb-6 min-h-56">
          <QrCode size={48} className="text-theme-text-muted mb-2" />
          <p className="text-xs text-theme-text-muted text-center">
            {qrError || 'Generating QR…'}
          </p>
        </div>
      )}

      <div className="flex gap-2 mb-6">
        <input
          readOnly
          value={invite.url}
          onFocus={e => e.target.select()}
          className="flex-1 bg-theme-card border border-theme-border rounded-lg px-3 py-2 text-xs font-mono text-theme-text"
        />
        <button
          onClick={copy}
          className="flex items-center gap-1 px-3 py-2 bg-theme-card border border-theme-border rounded-lg text-theme-text hover:bg-theme-surface-hover text-sm"
        >
          {copied ? <Check size={16} className="text-green-400" /> : <Copy size={16} />}
        </button>
      </div>

      <div className="flex gap-3">
        {typeof navigator !== 'undefined' && navigator.share && (
          <button
            onClick={share}
            className="flex-1 flex items-center justify-center gap-2 bg-theme-card border border-theme-border text-theme-text py-4 rounded-xl"
          >
            <Share2 size={18} />
            Share
          </button>
        )}
        <button
          onClick={onDone}
          className="flex-1 bg-theme-accent text-white py-4 rounded-xl font-medium hover:opacity-90 transition-opacity"
        >
          {invite.handoffStarted ? 'Done' : 'Open dashboard'}
        </button>
      </div>

      <p className="text-xs text-theme-text-muted mt-6 text-center">
        Need more invites later? They live under <strong>Invites</strong> in the sidebar.
      </p>
    </div>
  )
}
