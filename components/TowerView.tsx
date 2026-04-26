'use client'

import { useState, useEffect, useRef, useCallback, CSSProperties } from 'react'
import Link from 'next/link'
import type { RecentSession } from '@/lib/claude-fs'
import type { PaginatedSession, ParsedMessage, ProjectInfo, SessionInfo } from '@/lib/types'

// ── Sprite sheet constants ─────────────────────────────────────────────────
const CELL_PX = 288
const SHEET_COLS = 4
const SHEET_ROWS = 2
const DISP = 76

const ROW = { AGENT: 0, COMMANDER: 1 }
const COL = { IDLE: 0, WORKING: 1, DONE: 2, SIGNAL: 3 }

type AgentState = 'idle' | 'working' | 'done' | 'signal'

const STATE_COL: Record<AgentState, number> = {
  idle: COL.IDLE, working: COL.WORKING, done: COL.DONE, signal: COL.SIGNAL,
}
const STATE_ANIM_CLASS: Record<AgentState, string> = {
  idle: 'tower-agent-idle', working: 'tower-agent-working',
  done: 'tower-agent-done', signal: 'tower-agent-signal',
}
const STATE_LABEL_COLOR: Record<AgentState, string> = {
  idle: 'var(--text3)', working: 'var(--green)', done: 'var(--accent)', signal: 'var(--yellow)',
}
const STATE_LABEL: Record<AgentState, string> = {
  idle: 'idle', working: 'working…', done: 'done!', signal: 'signaling',
}

// Models — passed as --model <alias> to the claude CLI
const MODELS: Array<{ value: string; label: string; emoji: string }> = [
  { value: 'sonnet', label: 'Sonnet 4.6', emoji: '⚡' },
  { value: 'opus',   label: 'Opus 4.7',   emoji: '🧠' },
  { value: 'haiku',  label: 'Haiku 4.5',  emoji: '🪶' },
]
const MODEL_KEY = 'tower:default-model'

function useDefaultModel(): readonly [string, (m: string) => void] {
  const [model, setModelState] = useState<string>('sonnet')
  useEffect(() => {
    if (typeof window === 'undefined') return
    const saved = localStorage.getItem(MODEL_KEY)
    if (saved && MODELS.some(m => m.value === saved)) setModelState(saved)
  }, [])
  const setModel = useCallback((m: string) => {
    setModelState(m)
    if (typeof window !== 'undefined') localStorage.setItem(MODEL_KEY, m)
  }, [])
  return [model, setModel] as const
}

// Tool / activity → emoji badge
const TOOL_EMOJI: Record<string, string> = {
  thinking: '💭',
  writing: '✍️',
  Bash: '⌘',
  Read: '👁',
  Write: '📝',
  Edit: '✏️',
  MultiEdit: '✏️',
  Grep: '🔍',
  Glob: '📂',
  WebSearch: '🌐',
  WebFetch: '🌐',
  Task: '🤝',
  TodoWrite: '📋',
  NotebookEdit: '📓',
}
function toolEmoji(activity: string | null): string | null {
  if (!activity) return null
  return TOOL_EMOJI[activity] ?? '🔧'
}
function toolLabel(activity: string | null): string {
  if (!activity) return ''
  if (activity === 'thinking') return 'thinking…'
  if (activity === 'writing') return 'writing…'
  return `${activity}…`
}

// ── Helpers ────────────────────────────────────────────────────────────────
function hashId(id: string): number {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0
  return Math.abs(h)
}
function sessionHue(id: string): number { return hashId(id) % 360 }
function relTime(ms: number): string {
  const s = Math.floor((Date.now() - ms) / 1000)
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  return `${Math.floor(s / 3600)}h ago`
}
function firstText(blocks: ParsedMessage['content']): string {
  for (const b of blocks) {
    if (b.type === 'text' && b.text) return b.text.replace(/<[^>]+>/g, '').trim()
  }
  return ''
}
function agentWander(sessionId: string, isIdle: boolean) {
  const h = hashId(sessionId)
  return {
    wx: ((h >> 8) % 28) - 14,
    wy: ((h >> 12) % 16) - 8,
    dur: (isIdle ? 6 : 4) + (h % 5),
    delay: -((h >> 16) % 9),
  }
}

