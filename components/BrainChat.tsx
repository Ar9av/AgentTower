'use client'
import { useEffect, useRef, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import SkillPicker, { SkillButton, useSkills } from './SkillPicker'

// ── Markdown renderer ─────────────────────────────────────────────────────────

export function renderMarkdown(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = []
  const lines = text.split('\n')
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (line.startsWith('```')) {
      const lang = line.slice(3).trim()
      const codeLines: string[] = []
      i++
      while (i < lines.length && !lines[i].startsWith('```')) { codeLines.push(lines[i]); i++ }
      nodes.push(
        <pre key={i} style={{ background: 'var(--bg)', border: '1px solid var(--glass-border)', borderRadius: 8, padding: '10px 14px', overflowX: 'auto', fontSize: 12, margin: '8px 0', fontFamily: 'ui-monospace, monospace' }}>
          {lang && <div style={{ fontSize: 10, color: 'var(--text3)', marginBottom: 4 }}>{lang}</div>}
          <code>{codeLines.join('\n')}</code>
        </pre>
      )
      i++; continue
    }
    const hm = line.match(/^(#{1,3})\s+(.+)/)
    if (hm) {
      const level = hm[1].length
      const size = level === 1 ? 17 : level === 2 ? 15 : 13
      nodes.push(<div key={i} style={{ fontSize: size, fontWeight: 700, color: 'var(--text)', margin: `${level === 1 ? 14 : 10}px 0 4px`, letterSpacing: '-0.01em' }}>{renderInline(hm[2])}</div>)
      i++; continue
    }
    if (line.includes('|') && i + 1 < lines.length && lines[i + 1].match(/^\|?[\s\-|:]+\|?$/)) {
      const tableLines: string[] = [line]; i++
      while (i < lines.length && lines[i].includes('|')) { tableLines.push(lines[i]); i++ }
      const parseRow = (r: string) => r.split('|').map(c => c.trim()).filter(c => c !== '')
      const rows = tableLines.filter(r => !r.match(/^\|?[\s\-|:]+\|?$/))
      const header = parseRow(rows[0] ?? '')
      const bodyRows = rows.slice(1).map(parseRow)
      nodes.push(
        <div key={i} style={{ overflowX: 'auto', margin: '8px 0' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12 }}>
            <thead><tr>{header.map((h, j) => <th key={j} style={{ padding: '5px 10px', textAlign: 'left', borderBottom: '1px solid var(--glass-border)', color: 'var(--text2)', fontWeight: 600, whiteSpace: 'nowrap' }}>{renderInline(h)}</th>)}</tr></thead>
            <tbody>{bodyRows.map((row, ri) => <tr key={ri} style={{ borderBottom: '1px solid var(--glass-border)' }}>{row.map((cell, ci) => <td key={ci} style={{ padding: '5px 10px', color: 'var(--text)', verticalAlign: 'top' }}>{renderInline(cell)}</td>)}</tr>)}</tbody>
          </table>
        </div>
      )
      continue
    }
    if (line.match(/^[-*]\s/)) {
      const items: string[] = []
      while (i < lines.length && lines[i].match(/^[-*]\s/)) { items.push(lines[i].replace(/^[-*]\s/, '')); i++ }
      nodes.push(<ul key={i} style={{ margin: '4px 0', paddingLeft: 18, listStyle: 'disc' }}>{items.map((it, j) => <li key={j} style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.6 }}>{renderInline(it)}</li>)}</ul>)
      continue
    }
    if (line.match(/^[-*_]{3,}$/)) { nodes.push(<hr key={i} style={{ border: 'none', borderTop: '1px solid var(--glass-border)', margin: '10px 0' }} />); i++; continue }
    if (!line.trim()) { nodes.push(<div key={i} style={{ height: 6 }} />); i++; continue }
    nodes.push(<p key={i} style={{ margin: '3px 0', fontSize: 13, lineHeight: 1.65, color: 'var(--text)' }}>{renderInline(line)}</p>)
    i++
  }
  return nodes
}

