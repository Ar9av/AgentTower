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

      // Give Claude a moment to write the session file, then refresh
      setTimeout(() => router.refresh(), 2000)
    } finally {
      setLaunching(false)
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="glass-btn-prominent"
        style={{ width: 'auto', padding: '8px 18px', fontSize: 13 }}
      >
        + New session
      </button>
    )
  }

  return (
    <div className="glass" style={{ borderRadius: 14, padding: '16px 20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>New session in <code style={{ fontFamily: 'ui-monospace, monospace', color: 'var(--accent)', fontSize: 12 }}>{projectPath.split('/').pop()}</code></span>
        <button onClick={() => { setOpen(false); setPrompt('') }} style={{ background: 'none', border: 'none', color: 'var(--text2)', fontSize: 16, cursor: 'pointer', lineHeight: 1 }}>✕</button>
      </div>

      <form onSubmit={handleSubmit} style={{ display: 'flex', gap: 10 }}>
        <textarea
          className="glass-input"
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(e) } }}
          placeholder="What do you want Claude to do? (Enter to send, Shift+Enter for newline)"
          autoFocus
          rows={2}
          style={{ flex: 1, fontSize: 14, padding: '10px 14px', borderRadius: 10, resize: 'none', lineHeight: 1.5 }}
        />
        <button
          type="submit"
          className="glass-btn-prominent"
          disabled={!prompt.trim() || launching}
          style={{ width: 'auto', padding: '10px 20px', fontSize: 14, flexShrink: 0, alignSelf: 'flex-end' }}
        >
          {launching ? 'Starting…' : 'Launch ↗'}
        </button>
      </form>

      {error && <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--red)' }}>⚠ {error}</p>}
      {launching && (
        <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--text2)' }}>
          Starting Claude… the new session will appear in the list in a moment.
        </p>
      )}
    </div>
  )
}
