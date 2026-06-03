'use client'
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import type { ParsedMessage } from '@/lib/types'

interface Props {
  projectDirName: string
  projectDisplayName: string
  onClose: () => void
}

interface ResolvedSession {
  sessionId: string
  encodedFilepath: string
}

type LineType = 'user' | 'assistant' | 'tool' | 'thinking'

interface LogLine {
  id: string
  type: LineType
  label?: string
  text: string
}

// Strip XML-style command tags Claude Code embeds in text blocks
function stripCommandXml(text: string): string {
  // Remove XML-style command tag pairs (no 's' flag — use [\s\S] instead of dotAll)
  return text
    .replace(/<\/?(?:command-name|command-message|command-args|local-command-stdout|local-command-stderr|function_calls|invoke|parameter)[^>]*>[\s\S]*?<\/[^>]+>/g, '')
    .replace(/<\/?(?:command-name|command-message|command-args|local-command-stdout|local-command-stderr|function_calls|invoke|parameter)[^>]*>/g, '')
    .trim()
}

function isCommandXml(text: string): boolean {
  return /<command-name>|<local-command-stdout>|<command-message>|<command-args>|<function_calls>/.test(text)
}

function renderLines(msg: ParsedMessage): LogLine[] {
  if (msg.isMeta) return []
  const lines: LogLine[] = []

  if (msg.type === 'user') {
    for (const b of msg.content) {
      if (b.type === 'text' && b.text) {
        const cleaned = stripCommandXml(b.text)
        if (cleaned && !isCommandXml(cleaned)) {
          lines.push({ id: `${msg.uuid}-user`, type: 'user', text: truncate(cleaned, 400) })
        }
      }
    }
    return lines
  }

  if (msg.type === 'assistant') {
    for (const b of msg.content) {
      if (b.type === 'thinking' && b.thinking) {
        const cleaned = stripCommandXml(b.thinking)
        if (cleaned) lines.push({ id: `${msg.uuid}-think`, type: 'thinking', text: truncate(cleaned, 280) })
      }
      if (b.type === 'text' && b.text) {
        const cleaned = stripCommandXml(b.text)
        if (cleaned && !isCommandXml(cleaned)) {
          lines.push({ id: `${msg.uuid}-text`, type: 'assistant', text: truncate(cleaned, 500) })
        }
      }
      if (b.type === 'tool_use') {
        const toolName = b.tool_name ?? 'tool'
        let detail = ''
        if (b.tool_input && typeof b.tool_input === 'object') {
          const inp = b.tool_input as Record<string, unknown>
          const key = Object.keys(inp)[0]
          if (key) {
            const val = String(inp[key])
            detail = truncate(val, 80)
          }
        }
        lines.push({ id: `${msg.uuid}-${toolName}`, type: 'tool', label: toolName, text: detail })
      }
    }
  }
  return lines
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s
}