function renderInline(text: string): React.ReactNode {
  const parts = text
    .split(/(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\[(?:[^\]]+)\]\((?:[^)]+)\))/)
    .filter((p): p is string => p != null && p !== '')
  return parts.map((part, i) => {
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2)
      return <code key={i} style={{ background: 'var(--bg)', padding: '1px 5px', borderRadius: 4, fontSize: 12, fontFamily: 'ui-monospace, monospace', color: 'var(--accent)' }}>{part.slice(1, -1)}</code>
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4)
      return <strong key={i} style={{ fontWeight: 700, color: 'var(--text)' }}>{part.slice(2, -2)}</strong>
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2)
      return <em key={i}>{part.slice(1, -1)}</em>
    const lm = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/)
    if (lm) return <a key={i} href={lm[2]} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)', textDecoration: 'underline' }}>{lm[1]}</a>
    return part
  })
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface Message {
  id: string
  role: 'user' | 'brain'
  content: string
  streaming?: boolean
  actions?: ParsedAction[]
  ts: number
  provider?: 'claude' | 'codex'
}

type BrainProvider = 'auto' | 'claude' | 'codex'

interface ParsedAction {
  type: 'start_session' | 'open_session' | 'kill_session' | 'save_memory' | 'update_wiki' | 'search_wiki' | 'send_to_session'
  label: string
  payload: Record<string, unknown>
}

interface ContextMeta {
  runningCount: number
  completedTodayCount: number
  hasWiki: boolean
  hasMemory: boolean
  hasOrchestrator: boolean
  requestedProvider?: BrainProvider
}

// ── Persistence ───────────────────────────────────────────────────────────────

const HISTORY_KEY = 'brain-history-v2'

function loadHistory(): Message[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    if (!raw) return []
    const msgs = JSON.parse(raw) as Message[]
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000
    return msgs.filter(m => m.ts > cutoff).slice(-40)
  } catch { return [] }
}
function saveHistory(msgs: Message[]) {
  if (typeof window === 'undefined') return
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(msgs.slice(-40))) } catch { /* ignore */ }
}

// ── Action parsing ────────────────────────────────────────────────────────────

function parseActions(text: string): ParsedAction[] {
  const actions: ParsedAction[] = []
  for (const line of text.split('\n')) {
    const m = line.match(/^ACTION:(\w+):(\{.+\})$/)
    if (!m) continue
    try {
      const type = m[1] as ParsedAction['type']
      const payload = JSON.parse(m[2])
      let label: string = type
      if (type === 'start_session' && payload.project) label = `▶ Start in ${String(payload.project).split('/').pop()}`
      else if (type === 'send_to_session') label = `➤ Send to ${payload.label ?? 'agent'}`
      else if (type === 'open_session') label = `↗ ${payload.label ?? 'Open session'}`
      else if (type === 'kill_session') label = `⏹ Kill ${payload.label ?? 'agent'}`
      else if (type === 'save_memory') label = `🧠 Remember${payload.type ? ` (${payload.type})` : ''}`
      else if (type === 'update_wiki' && payload.path) label = `📖 Write ${String(payload.path).split('/').pop()}`
      else if (type === 'search_wiki' && payload.query) label = `🔍 Search "${payload.query}"`
      actions.push({ type, label, payload })
    } catch { /* skip */ }
  }
  return actions
}
function stripActions(text: string): string {
  return text.split('\n').filter(l => !l.match(/^ACTION:\w+:\{/)).join('\n').trim()
}

// ── Action executor ───────────────────────────────────────────────────────────

function useActionExecutor(onResult: (msg: string) => void) {
  const router = useRouter()
  return useCallback(async (action: ParsedAction): Promise<'done' | 'error'> => {
    try {
      const p = action.payload
      if (action.type === 'open_session' && p.encodedFilepath) {
        const mode = p.provider === 'codex' ? 'codex' : 'claude'
        router.push(mode === 'codex' ? `/session?mode=codex&f=${p.encodedFilepath}` : `/session?f=${p.encodedFilepath}`)
        return 'done'
      }
      if (action.type === 'start_session' && p.project) {
        const res = await fetch('/api/run', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ project_path: p.project, prompt: p.prompt ?? 'hello', model: p.model ?? 'sonnet', mode: p.provider ?? 'auto' }) })
        if (res.ok) onResult(`Started session in ${String(p.project).split('/').pop()}`)
        return res.ok ? 'done' : 'error'
      }
      if (action.type === 'send_to_session' && p.sessionId && p.message) {
        const res = await fetch('/api/input', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ session_id: p.sessionId, prompt: p.message, mode: p.provider }) })
        if (res.ok) onResult(`Sent to ${p.label ?? 'agent'}: "${String(p.message).slice(0, 60)}"`)
        return res.ok ? 'done' : 'error'
      }
      if (action.type === 'kill_session' && p.pid) {
        const res = await fetch('/api/kill', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pid: p.pid }) })
        if (res.ok) onResult(`Killed ${p.label ?? 'agent'}`)
        return res.ok ? 'done' : 'error'
      }
      if (action.type === 'save_memory' && p.fact) {
        const res = await fetch('/api/brain/memory', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fact: p.fact, type: p.type }) })
        if (res.ok) onResult('Saved to memory')
        return res.ok ? 'done' : 'error'
      }
      if (action.type === 'update_wiki' && p.path && p.content) {
        const res = await fetch('/api/brain/wiki', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: p.path, title: p.title, content: p.content }) })
        if (res.ok) onResult(`Updated wiki: ${p.path}`)
        return res.ok ? 'done' : 'error'
      }
      if (action.type === 'search_wiki' && p.query) {
        const res = await fetch(`/api/brain/wiki?q=${encodeURIComponent(String(p.query))}`)
        if (res.ok) {
          const data = await res.json()
          const preview = (data.results ?? []).slice(0, 3)
            .map((r: { title: string; snippet: string }) => `**${r.title}**: ${r.snippet.slice(0, 120)}`).join('\n')
          onResult(preview || 'No results found')
        }
        return res.ok ? 'done' : 'error'
      }
      return 'error'
    } catch { return 'error' }
  }, [router, onResult])
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ContextBadge({ icon, label, active }: { icon: string; label: string; active: boolean }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '2px 8px', borderRadius: 99, fontSize: 11, fontWeight: 600,
      background: active ? 'color-mix(in srgb, var(--accent) 10%, transparent)' : 'var(--glass-bg)',
      color: active ? 'var(--accent)' : 'var(--text3)',
      border: `1px solid ${active ? 'color-mix(in srgb, var(--accent) 25%, transparent)' : 'var(--glass-border)'}`,
    }}>{icon} {label}</span>
  )
}

