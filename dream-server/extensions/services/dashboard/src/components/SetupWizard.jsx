import { useState, useEffect, useCallback } from 'react'
import { CheckCircle, Circle, ChevronRight, ChevronLeft, Mic, User, Settings, Play, Shield } from 'lucide-react'
import { PreFlightChecks } from './PreFlightChecks'

const fallbackVoices = [
  { id: 'af_heart', name: 'Heart', desc: 'Warm, friendly female' },
  { id: 'af_bella', name: 'Bella', desc: 'Professional female' },
  { id: 'af_sky', name: 'Sky', desc: 'Casual female' },
  { id: 'am_adam', name: 'Adam', desc: 'Natural male' },
  { id: 'am_michael', name: 'Michael', desc: 'Deep male' }
]

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
  const [voices, setVoices] = useState(fallbackVoices)
  const [stateError, setStateError] = useState(null)
  const totalSteps = 5

  const persistWizardState = useCallback(async (overrides = {}) => {
    const nextConfig = {
      ...config,
      ...(overrides.userName !== undefined ? { userName: overrides.userName } : {}),
      ...(overrides.voice !== undefined ? { voice: overrides.voice } : {}),
      ...(overrides.tested !== undefined ? { tested: overrides.tested } : {}),
      ...(overrides.preflightPassed !== undefined ? { preflightPassed: overrides.preflightPassed } : {})
    }
    const nextIssues = overrides.preflightIssues ?? preflightIssues
    const nextStep = overrides.step ?? step

    localStorage.setItem('dream-config', JSON.stringify(nextConfig))

    try {
      const response = await fetch('/api/setup/wizard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          step: nextStep,
          user_name: nextConfig.userName,
          voice: nextConfig.voice,
          tested: nextConfig.tested,
          preflight_passed: nextConfig.preflightPassed,
          preflight_issues: nextIssues
        })
      })

      if (!response.ok) {
        throw new Error('Failed to save setup progress')
      }

      setStateError(null)
    } catch (err) {
      setStateError('Could not save setup progress to the dashboard API. Your choices are still cached locally.')
    }
  }, [config, preflightIssues, step])

  useEffect(() => {
    const cachedConfig = localStorage.getItem('dream-config')
    if (cachedConfig) {
      try {
        const parsed = JSON.parse(cachedConfig)
        setConfig(c => ({ ...c, ...parsed }))
      } catch {
        // Ignore corrupt local cache and fall back to API/defaults.
      }
    }

    let active = true

    const loadWizardState = async () => {
      try {
        const response = await fetch('/api/setup/wizard')
        if (!response.ok) {
          throw new Error('Failed to load setup wizard state')
        }

        const data = await response.json()
        if (!active) {
          return
        }

        setStep(data.step || 1)
        setVoices(Array.isArray(data.voices) && data.voices.length > 0 ? data.voices : fallbackVoices)
        setConfig(c => ({
          ...c,
          ...(data.config || {})
        }))
        setPreflightIssues(data.config?.preflightIssues || [])
        setStateError(null)

        if (data.config?.tested) {
          setTestStatus({
            running: false,
            output: ['Diagnostics already completed.'],
            done: true,
            success: true
          })
        }
      } catch (err) {
        if (active) {
          setStateError('Could not load saved setup state. Using local defaults for now.')
        }
      }
    }

    loadWizardState()

    return () => {
      active = false
    }
  }, [])

  // Stable callbacks so PreFlightChecks doesn't re-run on parent re-render
  const handlePreflightComplete = useCallback(() => {
    setConfig(c => ({ ...c, preflightPassed: true }))
    persistWizardState({ preflightPassed: true })
  }, [persistWizardState])

  const handlePreflightIssues = useCallback((issues) => {
    setPreflightIssues(issues)
    persistWizardState({ preflightIssues: issues })
  }, [persistWizardState])

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
      await persistWizardState({ tested: true })
    } catch (err) {
      setTestStatus(prev => ({ ...prev, running: false, done: true, success: false, output: [...prev.output, `Error: ${err.message}`] }))
    }
  }

  const moveStep = async (nextStep) => {
    setStep(nextStep)
    await persistWizardState({ step: nextStep })
  }

  const saveConfig = async () => {
    localStorage.setItem('dream-config', JSON.stringify(config))
    localStorage.setItem('dream-dashboard-visited', 'true')
    await persistWizardState({ step: totalSteps })

    try {
      await fetch('/api/setup/complete', { method: 'POST' })
    } catch {
      // The local completion marker still lets the dashboard continue offline.
    }

    onComplete()
  }

  return (
    <div className="fixed inset-0 bg-[#0f0f13] z-50 overflow-y-auto">
      <div className="min-h-screen flex flex-col">
        <div className="flex-1 flex flex-col justify-center p-8">
          {/* Step Indicator */}
          <div className="flex items-center justify-center gap-2 mb-8">
            {[1, 2, 3, 4, 5].map(i => (
              <div key={i} className="flex items-center">
                {i < step ? (
                  <CheckCircle className="w-6 h-6 text-green-500" />
                ) : i === step ? (
                  <Circle className="w-6 h-6 text-indigo-500 fill-indigo-500/20" />
                ) : (
                  <Circle className="w-6 h-6 text-zinc-600" />
                )}
                {i < 5 && <div className={`w-8 h-0.5 mx-1 ${i < step ? 'bg-green-500' : 'bg-zinc-700'}`} />}
              </div>
            ))}
          </div>

          {stateError && (
            <div className="max-w-2xl mx-auto mb-6 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
              {stateError}
            </div>
          )}

          {/* Step 1: Preflight */}
          {step === 1 && (
            <div className="text-center max-w-lg mx-auto">
              <div className="w-20 h-20 bg-amber-500/20 rounded-2xl flex items-center justify-center mx-auto mb-6">
                <Shield className="w-10 h-10 text-amber-400" />
              </div>
              <h2 className="text-3xl font-bold text-white mb-4">System Check</h2>
              <p className="text-zinc-400 mb-8">
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
              <div className="w-20 h-20 bg-indigo-500/20 rounded-2xl flex items-center justify-center mx-auto mb-6">
                <Settings className="w-10 h-10 text-indigo-400" />
              </div>
              <h2 className="text-3xl font-bold text-white mb-4">Welcome to Dream Server</h2>
              <p className="text-zinc-400 mb-8">
                Let's get your local AI set up in just a few steps.
                Everything runs on your hardware — no cloud, no subscriptions.
              </p>
              <div className="space-y-3 text-left bg-zinc-900/50 rounded-xl p-6 mb-8">
                <div className="flex items-center gap-3 text-zinc-300">
                  <CheckCircle className="w-5 h-5 text-green-500" />
                  <span>Personalize your assistant</span>
                </div>
                <div className="flex items-center gap-3 text-zinc-300">
                  <CheckCircle className="w-5 h-5 text-green-500" />
                  <span>Choose your voice</span>
                </div>
                <div className="flex items-center gap-3 text-zinc-300">
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
              <h2 className="text-3xl font-bold text-white mb-4">What should we call you?</h2>
              <p className="text-zinc-400 mb-8">
                Your AI assistant will use this name when talking to you.
              </p>
              <input
                type="text"
                value={config.userName}
                onChange={(e) => setConfig(c => ({ ...c, userName: e.target.value }))}
                onBlur={(e) => persistWizardState({ userName: e.target.value })}
                placeholder="Enter your name"
                className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-lg text-white placeholder-zinc-500 focus:outline-none focus:border-indigo-500"
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
              <h2 className="text-3xl font-bold text-white mb-4">Choose a voice</h2>
              <p className="text-zinc-400 mb-8">
                Pick the voice your AI assistant will use when speaking to you.
              </p>
              <div className="grid gap-3">
                {voices.map(voice => (
                  <button
                    key={voice.id}
                    onClick={() => {
                      setConfig(c => ({ ...c, voice: voice.id }))
                      persistWizardState({ voice: voice.id })
                    }}
                    className={`flex items-center gap-4 p-4 rounded-xl border transition-all text-left ${
                      config.voice === voice.id
                        ? 'border-indigo-500 bg-indigo-500/10'
                        : 'border-zinc-700 bg-zinc-800/50 hover:border-zinc-600'
                    }`}
                  >
                    <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                      config.voice === voice.id ? 'border-indigo-500' : 'border-zinc-600'
                    }`}>
                      {config.voice === voice.id && <div className="w-2.5 h-2.5 rounded-full bg-indigo-500" />}
                    </div>
                    <div className="flex-1">
                      <div className="font-medium text-white">{voice.name}</div>
                      <div className="text-sm text-zinc-500">{voice.desc}</div>
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
              <h2 className="text-3xl font-bold text-white mb-4">Run diagnostics</h2>
              <p className="text-zinc-400 mb-8">
                Let's verify everything is working correctly. This will test LLM, STT, TTS, and voice pipeline.
              </p>

              {!testStatus.running && !testStatus.done && (
                <button
                  onClick={runDiagnostics}
                  className="px-6 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium transition-colors"
                >
                  Start Diagnostics
                </button>
              )}

              {(testStatus.running || testStatus.done) && (
                <div className="bg-zinc-900 rounded-xl p-4 text-left font-mono text-sm max-h-64 overflow-y-auto">
                  {testStatus.output.map((line, i) => (
                    <div key={i} className="text-zinc-400">{line}</div>
                  ))}
                  {testStatus.running && <div className="text-indigo-400 animate-pulse">...</div>}
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

        <div className="p-6 border-t border-zinc-800">
          <div className="max-w-4xl mx-auto flex items-center justify-between">
            <button
              onClick={() => moveStep(Math.max(1, step - 1))}
              disabled={step === 1}
              className="flex items-center gap-2 px-4 py-2 text-zinc-400 hover:text-white disabled:opacity-0 transition-colors"
            >
              <ChevronLeft className="w-5 h-5" />
              Back
            </button>

            <div className="text-zinc-500 text-sm">
              Step {step} of {totalSteps}
            </div>

            {step < totalSteps ? (
              <button
                onClick={() => moveStep(Math.min(totalSteps, step + 1))}
                disabled={step === 3 && !config.userName.trim()}
                className="flex items-center gap-2 px-6 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-zinc-700 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
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
