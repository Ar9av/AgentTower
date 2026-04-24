'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

// ── Types ──────────────────────────────────────────────────────────────────

export type VoiceLang = 'en-IN' | 'hi-IN' | 'en-US' | 'ta-IN' | 'te-IN'

export const VOICE_LANGS: { code: VoiceLang; label: string; ttsLang: string }[] = [
  { code: 'en-IN', label: 'English (IN)', ttsLang: 'en-IN' },
  { code: 'hi-IN', label: 'Hindi',        ttsLang: 'hi-IN' },
  { code: 'en-US', label: 'English (US)', ttsLang: 'en-US' },
  { code: 'ta-IN', label: 'Tamil',        ttsLang: 'ta-IN' },
  { code: 'te-IN', label: 'Telugu',       ttsLang: 'te-IN' },
]

export interface UseVoiceReturn {
  // Input
  isListening: boolean
  interimTranscript: string
  isSupported: boolean
  lang: VoiceLang
  setLang: (l: VoiceLang) => void
  startListening: (onFinal: (text: string) => void) => void
  stopListening: () => void
  // Wake word ("Hey Claude" / "Hey Jarvis")
  wakeEnabled: boolean
  toggleWake: () => void
  // TTS
  isSpeaking: boolean
  isMuted: boolean
  toggleMute: () => void
  speak: (text: string) => void
  cancelSpeech: () => void
}

// ── Constants ──────────────────────────────────────────────────────────────

const WAKE_PHRASES = ['hey claude', 'hey jarvis', 'jarvis', 'ok claude', 'claude']

// ── webkitSpeechRecognition type shim ─────────────────────────────────────

declare global {
  interface Window {
    webkitSpeechRecognition?: typeof SpeechRecognition
  }
}

// ── Hook ──────────────────────────────────────────────────────────────────