// ── Magenta-removal hook ───────────────────────────────────────────────────
function useProcessedSheet(src: string): string | null {
  const [dataUrl, setDataUrl] = useState<string | null>(null)
  useEffect(() => {
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(img, 0, 0)
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height)
      const px = data.data
      for (let i = 0; i < px.length; i += 4) {
        if (px[i] > 200 && px[i + 2] > 200 && px[i + 1] < 80) px[i + 3] = 0
      }
      ctx.putImageData(data, 0, 0)
      setDataUrl(canvas.toDataURL('image/png'))
    }
    img.src = src
  }, [src])
  return dataUrl
}

// ── Sprite (single frame) ──────────────────────────────────────────────────
function Sprite({ row, col, hue = 0, size = DISP, sheet, animClass = '', style = {} }: {
  row: number; col: number; hue?: number; size?: number
  sheet: string | null; animClass?: string; style?: CSSProperties
}) {
  const scale = size / CELL_PX
  const bgW = SHEET_COLS * CELL_PX * scale
  const bgH = SHEET_ROWS * CELL_PX * scale
  return (
    <div className={animClass} style={{
      width: size, height: size,
      backgroundImage: sheet ? `url(${sheet})` : 'none',
      backgroundSize: `${bgW}px ${bgH}px`,
      backgroundPosition: `${-col * size}px ${-row * size}px`,
      backgroundRepeat: 'no-repeat',
      imageRendering: 'pixelated',
      filter: hue !== 0 ? `hue-rotate(${hue}deg)` : undefined,
      flexShrink: 0,
      ...style,
    }} />
  )
}

// Two sprites layered, alternating visibility — gives a frame animation feel
function AnimatedSprite({ row, colA, colB, hue, size, sheet, cycleMs = 700, animClass = '' }: {
  row: number; colA: number; colB: number; hue: number; size: number
  sheet: string | null; cycleMs?: number; animClass?: string
}) {
  return (
    <div className={animClass} style={{ position: 'relative', width: size, height: size }}>
      <Sprite row={row} col={colA} hue={hue} size={size} sheet={sheet} style={{
        position: 'absolute', inset: 0,
        animation: `tower-frame-blink ${cycleMs}ms steps(1) infinite`,
      }} />
      <Sprite row={row} col={colB} hue={hue} size={size} sheet={sheet} style={{
        position: 'absolute', inset: 0,
        animation: `tower-frame-blink ${cycleMs}ms steps(1) -${cycleMs / 2}ms infinite`,
      }} />
    </div>
  )
}

