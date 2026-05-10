'use client'

import { useState, useEffect, useRef, useCallback, useMemo, CSSProperties } from 'react'
import Link from 'next/link'
import type { RecentSession } from '@/lib/claude-fs'
import type { PaginatedSession, ParsedMessage, ProjectInfo, SessionInfo } from '@/lib/types'
import { Scene, tilePos } from '@/lib/world-engine'
import {
  makeOfficeScene, slotsByGroup, FLOOR_SURFACE_Y, LIFT_X,
  SCENE_WIDTH, SCENE_HEIGHT,
} from '@/lib/world/officeScene'

// Display size of one tile, in CSS px. Scene = SCENE_WIDTH * TILE_PX wide.
const TILE_PX = 28

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
// ── Floor layout (driven by world-engine slot data) ───────────────────────
type Floor = 'penthouse' | 'boardroom' | 'office_2' | 'office_1' | 'lounge'

const FLOOR_LABEL: Record<Floor, string> = {
  penthouse: 'Executive', boardroom: 'Boardroom',
  office_2: 'Office · 4F', office_1: 'Office · 3F', lounge: 'Lounge',
}

// Hide overflow idle agents (showing every single one would clutter the lounge)
const LOUNGE_VISIBLE_CAP = (slotsByGroup.lounge?.length ?? 8) * 2

interface SlotAssignment {
  floor: Floor
  slotIdx: number      // index into slotsByGroup[floor]
  rowOffset: number    // extra tile-Y offset for lounge multi-row overflow
}

// Lift sprite layout: 1 row × 3 cols (closed | half_open | open)
const LIFT_COLS = 3
const LIFT_ROWS = 1
const LIFT_CELL = 512

