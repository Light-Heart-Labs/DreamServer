/**
 * useVoiceAgent Hook
 * 
 * Manages WebRTC connection to LiveKit for real-time voice conversation.
 * Handles microphone streaming, transcription display, and audio playback.
 */

import { useState, useRef, useCallback, useEffect } from 'react'

// Auth: nginx injects Authorization header for all /api/ requests (see nginx.conf).
// LiveKit URL is auto-detected from window.location for WebSocket connections.
const getHost = () => typeof window !== 'undefined' ? window.location.hostname : 'localhost'
const getProtocol = () => typeof window !== 'undefined' && window.location.protocol === 'https:' ? 'wss:' : 'ws:'
const LIVEKIT_URL = import.meta.env.VITE_LIVEKIT_URL || `${getProtocol()}//${getHost()}:7880`

export function useVoiceAgent() {
  // Connection state
  const [status, setStatus] = useState('disconnected') // disconnected, connecting, connected, error
  const [isListening, setIsListening] = useState(false)
  const [isSpeaking, setIsSpeaking] = useState(false)
  
  // Conversation state
  const [messages, setMessages] = useState([])
  const [currentTranscript, setCurrentTranscript] = useState('')
  const [error, setError] = useState(null)
  
  // Audio state
  const [volume, setVolume] = useState(1.0)
  const [isMuted, setIsMuted] = useState(false)
  
  // Refs
  const roomRef = useRef(null)
  const audioContextRef = useRef(null)
  const mediaStreamRef = useRef(null)
  const audioElementRef = useRef(null)
  const audioElementsRef = useRef([]) // Track all audio elements for cleanup

  // Get LiveKit token from backend
  const getToken = useCallback(async () => {
    try {
      const response = await fetch(`/api/voice/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identity: `dashboard-${Date.now()}` })
      })
      if (!response.ok) throw new Error('Failed to get token')
      const data = await response.json()
      return data.token
    } catch (err) {
      console.error('Token error:', err)
      throw err
    }
  }, [])

  // Connect to LiveKit room
  const connect = useCallback(async () => {
    try {
      setStatus('connecting')
      setError(null)

      // Dynamic import of LiveKit SDK
      const { Room, RoomEvent, Track, createLocalAudioTrack } = await import('livekit-client')

      const token = await getToken()
      
      const room = new Room({
        adaptiveStream: true,
        dynacast: true,
      })

      // Set up event handlers
      room.on(RoomEvent.Connected, () => {
        // Connected to LiveKit room
        setStatus('connected')
      })

      room.on(RoomEvent.Disconnected, () => {
        // Disconnected from LiveKit room
        setStatus('disconnected')
        setIsListening(false)
      })

      room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
        if (track.kind === Track.Kind.Audio) {
          // Attach remote audio (TTS output)
          const audioElement = track.attach()
          audioElement.volume = volume
          document.body.appendChild(audioElement)
          audioElementRef.current = audioElement
          audioElementsRef.current.push(audioElement) // Track for cleanup
          setIsSpeaking(true)
        }
      })

      room.on(RoomEvent.TrackUnsubscribed, (track) => {
        if (track.kind === Track.Kind.Audio) {
          track.detach()
          setIsSpeaking(false)
        }
      })

      // Handle data messages (transcription)
      room.on(RoomEvent.DataReceived, (data, participant) => {
        try {
          const message = JSON.parse(new TextDecoder().decode(data))
          if (message.type === 'transcript') {
            if (message.final) {
              setMessages(prev => [...prev, {
                role: message.role || 'user',
                content: message.text,
                timestamp: Date.now()
              }])
              setCurrentTranscript('')
            } else {
              setCurrentTranscript(message.text)
            }
          } else if (message.type === 'assistant_speaking') {
            setIsSpeaking(true)
          } else if (message.type === 'assistant_done') {
            setIsSpeaking(false)
          }
        } catch (err) {
          console.error('Error parsing data message:', err)
        }
      })

      // Connect to room
      await room.connect(LIVEKIT_URL, token)
      roomRef.current = room

      // Create and publish local audio track
      const audioTrack = await createLocalAudioTrack({
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      })
      await room.localParticipant.publishTrack(audioTrack)
      mediaStreamRef.current = audioTrack.mediaStream

    } catch (err) {
      console.error('Connection error:', err)
      setError(err.message)
      setStatus('error')
    }
  }, [getToken, volume])

  // Disconnect from room
  const disconnect = useCallback(async () => {
    if (roomRef.current) {
      await roomRef.current.disconnect()
      roomRef.current = null
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop())
      mediaStreamRef.current = null
    }
    // Clean up all audio elements from DOM
    audioElementsRef.current.forEach(el => {
      if (el && el.parentNode) {
        el.parentNode.removeChild(el)
      }
    })
    audioElementsRef.current = []
    audioElementRef.current = null
    setStatus('disconnected')
    setIsListening(false)
  }, [])

  // Toggle listening (mute/unmute local audio)
  const toggleListening = useCallback(async () => {
    if (!roomRef.current) {
      // Connect first
      await connect()
      setIsListening(true)
      return
    }

    const newState = !isListening
    setIsListening(newState)

    // Mute/unmute local audio track
    const localAudio = roomRef.current.localParticipant.getTrackPublications()
    for (const pub of localAudio.values()) {
      if (pub.track?.kind === 'audio') {
        if (newState) {
          await pub.track.unmute()
        } else {
          await pub.track.mute()
        }
      }
    }
  }, [isListening, connect])

  // Mute/unmute playback
  const toggleMute = useCallback(() => {
    setIsMuted(prev => {
      const newMuted = !prev
      if (audioElementRef.current) {
        audioElementRef.current.muted = newMuted
      }
      return newMuted
    })
  }, [])

  // Update volume
  const updateVolume = useCallback((newVolume) => {
    setVolume(newVolume)
    if (audioElementRef.current) {
      audioElementRef.current.volume = newVolume
    }
  }, [])

  // Interrupt (stop AI speaking)
  const interrupt = useCallback(() => {
    if (roomRef.current) {
      // Send interrupt signal via data channel
      const encoder = new TextEncoder()
      roomRef.current.localParticipant.publishData(
        encoder.encode(JSON.stringify({ type: 'interrupt' })),
        { reliable: true }
      )
    }
    setIsSpeaking(false)
  }, [])

  // Clear conversation
  const clearMessages = useCallback(() => {
    setMessages([])
  }, [])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      disconnect()
    }
  }, [disconnect])

  return {
    // State
    status,
    isListening,
    isSpeaking,
    messages,
    currentTranscript,
    error,
    volume,
    isMuted,
    
    // Actions
    connect,
    disconnect,
    toggleListening,
    toggleMute,
    updateVolume,
    interrupt,
    clearMessages,
  }
}

export default useVoiceAgent
