'use client'
import { useEffect, useRef, useState, useCallback } from 'react'
import { ParsedMessage } from '@/lib/types'
import MessageBlock from './MessageBlock'
import Link from 'next/link'

type ProcState = 'running' | 'paused' | 'dead' | 'unknown'

interface Props {
  initialMessages: ParsedMessage[]
  encodedFilepath: string
  sessionId: string
  projectPath: string          // abs path to project dir — for "restart" spawning
  pid: number | null
  processState: ProcState
}

// ── helpers ────────────────────────────────────────────────────────────────

function lastRole(messages: ParsedMessage[]): 'user' | 'assistant' | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (!messages[i].isMeta) return messages[i].role
  }
  return null
}

// ── component ──────────────────────────────────────────────────────────────

export default function LiveSession({
  initialMessages,
  encodedFilepath,
  sessionId,
  projectPath,
  pid: initialPid,
  processState: initialProcState,
}: Props) {
  const [messages, setMessages]     = useState<ParsedMessage[]>(initialMessages.filter(m => !m.isMeta))
  const [connected, setConnected]   = useState(false)
  const [procState, setProcState]   = useState<ProcState>(initialProcState)
  const [pid, setPid]               = useState<number | null>(initialPid)
  const [inputText, setInputText]   = useState('')
  const [sending, setSending]       = useState(false)
  const [wasInterrupted, setWasInterrupted] = useState(false)

  const bottomRef   = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const atBottomRef  = useRef(true)
  const seenUuids    = useRef(new Set(initialMessages.map(m => m.uuid)))
  const prevState    = useRef<ProcState>(initialProcState)

  // ── scroll helpers ────────────────────────────────────────────────────────

  function checkAtBottom() {
    const el = containerRef.current
    if (!el) return
    atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
  }

  function scrollToBottom() {
    if (atBottomRef.current) bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => { scrollToBottom() }, [messages])

  // ── SSE tail ──────────────────────────────────────────────────────────────

  useEffect(() => {
    const es = new EventSource(`/api/tail?f=${encodedFilepath}`)
    es.onopen  = () => setConnected(true)
    es.onerror = () => setConnected(false)
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data)
        if (data.type === 'catchup') return
        if (data.type === 'message') {
          const msg: ParsedMessage = data.message
          if (!seenUuids.current.has(msg.uuid)) {
            seenUuids.current.add(msg.uuid)
            setMessages(prev => [...prev, msg])
          }
        }
      } catch { /* ignore */ }
    }
    return () => es.close()
  }, [encodedFilepath])

  // ── Process state polling (every 3s when we have a PID) ──────────────────

  const pollProcessState = useCallback(async () => {
    if (!pid) return
    try {
      const res = await fetch(`/api/process-state?pid=${pid}`)
      if (!res.ok) return
      const { state } = await res.json() as { state: ProcState }

      // Detect interrupted: was running/paused, now dead, last message was user
      if (
        state === 'dead' &&
        (prevState.current === 'running' || prevState.current === 'paused')
      ) {
        const lr = lastRole(messages)
        setWasInterrupted(lr === 'user')
      }

      prevState.current = state
      setProcState(state)
    } catch { /* ignore network errors */ }
  }, [pid, messages])

  useEffect(() => {
    if (!pid) return
    const id = setInterval(pollProcessState, 3000)
    return () => clearInterval(id)
  }, [pid, pollProcessState])

  // ── Actions ───────────────────────────────────────────────────────────────

  async function sendInput(e: React.FormEvent) {
    e.preventDefault()
    if (!inputText.trim() || sending) return
    setSending(true)
    try {
      const res = await fetch('/api/input', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId, prompt: inputText.trim() }),
      })
      if (res.ok) {
        setInputText('')
        // A new process was spawned — poll for its PID
        pollForNewPid()
      }
    } finally {
      setSending(false)
    }
  }

  async function resumeProcess() {
    if (!pid) return
    await fetch('/api/resume', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pid }),
    })
    setProcState('running')
  }

  async function killAndRestart(e: React.FormEvent) {
    e.preventDefault()
    if (!inputText.trim() || sending) return
    setSending(true)
    try {
      // Kill existing process
      if (pid) {
        await fetch('/api/kill', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pid }),
        })
        setProcState('dead')
        setPid(null)
      }
      // Start fresh in same project
      const res = await fetch('/api/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project_path: projectPath, prompt: inputText.trim() }),
      })
      if (res.ok) {
        const { pid: newPid } = await res.json()
        setInputText('')
        setPid(newPid)
        setProcState('running')
        setWasInterrupted(false)
        pollForNewPid()
      }
    } finally {
      setSending(false)
    }
  }

  // After spawning a new process via /api/input or /api/run,
  // the new PID isn't immediately available — the Claude process writes its session file
  // asynchronously. Poll /api/process-state for a few seconds to pick it up.
  function pollForNewPid() {
    // Optimistically mark as running; the SSE tail will pick up new messages
    setProcState('running')
  }

  // ── Derived UI state ──────────────────────────────────────────────────────

  const isRunning  = procState === 'running'
  const isPaused   = procState === 'paused'
  const isDead     = procState === 'dead' || procState === 'unknown'
  const isThinking = isRunning && lastRole(messages) === 'user'
  const msgCount   = messages.length

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 56px)' }}>

      {/* ── Header bar ─────────────────────────────────────────────────── */}
      <div className="glass-lg" style={{
        padding: '10px 24px',
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        flexShrink: 0,
        borderLeft: 'none',
        borderRight: 'none',
        borderTop: 'none',
        borderRadius: 0,
      }}>
        <Link href="javascript:history.back()" style={{ color: 'var(--text2)', fontSize: 13, textDecoration: 'none' }}>
          ← Back
        </Link>

        <span style={{
          fontFamily: 'ui-monospace, monospace',
          fontSize: 11,
          color: 'var(--text3)',
          background: 'rgba(255,255,255,0.05)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 6,
          padding: '2px 8px',
        }}>
          {sessionId.slice(0, 16)}…
        </span>

        {/* Connection dot */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span className={connected ? 'dot-live' : ''} style={!connected ? {
            width: 7, height: 7, borderRadius: '50%', background: 'var(--text3)', display: 'inline-block',
          } : {}} />
          <span style={{ fontSize: 12, color: connected ? 'var(--green)' : 'var(--text3)' }}>
            {connected ? 'Live' : 'Connecting…'}
          </span>
        </div>

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
          {msgCount > 0 && <span className="chip">{msgCount} messages</span>}

          {/* Process status chip */}
          {isRunning && isThinking && (
            <span className="chip chip-green" style={{ gap: 5 }}>
              <span style={{ display: 'inline-block', animation: 'spin 1s linear infinite' }}>⟳</span>
              Thinking…
            </span>
          )}
          {isRunning && !isThinking && <span className="chip chip-green">Running</span>}
          {isPaused  && <span className="chip chip-yellow">Paused</span>}
          {isDead    && <span className="chip">{wasInterrupted ? 'Interrupted' : 'Finished'}</span>}

          {/* Pause/Resume/Kill — only when process is live */}
          {isRunning && pid && (
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                className="chip chip-yellow"
                onClick={() => fetch('/api/pause', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pid }) }).then(() => setProcState('paused'))}
                style={{ cursor: 'pointer', padding: '3px 10px' }}
              >Pause</button>
              <KillButton pid={pid} onKill={() => { setProcState('dead'); setWasInterrupted(true) }} />
            </div>
          )}
          {isPaused && pid && (
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="chip chip-green" onClick={resumeProcess} style={{ cursor: 'pointer', padding: '3px 10px' }}>Resume</button>
              <KillButton pid={pid} onKill={() => { setProcState('dead'); setWasInterrupted(true) }} />
            </div>
          )}
        </div>
      </div>

      {/* ── Messages ───────────────────────────────────────────────────── */}
      <div ref={containerRef} onScroll={checkAtBottom} style={{ flex: 1, overflowY: 'auto', padding: '24px 28px' }}>
        <div style={{ maxWidth: 840, margin: '0 auto' }}>
          {messages.length === 0 ? (
            <div style={{ textAlign: 'center', color: 'var(--text2)', marginTop: 80 }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>💬</div>
              <p>No messages yet</p>
            </div>
          ) : (
            messages.map(msg => <MessageBlock key={msg.uuid} message={msg} />)
          )}

          {/* Thinking indicator */}
          {isThinking && (
            <div style={{ display: 'flex', justifyContent: 'flex-start', margin: '12px 0' }}>
              <div style={{
                background: 'rgba(255,255,255,0.055)',
                backdropFilter: 'blur(16px)',
                border: '1px solid rgba(255,255,255,0.09)',
                borderRadius: '14px 14px 14px 2px',
                padding: '12px 18px',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                fontSize: 14,
                color: 'var(--text2)',
              }}>
                <ThinkingDots /> Claude is thinking…
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      </div>

      {/* ── Bottom action bar — contextual per state ───────────────────── */}
      <BottomBar
        procState={procState}
        wasInterrupted={wasInterrupted}
        inputText={inputText}
        setInputText={setInputText}
        sending={sending}
        isThinking={isThinking}
        onSendInput={sendInput}
        onKillAndRestart={killAndRestart}
        onResumeProcess={resumeProcess}
        projectPath={projectPath}
      />

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes dot-bounce {
          0%, 80%, 100% { transform: translateY(0); opacity: .4; }
          40% { transform: translateY(-5px); opacity: 1; }
        }
      `}</style>
    </div>
  )
}

// ── Thinking dots animation ────────────────────────────────────────────────

function ThinkingDots() {
  return (
    <span style={{ display: 'inline-flex', gap: 3, alignItems: 'center' }}>
      {[0, 1, 2].map(i => (
        <span key={i} style={{
          width: 5, height: 5, borderRadius: '50%', background: 'var(--text2)',
          display: 'inline-block',
          animation: `dot-bounce 1.4s ease-in-out ${i * 0.16}s infinite`,
        }} />
      ))}
    </span>
  )
}

// ── Kill button with confirm ───────────────────────────────────────────────

function KillButton({ pid, onKill }: { pid: number; onKill: () => void }) {
  const [confirm, setConfirm] = useState(false)

  async function doKill() {
    await fetch('/api/kill', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pid }),
    })
    onKill()
    setConfirm(false)
  }

  return confirm ? (
    <span style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
      <button className="chip chip-red" onClick={doKill} style={{ cursor: 'pointer', padding: '3px 10px' }}>Confirm kill</button>
      <button onClick={() => setConfirm(false)} style={{ background: 'none', border: 'none', color: 'var(--text2)', fontSize: 12, cursor: 'pointer' }}>✕</button>
    </span>
  ) : (
    <button className="chip chip-red" onClick={() => setConfirm(true)} style={{ cursor: 'pointer', padding: '3px 10px' }}>Kill</button>
  )
}

// ── Bottom bar — switches based on process state ───────────────────────────

interface BarProps {
  procState: ProcState
  wasInterrupted: boolean
  inputText: string
  setInputText: (v: string) => void
  sending: boolean
  isThinking: boolean
  onSendInput: (e: React.FormEvent) => void
  onKillAndRestart: (e: React.FormEvent) => void
  onResumeProcess: () => void
  projectPath: string
}

function BottomBar({
  procState, wasInterrupted, inputText, setInputText, sending, isThinking,
  onSendInput, onKillAndRestart, onResumeProcess, projectPath,
}: BarProps) {
  const barStyle: React.CSSProperties = {
    flexShrink: 0,
    borderLeft: 'none',
    borderRight: 'none',
    borderBottom: 'none',
    borderRadius: 0,
  }

  // ── RUNNING: mid-conversation injection ─────────────────────────────────
  if (procState === 'running') {
    return (
      <div className="glass-lg" style={{ padding: '14px 24px', ...barStyle }}>
        <form onSubmit={onSendInput} style={{ display: 'flex', gap: 10, maxWidth: 840, margin: '0 auto' }}>
          <input
            className="glass-input"
            value={inputText}
            onChange={e => setInputText(e.target.value)}
            placeholder={isThinking ? 'Claude is thinking — you can still send a message…' : 'Send a message to this session…'}
            style={{ flex: 1, fontSize: 14, padding: '10px 16px', borderRadius: 12 }}
          />
          <button
            type="submit"
            className="glass-btn-prominent"
            disabled={!inputText.trim() || sending}
            style={{ width: 'auto', padding: '10px 20px', fontSize: 14, flexShrink: 0 }}
          >
            {sending ? '…' : 'Send'}
          </button>
        </form>
      </div>
    )
  }

  // ── PAUSED: resume or kill+restart with message ─────────────────────────
  if (procState === 'paused') {
    return (
      <div className="glass-lg" style={{ padding: '14px 24px', ...barStyle }}>
        <div style={{ maxWidth: 840, margin: '0 auto' }}>
          {/* Status banner */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            marginBottom: 10,
            padding: '8px 14px',
            background: 'rgba(245,200,66,0.08)',
            border: '1px solid rgba(245,200,66,0.2)',
            borderRadius: 10,
            fontSize: 13,
            color: 'var(--yellow)',
          }}>
            <span>⏸</span>
            <span>Session is paused</span>
            <button
              className="chip chip-green"
              onClick={onResumeProcess}
              style={{ cursor: 'pointer', marginLeft: 'auto', padding: '3px 12px' }}
            >
              Resume process
            </button>
          </div>

          {/* Kill + restart with new message */}
          <form onSubmit={onKillAndRestart} style={{ display: 'flex', gap: 10 }}>
            <input
              className="glass-input"
              value={inputText}
              onChange={e => setInputText(e.target.value)}
              placeholder="Or: kill this session and start a new one with this prompt…"
              style={{ flex: 1, fontSize: 14, padding: '10px 16px', borderRadius: 12 }}
            />
            <button
              type="submit"
              className="glass-btn"
              disabled={!inputText.trim() || sending}
              style={{ width: 'auto', padding: '10px 18px', fontSize: 14, flexShrink: 0, borderColor: 'rgba(255,90,90,0.3)', color: 'var(--red)' }}
            >
              {sending ? '…' : 'Kill & restart'}
            </button>
          </form>
        </div>
      </div>
    )
  }

  // ── DEAD: continue (resume) or start fresh ──────────────────────────────
  return (
    <div className="glass-lg" style={{ padding: '14px 24px', ...barStyle }}>
      <div style={{ maxWidth: 840, margin: '0 auto' }}>
        {/* Status banner */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginBottom: 10,
          padding: '8px 14px',
          background: wasInterrupted ? 'rgba(255,90,90,0.07)' : 'rgba(61,214,140,0.07)',
          border: `1px solid ${wasInterrupted ? 'rgba(255,90,90,0.2)' : 'rgba(61,214,140,0.2)'}`,
          borderRadius: 10,
          fontSize: 13,
          color: wasInterrupted ? 'var(--red)' : 'var(--green)',
        }}>
          <span>{wasInterrupted ? '⚡ Session was interrupted' : '✓ Session complete'}</span>
          <span style={{ color: 'var(--text3)', marginLeft: 4 }}>—</span>
          <span style={{ color: 'var(--text2)' }}>
            {wasInterrupted ? 'Resume the conversation or start fresh below' : 'Continue with a follow-up or start a new session'}
          </span>
        </div>

        {/* Two-mode input */}
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            className="glass-input"
            value={inputText}
            onChange={e => setInputText(e.target.value)}
            placeholder="Type a follow-up to continue, or a new prompt to restart…"
            style={{ flex: 1, fontSize: 14, padding: '10px 16px', borderRadius: 12 }}
          />
          {/* Continue = resume same session thread */}
          <button
            className="glass-btn-prominent"
            onClick={onSendInput as unknown as React.MouseEventHandler}
            disabled={!inputText.trim() || sending}
            style={{ width: 'auto', padding: '10px 18px', fontSize: 14, flexShrink: 0 }}
            title="Resume this session with a follow-up (claude --resume)"
          >
            {sending ? '…' : 'Continue ↩'}
          </button>
          {/* Restart = new session in same project */}
          <button
            className="glass-btn"
            onClick={onKillAndRestart as unknown as React.MouseEventHandler}
            disabled={!inputText.trim() || sending}
            style={{ width: 'auto', padding: '10px 18px', fontSize: 14, flexShrink: 0 }}
            title="Start a brand new session in this project directory"
          >
            New session ↗
          </button>
        </div>

        <p style={{ margin: '6px 0 0', fontSize: 11, color: 'var(--text3)' }}>
          <strong style={{ color: 'var(--text2)' }}>Continue ↩</strong> resumes this conversation thread &nbsp;·&nbsp;
          <strong style={{ color: 'var(--text2)' }}>New session ↗</strong> starts fresh in the same project
        </p>
      </div>
    </div>
  )
}