// ── Agent card ────────────────────────────────────────────────────────────
function AgentCard({ session, state, sheet, onClick }: {
  session: RecentSession; state: AgentState
  sheet: string | null; onClick: () => void
}) {
  const hue = sessionHue(session.sessionId)
  const isIdle = state === 'idle'
  const isWorking = state === 'working'
  const isDone = state === 'done'
  const wander = agentWander(session.sessionId, isIdle)
  const h = hashId(session.sessionId)
  const displaySize = isWorking ? 82 : isIdle ? 66 : DISP
  const emoji = isWorking ? toolEmoji(session.currentActivity) : null
  const activityText = isWorking ? toolLabel(session.currentActivity) : null

  // Choose sprite element based on state
  const spriteEl = isWorking ? (
    <AnimatedSprite row={ROW.AGENT} colA={COL.IDLE} colB={COL.WORKING}
      hue={hue} size={displaySize} sheet={sheet} cycleMs={650}
      animClass={STATE_ANIM_CLASS.working} />
  ) : isDone ? (
    <AnimatedSprite row={ROW.AGENT} colA={COL.DONE} colB={COL.SIGNAL}
      hue={hue} size={displaySize} sheet={sheet} cycleMs={400}
      animClass={STATE_ANIM_CLASS.done} />
  ) : (
    <Sprite row={ROW.AGENT} col={STATE_COL[state]} hue={hue} size={displaySize}
      sheet={sheet} animClass={STATE_ANIM_CLASS[state]} />
  )

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      ['--wx' as string]: `${wander.wx}px`,
      ['--wy' as string]: `${wander.wy}px`,
      animation: `tower-wander ${wander.dur}s ${wander.delay}s ease-in-out infinite`,
    }}>
      <button
        onClick={onClick}
        aria-label={`${session.projectDisplayName} — ${STATE_LABEL[state]}`}
        style={{
          all: 'unset', cursor: 'pointer',
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
          opacity: isIdle ? 0.48 : 1,
          filter: isIdle ? 'grayscale(50%)' : undefined,
          transition: 'opacity 0.25s, filter 0.25s, transform 0.15s',
        }}
        onMouseEnter={e => {
          const el = e.currentTarget as HTMLElement
          el.style.opacity = '1'; el.style.filter = 'none'
          el.style.transform = 'scale(1.1)'
        }}
        onMouseLeave={e => {
          const el = e.currentTarget as HTMLElement
          el.style.opacity = isIdle ? '0.48' : '1'
          el.style.filter = isIdle ? 'grayscale(50%)' : 'none'
          el.style.transform = ''
        }}
      >
        {/* Tool/activity badge for working agents */}
        {isWorking && emoji && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 4,
            padding: '2px 8px',
            background: 'rgba(91,163,255,0.18)',
            border: '1px solid rgba(91,163,255,0.3)',
            borderRadius: 99,
            fontSize: 11, lineHeight: 1.1,
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
            marginBottom: 2,
            animation: 'tower-pulse 1.6s ease-in-out infinite',
          }}>
            <span style={{ fontSize: 13 }}>{emoji}</span>
            <span style={{ color: 'var(--text)', textShadow: '0 1px 2px rgba(0,0,0,0.8)' }}>
              {session.currentActivity}
            </span>
          </div>
        )}
        {isWorking && !emoji && (
          <div style={{ display: 'flex', gap: 3, marginBottom: 2, height: 10, alignItems: 'flex-end' }}>
            {[0, 1, 2].map(i => (
              <div key={i} style={{
                width: 4, height: 4, borderRadius: '50%',
                background: 'var(--accent)',
                animation: `dot-bounce 1.1s ease-in-out ${i * 0.18}s infinite`,
              }} />
            ))}
          </div>
        )}
        {(state === 'done' || state === 'signal') && (
          <div style={{
            fontSize: 12, animation: 'tower-pulse 0.9s ease-in-out infinite',
          }}>
            {state === 'done' ? '✦' : '☆'}
          </div>
        )}

        {spriteEl}

        {/* Ground shadow */}
        <div style={{
          width: displaySize * 0.7, height: 6, borderRadius: '50%',
          background: 'rgba(0,0,0,0.45)', filter: 'blur(3px)', marginTop: -6,
          transform: `scaleX(${0.8 + (h % 5) * 0.05})`,
        }} />

        {/* Label */}
        <div style={{ textAlign: 'center', marginTop: 4 }}>
          <div style={{
            fontSize: 11, fontWeight: 600, color: 'var(--text)',
            whiteSpace: 'nowrap', maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis',
            textShadow: '0 1px 4px rgba(0,0,0,0.9)',
          }}>
            {session.projectDisplayName}
          </div>
          <div style={{
            fontSize: 10, color: STATE_LABEL_COLOR[state],
            textShadow: '0 1px 4px rgba(0,0,0,0.95)',
          }}>
            {activityText || STATE_LABEL[state]}
          </div>
        </div>
      </button>
    </div>
  )
}