export function useVoice(): UseVoiceReturn {
  // ── React state (drives re-renders) ──────────────────────────────────────
  const [isListening,       setIsListening]       = useState(false)
  const [interimTranscript, setInterimTranscript] = useState('')
  const [isSupported,       setIsSupported]       = useState(false)
  const [lang,              setLangState]         = useState<VoiceLang>('en-IN')
  const [wakeEnabled,       setWakeEnabled]       = useState(false)
  const [isSpeaking,        setIsSpeaking]        = useState(false)
  const [isMuted,           setIsMuted]           = useState(false)

  // ── Mutable refs (avoid stale closures, never cause re-renders) ──────────
  // All recognition machinery lives here and is set up once inside useEffect.
  const core = useRef({
    recog:       null as SpeechRecognition | null,
    lang:        'en-IN' as VoiceLang,
    wakeEnabled: false,
    isMuted:     false,
    onFinal:     null as ((t: string) => void) | null,
    // Self-reference: startRecog assigned below inside useEffect so it can
    // call itself recursively without stale-closure issues.
    startRecog:  (_phase: 'wake' | 'command') => {},
  })

  // ── One-time setup: build the recognition state machine ──────────────────
  useEffect(() => {
    if (typeof window === 'undefined') return

    const supported = !!(window.SpeechRecognition ?? window.webkitSpeechRecognition)
    setIsSupported(supported)
    if (!supported) return

    // Single SpeechRecognition instance drives two phases:
    // 'wake'    — continuous low-priority, looks for trigger phrases
    // 'command' — high-priority, captures the actual user utterance
    function startRecog(phase: 'wake' | 'command') {
      const SR = window.SpeechRecognition ?? window.webkitSpeechRecognition
      if (!SR) return

      // Abort any existing instance before starting a new one
      if (core.current.recog) {
        core.current.recog.abort()
        core.current.recog = null
      }

      const recog = new SR()
      recog.lang            = phase === 'command' ? core.current.lang : 'en-IN'
      recog.continuous      = false
      recog.interimResults  = phase === 'command'
      recog.maxAlternatives = 1

      if (phase === 'command') setIsListening(true)

      recog.onresult = (e: SpeechRecognitionEvent) => {
        if (phase === 'wake') {
          // Check every result for a wake phrase
          for (let i = e.resultIndex; i < e.results.length; i++) {
            const transcript = e.results[i][0].transcript.toLowerCase().trim()
            if (WAKE_PHRASES.some(w => transcript.includes(w))) {
              // Wake phrase detected — immediately switch to command phase
              core.current.startRecog('command')
              return
            }
          }
        } else {
          // Command phase — collect interim and final results
          let interim = ''
          let final   = ''
          for (let i = e.resultIndex; i < e.results.length; i++) {
            const t = e.results[i][0].transcript
            if (e.results[i].isFinal) final   += t
            else                       interim += t
          }
          setInterimTranscript(interim)
          if (final && core.current.onFinal) {
            core.current.onFinal(final.trim())
          }
        }
      }

      recog.onend = () => {
        core.current.recog = null
        if (phase === 'command') {
          setIsListening(false)
          setInterimTranscript('')
          // Return to wake-word listening if still enabled
          if (core.current.wakeEnabled) {
            setTimeout(() => core.current.startRecog('wake'), 300)
          }
        } else if (core.current.wakeEnabled) {
          // Wake phase ended naturally (no-speech timeout) — restart
          setTimeout(() => core.current.startRecog('wake'), 150)
        }
      }

      recog.onerror = (e: SpeechRecognitionErrorEvent) => {
        core.current.recog = null
        if (phase === 'command') {
          setIsListening(false)
          setInterimTranscript('')
          if (core.current.wakeEnabled) {
            setTimeout(() => core.current.startRecog('wake'), 500)
          }
        } else if (core.current.wakeEnabled && e.error !== 'aborted') {
          const delay = e.error === 'no-speech' ? 150 : 1000
          setTimeout(() => core.current.startRecog('wake'), delay)
        }
      }

      core.current.recog = recog
      try {
        recog.start()
      } catch {
        // Browser may throw if recognition is already starting
        core.current.recog = null
        if (phase === 'command') setIsListening(false)
      }
    }

    // Assign to ref so the function can reference itself recursively
    core.current.startRecog = startRecog

    return () => {
      // Cleanup: abort recognition and cancel any ongoing speech
      core.current.recog?.abort()
      core.current.recog = null
      window.speechSynthesis?.cancel()
    }
  }, []) // ← intentionally empty: the entire recognition engine is stable

  // ── Exposed actions ───────────────────────────────────────────────────────

  const setLang = useCallback((l: VoiceLang) => {
    core.current.lang = l
    setLangState(l)
  }, [])

  const startListening = useCallback((onFinal: (text: string) => void) => {
    core.current.onFinal = onFinal
    core.current.startRecog('command')
  }, [])

  const stopListening = useCallback(() => {
    core.current.recog?.stop()
    setIsListening(false)
    setInterimTranscript('')
  }, [])

  const toggleWake = useCallback(() => {
    setWakeEnabled(prev => {
      const next = !prev
      core.current.wakeEnabled = next
      if (next) {
        core.current.startRecog('wake')
      } else {
        core.current.recog?.abort()
        core.current.recog = null
      }
      return next
    })
  }, [])

  const speak = useCallback((text: string) => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return
    if (core.current.isMuted || !text.trim()) return
    window.speechSynthesis.cancel()
    const utt       = new SpeechSynthesisUtterance(text.slice(0, 500))
    const langEntry = VOICE_LANGS.find(l => l.code === core.current.lang)
    utt.lang        = langEntry?.ttsLang ?? 'en-IN'
    utt.rate        = 1.05
    utt.pitch       = 1.0
    utt.volume      = 0.9
    utt.onstart     = () => setIsSpeaking(true)
    utt.onend       = () => setIsSpeaking(false)
    utt.onerror     = () => setIsSpeaking(false)
    window.speechSynthesis.speak(utt)
  }, [])

  const cancelSpeech = useCallback(() => {
    if (typeof window !== 'undefined') {
      window.speechSynthesis?.cancel()
      setIsSpeaking(false)
    }
  }, [])

  const toggleMute = useCallback(() => {
    setIsMuted(prev => {
      const next = !prev
      core.current.isMuted = next
      if (next && typeof window !== 'undefined') {
        window.speechSynthesis?.cancel()
        setIsSpeaking(false)
      }
      return next
    })
  }, [])

  return {
    isListening, interimTranscript, isSupported, lang, setLang,
    startListening, stopListening,
    wakeEnabled, toggleWake,
    isSpeaking, isMuted, toggleMute, speak, cancelSpeech,
  }
}