function ActionButton({ action, execute }: { action: ParsedAction; execute: (a: ParsedAction) => Promise<'done' | 'error'> }) {
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  async function run() {
    if (state !== 'idle') return
    setState('loading')
    const r = await execute(action)
    setState(r)
    if (r === 'done') setTimeout(() => setState('idle'), 3000)
  }
  const styles: Record<string, React.CSSProperties> = {
    idle:    { background: 'var(--glass-bg)', color: 'var(--text2)', borderColor: 'var(--glass-border)', cursor: 'pointer' },
    loading: { background: 'color-mix(in srgb, var(--yellow) 10%, transparent)', color: 'var(--yellow)', borderColor: 'color-mix(in srgb, var(--yellow) 25%, transparent)', cursor: 'default' },
    done:    { background: 'color-mix(in srgb, var(--green) 12%, transparent)', color: 'var(--green)', borderColor: 'color-mix(in srgb, var(--green) 28%, transparent)', cursor: 'default' },
    error:   { background: 'color-mix(in srgb, var(--red) 10%, transparent)', color: 'var(--red)', borderColor: 'color-mix(in srgb, var(--red) 25%, transparent)', cursor: 'pointer' },
  }
  return (
    <button onClick={run} style={{ padding: '5px 12px', borderRadius: 8, fontSize: 12, fontWeight: 600, border: '1px solid', display: 'inline-flex', alignItems: 'center', gap: 5, transition: 'all 0.12s', ...styles[state] }}>
      {state === 'loading' && <span style={{ animation: 'spin 0.8s linear infinite', display: 'inline-block' }}>⟳</span>}
      {state === 'done' && '✓ '}{state === 'error' && '✕ '}{action.label}
    </button>
  )
}

