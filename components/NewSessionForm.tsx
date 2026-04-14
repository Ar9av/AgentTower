'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface Props {
  projectPath: string
}

export default function NewSessionForm({ projectPath }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [prompt, setPrompt] = useState('')
  const [launching, setLaunching] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!prompt.trim() || launching) return
    setLaunching(true)
    setError('')
    try {
      const res = await fetch('/api/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project_path: projectPath, prompt: prompt.trim() }),
      })
      if (!res.ok) {
        const d = await res.json()
        setError(d.error ?? 'Failed to start session')
        return
      }
      setPrompt('')
      setOpen(false)
      setTimeout(() => router.refresh(), 2000)
    } finally {
      setLaunching(false)
    }
  }

  return (
    <div style={{ marginBottom: open ? 20 : 0 }}>
      {/* Toggle button — always visible */}
      <button
        onClick={() => { setOpen(v => !v); setPrompt(''); setError('') }}
        className="glass-btn"
        style={{
          fontSize: 13,
          padding: '7px 16px',
          borderColor: open ? 'var(--glass-border-hi)' : undefined,
          color: open ? 'var(--text2)' : 'var(--text)',
        }}
      >
        {open ? '✕ Cancel' : '+ New session'}
      </button>

      {/* Inline expanded form — renders as a block BELOW the header */}
      {open && (
        <div
          className="glass"
          style={{
            borderRadius: 12,
            padding: '16px 18px',
            marginTop: 14,
            animation: 'fadeIn 0.15s ease',
          }}
        >
          <p style={{ margin: '0 0 10px', fontSize: 13, color: 'var(--text2)' }}>
            Start a new Claude session in{' '}
            <span style={{ fontFamily: 'ui-monospace, monospace', color: 'var(--accent)', fontSize: 12 }}>
              {projectPath.split('/').pop()}
            </span>
          </p>

          <form onSubmit={handleSubmit} style={{ display: 'flex', gap: 10 }}>
            <textarea
              className="glass-input"
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(e) }
              }}
              placeholder="What do you want Claude to do? (Enter to launch, Shift+Enter for newline)"
              autoFocus
              rows={2}
              style={{ flex: 1, fontSize: 14, padding: '10px 14px', borderRadius: 10, resize: 'none', lineHeight: 1.5 }}
            />
            <button
              type="submit"
              className="glass-btn-prominent"
              disabled={!prompt.trim() || launching}
              style={{ width: 'auto', padding: '0 20px', fontSize: 14, flexShrink: 0, alignSelf: 'stretch' }}
            >
              {launching ? 'Starting…' : 'Launch ↗'}
            </button>
          </form>

          {error && (
            <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--red)' }}>⚠ {error}</p>
          )}
          {launching && (
            <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--text2)' }}>
              Starting Claude… new session will appear shortly.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
