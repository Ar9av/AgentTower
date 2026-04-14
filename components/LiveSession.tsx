'use client'
import { useEffect, useRef, useState, useCallback } from 'react'
import { ParsedMessage, PaginatedSession } from '@/lib/types'
import MessageBlock from './MessageBlock'
import Link from 'next/link'

type ProcState = 'running' | 'paused' | 'dead' | 'unknown'

interface Props {
  initialData: PaginatedSession
  encodedFilepath: string
  sessionId: string
  projectPath: string
  pid: number | null
  processState: ProcState
}

function lastRole(messages: ParsedMessage[]): 'user' | 'assistant' | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (!messages[i].isMeta) return messages[i].role
  }
  return null
}

export default function LiveSession({
  initialData,
  encodedFilepath,
  sessionId,
  projectPath,
  pid: initialPid,
  processState: initialProcState,
}: Props) {
  // ── message state ─────────────────────────────────────────────────────────
  const [firstMessage, setFirstMessage]   = useState<ParsedMessage | null>(initialData.firstMessage)
  const [messages, setMessages]           = useState<ParsedMessage[]>(initialData.messages)
  const [total, setTotal]                 = useState(initialData.total)
  const [hiddenCount, setHiddenCount]     = useState(initialData.hiddenCount)
  const [hasMore, setHasMore]             = useState(initialData.hasMore)
  const [loadingMore, setLoadingMore]     = useState(false)

  // ── process / UI state ────────────────────────────────────────────────────
  const [connected, setConnected]         = useState(false)
  const [procState, setProcState]         = useState<ProcState>(initialProcState)
  const [pid, setPid]                     = useState<number | null>(initialPid)
  const [inputText, setInputText]         = useState('')
  const [sending, setSending]             = useState(false)
  const [wasInterrupted, setWasInterrupted] = useState(false)

  const bottomRef    = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const atBottomRef  = useRef(true)
  const seenUuids    = useRef(new Set([
    ...(initialData.firstMessage ? [initialData.firstMessage.uuid] : []),
    ...initialData.messages.map(m => m.uuid),
  ]))
  const prevState = useRef<ProcState>(initialProcState)

  // ── scroll ────────────────────────────────────────────────────────────────
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
            setTotal(t => t + 1)
          }
        }
      } catch { /* ignore */ }
    }
    return () => es.close()
  }, [encodedFilepath])

  // ── Process state polling ─────────────────────────────────────────────────
  const pollProcessState = useCallback(async () => {
    if (!pid) return
    try {
      const res = await fetch(`/api/process-state?pid=${pid}`)
      if (!res.ok) return
      const { state } = await res.json() as { state: ProcState }
      if (state === 'dead' && (prevState.current === 'running' || prevState.current === 'paused')) {
        setWasInterrupted(lastRole(messages) === 'user')
      }
      prevState.current = state
      setProcState(state)
    } catch { /* ignore */ }
  }, [pid, messages])

  useEffect(() => {
    if (!pid) return
    const id = setInterval(pollProcessState, 3000)
    return () => clearInterval(id)
  }, [pid, pollProcessState])

  // ── Load earlier messages ─────────────────────────────────────────────────
  async function loadMore() {
    if (loadingMore || !hasMore) return
    setLoadingMore(true)
    const oldestUuid = messages[0]?.uuid
    if (!oldestUuid) { setLoadingMore(false); return }

    try {
      const res = await fetch(`/api/session?f=${encodedFilepath}&limit=50&before=${oldestUuid}`)
      if (!res.ok) return
      const data: PaginatedSession = await res.json()

      // Prepend new messages, dedup
      setMessages(prev => {
        const existingUuids = new Set(prev.map(m => m.uuid))
        const newOnes = data.messages.filter(m => !existingUuids.has(m.uuid))
        newOnes.forEach(m => seenUuids.current.add(m.uuid))
        return [...newOnes, ...prev]
      })
      setHiddenCount(data.hiddenCount)
      setHasMore(data.hasMore)
      if (data.firstMessage && !firstMessage) setFirstMessage(data.firstMessage)
    } finally {
      setLoadingMore(false)
    }
  }

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
      if (res.ok) { setInputText(''); setProcState('running') }
    } finally { setSending(false) }
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
      if (pid) {
        await fetch('/api/kill', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pid }) })
        setProcState('dead'); setPid(null)
      }
      const res = await fetch('/api/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project_path: projectPath, prompt: inputText.trim() }),
      })
      if (res.ok) {
        const { pid: newPid } = await res.json()
        setInputText(''); setPid(newPid); setProcState('running'); setWasInterrupted(false)
      }
    } finally { setSending(false) }
  }

  // ── Derived ───────────────────────────────────────────────────────────────
  const isRunning  = procState === 'running'
  const isPaused   = procState === 'paused'
  const isDead     = procState === 'dead' || procState === 'unknown'
  const isThinking = isRunning && lastRole(messages) === 'user'

  // Is the firstMessage already in the visible window?
  const firstInWindow = firstMessage && messages.some(m => m.uuid === firstMessage.uuid)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 56px)' }}>

      {/* ── Header ────────────────────────────────────────────────────── */}
      <div className="glass-lg" style={{
        padding: '10px 24px', display: 'flex', alignItems: 'center', gap: 14,
        flexShrink: 0, borderLeft: 'none', borderRight: 'none', borderTop: 'none', borderRadius: 0,
      }}>
        <Link href="javascript:history.back()" style={{ color: 'var(--text2)', fontSize: 13, textDecoration: 'none' }}>← Back</Link>

        <span style={{
          fontFamily: 'ui-monospace, monospace', fontSize: 11, color: 'var(--text3)',
          background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 6, padding: '2px 8px',
        }}>{sessionId.slice(0, 16)}…</span>

        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span className={connected ? 'dot-live' : ''} style={!connected ? {
            width: 7, height: 7, borderRadius: '50%', background: 'var(--text3)', display: 'inline-block',
          } : {}} />
          <span style={{ fontSize: 12, color: connected ? 'var(--green)' : 'var(--text3)' }}>
            {connected ? 'Live' : 'Connecting…'}
          </span>
        </div>

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span className="chip">{total} messages</span>
          {isRunning && isThinking && <span className="chip chip-green"><span style={{ animation: 'spin 1s linear infinite', display: 'inline-block' }}>⟳</span> Thinking…</span>}
          {isRunning && !isThinking && <span className="chip chip-green">Running</span>}
          {isPaused && <span className="chip chip-yellow">Paused</span>}
          {isDead   && <span className="chip">{wasInterrupted ? 'Interrupted' : 'Finished'}</span>}

          {isRunning && pid && (
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="chip chip-yellow" style={{ cursor: 'pointer', padding: '3px 10px' }}
                onClick={() => fetch('/api/pause', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pid }) }).then(() => setProcState('paused'))}>
                Pause
              </button>
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

      {/* ── Messages ─────────────────────────────────────────────────── */}
      <div ref={containerRef} onScroll={checkAtBottom} style={{ flex: 1, overflowY: 'auto', padding: '24px 28px' }}>
        <div style={{ maxWidth: 840, margin: '0 auto' }}>

          {/* Pinned first message */}
          {firstMessage && !firstInWindow && (
            <>
              <div style={{ marginBottom: 4 }}>
                <span style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Original instruction
                </span>
              </div>
              <MessageBlock message={firstMessage} />

              {/* Load more / hidden count divider */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: 12, margin: '20px 0',
              }}>
                <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.07)' }} />
                <button
                  onClick={loadMore}
                  disabled={loadingMore || !hasMore}
                  style={{
                    background: 'rgba(255,255,255,0.06)',
                    border: '1px solid rgba(255,255,255,0.10)',
                    borderRadius: 99,
                    color: hasMore ? 'var(--accent)' : 'var(--text3)',
                    fontSize: 12,
                    padding: '5px 14px',
                    cursor: hasMore ? 'pointer' : 'default',
                    whiteSpace: 'nowrap',
                    backdropFilter: 'blur(8px)',
                  }}
                >
                  {loadingMore
                    ? 'Loading…'
                    : hasMore
                      ? `↑ Load 50 earlier  ·  ${hiddenCount} hidden`
                      : `${hiddenCount} messages in between`}
                </button>
                <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.07)' }} />
              </div>
            </>
          )}

          {/* Load more button (when first message IS in window but there are still older ones) */}
          {hasMore && (firstInWindow || !firstMessage) && (
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 20 }}>
              <button
                onClick={loadMore}
                disabled={loadingMore}
                style={{
                  background: 'rgba(255,255,255,0.06)',
                  border: '1px solid rgba(255,255,255,0.10)',
                  borderRadius: 99,
                  color: 'var(--accent)',
                  fontSize: 12,
                  padding: '5px 16px',
                  cursor: 'pointer',
                  backdropFilter: 'blur(8px)',
                }}
              >
                {loadingMore ? 'Loading…' : `↑ Load 50 earlier messages`}
              </button>
            </div>
          )}

          {/* Main message window */}
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
                background: 'rgba(255,255,255,0.055)', backdropFilter: 'blur(16px)',
                border: '1px solid rgba(255,255,255,0.09)', borderRadius: '14px 14px 14px 2px',
                padding: '12px 18px', display: 'flex', alignItems: 'center', gap: 8,
                fontSize: 14, color: 'var(--text2)',
              }}>
                <ThinkingDots /> Claude is thinking…
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      </div>

      {/* ── Bottom bar ────────────────────────────────────────────────── */}
      <BottomBar
        procState={procState} wasInterrupted={wasInterrupted}
        inputText={inputText} setInputText={setInputText}
        sending={sending} isThinking={isThinking}
        onSendInput={sendInput} onKillAndRestart={killAndRestart} onResumeProcess={resumeProcess}
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

