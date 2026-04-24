'use client'

import { useState } from 'react'
import { VOICE_LANGS, UseVoiceReturn } from '@/hooks/useVoice'

interface VoiceBarProps {
  voice: UseVoiceReturn
  onTranscript: (text: string) => void
  /** Compact mode for tighter layouts (paused / dead bars) */
  compact?: boolean
}

export default function VoiceBar({ voice, onTranscript, compact = false }: VoiceBarProps) {
  const [langOpen, setLangOpen] = useState(false)

  // Don't render anything if browser doesn't support speech
  if (!voice.isSupported) return null

  const { isListening, interimTranscript, wakeEnabled, isMuted, isSpeaking, lang } = voice
  const h = compact ? 36 : 44
  const pad = compact ? '6px 9px' : '8px 12px'

  function handleMic() {
    if (isListening) {
      voice.stopListening()
    } else {
      voice.startListening(onTranscript)
    }
  }

  const currentLang = VOICE_LANGS.find(l => l.code === lang) ?? VOICE_LANGS[0]

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0, position: 'relative' }}>

      {/* ── Mic button ─────────────────────────────────────────── */}
      <button
        type="button"
        onClick={handleMic}
        title={isListening ? 'Stop listening (click to stop)' : 'Voice input'}
        aria-label={isListening ? 'Stop voice input' : 'Start voice input'}
        style={{
          display:        'inline-flex',
          alignItems:     'center',
          gap:            5,
          minHeight:      h,
          padding:        pad,
          background:     isListening
            ? 'color-mix(in srgb, var(--red) 18%, var(--glass-bg))'
            : 'var(--glass-bg)',
          border:         `1px solid ${isListening
            ? 'color-mix(in srgb, var(--red) 45%, transparent)'
            : 'var(--glass-border)'}`,
          borderRadius:   10,
          cursor:         'pointer',
          fontSize:       16,
          color:          isListening ? 'var(--red)' : 'var(--text)',
          transition:     'all 0.15s',
          position:       'relative',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          whiteSpace:     'nowrap',
          maxWidth:       isListening ? 160 : undefined,
          overflow:       'hidden',
        }}
      >
        <span style={{ fontSize: 15 }}>{isListening ? '⏹' : '🎤'}</span>
        {isListening && (
          <span style={{ fontSize: 11, color: 'var(--red)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {interimTranscript
              ? interimTranscript.slice(0, 18) + (interimTranscript.length > 18 ? '…' : '')
              : 'Listening…'}
          </span>
        )}
        {/* Pulsing red dot while listening */}
        {isListening && (
          <span style={{
            position:   'absolute',
            top:        3,
            right:      3,
            width:      7,
            height:     7,
            borderRadius: '50%',
            background: 'var(--red)',
            animation:  'pulse-glow 1.1s ease-in-out infinite',
          }} />
        )}
      </button>

      {/* ── Speaker / mute button ───────────────────────────────── */}
      <button
        type="button"
        onClick={voice.toggleMute}
        title={isMuted ? 'Unmute voice output' : isSpeaking ? 'Speaking (click to mute)' : 'Mute voice output'}
        aria-label={isMuted ? 'Unmute' : 'Mute voice output'}
        style={{
          display:        'inline-flex',
          alignItems:     'center',
          justifyContent: 'center',
          minHeight:      h,
          padding:        pad,
          background:     isSpeaking
            ? 'color-mix(in srgb, var(--accent) 15%, var(--glass-bg))'
            : 'var(--glass-bg)',
          border:         `1px solid ${isSpeaking
            ? 'color-mix(in srgb, var(--accent) 35%, transparent)'
            : 'var(--glass-border)'}`,
          borderRadius:   10,
          cursor:         'pointer',
          fontSize:       16,
          color:          isMuted ? 'var(--text3)' : isSpeaking ? 'var(--accent)' : 'var(--text2)',
          transition:     'all 0.15s',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
        }}
      >
        {isMuted ? '🔇' : isSpeaking ? '🔊' : '🔈'}
      </button>

      {/* ── Wake word toggle ────────────────────────────────────── */}
      <button
        type="button"
        onClick={voice.toggleWake}
        title={wakeEnabled ? 'Wake word ON — say "Hey Claude" to activate' : 'Enable wake word ("Hey Claude")'}
        aria-label={wakeEnabled ? 'Disable wake word' : 'Enable wake word'}
        style={{
          display:        'inline-flex',
          alignItems:     'center',
          justifyContent: 'center',
          minHeight:      h,
          padding:        pad,
          background:     wakeEnabled
            ? 'color-mix(in srgb, var(--green) 15%, var(--glass-bg))'
            : 'var(--glass-bg)',
          border:         `1px solid ${wakeEnabled
            ? 'color-mix(in srgb, var(--green) 40%, transparent)'
            : 'var(--glass-border)'}`,
          borderRadius:   10,
          cursor:         'pointer',
          fontSize:       compact ? 13 : 14,
          fontWeight:     600,
          color:          wakeEnabled ? 'var(--green)' : 'var(--text3)',
          transition:     'all 0.15s',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          whiteSpace:     'nowrap',
          gap:            4,
        }}
      >
        <span>👂</span>
        {wakeEnabled && <span style={{ fontSize: 10 }}>ON</span>}
      </button>

      {/* ── Language picker ─────────────────────────────────────── */}
      <div style={{ position: 'relative' }}>
        <button
          type="button"
          onClick={() => setLangOpen(v => !v)}
          title="Select speech language"
          style={{
            display:        'inline-flex',
            alignItems:     'center',
            gap:            3,
            minHeight:      h,
            padding:        pad,
            background:     'var(--glass-bg)',
            border:         '1px solid var(--glass-border)',
            borderRadius:   10,
            cursor:         'pointer',
            fontSize:       11,
            fontWeight:     600,
            color:          'var(--text2)',
            whiteSpace:     'nowrap',
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
          }}
        >
          <span>{currentLang.label}</span>
          <span style={{ fontSize: 9, opacity: 0.6 }}>▾</span>
        </button>

        {langOpen && (
          <>
            {/* Invisible backdrop to close on outside click */}
            <div
              onClick={() => setLangOpen(false)}
              style={{ position: 'fixed', inset: 0, zIndex: 48 }}
            />
            <div style={{
              position:   'absolute',
              bottom:     'calc(100% + 6px)',
              right:      0,
              background: 'var(--bg2)',
              border:     '1px solid var(--glass-border)',
              borderRadius: 10,
              padding:    4,
              zIndex:     50,
              minWidth:   148,
              boxShadow:  'var(--shadow-lg)',
            }}>
              {VOICE_LANGS.map(l => (
                <button
                  key={l.code}
                  type="button"
                  onClick={() => { voice.setLang(l.code); setLangOpen(false) }}
                  style={{
                    display:      'block',
                    width:        '100%',
                    background:   l.code === lang ? 'var(--glass-bg-hover)' : 'transparent',
                    border:       'none',
                    padding:      '8px 12px',
                    fontSize:     13,
                    color:        'var(--text)',
                    cursor:       'pointer',
                    borderRadius: 7,
                    textAlign:    'left',
                    fontWeight:   l.code === lang ? 700 : 400,
                    transition:   'background 0.1s',
                  }}
                >
                  {l.label}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
