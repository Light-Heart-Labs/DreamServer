/**
 * Voice Page - Talk to your AI like Jarvis
 * 
 * Full-page voice interface with:
 * - Big mic button (click or push-to-talk)
 * - Real-time transcription
 * - Conversation history
 * - Volume controls
 * - Voice settings
 */

import { 
  Mic, 
  MicOff, 
  Volume2, 
  VolumeX, 
  Settings, 
  Loader2, 
  AlertCircle,
  Trash2,
  StopCircle,
  Radio,
  CheckCircle,
  XCircle,
  RefreshCw
} from 'lucide-react'
import { useState, useEffect, useRef, useCallback } from 'react'
import { useVoiceAgent } from '../hooks/useVoiceAgent'

// Auth: nginx injects Authorization header for all /api/ requests (see nginx.conf).

// Hook to check voice services status
function useVoiceServices() {
  const [services, setServices] = useState(null)
  const [loading, setLoading] = useState(true)

  const checkServices = useCallback(async () => {
    try {
      const response = await fetch(`/api/voice/status`)
      if (response.ok) {
        const data = await response.json()
        setServices(data)
      }
    } catch (err) {
      console.error('Failed to check voice services:', err)
      setServices({ available: false, services: {}, message: 'API unavailable' })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    checkServices()
    // Check every 30 seconds
    const interval = setInterval(checkServices, 30000)
    return () => clearInterval(interval)
  }, [checkServices])

  return { services, loading, refresh: checkServices }
}

// Voice services status banner
function VoiceServicesBanner({ services, loading, onRefresh }) {
  if (loading) {
    return (
      <div className="mb-6 p-4 bg-zinc-900/50 border border-zinc-800 rounded-xl flex items-center gap-3">
        <Loader2 size={18} className="text-zinc-400 animate-spin" />
        <span className="text-sm text-zinc-400">Checking voice services...</span>
      </div>
    )
  }

  if (!services) return null

  const { stt, tts, livekit } = services.services || {}
  const allHealthy = services.available

  if (allHealthy) {
    return (
      <div className="mb-6 p-4 bg-green-500/10 border border-green-500/30 rounded-xl flex items-center justify-between">
        <div className="flex items-center gap-3">
          <CheckCircle size={18} className="text-green-400" />
          <span className="text-sm text-green-400">Voice services ready</span>
        </div>
        <div className="flex items-center gap-4 text-xs text-zinc-500">
          <span>STT ✓</span>
          <span>TTS ✓</span>
          <span>LiveKit ✓</span>
        </div>
      </div>
    )
  }

  // Show which services are down
  return (
    <div className="mb-6 p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-xl">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <AlertCircle size={18} className="text-yellow-400" />
          <span className="text-sm text-yellow-400">Some voice services unavailable</span>
        </div>
        <button 
          onClick={onRefresh}
          className="text-yellow-400 hover:text-yellow-300"
          title="Refresh status"
        >
          <RefreshCw size={16} />
        </button>
      </div>
      <div className="flex items-center gap-4 mt-3 text-xs">
        <span className={stt?.status === 'healthy' ? 'text-green-400' : 'text-red-400'}>
          {stt?.status === 'healthy' ? '✓' : '✗'} Whisper (STT)
        </span>
        <span className={tts?.status === 'healthy' ? 'text-green-400' : 'text-red-400'}>
          {tts?.status === 'healthy' ? '✓' : '✗'} Kokoro (TTS)
        </span>
        <span className={livekit?.status === 'healthy' ? 'text-green-400' : 'text-red-400'}>
          {livekit?.status === 'healthy' ? '✓' : '✗'} LiveKit
        </span>
      </div>
      <p className="text-xs text-zinc-500 mt-2">
        Check voice services: <code className="text-zinc-400">docker compose ps whisper tts</code>
      </p>
    </div>
  )
}

// Waveform animation component
const WAVEFORM_COLORS = {
  indigo: 'bg-indigo-400',
  green: 'bg-green-400',
  red: 'bg-red-400',
  yellow: 'bg-yellow-400',
}

function AudioWaveform({ active, color = 'indigo' }) {
  const bars = 5
  const colorClass = WAVEFORM_COLORS[color] || 'bg-indigo-400'
  return (
    <div className="flex items-center gap-1 h-8">
      {Array.from({ length: bars }).map((_, i) => (
        <div
          key={i}
          className={`w-1 rounded-full transition-all duration-150 ${
            active
              ? `${colorClass} animate-pulse`
              : 'bg-zinc-600'
          }`}
          style={{
            height: active ? `${20 + Math.random() * 60}%` : '20%',
            animationDelay: `${i * 0.1}s`
          }}
        />
      ))}
    </div>
  )
}

// Message bubble component
function MessageBubble({ role, content, timestamp }) {
  const isUser = role === 'user'
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-4`}>
      <div 
        className={`max-w-[80%] px-4 py-3 rounded-2xl ${
          isUser 
            ? 'bg-indigo-600 text-white rounded-br-none' 
            : 'bg-zinc-800 text-zinc-100 rounded-bl-none'
        }`}
      >
        <p className="text-sm">{content}</p>
        <span className="text-xs opacity-50 mt-1 block">
          {new Date(timestamp).toLocaleTimeString()}
        </span>
      </div>
    </div>
  )
}

// Volume slider component
function VolumeSlider({ volume, onChange, muted, onToggleMute }) {
  return (
    <div className="flex items-center gap-3">
      <button 
        onClick={onToggleMute}
        className="text-zinc-400 hover:text-white transition-colors"
      >
        {muted ? <VolumeX size={20} /> : <Volume2 size={20} />}
      </button>
      <input
        type="range"
        min="0"
        max="1"
        step="0.1"
        value={muted ? 0 : volume}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-24 accent-indigo-500"
      />
    </div>
  )
}

// Settings panel component
function VoiceSettings({ isOpen, onClose }) {
  // Load from localStorage or use defaults
  const [voice, setVoice] = useState(() => localStorage.getItem('voice-setting') || 'default')
  const [speed, setSpeed] = useState(() => parseFloat(localStorage.getItem('voice-speed')) || 1.0)
  const [wakeWord, setWakeWord] = useState(() => localStorage.getItem('voice-wake') === 'true')

  const handleSave = () => {
    localStorage.setItem('voice-setting', voice)
    localStorage.setItem('voice-speed', speed.toString())
    localStorage.setItem('voice-wake', wakeWord.toString())
    onClose()
  }

  const handleCancel = () => {
    // Reset to saved values
    setVoice(localStorage.getItem('voice-setting') || 'default')
    setSpeed(parseFloat(localStorage.getItem('voice-speed')) || 1.0)
    setWakeWord(localStorage.getItem('voice-wake') === 'true')
    onClose()
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 w-full max-w-md">
        <h3 className="text-lg font-semibold text-white mb-4">Voice Settings</h3>
        
        <div className="space-y-4">
          {/* Voice Selection */}
          <div>
            <label className="text-sm text-zinc-400 block mb-2">Voice</label>
            <select 
              value={voice}
              onChange={(e) => setVoice(e.target.value)}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-white"
            >
              <option value="default">Default (LJSpeech)</option>
              <option value="jenny">Jenny (Female)</option>
              <option value="alan">Alan (Male)</option>
              <option value="amy">Amy (British)</option>
            </select>
          </div>

          {/* Speech Speed */}
          <div>
            <label className="text-sm text-zinc-400 block mb-2">
              Speech Speed: {speed.toFixed(1)}x
            </label>
            <input
              type="range"
              min="0.5"
              max="2"
              step="0.1"
              value={speed}
              onChange={(e) => setSpeed(parseFloat(e.target.value))}
              className="w-full accent-indigo-500"
            />
          </div>

          {/* Wake Word */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-white">Wake Word</p>
              <p className="text-xs text-zinc-500">Say "Hey Dream" to activate</p>
            </div>
            <button
              onClick={() => setWakeWord(!wakeWord)}
              className={`w-12 h-6 rounded-full transition-colors ${
                wakeWord ? 'bg-indigo-600' : 'bg-zinc-700'
              }`}
            >
              <div 
                className={`w-5 h-5 bg-white rounded-full transition-transform ${
                  wakeWord ? 'translate-x-6' : 'translate-x-0.5'
                }`}
              />
            </button>
          </div>
        </div>

        <div className="flex justify-end gap-3 mt-6">
          <button
            onClick={handleCancel}
            className="px-4 py-2 text-zinc-400 hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-colors"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  )
}

export default function Voice() {
  // Voice services health check
  const { services: voiceServices, loading: servicesLoading, refresh: refreshServices } = useVoiceServices()

  const {
    status,
    isListening,
    isSpeaking,
    messages,
    currentTranscript,
    error,
    volume,
    isMuted,
    toggleListening,
    toggleMute,
    updateVolume,
    interrupt,
    clearMessages,
  } = useVoiceAgent()

  const [showSettings, setShowSettings] = useState(false)
  const messagesEndRef = useRef(null)

  // Auto-scroll to bottom of messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, currentTranscript])

  // Keyboard support for push-to-talk (spacebar)
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Space for push-to-talk (only if not in an input)
      if (e.code === 'Space' && !['INPUT', 'TEXTAREA'].includes(e.target.tagName)) {
        e.preventDefault()
        if (!isListening && status !== 'connecting') {
          toggleListening()
        }
      }
      // Escape to interrupt
      if (e.code === 'Escape' && isSpeaking) {
        interrupt()
      }
    }

    const handleKeyUp = (e) => {
      // Release space to stop listening (push-to-talk mode)
      if (e.code === 'Space' && !['INPUT', 'TEXTAREA'].includes(e.target.tagName)) {
        e.preventDefault()
        // Could implement push-to-talk release here
        // For now, click to toggle is the primary mode
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
    }
  }, [isListening, isSpeaking, status, toggleListening, interrupt])

  // Status indicator
  const getStatusInfo = () => {
    switch (status) {
      case 'connecting':
        return { text: 'Connecting...', color: 'text-yellow-400', icon: Loader2 }
      case 'connected':
        return { text: 'Connected', color: 'text-green-400', icon: Radio }
      case 'error':
        return { text: 'Error', color: 'text-red-400', icon: AlertCircle }
      default:
        return { text: 'Ready', color: 'text-zinc-400', icon: Radio }
    }
  }

  const statusInfo = getStatusInfo()
  const StatusIcon = statusInfo.icon

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="p-6 border-b border-zinc-800">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">Voice</h1>
            <p className="text-zinc-400 mt-1">
              Talk to your AI. Like having your own Jarvis.
            </p>
          </div>
          <div className="flex items-center gap-4">
            {/* Status */}
            <div className={`flex items-center gap-2 ${statusInfo.color}`}>
              <StatusIcon size={16} className={status === 'connecting' ? 'animate-spin' : ''} />
              <span className="text-sm">{statusInfo.text}</span>
            </div>
            {/* Volume */}
            <VolumeSlider 
              volume={volume}
              onChange={updateVolume}
              muted={isMuted}
              onToggleMute={toggleMute}
            />
            {/* Settings */}
            <button 
              onClick={() => setShowSettings(true)}
              className="text-zinc-400 hover:text-white transition-colors"
            >
              <Settings size={20} />
            </button>
          </div>
        </div>
      </div>

      {/* Voice Services Status */}
      <div className="px-6 pt-4">
        <VoiceServicesBanner 
          services={voiceServices} 
          loading={servicesLoading} 
          onRefresh={refreshServices}
        />
      </div>

      {/* Conversation Area */}
      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        {messages.length === 0 && !currentTranscript && (
          <div className="h-full flex flex-col items-center justify-center text-center">
            <div className="w-24 h-24 rounded-full bg-zinc-800/50 flex items-center justify-center mb-4">
              <Mic size={40} className="text-zinc-600" />
            </div>
            <h3 className="text-lg text-zinc-300 mb-2">Start a conversation</h3>
            <p className="text-sm text-zinc-500 max-w-md">
              Click the microphone button below to start talking. 
              Your AI will listen, understand, and respond with voice.
            </p>
          </div>
        )}

        {messages.map((msg, idx) => (
          <MessageBubble key={idx} {...msg} />
        ))}

        {/* Current (interim) transcript */}
        {currentTranscript && (
          <div className="flex justify-end mb-4">
            <div className="max-w-[80%] px-4 py-3 rounded-2xl bg-indigo-600/50 text-white rounded-br-none border border-indigo-500/30">
              <p className="text-sm italic">{currentTranscript}</p>
            </div>
          </div>
        )}

        {/* AI Speaking indicator */}
        {isSpeaking && (
          <div className="flex justify-start mb-4">
            <div className="px-4 py-3 rounded-2xl bg-zinc-800 rounded-bl-none flex items-center gap-3">
              <AudioWaveform active={true} />
              <span className="text-sm text-zinc-400">AI is speaking...</span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Error Banner */}
      {error && (
        <div className="mx-6 mb-4 p-4 bg-red-500/10 border border-red-500/30 rounded-xl flex items-start gap-3">
          <AlertCircle size={20} className="text-red-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm text-red-400 font-medium">Connection Error</p>
            <p className="text-xs text-red-400/70 mt-1">{error}</p>
            <p className="text-xs text-zinc-500 mt-2">
              Make sure LiveKit server is running and voice services are enabled.
            </p>
          </div>
        </div>
      )}

      {/* Control Bar */}
      <div className="p-6 border-t border-zinc-800 bg-zinc-900/50">
        <div className="flex items-center justify-center gap-4">
          {/* Clear button */}
          {messages.length > 0 && (
            <button
              onClick={clearMessages}
              className="p-3 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-full transition-colors"
              title="Clear conversation"
            >
              <Trash2 size={20} />
            </button>
          )}

          {/* Main Mic Button */}
          <button
            onClick={toggleListening}
            disabled={status === 'connecting'}
            className={`w-20 h-20 rounded-full flex items-center justify-center transition-all shadow-lg ${
              status === 'connecting'
                ? 'bg-zinc-700 cursor-not-allowed'
                : isListening 
                  ? 'bg-red-500 hover:bg-red-600 scale-110' 
                  : 'bg-indigo-600 hover:bg-indigo-700 hover:scale-105'
            }`}
          >
            {status === 'connecting' ? (
              <Loader2 size={32} className="text-white animate-spin" />
            ) : isListening ? (
              <MicOff size={32} className="text-white" />
            ) : (
              <Mic size={32} className="text-white" />
            )}
          </button>

          {/* Interrupt button (when AI is speaking) */}
          {isSpeaking && (
            <button
              onClick={interrupt}
              className="p-3 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-full transition-colors"
              title="Interrupt AI"
            >
              <StopCircle size={20} />
            </button>
          )}
        </div>

        <p className="text-center text-sm text-zinc-500 mt-4">
          {status === 'connecting' 
            ? 'Connecting to voice server...'
            : isListening 
              ? 'Listening... Click to stop' 
              : 'Click to start talking'
          }
        </p>

        {/* Keyboard hint */}
        <p className="text-center text-xs text-zinc-600 mt-2">
          Tip: Hold <kbd className="px-1.5 py-0.5 bg-zinc-800 rounded text-zinc-400">Space</kbd> to talk
        </p>
      </div>

      {/* Settings Modal */}
      <VoiceSettings isOpen={showSettings} onClose={() => setShowSettings(false)} />
    </div>
  )
}
