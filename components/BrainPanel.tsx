'use client'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

interface Message {
  id: string
  role: 'user' | 'brain'
  content: string
  streaming?: boolean
  actions?: ParsedAction[]
}

interface ParsedAction {
  type: 'start_session' | 'open_session'
  label: string
  project?: string
  prompt?: string
  model?: string
  encodedFilepath?: string
}

interface StatusSummary {
  running: number
  completedToday: number
  currentActivities: string[]
}

function parseActions(text: string): ParsedAction[] {
  const actions: ParsedAction[] = []
  const lines = text.split('\n')
  for (const line of lines) {
    const m = line.match(/^ACTION:(\w+):(.+)$/)
    if (!m) continue
    try {
      const type = m[1] as ParsedAction['type']
      const payload = JSON.parse(m[2])
      if (type === 'start_session' && payload.project) {
        actions.push({
          type,
          label: `Start: ${payload.prompt?.slice(0, 50) ?? 'new session'}`,
          project: payload.project,
          prompt: payload.prompt,
          model: payload.model,
        })
      } else if (type === 'open_session' && payload.encodedFilepath) {
        actions.push({
          type,
          label: payload.label ?? 'Open session',
          encodedFilepath: payload.encodedFilepath,
        })
      }
    } catch { /* skip malformed */ }
  }
  return actions
}

function stripActions(text: string): string {
  return text
    .split('\n')
    .filter(l => !l.match(/^ACTION:\w+:/))
    .join('\n')
    .trim()
}

// ── Sub-components ─────────────────────────────────────────────────────────

function ActionChip({ action, onDone }: { action: ParsedAction; onDone: () => void }) {
  const router = useRouter()
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')

  async function execute() {
    setState('loading')
    try {
      if (action.type === 'open_session' && action.encodedFilepath) {
        router.push(`/session?f=${action.encodedFilepath}`)
        onDone()
        return
      }
      if (action.type === 'start_session' && action.project) {
        const res = await fetch('/api/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            project_path: action.project,
            prompt: action.prompt ?? 'hello',
            model: action.model ?? 'sonnet',
          }),
        })
        if (res.ok) {
          setState('done')
          setTimeout(() => {
            onDone()
            router.push('/projects')
          }, 800)
          return
        }
      }
      setState('error')
    } catch {
      setState('error')
    }
  }

  const colors: Record<string, string> = {
    idle:    'color-mix(in srgb, var(--accent) 14%, transparent)',
    loading: 'color-mix(in srgb, var(--yellow) 14%, transparent)',
    done:    'color-mix(in srgb, var(--green) 14%, transparent)',
    error:   'color-mix(in srgb, var(--red) 14%, transparent)',
  }
  const textColors: Record<string, string> = {
    idle: 'var(--accent)', loading: 'var(--yellow)', done: 'var(--green)', error: 'var(--red)',
  }

  return (
    <button
      onClick={execute}
      disabled={state !== 'idle'}
      style={{
        padding: '5px 12px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: state === 'idle' ? 'pointer' : 'default',
        background: colors[state],
        border: `1px solid ${textColors[state].replace('var(--accent)', 'color-mix(in srgb, var(--accent) 30%, transparent)')}`,
        color: textColors[state],
        display: 'inline-flex', alignItems: 'center', gap: 5,
        transition: 'all 0.15s',
      }}
    >
      {state === 'idle'    && <span>⚡ {action.label}</span>}
      {state === 'loading' && <span>⟳ Running…</span>}
      {state === 'done'    && <span>✓ Done</span>}
      {state === 'error'   && <span>✕ Failed</span>}
    </button>
  )
}

function ThinkingDots() {
  return (
    <span style={{ display: 'inline-flex', gap: 3, alignItems: 'center', padding: '2px 0' }}>
      {[0, 1, 2].map(i => (
        <span key={i} style={{
          width: 5, height: 5, borderRadius: '50%', background: 'var(--text3)',
          display: 'inline-block',
          animation: `dot-bounce 1.4s ease-in-out ${i * 0.16}s infinite`,
        }} />
      ))}
    </span>
  )
}

