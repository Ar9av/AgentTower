'use client'
import { useState } from 'react'

interface Props {
  pid: number
  state: 'running' | 'paused' | 'dead' | 'unknown'
}

export default function ProcessControls({ pid, state }: Props) {
  const [loading, setLoading] = useState<string | null>(null)
  const [confirm, setConfirm] = useState(false)

  async function send(action: string) {
    setLoading(action)
    try {
      await fetch(`/api/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pid }),
      })
    } finally {
      setLoading(null)
      setConfirm(false)
    }
  }

  if (state === 'dead') return null

  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
      {confirm && (
        <span style={{ fontSize: 12, color: 'var(--red)' }}>Kill session?</span>
      )}

      {state === 'running' && (
        <button
          className="chip chip-yellow"
          onClick={() => send('pause')}
          disabled={loading !== null}
          style={{ cursor: 'pointer', fontSize: 12, padding: '3px 10px' }}
        >
          {loading === 'pause' ? '…' : 'Pause'}
        </button>
      )}

      {state === 'paused' && (
        <button
          className="chip chip-green"
          onClick={() => send('resume')}
          disabled={loading !== null}
          style={{ cursor: 'pointer', fontSize: 12, padding: '3px 10px' }}
        >
          {loading === 'resume' ? '…' : 'Resume'}
        </button>
      )}

      <button
        className="chip chip-red"
        onClick={() => confirm ? send('kill') : setConfirm(true)}
        disabled={loading !== null}
        style={{ cursor: 'pointer', fontSize: 12, padding: '3px 10px' }}
      >
        {loading === 'kill' ? '…' : confirm ? 'Confirm' : 'Kill'}
      </button>

      {confirm && (
        <button
          onClick={() => setConfirm(false)}
          style={{ background: 'none', border: 'none', color: 'var(--text2)', fontSize: 12, cursor: 'pointer', padding: '3px 6px' }}
        >
          ✕
        </button>
      )}
    </div>
  )
}
