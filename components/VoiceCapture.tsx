'use client'
import { useCallback, useRef, useState } from 'react'

type Status = 'idle' | 'recording' | 'saving' | 'done' | 'error'

// Records mic audio in the browser and POSTs it to /api/brain/voice, which
// transcribes via Whisper and writes the transcript into the vault's _raw/ folder.
export default function VoiceCapture({ onSaved }: { onSaved?: (path: string) => void }) {
  const [status, setStatus] = useState<Status>('idle')
  const [msg, setMsg] = useState('')
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)

  const stopTracks = useCallback(() => {
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
  }, [])

  const upload = useCallback(async (blob: Blob, mime: string) => {
    setStatus('saving')
    setMsg('Transcribing…')
    const ext = mime.includes('mp4') ? 'mp4' : mime.includes('ogg') ? 'ogg' : 'webm'
    const fd = new FormData()
    fd.append('audio', blob, `voice-note.${ext}`)
    try {
      const res = await fetch('/api/brain/voice', { method: 'POST', body: fd })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setStatus('error')
        setMsg(data.error || `Failed (HTTP ${res.status})`)
        return
      }
      setStatus('done')
      setMsg(`Saved → ${data.path}`)
      onSaved?.(data.path)
      setTimeout(() => { setStatus('idle'); setMsg('') }, 4000)
    } catch (e) {
      setStatus('error')
      setMsg((e as Error).message)
    }
  }, [onSaved])

  const start = useCallback(async () => {
    setMsg('')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      const mime = MediaRecorder.isTypeSupported('audio/webm')
        ? 'audio/webm'
        : MediaRecorder.isTypeSupported('audio/mp4')
          ? 'audio/mp4'
          : ''
      const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream)
      chunksRef.current = []
      rec.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data) }
      rec.onstop = () => {
        stopTracks()
        const type = rec.mimeType || 'audio/webm'
        const blob = new Blob(chunksRef.current, { type })
        if (blob.size === 0) { setStatus('idle'); return }
        void upload(blob, type)
      }
      rec.start()
      recorderRef.current = rec
      setStatus('recording')
    } catch (e) {
      setStatus('error')
      setMsg(`Mic access denied: ${(e as Error).message}`)
    }
  }, [stopTracks, upload])

  const stop = useCallback(() => {
    recorderRef.current?.stop()
    recorderRef.current = null
  }, [])

  const busy = status === 'saving'
  const recording = status === 'recording'

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <button
        onClick={recording ? stop : start}
        disabled={busy}
        title={recording ? 'Stop & save to _raw' : 'Record a voice note → _raw'}
        aria-label={recording ? 'Stop recording' : 'Record voice note'}
        style={{
          display: 'flex', alignItems: 'center', gap: 6, cursor: busy ? 'default' : 'pointer',
          fontSize: 12, fontWeight: 600, padding: '5px 12px', borderRadius: 8,
          background: recording ? 'color-mix(in srgb, var(--red) 18%, transparent)' : 'var(--glass-bg)',
          color: recording ? 'var(--red)' : 'var(--text2)',
          border: `1px solid ${recording ? 'color-mix(in srgb, var(--red) 35%, transparent)' : 'var(--glass-border)'}`,
          opacity: busy ? 0.6 : 1,
        }}
      >
        <span style={{
          width: 8, height: 8, borderRadius: '50%',
          background: recording ? 'var(--red)' : 'var(--text3)',
          boxShadow: recording ? '0 0 8px var(--red)' : 'none',
          animation: recording ? 'pulse 1s ease-in-out infinite' : 'none',
        }} />
        {busy ? 'Saving…' : recording ? 'Stop' : 'Voice note'}
      </button>
      {msg && (
        <span style={{ fontSize: 11, color: status === 'error' ? 'var(--red)' : 'var(--text3)', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {msg}
        </span>
      )}
      <style>{`@keyframes pulse { 0%,100% { opacity: 1 } 50% { opacity: 0.35 } }`}</style>
    </div>
  )
}