function StatusBar({ status }: { status: StatusSummary | null }) {
  if (!status) return null
  return (
    <div style={{
      padding: '8px 16px', borderBottom: '1px solid var(--glass-border)',
      display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center',
      background: 'var(--bg3)', flexShrink: 0,
    }}>
      {status.running > 0 ? (
        <span style={{ fontSize: 12, color: 'var(--green)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 5 }}>
          <span className="dot-active" style={{ width: 6, height: 6 }} />
          {status.running} running
        </span>
      ) : (
        <span style={{ fontSize: 12, color: 'var(--text3)' }}>No agents running</span>
      )}
      {status.completedToday > 0 && (
        <span style={{ fontSize: 12, color: 'var(--text3)' }}>· {status.completedToday} completed today</span>
      )}
      {status.currentActivities.slice(0, 2).map((a, i) => (
        <span key={i} style={{
          fontSize: 11, padding: '2px 8px', borderRadius: 99,
          background: 'var(--glass-bg)', color: 'var(--text3)',
          border: '1px solid var(--glass-border)',
        }}>{a}</span>
      ))}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props { onClose: () => void }

export default function BrainPanel({ onClose }: Props) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState<StatusSummary | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  // Load live status summary
  useEffect(() => {
    fetch('/api/recent-sessions?limit=30')
      .then(r => r.ok ? r.json() : [])
      .then((sessions: Array<{ isActive: boolean; mtime: number; currentActivity: string | null }>) => {
        const now = Date.now()
        const running = sessions.filter(s => s.isActive)
        const completedToday = sessions.filter(s => !s.isActive && now - s.mtime < 24 * 60 * 60 * 1000).length
        const activities = running
          .map(s => s.currentActivity)
          .filter(Boolean)
          .slice(0, 3) as string[]
        setStatus({ running: running.length, completedToday, currentActivities: activities })
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  async function send(text?: string) {
    const content = (text ?? input).trim()
    if (!content || loading) return

    const userMsg: Message = { id: `u-${Date.now()}`, role: 'user', content }
    const brainId = `b-${Date.now()}`
    const brainMsg: Message = { id: brainId, role: 'brain', content: '', streaming: true }

    setMessages(prev => [...prev, userMsg, brainMsg])
    setInput('')
    setLoading(true)

    const ctrl = new AbortController()
    abortRef.current = ctrl

    try {
      const res = await fetch('/api/brain/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: ctrl.signal,
        body: JSON.stringify({
          messages: messages.map(m => ({ role: m.role, content: m.content })),
          userMessage: content,
        }),
      })

      if (!res.ok || !res.body) {
        setMessages(prev => prev.map(m =>
          m.id === brainId ? { ...m, content: 'Failed to get response.', streaming: false } : m
        ))
        return
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let full = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = decoder.decode(value, { stream: true })
        full += chunk
        setMessages(prev => prev.map(m =>
          m.id === brainId ? { ...m, content: full } : m
        ))
      }

      // Finalize — parse actions, strip from text
      const actions = parseActions(full)
      const clean = stripActions(full)
      setMessages(prev => prev.map(m =>
        m.id === brainId ? { ...m, content: clean, streaming: false, actions } : m
      ))
    } catch (err: unknown) {
      if (err instanceof Error && err.name !== 'AbortError') {
        setMessages(prev => prev.map(m =>
          m.id === brainId ? { ...m, content: 'Connection error.', streaming: false } : m
        ))
      }
    } finally {
      setLoading(false)
      abortRef.current = null
    }
  }

  const QUICK_PROMPTS = [
    'What are my agents working on?',
    'Any agents stuck or stalled?',
    'What should I work on next?',
    'Summarize today\'s activity',
  ]

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
          backdropFilter: 'blur(6px)', zIndex: 450,
        }}
      />

      {/* Panel */}
      <aside style={{
        position: 'fixed', top: 0, right: 0, bottom: 0,
        width: 'min(520px, 96vw)', zIndex: 451,
        display: 'flex', flexDirection: 'column',
        background: 'var(--bg2)',
        borderLeft: '1px solid var(--glass-border)',
        boxShadow: '-8px 0 60px rgba(0,0,0,0.6)',
        animation: 'slideInRight 0.22s cubic-bezier(0.4,0,0.2,1)',
      }}>

        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '14px 16px', borderBottom: '1px solid var(--glass-border)',
          flexShrink: 0, background: 'var(--bg3)',
        }}>
          <div style={{
            width: 32, height: 32, borderRadius: 10, flexShrink: 0,
            background: 'color-mix(in srgb, var(--accent) 14%, transparent)',
            border: '1px solid color-mix(in srgb, var(--accent) 30%, transparent)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)"
              strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
            </svg>
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>AgentTower Brain</div>
            <div style={{ fontSize: 11, color: 'var(--text3)' }}>AI coordination assistant</div>
          </div>

          <button
            onClick={onClose}
            style={{
              background: 'var(--glass-bg)', border: '1px solid var(--glass-border)',
              color: 'var(--text2)', fontSize: 14, cursor: 'pointer',
              padding: '5px 9px', borderRadius: 8, lineHeight: 1,
              display: 'flex', alignItems: 'center',
            }}
          >✕</button>
        </div>

        {/* Status bar */}
        <StatusBar status={status} />

        {/* Messages */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px' }}>

          {/* Empty state — quick prompts */}
          {messages.length === 0 && (
            <div style={{ paddingTop: 12 }}>
              <p style={{ fontSize: 13, color: 'var(--text3)', marginBottom: 16 }}>
                Ask me anything about your agents. I have full visibility into all running and recent sessions.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {QUICK_PROMPTS.map(q => (
                  <button
                    key={q}
                    onClick={() => send(q)}
                    style={{
                      textAlign: 'left', padding: '9px 14px', borderRadius: 10,
                      background: 'var(--glass-bg)', border: '1px solid var(--glass-border)',
                      color: 'var(--text2)', fontSize: 13, cursor: 'pointer',
                      transition: 'all 0.12s', lineHeight: 1.4,
                    }}
                    onMouseEnter={e => {
                      e.currentTarget.style.background = 'var(--glass-bg-hover)'
                      e.currentTarget.style.color = 'var(--text)'
                    }}
                    onMouseLeave={e => {
                      e.currentTarget.style.background = 'var(--glass-bg)'
                      e.currentTarget.style.color = 'var(--text2)'
                    }}
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Chat messages */}
          {messages.map(msg => (
            <div key={msg.id} style={{
              marginBottom: 16,
              display: 'flex',
              flexDirection: msg.role === 'user' ? 'row-reverse' : 'row',
              gap: 8, alignItems: 'flex-start',
            }}>
              {/* Avatar */}
              {msg.role === 'brain' && (
                <div style={{
                  width: 28, height: 28, borderRadius: 8, flexShrink: 0,
                  background: 'color-mix(in srgb, var(--accent) 12%, transparent)',
                  border: '1px solid color-mix(in srgb, var(--accent) 25%, transparent)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: 2,
                }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
                  </svg>
                </div>
              )}

              <div style={{ maxWidth: '85%' }}>
                {/* Bubble */}
                <div style={{
                  padding: '10px 14px', borderRadius: msg.role === 'user' ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
                  background: msg.role === 'user'
                    ? 'color-mix(in srgb, var(--accent) 14%, var(--bg3))'
                    : 'var(--bg3)',
                  border: '1px solid var(--glass-border)',
                  fontSize: 13, lineHeight: 1.6, color: 'var(--text)',
                  whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                }}>
                  {msg.streaming && !msg.content ? <ThinkingDots /> : (msg.content || <ThinkingDots />)}
                </div>

                {/* Action chips */}
                {msg.actions && msg.actions.length > 0 && (
                  <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {msg.actions.map((action, i) => (
                      <ActionChip key={i} action={action} onDone={() => {}} />
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}

          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div style={{
          padding: '10px 14px',
          borderTop: '1px solid var(--glass-border)',
          flexShrink: 0, background: 'var(--bg3)',
        }}>
          <div style={{
            display: 'flex', gap: 8, alignItems: 'flex-end',
            background: 'var(--bg2)', border: `1.5px solid ${loading ? 'var(--accent)' : 'var(--glass-border-hi)'}`,
            borderRadius: 14, padding: '6px 6px 6px 14px',
            transition: 'border-color 0.15s',
          }}>
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
                if (e.key === 'Escape') onClose()
              }}
              placeholder="Ask about your agents…"
              rows={1}
              disabled={loading}
              style={{
                flex: 1, background: 'transparent', border: 'none', outline: 'none',
                resize: 'none', color: 'var(--text)', fontSize: 14, lineHeight: 1.5,
                padding: '5px 0', maxHeight: 120, overflowY: 'auto', fontFamily: 'inherit',
              }}
            />
            {loading ? (
              <button
                onClick={() => { abortRef.current?.abort(); setLoading(false) }}
                style={{
                  width: 34, height: 34, borderRadius: '50%', border: 'none', cursor: 'pointer',
                  background: 'color-mix(in srgb, var(--red) 20%, transparent)',
                  color: 'var(--red)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0, alignSelf: 'flex-end', marginBottom: 1, fontSize: 14,
                }}
                title="Stop"
              >■</button>
            ) : (
              <button
                onClick={() => send()}
                disabled={!input.trim()}
                style={{
                  width: 34, height: 34, borderRadius: '50%', border: 'none',
                  cursor: input.trim() ? 'pointer' : 'default', flexShrink: 0,
                  alignSelf: 'flex-end', marginBottom: 1,
                  background: input.trim() ? 'var(--accent)' : 'var(--glass-bg)',
                  color: input.trim() ? '#000' : 'var(--text3)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  transition: 'background 0.12s',
                }}
                title="Send (Enter)"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="19" x2="12" y2="5"/>
                  <polyline points="5 12 12 5 19 12"/>
                </svg>
              </button>
            )}
          </div>
          <p style={{ fontSize: 11, color: 'var(--text3)', marginTop: 5, textAlign: 'center' }}>
            Enter to send · Shift+Enter for newline · Esc to close
          </p>
        </div>
      </aside>

      <style>{`
        @keyframes slideInRight {
          from { transform: translateX(100%); opacity: 0; }
          to   { transform: translateX(0);   opacity: 1; }
        }
        @keyframes dot-bounce {
          0%, 80%, 100% { transform: translateY(0); opacity: .4; }
          40% { transform: translateY(-4px); opacity: 1; }
        }
      `}</style>
    </>
  )
}