// ── Line row component ────────────────────────────────────────────────────────
function LineRow({ line }: { line: LogLine }) {
  const [expanded, setExpanded] = useState(false)

  if (line.type === 'user') return (
    <div style={{
      display: 'flex', gap: 10, padding: '8px 14px',
      borderBottom: '1px solid var(--glass-border)',
      borderLeft: '2px solid var(--accent)',
      background: 'color-mix(in srgb, var(--accent) 5%, transparent)',
    }}>
      <span style={{ fontSize: 11, color: 'var(--accent)', fontWeight: 700, flexShrink: 0, marginTop: 1, letterSpacing: '0.03em' }}>YOU</span>
      <p style={{ margin: 0, fontSize: 13, color: 'var(--text)', lineHeight: 1.5, wordBreak: 'break-word' }}>{line.text}</p>
    </div>
  )

  if (line.type === 'thinking') return (
    <div style={{
      display: 'flex', gap: 10, padding: '6px 14px',
      borderBottom: '1px solid var(--glass-border)',
      opacity: 0.6,
    }}>
      <span style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 700, flexShrink: 0, marginTop: 1, fontStyle: 'italic' }}>THINK</span>
      <p style={{ margin: 0, fontSize: 12, color: 'var(--text2)', lineHeight: 1.45, fontStyle: 'italic', wordBreak: 'break-word' }}>{line.text}</p>
    </div>
  )

  if (line.type === 'tool') return (
    <div style={{
      display: 'flex', alignItems: 'baseline', gap: 8, padding: '6px 14px',
      borderBottom: '1px solid var(--glass-border)',
    }}>
      <span style={{ fontSize: 10, color: 'var(--green)', fontWeight: 700, fontFamily: 'ui-monospace, monospace',
        background: 'color-mix(in srgb, var(--green) 10%, transparent)',
        border: '1px solid color-mix(in srgb, var(--green) 25%, transparent)',
        borderRadius: 4, padding: '1px 6px', flexShrink: 0, letterSpacing: '0.02em' }}>
        {line.label}
      </span>
      {line.text && (
        <span style={{ fontSize: 12, color: 'var(--text3)', fontFamily: 'ui-monospace, monospace',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>
          {line.text}
        </span>
      )}
    </div>
  )

  // assistant
  return (
    <div
      onClick={() => line.text.length > 120 && setExpanded(v => !v)}
      style={{
        padding: '8px 14px',
        borderBottom: '1px solid var(--glass-border)',
        cursor: line.text.length > 120 ? 'pointer' : 'default',
      }}
    >
      <p style={{
        margin: 0, fontSize: 13, color: 'var(--text)', lineHeight: 1.55, wordBreak: 'break-word',
        display: expanded ? undefined : '-webkit-box',
        WebkitLineClamp: expanded ? undefined : 3,
        WebkitBoxOrient: expanded ? undefined : 'vertical',
        overflow: expanded ? undefined : 'hidden',
      }}>{line.text}</p>
      {line.text.length > 120 && (
        <span style={{ fontSize: 11, color: 'var(--text3)', marginTop: 3, display: 'block' }}>
          {expanded ? '▲ less' : '▼ more'}
        </span>
      )}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function LiveTailDrawer({ projectDirName, projectDisplayName, onClose }: Props) {
  const [session, setSession] = useState<ResolvedSession | null>(null)
  const [error, setError] = useState('')
  const [lines, setLines] = useState<LogLine[]>([])
  const [connected, setConnected] = useState(false)
  const [autoScroll, setAutoScroll] = useState(true)
  const seen = useRef<Set<string>>(new Set())
  const bodyRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/recent-sessions?limit=50')
      .then(r => r.ok ? r.json() : [])
      .then((all: Array<{ sessionId: string; encodedFilepath: string; projectDirName: string; isActive: boolean; mtime: number }>) => {
        if (cancelled) return
        const match = all
          .filter(s => s.projectDirName === projectDirName && s.isActive)
          .sort((a, b) => b.mtime - a.mtime)[0]
        if (!match) { setError('No active session found for this project.'); return }
        setSession({ sessionId: match.sessionId, encodedFilepath: match.encodedFilepath })
      })
      .catch(err => setError(String(err)))
    return () => { cancelled = true }
  }, [projectDirName])

  useEffect(() => {
    if (!session) return
    const es = new EventSource(`/api/tail?f=${session.encodedFilepath}`)
    es.onopen = () => setConnected(true)
    es.onerror = () => setConnected(false)
    es.onmessage = e => {
      try {
        const data = JSON.parse(e.data)
        const msg = (data.type === 'catchup' || data.type === 'message') ? data.message as ParsedMessage : null
        if (!msg || seen.current.has(msg.uuid)) return
        seen.current.add(msg.uuid)
        const newLines = renderLines(msg)
        if (!newLines.length) return
        setLines(prev => {
          const next = [...prev, ...newLines]
          return next.length > 120 ? next.slice(-120) : next
        })
      } catch { /* ignore */ }
    }
    return () => es.close()
  }, [session])

  // Auto-scroll to bottom
  useEffect(() => {
    if (!autoScroll || !bodyRef.current) return
    bodyRef.current.scrollTo({ top: bodyRef.current.scrollHeight, behavior: 'smooth' })
  }, [lines, autoScroll])

  // Detect manual scroll up → pause auto-scroll
  function onScroll() {
    const el = bodyRef.current
    if (!el) return
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60
    setAutoScroll(nearBottom)
  }

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
          backdropFilter: 'blur(6px)', zIndex: 250,
        }}
      />

      {/* Drawer */}
      <aside style={{
        position: 'fixed', top: 0, right: 0, bottom: 0,
        width: 'min(480px, 94vw)', zIndex: 251,
        display: 'flex', flexDirection: 'column',
        background: 'var(--bg2)',
        borderLeft: '1px solid var(--glass-border)',
        boxShadow: '-8px 0 48px rgba(0,0,0,0.5)',
        animation: 'slideInRight 0.22s cubic-bezier(0.4,0,0.2,1)',
      }}>

        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '14px 16px',
          borderBottom: '1px solid var(--glass-border)',
          flexShrink: 0,
          background: 'var(--bg3)',
        }}>
          {/* Live indicator */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
            <span className={connected ? 'dot-active' : 'dot-live'} style={
              !connected ? { width: 7, height: 7, borderRadius: '50%', background: 'var(--text3)', display: 'inline-block' } : {}
            } />
          </div>

          {/* Title */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {projectDisplayName}
            </div>
            <div style={{ fontSize: 11, color: connected ? 'var(--green)' : 'var(--text3)', marginTop: 1 }}>
              {connected ? '● Live' : session ? 'Connecting…' : 'Finding session…'}
            </div>
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
            {session && (
              <Link
                href={`/session?f=${session.encodedFilepath}`}
                onClick={onClose}
                style={{
                  fontSize: 12, fontWeight: 600, color: 'var(--accent)',
                  textDecoration: 'none', padding: '4px 10px',
                  background: 'var(--accent-dim)', borderRadius: 7,
                  border: '1px solid color-mix(in srgb, var(--accent) 25%, transparent)',
                }}
              >
                Open →
              </Link>
            )}
            <button
              onClick={onClose}
              aria-label="Close"
              style={{
                background: 'var(--glass-bg)', border: '1px solid var(--glass-border)',
                color: 'var(--text2)', fontSize: 14, cursor: 'pointer',
                padding: '5px 9px', borderRadius: 8, lineHeight: 1, display: 'flex', alignItems: 'center',
              }}
            >✕</button>
          </div>
        </div>

        {/* Log body */}
        <div
          ref={bodyRef}
          onScroll={onScroll}
          style={{ flex: 1, overflowY: 'auto' }}
        >
          {error && (
            <div style={{ padding: '20px 16px', color: 'var(--red)', fontSize: 13, display: 'flex', gap: 8 }}>
              <span>⚠</span> {error}
            </div>
          )}

          {!error && lines.length === 0 && (
            <div style={{ padding: '48px 20px', textAlign: 'center', color: 'var(--text3)' }}>
              <div style={{ fontSize: 28, marginBottom: 10 }}>📡</div>
              <div style={{ fontSize: 13, fontWeight: 500 }}>
                {session ? 'Waiting for messages…' : 'Connecting…'}
              </div>
              <div style={{ fontSize: 11, marginTop: 5 }}>New messages will appear here in real time</div>
            </div>
          )}

          {lines.map(line => <LineRow key={line.id} line={line} />)}
        </div>

        {/* Auto-scroll resume hint */}
        {!autoScroll && lines.length > 0 && (
          <div style={{
            padding: '8px 14px', borderTop: '1px solid var(--glass-border)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            flexShrink: 0, background: 'var(--bg3)',
          }}>
            <span style={{ fontSize: 12, color: 'var(--text3)' }}>Scroll paused</span>
            <button
              onClick={() => {
                setAutoScroll(true)
                bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight, behavior: 'smooth' })
              }}
              style={{
                fontSize: 12, color: 'var(--accent)', background: 'none', border: 'none',
                cursor: 'pointer', padding: '2px 6px', fontWeight: 600,
              }}
            >
              ↓ Resume
            </button>
          </div>
        )}
      </aside>

      <style>{`
        @keyframes slideInRight {
          from { transform: translateX(100%); opacity: 0; }
          to   { transform: translateX(0);   opacity: 1; }
        }
      `}</style>
    </>
  )
}