// ── Brain orchestrator modal — click the commander ────────────────────────
function BrainModal({ onClose, onDispatched }: { onClose: () => void; onDispatched: () => void }) {
  const [projects, setProjects] = useState<ProjectInfo[]>([])
  const [selectedPath, setSelectedPath] = useState<string>('')
  const [task, setTask] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [model, setModel] = useDefaultModel()
  const sheet = useProcessedSheet('/sprites/agents.png')

  useEffect(() => {
    fetch('/api/projects')
      .then(r => r.ok ? r.json() : [])
      .then((data: ProjectInfo[]) => {
        setProjects(data)
        if (data.length && !selectedPath) setSelectedPath(data[0].decodedPath)
      })
      .catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleDispatch(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedPath || !task.trim()) return
    setSending(true)
    setError(null)
    try {
      const res = await fetch('/api/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project_path: selectedPath, prompt: task.trim(), model }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error || `Failed (${res.status})`)
        return
      }
      onDispatched()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error')
    } finally {
      setSending(false)
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 950,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(6px)',
    }} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="glass-lg" style={{
        width: '100%', maxWidth: 520, borderRadius: 18, overflow: 'hidden',
        boxShadow: 'var(--shadow-lg)', margin: '0 16px',
        animation: 'fadeIn 0.18s ease',
      }}>
        {/* Header */}
        <div style={{
          padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12,
          borderBottom: '1px solid var(--glass-border)',
          background: 'radial-gradient(ellipse at top, rgba(91,163,255,0.12), transparent)',
        }}>
          <div style={{
            background: 'radial-gradient(circle, rgba(91,163,255,0.2), transparent)',
            padding: 6, borderRadius: '50%',
          }}>
            <Sprite row={ROW.COMMANDER} col={COL.WORKING} sheet={sheet} size={48}
              animClass="tower-agent-working" />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 800, fontSize: 16, color: 'var(--text)' }}>
              Dispatch a task
            </div>
            <div style={{ fontSize: 11, color: 'var(--text2)' }}>
              The Brain spawns a Claude agent in your chosen project
            </div>
          </div>
          <button onClick={onClose} className="glass-btn"
            style={{ fontSize: 18, padding: '2px 10px', lineHeight: 1 }}>×</button>
        </div>

        <form onSubmit={handleDispatch} style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Project picker */}
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Project
            </span>
            <select
              value={selectedPath}
              onChange={e => setSelectedPath(e.target.value)}
              className="glass-input"
              style={{ fontSize: 14, padding: '10px 12px', borderRadius: 10, cursor: 'pointer' }}
              disabled={sending}
            >
              {projects.length === 0 && <option value="">Loading…</option>}
              {projects.map(p => (
                <option key={p.decodedPath} value={p.decodedPath}>
                  {p.displayName}{p.hasActive ? ' ● active' : ''}
                </option>
              ))}
            </select>
          </label>

          {/* Model picker */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Model
            </span>
            <div style={{ display: 'flex', gap: 6 }}>
              {MODELS.map(m => {
                const active = model === m.value
                return (
                  <button key={m.value} type="button" onClick={() => setModel(m.value)}
                    disabled={sending}
                    style={{
                      all: 'unset', cursor: sending ? 'default' : 'pointer',
                      flex: 1, textAlign: 'center',
                      padding: '8px 10px', borderRadius: 10,
                      border: `1px solid ${active ? 'rgba(91,163,255,0.5)' : 'var(--glass-border)'}`,
                      background: active ? 'rgba(91,163,255,0.18)' : 'var(--glass-bg)',
                      color: active ? 'var(--text)' : 'var(--text2)',
                      fontSize: 12, fontWeight: active ? 700 : 500,
                      transition: 'background 0.15s, border-color 0.15s',
                    }}>
                    <div style={{ fontSize: 16, marginBottom: 2 }}>{m.emoji}</div>
                    {m.label}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Task input */}
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Task
            </span>
            <textarea
              value={task}
              onChange={e => setTask(e.target.value)}
              placeholder="What should the agent do? e.g. &quot;Add a unit test for the login flow&quot;"
              className="glass-input"
              rows={4}
              disabled={sending}
              style={{ fontSize: 14, padding: '10px 12px', borderRadius: 10, resize: 'vertical', minHeight: 80 }}
              autoFocus
            />
          </label>

          {error && (
            <div style={{ fontSize: 12, color: 'var(--red)', padding: '6px 10px',
              background: 'rgba(255,90,90,0.08)', borderRadius: 8 }}>
              {error}
            </div>
          )}

          <button type="submit"
            className="glass-btn-prominent"
            disabled={!selectedPath || !task.trim() || sending}
            style={{
              padding: '10px 16px', fontSize: 14, fontWeight: 700,
              background: 'rgba(91,163,255,0.25)',
              border: '1px solid rgba(91,163,255,0.4)',
              borderRadius: 10,
            }}
          >
            {sending ? 'Dispatching…' : '⚡ Dispatch agent'}
          </button>
        </form>
      </div>
    </div>
  )
}

// ── Agent dialogue modal ───────────────────────────────────────────────────
function AgentModal({ session, onClose }: { session: RecentSession; onClose: () => void }) {
  const [messages, setMessages] = useState<ParsedMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [inputText, setInputText] = useState('')
  const [sending, setSending] = useState(false)
  const [siblings, setSiblings] = useState<SessionInfo[]>([])
  const [siblingsOpen, setSiblingsOpen] = useState(false)
  const [model, setModel] = useDefaultModel()
  const bottomRef = useRef<HTMLDivElement>(null)
  const sheet = useProcessedSheet('/sprites/agents.png')
  const hue = sessionHue(session.sessionId)

  const fetchMessages = useCallback(async () => {
    try {
      const res = await fetch(`/api/session?f=${session.encodedFilepath}&limit=14`)
      if (!res.ok) return
      const data: PaginatedSession = await res.json()
      const relevant = data.messages.filter(m =>
        !m.isMeta && m.content.some(b => b.type === 'text' && b.text?.trim())
      )
      setMessages(relevant.slice(-12))
    } finally { setLoading(false) }
  }, [session.encodedFilepath])

  useEffect(() => {
    fetchMessages()
    if (!session.isActive) return
    const iv = setInterval(fetchMessages, 3000)
    return () => clearInterval(iv)
  }, [fetchMessages, session.isActive])

  // Load other sessions in same project
  useEffect(() => {
    const enc = btoa(unescape(encodeURIComponent(session.projectDirName)))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    fetch(`/api/sessions?p=${enc}`)
      .then(r => r.ok ? r.json() : [])
      .then((list: SessionInfo[]) => {
        setSiblings(list.filter(s => s.sessionId !== session.sessionId).slice(0, 8))
      })
      .catch(() => {})
  }, [session.projectDirName, session.sessionId])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

  async function handleSend(e: React.FormEvent) {
    e.preventDefault()
    const prompt = inputText.trim()
    if (!prompt) return
    setSending(true); setInputText('')
    try {
      // /api/input uses -r flag → resumes the session even if its process died
      await fetch('/api/input', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: session.sessionId, prompt, model }),
      })
      setTimeout(fetchMessages, 1800)
    } finally { setSending(false) }
  }

  async function handleStartFresh() {
    // Need the project decoded path — derive from projectDirName
    // The simplest path: send user to the project page where they can start a new session
    onClose()
    const enc = btoa(unescape(encodeURIComponent(session.projectDirName)))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    window.location.href = `/project?p=${enc}`
  }

  const inputPlaceholder = session.isActive
    ? 'Continue conversation…'
    : 'Resume — type a message to wake this session'

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 900,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(6px)',
    }} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="glass-lg" style={{
        width: '100%', maxWidth: 540, maxHeight: '85vh',
        display: 'flex', flexDirection: 'column', borderRadius: 18,
        overflow: 'hidden', boxShadow: 'var(--shadow-lg)', margin: '0 16px',
        animation: 'fadeIn 0.18s ease',
      }}>
        {/* Header */}
        <div style={{
          padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 10,
          borderBottom: '1px solid var(--glass-border)', flexShrink: 0,
        }}>
          <div style={{ borderRadius: '50%', padding: 5, background: 'var(--glass-bg)' }}>
            <Sprite row={ROW.AGENT} col={session.isActive ? COL.WORKING : COL.IDLE}
              hue={hue} sheet={sheet} size={44}
              animClass={session.isActive ? 'tower-agent-working' : ''} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {session.projectDisplayName}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text3)', display: 'flex', gap: 8 }}>
              <span style={{ fontFamily: 'monospace' }}>{session.sessionId.slice(0, 8)}…</span>
              <span style={{ color: session.isActive ? 'var(--green)' : 'var(--text3)' }}>
                {session.isActive ? '● live' : relTime(session.mtime)}
              </span>
              {session.isActive && session.currentActivity && (
                <span style={{ color: 'var(--accent)' }}>
                  {toolEmoji(session.currentActivity)} {session.currentActivity}
                </span>
              )}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <Link href={`/session?f=${session.encodedFilepath}`}
              className="glass-btn" onClick={onClose}
              style={{ fontSize: 11, padding: '4px 10px', textDecoration: 'none' }}>
              Open ↗
            </Link>
            <button onClick={onClose} className="glass-btn"
              style={{ fontSize: 18, padding: '2px 8px', lineHeight: 1 }}>×</button>
          </div>
        </div>

        {/* Task label */}
        {session.firstPrompt && session.firstPrompt !== '(no prompt)' && (
          <div style={{
            padding: '7px 14px', background: 'rgba(91,163,255,0.07)',
            borderBottom: '1px solid var(--glass-border)',
            fontSize: 11, color: 'var(--text2)', flexShrink: 0,
          }}>
            <span style={{ color: 'var(--text3)', fontWeight: 600 }}>Task: </span>
            {session.firstPrompt.length > 120
              ? session.firstPrompt.slice(0, 120) + '…'
              : session.firstPrompt}
          </div>
        )}

        {/* Messages */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {loading && <div style={{ color: 'var(--text3)', fontSize: 13, textAlign: 'center', padding: 20 }}>Loading…</div>}
          {!loading && messages.length === 0 && <div style={{ color: 'var(--text3)', fontSize: 13, textAlign: 'center', padding: 20 }}>No messages yet</div>}
          {messages.map(msg => {
            const text = firstText(msg.content)
            if (!text) return null
            const isUser = msg.role === 'user'
            return (
              <div key={msg.uuid} style={{
                alignSelf: isUser ? 'flex-end' : 'flex-start',
                maxWidth: '85%',
                background: isUser ? 'rgba(91,163,255,0.22)' : 'var(--glass-bg)',
                border: `1px solid ${isUser ? 'rgba(91,163,255,0.35)' : 'var(--glass-border)'}`,
                borderRadius: isUser ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
                padding: '8px 12px', fontSize: 12, color: 'var(--text)', lineHeight: 1.55,
              }}>
                {text.length > 300 ? text.slice(0, 300) + '…' : text}
              </div>
            )
          })}
          {sending && (
            <div style={{ alignSelf: 'flex-start', color: 'var(--text3)', fontSize: 12, padding: '4px 8px' }}>
              Sending…
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Past sessions in same project */}
        {siblings.length > 0 && (
          <div style={{ borderTop: '1px solid var(--glass-border)', flexShrink: 0 }}>
            <button onClick={() => setSiblingsOpen(o => !o)} style={{
              all: 'unset', cursor: 'pointer', display: 'flex', width: '100%',
              padding: '8px 14px', fontSize: 11, color: 'var(--text3)',
              alignItems: 'center', gap: 6,
            }}>
              <span style={{ transform: siblingsOpen ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }}>▶</span>
              Other sessions in this project ({siblings.length})
            </button>
            {siblingsOpen && (
              <div style={{ maxHeight: 140, overflowY: 'auto', padding: '0 8px 8px' }}>
                {siblings.map(s => {
                  const enc = btoa(unescape(encodeURIComponent(s.filepath)))
                    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
                  return (
                    <Link key={s.sessionId} href={`/session?f=${enc}`} onClick={onClose}
                      style={{
                        display: 'block', padding: '6px 8px', borderRadius: 6,
                        textDecoration: 'none', fontSize: 12, color: 'var(--text)',
                        background: 'rgba(255,255,255,0.02)',
                        marginBottom: 4,
                      }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {s.firstPrompt && s.firstPrompt !== '(no prompt)'
                            ? s.firstPrompt.slice(0, 60)
                            : s.sessionId.slice(0, 8) + '…'}
                        </span>
                        <span style={{ color: s.isActive ? 'var(--green)' : 'var(--text3)', flexShrink: 0, fontSize: 10 }}>
                          {s.isActive ? '● live' : relTime(s.mtime)}
                        </span>
                      </div>
                    </Link>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* Reply form — works for both active and stopped (resumes via -r) */}
        <form onSubmit={handleSend} style={{
          padding: '10px 12px', borderTop: '1px solid var(--glass-border)',
          display: 'flex', flexDirection: 'column', gap: 8, flexShrink: 0,
          background: session.isActive ? undefined : 'rgba(255,255,255,0.02)',
        }}>
          {/* Model picker — compact pill row */}
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <span style={{ fontSize: 10, color: 'var(--text3)', marginRight: 4 }}>model:</span>
            {MODELS.map(m => {
              const active = model === m.value
              return (
                <button key={m.value} type="button" onClick={() => setModel(m.value)}
                  disabled={sending}
                  title={m.label}
                  style={{
                    all: 'unset', cursor: sending ? 'default' : 'pointer',
                    padding: '2px 8px', borderRadius: 99,
                    border: `1px solid ${active ? 'rgba(91,163,255,0.5)' : 'transparent'}`,
                    background: active ? 'rgba(91,163,255,0.18)' : 'transparent',
                    color: active ? 'var(--text)' : 'var(--text3)',
                    fontSize: 11, fontWeight: active ? 700 : 500,
                  }}>
                  {m.emoji} {m.label.replace(/ \d.+$/, '')}
                </button>
              )
            })}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              value={inputText}
              onChange={e => setInputText(e.target.value)}
              placeholder={inputPlaceholder}
              className="glass-input"
              disabled={sending}
              style={{ flex: 1, fontSize: 13, padding: '8px 12px', borderRadius: 10 }}
            />
            <button type="submit" className="glass-btn"
              disabled={!inputText.trim() || sending}
              style={{ padding: '8px 14px', fontSize: 15 }}
              title={session.isActive ? 'Send' : 'Resume session'}
            >
              {session.isActive ? '↵' : '▶'}
            </button>
          </div>
        </form>

        {/* Start fresh — only for stopped sessions */}
        {!session.isActive && (
          <button onClick={handleStartFresh} style={{
            all: 'unset', cursor: 'pointer', textAlign: 'center',
            padding: '8px 14px', fontSize: 11, color: 'var(--text3)',
            borderTop: '1px solid var(--glass-border)',
          }}>
            …or start a fresh session in this project →
          </button>
        )}
      </div>
    </div>
  )
}

// ── Main TowerView ─────────────────────────────────────────────────────────
export default function TowerView() {
  const [sessions, setSessions] = useState<RecentSession[]>([])
  const [agentStates, setAgentStates] = useState<Record<string, AgentState>>({})
  const [selected, setSelected] = useState<RecentSession | null>(null)
  const [brainOpen, setBrainOpen] = useState(false)
  const [cmdCol, setCmdCol] = useState(COL.IDLE)
  const prevActive = useRef<Set<string>>(new Set())
  const recentlyDone = useRef<Map<string, number>>(new Map())
  const sheet = useProcessedSheet('/sprites/agents.png')

  const poll = useCallback(async () => {
    try {
      const res = await fetch('/api/recent-sessions?limit=40')
      if (!res.ok) return
      const data: RecentSession[] = await res.json()
      const now = Date.now()
      const currentActive = new Set(data.filter(s => s.isActive).map(s => s.sessionId))

      for (const sid of prevActive.current) {
        if (!currentActive.has(sid)) {
          recentlyDone.current.set(sid, now)
          setCmdCol(COL.DONE)
          setTimeout(() => setCmdCol(COL.IDLE), 2500)
        }
      }
      prevActive.current = currentActive

      for (const [sid, ts] of recentlyDone.current) {
        if (now - ts > 9000) recentlyDone.current.delete(sid)
      }

      const states: Record<string, AgentState> = {}
      for (const s of data) {
        const doneTs = recentlyDone.current.get(s.sessionId)
        if (doneTs) {
          states[s.sessionId] = now - doneTs < 4000 ? 'done' : 'signal'
        } else if (s.isActive) {
          states[s.sessionId] = 'working'
        } else {
          states[s.sessionId] = 'idle'
        }
      }

      setSessions(data)
      setAgentStates(states)
    } catch {}
  }, [])

  useEffect(() => {
    poll()
    const iv = setInterval(poll, 3000)
    return () => clearInterval(iv)
  }, [poll])

  const sorted = [...sessions].sort((a, b) => {
    const order = { working: 0, done: 1, signal: 1, idle: 2 }
    const sa = order[agentStates[a.sessionId] ?? 'idle']
    const sb = order[agentStates[b.sessionId] ?? 'idle']
    if (sa !== sb) return sa - sb
    return b.mtime - a.mtime
  })

  const workingCount = Object.values(agentStates).filter(s => s === 'working').length
  const totalCols = Math.max(4, Math.min(7, Math.ceil(Math.sqrt(sorted.length * 1.6))))
  const fieldRows = Math.ceil(sorted.length / totalCols)
  const fieldHeight = Math.max(260, fieldRows * 150 + 60)

  return (
    <div style={{ minHeight: '100vh', position: 'relative' }}>
      {/* Background */}
      <div style={{
        position: 'fixed', inset: 0, zIndex: 0,
        backgroundImage: "url('/sprites/tower-bg.png')",
        backgroundSize: 'cover', backgroundPosition: 'center top',
        imageRendering: 'pixelated', opacity: 0.38,
      }} />
      <div style={{
        position: 'fixed', inset: 0, zIndex: 0,
        background: 'radial-gradient(ellipse 120% 100% at 50% 0%, transparent 40%, rgba(8,12,20,0.6) 100%)',
        pointerEvents: 'none',
      }} />

      <div style={{ position: 'relative', zIndex: 1, minHeight: '100vh' }}>

        {/* Commander section — clickable to open Brain modal */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 36 }}>
          <div style={{ display: 'flex', gap: 5, marginBottom: -2 }}>
            {[...Array(11)].map((_, i) => (
              <div key={i} style={{
                width: 16, height: 24, borderRadius: 3,
                background: i % 2 === 0 ? 'var(--accent)' : 'transparent',
                opacity: 0.8,
                boxShadow: i % 2 === 0 ? '0 0 10px rgba(91,163,255,0.5)' : 'none',
              }} />
            ))}
          </div>
          <div style={{ width: 11 * 16 + 10 * 5, height: 5, background: 'var(--accent)', opacity: 0.7, borderRadius: '0 0 2px 2px' }} />

          <button
            onClick={() => setBrainOpen(true)}
            style={{
              all: 'unset', cursor: 'pointer',
              background: 'radial-gradient(circle, rgba(91,163,255,0.18) 0%, transparent 70%)',
              border: '1px solid rgba(91,163,255,0.25)', borderRadius: '50%',
              padding: 16, marginTop: 10,
              boxShadow: '0 0 48px rgba(91,163,255,0.22)',
              transition: 'transform 0.15s, box-shadow 0.2s',
            }}
            onMouseEnter={e => {
              const el = e.currentTarget as HTMLElement
              el.style.transform = 'scale(1.08)'
              el.style.boxShadow = '0 0 64px rgba(91,163,255,0.45)'
            }}
            onMouseLeave={e => {
              const el = e.currentTarget as HTMLElement
              el.style.transform = ''
              el.style.boxShadow = '0 0 48px rgba(91,163,255,0.22)'
            }}
            title="Click to dispatch a task"
            aria-label="Dispatch task to a project"
          >
            <Sprite row={ROW.COMMANDER} col={cmdCol} sheet={sheet} size={100}
              animClass={cmdCol === COL.DONE ? 'tower-agent-done' : ''} />
          </button>

          <div style={{ textAlign: 'center', marginTop: 14 }}>
            <h1 style={{ margin: 0, fontWeight: 800, fontSize: 26, letterSpacing: '-0.03em', color: 'var(--text)' }}>
              Agent Tower
            </h1>
            <div style={{ fontSize: 13, color: 'var(--text2)', marginTop: 6, display: 'flex', gap: 14, justifyContent: 'center', alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ color: workingCount > 0 ? 'var(--green)' : 'var(--text3)' }}>
                {workingCount > 0 ? `● ${workingCount} working` : '○ all quiet'}
              </span>
              {sessions.length > 0 && <span style={{ color: 'var(--text3)' }}>{sessions.length} sessions</span>}
              <button onClick={() => setBrainOpen(true)} style={{
                all: 'unset', cursor: 'pointer',
                fontSize: 11, color: 'var(--accent)',
                padding: '3px 10px', borderRadius: 99,
                border: '1px solid rgba(91,163,255,0.4)',
                background: 'rgba(91,163,255,0.1)',
              }}>
                ⚡ Dispatch task
              </button>
            </div>
          </div>
        </div>

        {/* Field */}
        <div style={{ maxWidth: 1100, margin: '32px auto 0', padding: '0 24px 48px' }}>
          {sorted.length === 0 ? (
            <div style={{ textAlign: 'center', color: 'var(--text3)', fontSize: 14, padding: '80px 0' }}>
              <div style={{ fontSize: 32, marginBottom: 12, opacity: 0.25 }}>🏰</div>
              <div>No sessions found — click the Commander to dispatch your first task</div>
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', gap: 16, marginBottom: 20, flexWrap: 'wrap', fontSize: 11, color: 'var(--text3)' }}>
                {(['working', 'done', 'signal', 'idle'] as AgentState[]).map(st => (
                  <span key={st} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <span style={{
                      width: 7, height: 7, borderRadius: '50%', display: 'inline-block',
                      background: STATE_LABEL_COLOR[st], opacity: st === 'idle' ? 0.4 : 1,
                    }} />
                    {STATE_LABEL[st]}
                  </span>
                ))}
                <span style={{ marginLeft: 'auto', opacity: 0.4 }}>click any agent to inspect or chat</span>
              </div>

              <div style={{
                position: 'relative',
                display: 'grid',
                gridTemplateColumns: `repeat(${totalCols}, 1fr)`,
                gap: '12px 8px', padding: '32px 24px 40px',
                alignItems: 'end',
                minHeight: fieldHeight,
              }}>
                {sorted.map(session => {
                  const state = agentStates[session.sessionId] ?? 'idle'
                  return (
                    <div key={session.sessionId} style={{
                      display: 'flex', justifyContent: 'center',
                      marginBottom: hashId(session.sessionId) % 16,
                    }}>
                      <AgentCard
                        session={session}
                        state={state}
                        sheet={sheet}
                        onClick={() => setSelected(session)}
                      />
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </div>
      </div>

      {selected && <AgentModal session={selected} onClose={() => setSelected(null)} />}
      {brainOpen && <BrainModal onClose={() => setBrainOpen(false)} onDispatched={() => poll()} />}
    </div>
  )
}
