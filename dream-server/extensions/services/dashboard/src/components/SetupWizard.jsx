import { useState, useEffect, useCallback } from 'react'
import { CheckCircle, Circle, ChevronRight, ChevronLeft, Mic, User, Settings, Play, Shield } from 'lucide-react'
import { PreFlightChecks } from './PreFlightChecks'

export default function SetupWizard({ onComplete }) {
  const [step, setStep] = useState(1)
  const [config, setConfig] = useState({
    userName: '',
    voice: 'af_heart',
    tested: false,
    preflightPassed: false
  })
  const [testStatus, setTestStatus] = useState({ running: false, output: [], done: false, success: false })
  const [preflightIssues, setPreflightIssues] = useState([])
  const totalSteps = 5

  const voices = [
    { id: 'af_heart', name: 'Heart', desc: 'Warm, friendly female' },
    { id: 'af_bella', name: 'Bella', desc: 'Professional female' },
    { id: 'af_sky', name: 'Sky', desc: 'Casual female' },
    { id: 'am_adam', name: 'Adam', desc: 'Natural male' },
    { id: 'am_michael', name: 'Michael', desc: 'Deep male' }
  ]

  // Stable callbacks so PreFlightChecks doesn't re-run on parent re-render
  const handlePreflightComplete = useCallback(() => {
    setConfig(c => ({ ...c, preflightPassed: true }))
  }, [])

  const handlePreflightIssues = useCallback((issues) => {
    setPreflightIssues(issues)
  }, [])

  const runDiagnostics = async () => {
    setTestStatus({ running: true, output: ['Starting diagnostic tests...'], done: false, success: false })

    try {
      const res = await fetch('/api/setup/test', { method: 'POST' })
      const reader = res.body.getReader()
      const decoder = new TextDecoder()

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const text = decoder.decode(value)
        setTestStatus(prev => ({ ...prev, output: [...prev.output, text] }))
      }

      setTestStatus(prev => ({ ...prev, running: false, done: true, success: true }))
      setConfig(c => ({ ...c, tested: true }))
    } catch (err) {
      setTestStatus(prev => ({ ...prev, running: false, done: true, success: false, output: [...prev.output, `Error: ${err.message}`] }))
    }
  }

  const saveConfig = () => {
    localStorage.setItem('dream-config', JSON.stringify(config))
    localStorage.setItem('dream-dashboard-visited', 'true')
    onComplete()
  }

  return (
    <div className="fixed inset-0 bg-theme-bg z-50 overflow-y-auto">
      <div className="min-h-screen flex flex-col">
        <div className="flex-1 flex flex-col justify-center p-8">
          {/* Step Indicator */}
          <div className="flex items-center justify-center gap-2 mb-8">
            {[1, 2, 3, 4, 5].map(i => (
              <div key={i} className="flex items-center">
                {i < step ? (
                  <CheckCircle className="w-6 h-6 text-green-500" />
                ) : i === step ? (
                  <Circle className="w-6 h-6 text-theme-accent fill-indigo-500/20" />
                ) : (
                  <Circle className="w-6 h-6 text-theme-text-muted" />
                )}
                {i < 5 && <div className={`w-8 h-0.5 mx-1 ${i < step ? 'bg-green-500' : 'bg-theme-border'}`} />}
              </div>
            ))}
          </div>

          {/* Step 1: Preflight */}
          {step === 1 && (
            <div className="text-center max-w-lg mx-auto">
              <div className="w-20 h-20 bg-amber-500/20 rounded-2xl flex items-center justify-center mx-auto mb-6">
                <Shield className="w-10 h-10 text-amber-400" />
              </div>
              <h2 className="text-3xl font-bold text-theme-text mb-4">System Check</h2>
              <p className="text-theme-text-secondary mb-8">
                Let's verify your system is ready for Dream Server. This checks Docker, GPU, ports, and disk space.
              </p>
              <PreFlightChecks
                onComplete={handlePreflightComplete}
                onIssuesFound={handlePreflightIssues}
              />
            </div>
          )}

          {/* Step 2: Welcome */}
          {step === 2 && (
            <div className="text-center max-w-lg mx-auto">
              <div className="w-20 h-20 bg-theme-accent/20 rounded-2xl flex items-center justify-center mx-auto mb-6">
                <Settings className="w-10 h-10 text-theme-accent" />
              </div>
              <h2 className="text-3xl font-bold text-theme-text mb-4">Welcome to Dream Server</h2>
              <p className="text-theme-text-secondary mb-8">
                Let's get your local AI set up in just a few steps.
                Everything runs on your hardware — no cloud, no subscriptions.
              </p>
              <div className="space-y-3 text-left bg-theme-card rounded-xl p-6 mb-8">
                <div className="flex items-center gap-3 text-theme-text">
                  <CheckCircle className="w-5 h-5 text-green-500" />
                  <span>Personalize your assistant</span>
                </div>
                <div className="flex items-center gap-3 text-theme-text">
                  <CheckCircle className="w-5 h-5 text-green-500" />
                  <span>Choose your voice</span>
                </div>
                <div className="flex items-center gap-3 text-theme-text">
                  <CheckCircle className="w-5 h-5 text-green-500" />
                  <span>Run diagnostics</span>
                </div>
              </div>
            </div>
          )}

          {/* Step 3: Name */}
          {step === 3 && (
            <div className="text-center max-w-md mx-auto">
              <div className="w-20 h-20 bg-purple-500/20 rounded-2xl flex items-center justify-center mx-auto mb-6">
                <User className="w-10 h-10 text-purple-400" />
              </div>
              <h2 className="text-3xl font-bold text-theme-text mb-4">What should we call you?</h2>
              <p className="text-theme-text-secondary mb-8">
                Your AI assistant will use this name when talking to you.
              </p>
              <input
                type="text"
                value={config.userName}
                onChange={(e) => setConfig(c => ({ ...c, userName: e.target.value }))}
                placeholder="Enter your name"
                className="w-full px-4 py-3 bg-theme-card border border-theme-border rounded-lg text-theme-text placeholder-theme-text-muted focus:outline-none focus:border-theme-accent"
                autoFocus
              />
            </div>
          )}

          {/* Step 4: Voice */}
          {step === 4 && (
            <div className="text-center max-w-lg mx-auto">
              <div className="w-20 h-20 bg-pink-500/20 rounded-2xl flex items-center justify-center mx-auto mb-6">
                <Mic className="w-10 h-10 text-pink-400" />
              </div>
              <h2 className="text-3xl font-bold text-theme-text mb-4">Choose a voice</h2>
              <p className="text-theme-text-secondary mb-8">
                Pick the voice your AI assistant will use when speaking to you.
              </p>
              <div className="grid gap-3">
                {voices.map(voice => (
                  <button
                    key={voice.id}
                    onClick={() => setConfig(c => ({ ...c, voice: voice.id }))}
                    className={`flex items-center gap-4 p-4 rounded-xl border transition-all text-left ${
                      config.voice === voice.id
                        ? 'border-theme-accent bg-theme-accent/10'
                        : 'border-theme-border bg-theme-card/50 hover:border-theme-border'
                    }`}
                  >
                    <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                      config.voice === voice.id ? 'border-theme-accent' : 'border-theme-border'
                    }`}>
                      {config.voice === voice.id && <div className="w-2.5 h-2.5 rounded-full bg-theme-accent" />}
                    </div>
                    <div className="flex-1">
                      <div className="font-medium text-theme-text">{voice.name}</div>
                      <div className="text-sm text-theme-text-muted">{voice.desc}</div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Step 5: Diagnostics */}
          {step === 5 && (
            <div className="text-center max-w-2xl mx-auto">
              <div className="w-20 h-20 bg-green-500/20 rounded-2xl flex items-center justify-center mx-auto mb-6">
                <Play className="w-10 h-10 text-green-400" />
              </div>
              <h2 className="text-3xl font-bold text-theme-text mb-4">Run diagnostics</h2>
              <p className="text-theme-text-secondary mb-8">
                Let's verify everything is working correctly. This will test LLM, STT, TTS, and voice pipeline.
              </p>

              {!testStatus.running && !testStatus.done && (
                <button
                  onClick={runDiagnostics}
                  className="px-6 py-3 bg-theme-accent hover:bg-theme-accent-hover text-white rounded-lg font-medium transition-colors"
                >
                  Start Diagnostics
                </button>
              )}

              {(testStatus.running || testStatus.done) && (
                <div className="bg-theme-card rounded-xl p-4 text-left font-mono text-sm max-h-64 overflow-y-auto">
                  {testStatus.output.map((line, i) => (
                    <div key={i} className="text-theme-text-secondary">{line}</div>
                  ))}
                  {testStatus.running && <div className="text-theme-accent animate-pulse">...</div>}
                </div>
              )}

              {testStatus.done && (
                <div className={`mt-4 p-4 rounded-lg ${testStatus.success ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
                  {testStatus.success ? '✓ All systems operational' : '✗ Some tests failed — check logs'}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="p-6 border-t border-theme-border">
          <div className="max-w-4xl mx-auto flex items-center justify-between">
            <button
              onClick={() => setStep(s => Math.max(1, s - 1))}
              disabled={step === 1}
              className="flex items-center gap-2 px-4 py-2 text-theme-text-secondary hover:text-theme-text disabled:opacity-0 transition-colors"
            >
              <ChevronLeft className="w-5 h-5" />
              Back
            </button>

            <div className="text-theme-text-muted text-sm">
              Step {step} of {totalSteps}
            </div>

            {step < totalSteps ? (
              <button
                onClick={() => setStep(s => s + 1)}
                disabled={step === 3 && !config.userName.trim()}
                className="flex items-center gap-2 px-6 py-2 bg-theme-accent hover:bg-theme-accent-hover disabled:bg-zinc-700 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
              >
                Next
                <ChevronRight className="w-5 h-5" />
              </button>
            ) : (
              <button
                onClick={saveConfig}
                disabled={!config.tested}
                className="flex items-center gap-2 px-6 py-2 bg-green-600 hover:bg-green-700 disabled:bg-zinc-700 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
              >
                <CheckCircle className="w-5 h-5" />
                Complete Setup
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