function allocateSlots(
  sessions: RecentSession[],
  states: Record<string, AgentState>
): { assignments: Map<string, SlotAssignment>; loungeHidden: number } {
  // Stable order so a given session keeps its slot across renders
  const ordered = [...sessions].sort((a, b) => hashId(a.sessionId) - hashId(b.sessionId))

  const groups: Record<Floor, RecentSession[]> = {
    penthouse: [], boardroom: [], office_2: [], office_1: [], lounge: [],
  }
  for (const s of ordered) {
    const st = states[s.sessionId] ?? 'idle'
    if (st === 'done' || st === 'signal') groups.boardroom.push(s)
    else if (st === 'working') groups.office_1.push(s)
    else groups.lounge.push(s)
  }

  // Working: fill 3F (office_1) first, then 4F (office_2). Beyond capacity → cycle in 4F.
  const office1Cap = slotsByGroup.office_1?.length ?? 6
  if (groups.office_1.length > office1Cap) {
    groups.office_2 = groups.office_1.slice(office1Cap)
    groups.office_1 = groups.office_1.slice(0, office1Cap)
  }

  // Lounge: cap visible, overflow becomes "+N more"
  groups.lounge.sort((a, b) => b.mtime - a.mtime)
  const loungeHidden = Math.max(0, groups.lounge.length - LOUNGE_VISIBLE_CAP)
  groups.lounge = groups.lounge.slice(0, LOUNGE_VISIBLE_CAP)

  const out = new Map<string, SlotAssignment>()
  ;(['boardroom', 'office_1', 'office_2', 'lounge'] as Floor[]).forEach(floor => {
    const groupSlots = slotsByGroup[floor] ?? []
    const cap = groupSlots.length || 1
    groups[floor].forEach((s, i) => {
      const slotIdx = i % cap
      const rowOffset = floor === 'lounge' ? Math.floor(i / cap) * 1.5 : 0
      out.set(s.sessionId, { floor, slotIdx, rowOffset })
    })
  })
  return { assignments: out, loungeHidden }
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

// Lift car — 3-frame sprite (closed/half/open). Positioned in tile coords.
function LiftCar({ tileX, tileY, doorFrame, sheet, floorLabel, tilePx }: {
  tileX: number; tileY: number
  doorFrame: 0 | 1 | 2
  sheet: string | null
  floorLabel: string
  tilePx: number
}) {
  // Lift car is ~1.6 tiles tall; size ~50 px at TILE_PX=28
  const SIZE = Math.round(tilePx * 1.8)
  const scale = SIZE / LIFT_CELL
  const bgW = LIFT_COLS * LIFT_CELL * scale
  const bgH = LIFT_ROWS * LIFT_CELL * scale
  return (
    <div style={{
      ...tilePos(tileX, tileY, tilePx, 'bottom-center'),
      transition: 'top 1.5s cubic-bezier(0.45, 0, 0.25, 1)',
      zIndex: 4, pointerEvents: 'none',
      filter: 'drop-shadow(0 0 12px rgba(255,200,80,0.35))',
    }}>
      <div style={{
        width: SIZE, height: SIZE,
        backgroundImage: sheet ? `url(${sheet})` : 'none',
        backgroundSize: `${bgW}px ${bgH}px`,
        backgroundPosition: `${-doorFrame * SIZE}px 0px`,
        backgroundRepeat: 'no-repeat',
        imageRendering: 'pixelated',
      }} />
      {/* Floor indicator above */}
      <div style={{
        position: 'absolute',
        top: -16, left: '50%',
        transform: 'translateX(-50%)',
        fontSize: 9, fontWeight: 700,
        color: 'var(--yellow)',
        background: 'rgba(0,0,0,0.7)',
        padding: '1px 6px', borderRadius: 4,
        whiteSpace: 'nowrap',
        letterSpacing: '0.05em',
        textTransform: 'uppercase',
      }}>
        ▲ {floorLabel}
      </div>
    </div>
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
  const h = hashId(session.sessionId)
  // Scale matches the building's furniture (~16-32px chairs/desks)
  const displaySize = isWorking ? 38 : isIdle ? 30 : 36
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
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <button
        onClick={onClick}
        aria-label={`${session.projectDisplayName} — ${STATE_LABEL[state]}`}
        className={isIdle ? 'tower-card-idle' : undefined}
        style={{
          all: 'unset', cursor: 'pointer',
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
          opacity: isIdle ? 0.42 : 1,
          filter: isIdle ? 'grayscale(55%)' : undefined,
          transition: 'opacity 0.25s, filter 0.25s, transform 0.15s',
        }}
        onMouseEnter={e => {
          const el = e.currentTarget as HTMLElement
          el.style.opacity = '1'; el.style.filter = 'none'
          el.style.transform = 'scale(1.18)'
        }}
        onMouseLeave={e => {
          const el = e.currentTarget as HTMLElement
          el.style.opacity = isIdle ? '0.42' : '1'
          el.style.filter = isIdle ? 'grayscale(55%)' : 'none'
          el.style.transform = ''
        }}
      >
        {/* Tool/activity badge — compact, only emoji for small scale */}
        {isWorking && emoji && (
          <div style={{
            padding: '1px 5px',
            background: 'rgba(91,163,255,0.22)',
            border: '1px solid rgba(91,163,255,0.4)',
            borderRadius: 99,
            fontSize: 10, lineHeight: 1.1,
            marginBottom: 1,
            animation: 'tower-pulse 1.6s ease-in-out infinite',
            display: 'flex', alignItems: 'center', gap: 3,
          }}>
            <span style={{ fontSize: 10 }}>{emoji}</span>
          </div>
        )}
        {isWorking && !emoji && (
          <div style={{ display: 'flex', gap: 2, marginBottom: 1, height: 6, alignItems: 'flex-end' }}>
            {[0, 1, 2].map(i => (
              <div key={i} style={{
                width: 3, height: 3, borderRadius: '50%',
                background: 'var(--accent)',
                animation: `dot-bounce 1.1s ease-in-out ${i * 0.18}s infinite`,
              }} />
            ))}
          </div>
        )}
        {(state === 'done' || state === 'signal') && (
          <div style={{ fontSize: 10, animation: 'tower-pulse 0.9s ease-in-out infinite' }}>
            {state === 'done' ? '✦' : '☆'}
          </div>
        )}

        {spriteEl}

        {/* Ground shadow — small to match scale */}
        <div style={{
          width: displaySize * 0.6, height: 3, borderRadius: '50%',
          background: 'rgba(0,0,0,0.55)', filter: 'blur(2px)', marginTop: -3,
        }} />

        {/* Label — auto-hidden for idle agents */}
        <div className="tower-card-label" style={{ textAlign: 'center', marginTop: 1 }}>
          <div style={{
            fontSize: 9, fontWeight: 700, color: 'var(--text)',
            whiteSpace: 'nowrap', maxWidth: 70, overflow: 'hidden', textOverflow: 'ellipsis',
            textShadow: '0 1px 3px rgba(0,0,0,1), 0 0 4px rgba(0,0,0,0.9)',
            padding: '0 2px',
          }}>
            {session.projectDisplayName}
          </div>
          {!isIdle && activityText && (
            <div style={{
              fontSize: 8, color: STATE_LABEL_COLOR[state],
              textShadow: '0 1px 3px rgba(0,0,0,1)',
            }}>
              {activityText}
            </div>
          )}
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
  const liftSheet = useProcessedSheet('/sprites/lift.png')

  // Lift state machine
  const [liftFloor, setLiftFloor] = useState<Floor>('lounge')
  const [doorFrame, setDoorFrame] = useState<0 | 1 | 2>(0)
  const liftQueueRef = useRef<Floor[]>([])
  const liftBusyRef = useRef(false)
  const prevAssignmentRef = useRef<Map<string, Floor>>(new Map())

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

  // Build the scene once (tilemap is static — only entities change)
  const sceneSpec = useMemo(() => makeOfficeScene(TILE_PX), [])

  // Allocate slots on every state/session change. Stable per-session.
  const { assignments, loungeHidden } = useMemo(
    () => allocateSlots(sessions, agentStates),
    [sessions, agentStates]
  )

  // Floor counts (total, not just visible)
  const floorCounts = useMemo(() => {
    const c: Record<Floor, number> = { penthouse: 0, boardroom: 0, office_2: 0, office_1: 0, lounge: 0 }
    Object.values(agentStates).forEach(st => {
      if (st === 'working') c.office_1++
      else if (st === 'done' || st === 'signal') c.boardroom++
      else c.lounge++
    })
    // Adjust office_1 vs office_2 split (visual)
    if (c.office_1 > 6) { c.office_2 = c.office_1 - 6; c.office_1 = 6 }
    return c
  }, [agentStates])

  const workingCount = floorCounts.office_1 + floorCounts.office_2

  // Detect floor changes → queue lift visits
  useEffect(() => {
    const prev = prevAssignmentRef.current
    const newQueue: Floor[] = []
    assignments.forEach((a, sid) => {
      const prevFloor = prev.get(sid)
      if (prevFloor && prevFloor !== a.floor) {
        // Visit the destination floor (where the agent is "arriving")
        if (!newQueue.includes(a.floor) && newQueue[newQueue.length - 1] !== a.floor) {
          newQueue.push(a.floor)
        }
      }
      prev.set(sid, a.floor)
    })
    if (newQueue.length > 0) {
      liftQueueRef.current.push(...newQueue)
    }
  }, [assignments])

  // Lift loop — pulls from queue, animates: travel → open → wait → close → next
  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null

    function next() {
      if (cancelled) return
      const q = liftQueueRef.current
      if (q.length === 0) {
        liftBusyRef.current = false
        timer = setTimeout(next, 1200)
        return
      }
      liftBusyRef.current = true
      const target = q.shift()!
      // 1) Travel to floor (CSS transition handles the slide, ~1.5s)
      setLiftFloor(target)
      setDoorFrame(0)
      timer = setTimeout(() => {
        if (cancelled) return
        // 2) Doors open
        setDoorFrame(1)
        timer = setTimeout(() => {
          if (cancelled) return
          setDoorFrame(2)
          timer = setTimeout(() => {
            if (cancelled) return
            // 3) Doors close
            setDoorFrame(1)
            timer = setTimeout(() => {
              if (cancelled) return
              setDoorFrame(0)
              timer = setTimeout(next, 250)
            }, 200)
          }, 1000)
        }, 200)
      }, 1550)
    }

    next()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [])

  return (
    <div style={{ minHeight: '100vh', position: 'relative' }}>
      {/* Page background — atmospheric night gradient (no castle, since the tower IS the focal building) */}
      <div style={{
        position: 'fixed', inset: 0, zIndex: 0,
        background: `
          radial-gradient(ellipse 60% 40% at 20% 30%, rgba(80,40,180,0.18) 0%, transparent 60%),
          radial-gradient(ellipse 60% 40% at 80% 70%, rgba(40,80,180,0.16) 0%, transparent 60%),
          linear-gradient(to bottom, #050810 0%, #0b1224 60%, #0e1834 100%)
        `,
      }} />
      {/* Star field — sparse pixel-art stars via CSS */}
      <div style={{
        position: 'fixed', inset: 0, zIndex: 0,
        backgroundImage: `
          radial-gradient(1.5px 1.5px at 17% 22%, white, transparent),
          radial-gradient(1px 1px at 53% 11%, white, transparent),
          radial-gradient(1.5px 1.5px at 87% 38%, white, transparent),
          radial-gradient(1px 1px at 28% 64%, white, transparent),
          radial-gradient(1px 1px at 72% 84%, white, transparent),
          radial-gradient(2px 2px at 9% 88%, white, transparent),
          radial-gradient(1.5px 1.5px at 95% 15%, white, transparent),
          radial-gradient(1px 1px at 42% 47%, white, transparent)
        `,
        opacity: 0.55, pointerEvents: 'none',
      }} />

      <div style={{ position: 'relative', zIndex: 1, minHeight: '100vh' }}>

        {/* Header — Commander floats above the building */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 28 }}>
          <button
            onClick={() => setBrainOpen(true)}
            style={{
              all: 'unset', cursor: 'pointer', position: 'relative',
              background: 'radial-gradient(circle, rgba(91,163,255,0.22) 0%, transparent 70%)',
              border: '1px solid rgba(91,163,255,0.3)', borderRadius: '50%',
              padding: 12,
              boxShadow: '0 0 48px rgba(91,163,255,0.28)',
              transition: 'transform 0.15s, box-shadow 0.2s',
            }}
            onMouseEnter={e => {
              const el = e.currentTarget as HTMLElement
              el.style.transform = 'scale(1.08)'
              el.style.boxShadow = '0 0 72px rgba(91,163,255,0.5)'
            }}
            onMouseLeave={e => {
              const el = e.currentTarget as HTMLElement
              el.style.transform = ''
              el.style.boxShadow = '0 0 48px rgba(91,163,255,0.28)'
            }}
            title="Click to dispatch a task"
            aria-label="Dispatch task"
          >
            <Sprite row={ROW.COMMANDER} col={cmdCol} sheet={sheet} size={84}
              animClass={cmdCol === COL.DONE ? 'tower-agent-done' : 'tower-agent-idle'} />
          </button>

          <h1 style={{ margin: '12px 0 4px', fontWeight: 800, fontSize: 22, letterSpacing: '-0.03em', color: 'var(--text)' }}>
            Agent Tower
          </h1>
          <div style={{ fontSize: 12, color: 'var(--text2)', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'center' }}>
            <span style={{ color: workingCount > 0 ? 'var(--green)' : 'var(--text3)' }}>
              {workingCount > 0 ? `● ${workingCount} working` : '○ all quiet'}
            </span>
            {sessions.length > 0 && <span style={{ color: 'var(--text3)' }}>· {sessions.length} sessions</span>}
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

        {/* Building stage */}
        <div style={{ display: 'flex', justifyContent: 'center', padding: '24px 16px 60px', gap: 24, alignItems: 'flex-start' }}>

          {/* Floor directory (left side) — desktop only */}
          <div className="hide-mobile" style={{
            width: 180, paddingTop: 32, color: 'var(--text2)', fontSize: 11,
            display: 'flex', flexDirection: 'column', gap: 4,
          }}>
            {(['penthouse', 'boardroom', 'office_2', 'office_1', 'lounge'] as Floor[]).map(f => (
              <div key={f} style={{
                display: 'flex', justifyContent: 'space-between',
                padding: '6px 10px', borderRadius: 6,
                background: liftFloor === f ? 'rgba(255,200,80,0.12)' : 'transparent',
                border: liftFloor === f ? '1px solid rgba(255,200,80,0.3)' : '1px solid transparent',
                transition: 'background 0.3s, border-color 0.3s',
              }}>
                <span style={{ color: liftFloor === f ? 'var(--yellow)' : 'var(--text2)' }}>
                  {liftFloor === f ? '▶ ' : '  '}{FLOOR_LABEL[f]}
                </span>
                <span style={{ color: 'var(--text3)' }}>{floorCounts[f]}</span>
              </div>
            ))}
          </div>

          {/* The building — rendered by the world-engine Scene from a tilemap */}
          <Scene
            spec={sceneSpec}
            style={{
              flexShrink: 0,
              filter: 'drop-shadow(0 0 30px rgba(91,163,255,0.2))',
            }}
          >

            {/* Empty state */}
            {sessions.length === 0 && (
              <div style={{
                position: 'absolute', inset: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: 'var(--text3)', fontSize: 12, textAlign: 'center', padding: 40,
                background: 'rgba(0,0,0,0.4)',
              }}>
                <div>
                  <div style={{ fontSize: 28, opacity: 0.4, marginBottom: 8 }}>🏢</div>
                  No sessions yet —<br/>click the Commander to dispatch a task
                </div>
              </div>
            )}

            {/* Lift car */}
            <LiftCar
              tileX={LIFT_X}
              tileY={FLOOR_SURFACE_Y[liftFloor]}
              doorFrame={doorFrame}
              sheet={liftSheet}
              floorLabel={FLOOR_LABEL[liftFloor]}
              tilePx={TILE_PX}
            />

            {/* "+N more" indicator at the lounge */}
            {loungeHidden > 0 && (
              <div style={{
                ...tilePos(SCENE_WIDTH / 2, SCENE_HEIGHT - 0.3, TILE_PX, 'center'),
                fontSize: 10, fontWeight: 700,
                color: 'var(--text)',
                background: 'rgba(0,0,0,0.78)',
                border: '1px solid var(--glass-border)',
                padding: '2px 9px', borderRadius: 99,
                whiteSpace: 'nowrap',
                letterSpacing: '0.04em',
                zIndex: 4,
              }}>
                +{loungeHidden} more idle
              </div>
            )}

            {/* Agents on their floor slots — positioned in tile coords */}
            {sessions.map(session => {
              const state = agentStates[session.sessionId] ?? 'idle'
              const a = assignments.get(session.sessionId)
              if (!a) return null
              const groupSlots = slotsByGroup[a.floor]
              if (!groupSlots || groupSlots.length === 0) return null
              const slot = groupSlots[a.slotIdx]
              const tileX = slot.x
              const tileY = slot.y + a.rowOffset
              return (
                <div
                  key={session.sessionId}
                  style={{
                    ...tilePos(tileX, tileY, TILE_PX, 'bottom-center'),
                    transition: 'left 1.1s cubic-bezier(0.4, 0, 0.2, 1), top 1.1s cubic-bezier(0.4, 0, 0.2, 1)',
                    zIndex: 3,
                  }}
                >
                  <AgentCard
                    session={session}
                    state={state}
                    sheet={sheet}
                    onClick={() => setSelected(session)}
                  />
                </div>
              )
            })}
          </Scene>

          {/* Legend / activity panel (right side) — desktop only */}
          <div className="hide-mobile" style={{
            width: 200, paddingTop: 32, color: 'var(--text2)', fontSize: 11,
            display: 'flex', flexDirection: 'column', gap: 12,
          }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {(['working', 'done', 'signal', 'idle'] as AgentState[]).map(st => (
                <div key={st} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{
                    width: 7, height: 7, borderRadius: '50%',
                    background: STATE_LABEL_COLOR[st], opacity: st === 'idle' ? 0.5 : 1,
                  }} />
                  <span style={{ color: 'var(--text2)' }}>{STATE_LABEL[st]}</span>
                </div>
              ))}
            </div>
            <div style={{ borderTop: '1px solid var(--glass-border)', paddingTop: 10, fontSize: 10, color: 'var(--text3)', lineHeight: 1.6 }}>
              <div style={{ marginBottom: 6 }}>Click any agent to inspect or chat.</div>
              <div>The lift moves whenever an agent changes floors.</div>
            </div>
          </div>
        </div>
      </div>

      {selected && <AgentModal session={selected} onClose={() => setSelected(null)} />}
      {brainOpen && <BrainModal onClose={() => setBrainOpen(false)} onDispatched={() => poll()} />}
    </div>
  )
}