function ThinkingDots() {
  return (
    <span style={{ display: 'inline-flex', gap: 3, alignItems: 'center' }}>
      {[0, 1, 2].map(i => <span key={i} style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--text3)', display: 'inline-block', animation: `dot-bounce 1.4s ease-in-out ${i * 0.16}s infinite` }} />)}
    </span>
  )
}

function MessageBubble({ msg, execute }: { msg: Message; execute: (a: ParsedAction) => Promise<'done' | 'error'> }) {
  const isUser = msg.role === 'user'
  const showThinking = msg.streaming && !msg.content
  return (
    <div style={{ display: 'flex', flexDirection: isUser ? 'row-reverse' : 'row', gap: 8, alignItems: 'flex-start', marginBottom: 16 }}>
      {!isUser && (
        <div style={{ width: 28, height: 28, borderRadius: 8, flexShrink: 0, background: 'color-mix(in srgb, var(--accent) 12%, transparent)', border: '1px solid color-mix(in srgb, var(--accent) 25%, transparent)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: 2 }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
        </div>
      )}
      <div style={{ maxWidth: isUser ? '75%' : '92%', minWidth: 0 }}>
        <div style={{ padding: isUser ? '9px 14px' : '10px 16px', borderRadius: isUser ? '14px 14px 4px 14px' : '14px 14px 14px 4px', background: isUser ? 'color-mix(in srgb, var(--accent) 14%, var(--bg3))' : 'var(--bg3)', border: '1px solid var(--glass-border)', wordBreak: 'break-word' }}>
          {showThinking ? <ThinkingDots /> : isUser ? <p style={{ margin: 0, fontSize: 13, lineHeight: 1.65, color: 'var(--text)' }}>{msg.content}</p> : <>{renderMarkdown(msg.content || '')}</>}
        </div>
        {msg.actions && msg.actions.length > 0 && (
          <div style={{ marginTop: 7, display: 'flex', flexWrap: 'wrap', gap: 5 }}>
            {msg.actions.map((a, i) => <ActionButton key={i} action={a} execute={execute} />)}
          </div>
        )}
        <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 3, textAlign: isUser ? 'right' : 'left' }}>
          {!isUser && msg.provider ? `${msg.provider === 'claude' ? 'Claude' : 'Codex'} · ` : ''}
          {new Date(msg.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </div>
      </div>
    </div>
  )
}

const QUICK_PROMPTS = [
  'What are my agents working on right now?',
  'Any agents stuck or stalled? Investigate.',
  'What should I focus on next?',
  'Summarise today\'s agent activity',
  'What patterns keep recurring across my recent sessions?',
]

// ── Main reusable chat ────────────────────────────────────────────────────────

interface Props {
  variant?: 'panel' | 'page'
  /** External seed prompt (e.g. clicking an alert) */
  seedPrompt?: string
  /** Notify parent of message count + clear handler for header chrome */
  onStateChange?: (s: { count: number; clear: () => void; loading: boolean }) => void
}

export default function BrainChat({ variant = 'panel', seedPrompt, onStateChange }: Props) {
  const [messages, setMessages] = useState<Message[]>(() => loadHistory())
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [contextMeta, setContextMeta] = useState<ContextMeta | null>(null)
  const [provider, setProvider] = useState<BrainProvider>('auto')
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  useSkills() // warm skill cache
  const slashMatch = input.match(/\/(\w*)$/)
  const showSkillPicker = slashMatch !== null
  const skillQuery = slashMatch?.[1] ?? ''
  function handleSkillSelect(name: string) {
    setInput(input.replace(/\/\w*$/, `/${name} `))
    inputRef.current?.focus()
  }
  function openSkillPicker() {
    setInput(prev => prev.endsWith('/') ? prev : prev + '/')
    inputRef.current?.focus()
  }

  const execute = useActionExecutor((msg) => {
    const note: Message = { id: `sys-${Date.now()}`, role: 'brain', content: `✓ ${msg}`, ts: Date.now() }
    setMessages(prev => { const next = [...prev, note]; saveHistory(next); return next })
  })

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])
  useEffect(() => { setTimeout(() => inputRef.current?.focus(), 80) }, [])
  useEffect(() => {
    const saved = localStorage.getItem('brain-provider')
    if (saved === 'claude' || saved === 'codex') setProvider(saved)
  }, [])
  useEffect(() => { if (messages.length > 0) saveHistory(messages) }, [messages])

  const clearHistory = useCallback(() => {
    setMessages([])
    if (typeof window !== 'undefined') localStorage.removeItem(HISTORY_KEY)
  }, [])

  useEffect(() => {
    onStateChange?.({ count: messages.length, clear: clearHistory, loading })
  }, [messages.length, loading, clearHistory, onStateChange])

  // Seed prompt from parent (alert click)
  const seededRef = useRef('')
  useEffect(() => {
    if (seedPrompt && seedPrompt !== seededRef.current) {
      seededRef.current = seedPrompt
      send(seedPrompt)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedPrompt])

  async function send(text?: string) {
    const content = (text ?? input).trim()
    if (!content || loading) return
    const userMsg: Message = { id: `u-${Date.now()}`, role: 'user', content, ts: Date.now() }
    const brainId = `b-${Date.now()}`
    const brainMsg: Message = { id: brainId, role: 'brain', content: '', streaming: true, ts: Date.now() }
    setMessages(prev => [...prev, userMsg, brainMsg])
    setInput('')
    if (inputRef.current) inputRef.current.style.height = 'auto'
    setLoading(true)
    const ctrl = new AbortController()
    abortRef.current = ctrl
    try {
      const res = await fetch('/api/brain/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: ctrl.signal,
        body: JSON.stringify({ messages: messages.map(m => ({ role: m.role, content: m.content })), userMessage: content, provider }),
      })
      if (!res.ok || !res.body) {
        if (res.status === 401) {
          setMessages(prev => prev.map(m => m.id === brainId ? { ...m, content: 'Your session expired. Reconnecting…', streaming: false } : m))
          window.location.assign('/login')
          return
        }
        const detail = await res.json().catch(() => ({})) as { error?: string }
        setMessages(prev => prev.map(m => m.id === brainId ? { ...m, content: detail.error || `Brain request failed (${res.status}).`, streaming: false } : m)); return
      }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let full = ''
      let pending = ''
      const handleControl = (raw: string) => {
        try {
          const data = JSON.parse(raw) as ContextMeta & { _meta?: boolean; _event?: string; provider?: 'claude' | 'codex' }
          if (data._meta) setContextMeta(data)
          if (data._event === 'provider' && data.provider) {
            setMessages(prev => prev.map(m => m.id === brainId ? { ...m, provider: data.provider } : m))
          }
        } catch { /* ignore malformed control data */ }
      }
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        pending += decoder.decode(value, { stream: true })
        while (pending) {
          const start = pending.indexOf('\x00')
          if (start < 0) { full += pending; pending = ''; break }
          if (start > 0) { full += pending.slice(0, start); pending = pending.slice(start); continue }
          const end = pending.indexOf('\x00', 1)
          if (end < 0) break
          handleControl(pending.slice(1, end))
          pending = pending.slice(end + 1)
        }
        setMessages(prev => prev.map(m => m.id === brainId ? { ...m, content: full } : m))
      }
      full += pending
      const actions = parseActions(full)
      const clean = stripActions(full)
      setMessages(prev => { const next = prev.map(m => m.id === brainId ? { ...m, content: clean, streaming: false, actions } : m); saveHistory(next); return next })
    } catch (err: unknown) {
      if (err instanceof Error && err.name !== 'AbortError') {
        setMessages(prev => prev.map(m => m.id === brainId ? { ...m, content: 'Connection error. Is Claude installed?', streaming: false } : m))
      }
    } finally { setLoading(false); abortRef.current = null }
  }

  const isPage = variant === 'page'
  const railPad = isPage ? 'max(16px, calc(50% - 380px))' : '16px'

  return (
    <div className="brain-chat" style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, background: 'var(--bg)' }}>
      {/* Context badges */}
      {contextMeta && (
        <div className="brain-context-badges" style={{ padding: '7px 14px', borderBottom: '1px solid var(--glass-border)', display: 'flex', gap: 6, flexWrap: 'wrap', flexShrink: 0, background: 'var(--bg2)' }}>
          <ContextBadge icon="🟢" label={`${contextMeta.runningCount} running`} active={contextMeta.runningCount > 0} />
          <ContextBadge icon="✅" label={`${contextMeta.completedTodayCount} today`} active={contextMeta.completedTodayCount > 0} />
          <ContextBadge icon="📖" label="Wiki" active={contextMeta.hasWiki} />
          <ContextBadge icon="🧠" label="Memory" active={contextMeta.hasMemory} />
          <ContextBadge icon="🤖" label="Orchestrator" active={contextMeta.hasOrchestrator} />
        </div>
      )}

      {/* Messages */}
      <div className="brain-messages" style={{ flex: 1, overflowY: 'auto', padding: isPage ? `20px ${railPad}` : '14px 16px' }}>
        {messages.length === 0 && (
          <div>
            <p style={{ fontSize: 13, color: 'var(--text3)', marginBottom: 14, lineHeight: 1.6 }}>
              Your unified intelligence layer. I can read your session transcripts, search your wiki,
              remember facts, and act — start, steer, or stop agents. Ask me anything.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {QUICK_PROMPTS.map(q => (
                <button key={q} onClick={() => send(q)} style={{ textAlign: 'left', padding: '8px 13px', borderRadius: 9, background: 'var(--bg2)', border: '1px solid var(--glass-border)', color: 'var(--text2)', fontSize: 13, cursor: 'pointer', transition: 'all 0.12s', lineHeight: 1.4 }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg3)'; e.currentTarget.style.color = 'var(--text)' }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'var(--bg2)'; e.currentTarget.style.color = 'var(--text2)' }}>
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map(msg => <MessageBubble key={msg.id} msg={msg} execute={execute} />)}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="brain-composer" style={{ padding: isPage ? `12px ${railPad} 16px` : '10px 14px 14px', borderTop: '1px solid var(--glass-border)', flexShrink: 0, background: 'var(--bg2)' }}>
        <div className="brain-provider-row" style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 7 }}>
          <span className="brain-provider-label" style={{ fontSize: 11, color: 'var(--text3)' }}>Brain provider</span>
          <div style={{ display: 'inline-flex', padding: 2, borderRadius: 8, background: 'var(--bg3)', border: '1px solid var(--glass-border)' }}>
            {(['auto', 'claude', 'codex'] as BrainProvider[]).map(option => (
              <button key={option} onClick={() => { setProvider(option); localStorage.setItem('brain-provider', option) }} disabled={loading}
                title={option === 'auto' ? 'Use Claude, then switch to Codex on usage or rate limits' : `Always use ${option}`}
                style={{ border: 0, borderRadius: 6, padding: '4px 9px', cursor: loading ? 'default' : 'pointer', fontSize: 11, fontWeight: 600, textTransform: 'capitalize', background: provider === option ? 'var(--accent-dim)' : 'transparent', color: provider === option ? 'var(--accent)' : 'var(--text3)' }}>
                {option}
              </button>
            ))}
          </div>
          {provider === 'auto' && <span className="brain-fallback-hint" style={{ fontSize: 10, color: 'var(--text3)' }}>Claude → Codex fallback</span>}
        </div>
        <div style={{ position: 'relative' }}>
          {showSkillPicker && (
            <SkillPicker
              query={skillQuery}
              onSelect={handleSkillSelect}
              onDismiss={() => setInput(input.replace(/\/\w*$/, ''))}
            />
          )}
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', background: 'var(--bg3)', border: `1.5px solid ${loading ? 'color-mix(in srgb, var(--accent) 50%, var(--glass-border))' : 'var(--glass-border-hi)'}`, borderRadius: 14, padding: '6px 6px 6px 10px', transition: 'border-color 0.15s' }}>
            <SkillButton onClick={openSkillPicker} />
            <textarea ref={inputRef} value={input} onChange={e => {
              setInput(e.target.value)
              e.currentTarget.style.height = 'auto'
              e.currentTarget.style.height = `${Math.min(e.currentTarget.scrollHeight, 140)}px`
            }}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !showSkillPicker) { e.preventDefault(); send() } }}
              placeholder="Ask, command, or describe what you need… (type / for skills)" rows={1}
              style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', resize: 'none', color: 'var(--text)', fontSize: 'max(14px, 16px)', lineHeight: 1.55, padding: '5px 0', maxHeight: 140, overflowY: 'auto', fontFamily: 'inherit' }} />
            {loading ? (
              <button onClick={() => { abortRef.current?.abort(); setLoading(false) }} title="Stop"
                style={{ width: 34, height: 34, borderRadius: '50%', border: 'none', cursor: 'pointer', background: 'color-mix(in srgb, var(--red) 18%, transparent)', color: 'var(--red)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, alignSelf: 'flex-end', marginBottom: 1 }}>■</button>
            ) : (
              <button onClick={() => send()} disabled={!input.trim()} title="Send (Enter)"
                style={{ width: 34, height: 34, borderRadius: '50%', border: 'none', cursor: input.trim() ? 'pointer' : 'default', flexShrink: 0, alignSelf: 'flex-end', marginBottom: 1, background: input.trim() ? 'var(--accent)' : 'var(--glass-bg)', color: input.trim() ? '#000' : 'var(--text3)', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'background 0.12s' }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>
              </button>
            )}
          </div>
        </div>
        <p className="brain-input-hint" style={{ fontSize: 11, color: 'var(--text3)', marginTop: 5, textAlign: 'center' }}>Enter · Shift+Enter for newline{variant === 'panel' ? ' · Esc to close' : ''}</p>
      </div>
    </div>
  )
}
