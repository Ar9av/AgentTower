'use client'
import { useEffect, useRef, useState } from 'react'
import { appPath } from '@/lib/base-path'

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;?]*[a-zA-Z]|\x1b\][^\x07]*\x07|\r/g

export default function TerminalView() {
  const [sid, setSid] = useState<string | null>(null)
  const [cwd, setCwd] = useState('')
  const [output, setOutput] = useState('')
  const [input, setInput] = useState('')
  const [history, setHistory] = useState<string[]>([])
  const [historyIdx, setHistoryIdx] = useState(-1)
  const [error, setError] = useState('')
  const [connecting, setConnecting] = useState(true)
  const outputRef = useRef<HTMLPreElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const esRef = useRef<EventSource | null>(null)

  async function startSession() {
    setConnecting(true)
    setError('')
    try {
      const res = await fetch('/api/terminal', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      setSid(data.id)
      setCwd(data.cwd)
      setOutput('')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setConnecting(false)
    }
  }

  useEffect(() => { startSession() }, [])

  useEffect(() => {
    if (!sid) return
    const es = new EventSource(appPath(`/api/terminal?sid=${sid}`))
    esRef.current = es
    es.onmessage = e => {
      setConnecting(false)
      const payload = JSON.parse(e.data)
      if (payload.type === 'output') {
        setOutput(prev => (prev + payload.chunk).replace(ANSI_RE, ''))
      } else if (payload.type === 'error') {
        setError(payload.message)
      }
    }
    es.onerror = () => setConnecting(false)
    return () => es.close()
  }, [sid])

  useEffect(() => {
    outputRef.current?.scrollTo({ top: outputRef.current.scrollHeight })
  }, [output])

  async function sendCommand(cmd: string) {
    if (!sid) return
    await fetch('/api/terminal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sid, input: cmd + '\n' }),
    })
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!input.trim() && input !== '') return
    sendCommand(input)
    setHistory(prev => [...prev, input])
    setHistoryIdx(-1)
    setInput('')
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (history.length === 0) return
      const idx = historyIdx === -1 ? history.length - 1 : Math.max(0, historyIdx - 1)
      setHistoryIdx(idx)
      setInput(history[idx])
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (historyIdx === -1) return
      const idx = historyIdx + 1
      if (idx >= history.length) { setHistoryIdx(-1); setInput('') }
      else { setHistoryIdx(idx); setInput(history[idx]) }
    } else if (e.key === 'c' && e.ctrlKey) {
      e.preventDefault()
      if (sid) fetch('/api/terminal', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sid, input: String.fromCharCode(3) }) })
    }
  }

  async function restart() {
    esRef.current?.close()
    if (sid) await fetch(appPath(`/api/terminal?sid=${sid}`), { method: 'DELETE' })
    setSid(null)
    startSession()
  }

  return (
    <div className="glass" style={{ borderRadius: 16, padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', height: 'min(70vh, 640px)' }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
        borderBottom: '1px solid var(--glass-border)', flexShrink: 0,
      }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: connecting ? 'var(--yellow, #e0a020)' : sid ? 'var(--green, #2ea043)' : '#ff4444', flexShrink: 0 }} />
        <span style={{ fontSize: 12, color: 'var(--text2)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {cwd || (connecting ? 'connecting…' : 'disconnected')}
        </span>
        <button onClick={restart} className="glass-btn" style={{ marginLeft: 'auto', padding: '4px 10px', fontSize: 12 }}>
          Restart
        </button>
      </div>

      {error && (
        <div style={{ padding: '8px 14px', background: '#ff444420', color: '#ff6666', fontSize: 12 }}>{error}</div>
      )}

      <pre
        ref={outputRef}
        style={{
          flex: 1, margin: 0, padding: 14, overflowY: 'auto',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          fontSize: 13, lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-all',
          color: 'var(--text)', background: 'transparent',
        }}
      >
        {output || (connecting ? 'Starting shell…' : '')}
      </pre>

      <form onSubmit={onSubmit} style={{ display: 'flex', borderTop: '1px solid var(--glass-border)', flexShrink: 0 }}>
        <span style={{ padding: '10px 0 10px 14px', color: 'var(--text3)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 13 }}>$</span>
        <input
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={!sid}
          placeholder="Type a command and press Enter…"
          spellCheck={false}
          autoFocus
          style={{
            flex: 1, border: 'none', outline: 'none', background: 'transparent',
            padding: '10px 14px 10px 8px', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            fontSize: 13, color: 'var(--text)',
          }}
        />
      </form>
    </div>
  )
}