// ── Sub-components (unchanged from before) ─────────────────────────────────

function ThinkingDots() {
  return (
    <span style={{ display: 'inline-flex', gap: 3, alignItems: 'center' }}>
      {[0, 1, 2].map(i => (
        <span key={i} style={{
          width: 5, height: 5, borderRadius: '50%', background: 'var(--text2)', display: 'inline-block',
          animation: `dot-bounce 1.4s ease-in-out ${i * 0.16}s infinite`,
        }} />
      ))}
    </span>
  )
}

function KillButton({ pid, onKill }: { pid: number; onKill: () => void }) {
  const [confirm, setConfirm] = useState(false)
  async function doKill() {
    await fetch('/api/kill', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pid }) })
    onKill(); setConfirm(false)
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

interface BarProps {
  procState: ProcState; wasInterrupted: boolean
  inputText: string; setInputText: (v: string) => void
  sending: boolean; isThinking: boolean
  onSendInput: (e: React.FormEvent) => void
  onKillAndRestart: (e: React.FormEvent) => void
  onResumeProcess: () => void
  projectPath: string
}

function BottomBar({ procState, wasInterrupted, inputText, setInputText, sending, isThinking, onSendInput, onKillAndRestart, onResumeProcess }: BarProps) {
  const base: React.CSSProperties = { flexShrink: 0, borderLeft: 'none', borderRight: 'none', borderBottom: 'none', borderRadius: 0 }

  if (procState === 'running') return (
    <div className="glass-lg" style={{ padding: '14px 24px', ...base }}>
      <form onSubmit={onSendInput} style={{ display: 'flex', gap: 10, maxWidth: 840, margin: '0 auto' }}>
        <input className="glass-input" value={inputText} onChange={e => setInputText(e.target.value)}
          placeholder={isThinking ? 'Claude is thinking — you can still send a message…' : 'Send a message to this session…'}
          style={{ flex: 1, fontSize: 14, padding: '10px 16px', borderRadius: 12 }} />
        <button type="submit" className="glass-btn-prominent" disabled={!inputText.trim() || sending}
          style={{ width: 'auto', padding: '10px 20px', fontSize: 14, flexShrink: 0 }}>
          {sending ? '…' : 'Send'}
        </button>
      </form>
    </div>
  )

  if (procState === 'paused') return (
    <div className="glass-lg" style={{ padding: '14px 24px', ...base }}>
      <div style={{ maxWidth: 840, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, padding: '8px 14px',
          background: 'rgba(245,200,66,0.08)', border: '1px solid rgba(245,200,66,0.2)', borderRadius: 10, fontSize: 13, color: 'var(--yellow)' }}>
          <span>⏸ Session is paused</span>
          <button className="chip chip-green" onClick={onResumeProcess} style={{ cursor: 'pointer', marginLeft: 'auto', padding: '3px 12px' }}>Resume process</button>
        </div>
        <form onSubmit={onKillAndRestart} style={{ display: 'flex', gap: 10 }}>
          <input className="glass-input" value={inputText} onChange={e => setInputText(e.target.value)}
            placeholder="Or: kill this session and start a new one with this prompt…"
            style={{ flex: 1, fontSize: 14, padding: '10px 16px', borderRadius: 12 }} />
          <button type="submit" className="glass-btn" disabled={!inputText.trim() || sending}
            style={{ width: 'auto', padding: '10px 18px', fontSize: 14, flexShrink: 0, borderColor: 'rgba(255,90,90,0.3)', color: 'var(--red)' }}>
            {sending ? '…' : 'Kill & restart'}
          </button>
        </form>
      </div>
    </div>
  )

  return (
    <div className="glass-lg" style={{ padding: '14px 24px', ...base }}>
      <div style={{ maxWidth: 840, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, padding: '8px 14px',
          background: wasInterrupted ? 'rgba(255,90,90,0.07)' : 'rgba(61,214,140,0.07)',
          border: `1px solid ${wasInterrupted ? 'rgba(255,90,90,0.2)' : 'rgba(61,214,140,0.2)'}`,
          borderRadius: 10, fontSize: 13, color: wasInterrupted ? 'var(--red)' : 'var(--green)' }}>
          <span>{wasInterrupted ? '⚡ Session was interrupted' : '✓ Session complete'}</span>
          <span style={{ color: 'var(--text2)', marginLeft: 4 }}>— {wasInterrupted ? 'Resume or start fresh below' : 'Continue with a follow-up or start a new session'}</span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input className="glass-input" value={inputText} onChange={e => setInputText(e.target.value)}
            placeholder="Type a follow-up to continue, or a new prompt to restart…"
            style={{ flex: 1, fontSize: 14, padding: '10px 16px', borderRadius: 12 }} />
          <button className="glass-btn-prominent" onClick={onSendInput as unknown as React.MouseEventHandler}
            disabled={!inputText.trim() || sending} style={{ width: 'auto', padding: '10px 18px', fontSize: 14, flexShrink: 0 }}
            title="Resume this session thread (claude --resume)">
            {sending ? '…' : 'Continue ↩'}
          </button>
          <button className="glass-btn" onClick={onKillAndRestart as unknown as React.MouseEventHandler}
            disabled={!inputText.trim() || sending} style={{ width: 'auto', padding: '10px 18px', fontSize: 14, flexShrink: 0 }}
            title="Start a fresh session in this project">
            New session ↗
          </button>
        </div>
        <p style={{ margin: '6px 0 0', fontSize: 11, color: 'var(--text3)' }}>
          <strong style={{ color: 'var(--text2)' }}>Continue ↩</strong> resumes this thread &nbsp;·&nbsp;
          <strong style={{ color: 'var(--text2)' }}>New session ↗</strong> starts fresh in the same project
        </p>
      </div>
    </div>
  )
}
