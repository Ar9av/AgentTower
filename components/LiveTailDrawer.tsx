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

export default function LiveTailDrawer({ projectDirName, projectDisplayName, onClose }: Props) {
  const [session, setSession] = useState<ResolvedSession | null>(null)
  const [error, setError] = useState('')
  const [lines, setLines] = useState<string[]>([])
  const [connected, setConnected] = useState(false)
  const seen = useRef<Set<string>>(new Set())
  const bodyRef = useRef<HTMLDivElement>(null)

  // Resolve the most recent active session for this project
  useEffect(() => {
    let cancelled = false
    fetch('/api/recent-sessions?limit=50')
      .then(r => r.ok ? r.json() : [])
      .then((all: Array<{ sessionId: string; encodedFilepath: string; projectDirName: string; isActive: boolean; mtime: number }>) => {
        if (cancelled) return
        const match = all
          .filter(s => s.projectDirName === projectDirName && s.isActive)
          .sort((a, b) => b.mtime - a.mtime)[0]
        if (!match) {
          setError('No active session for this project.')
          return
        }
        setSession({ sessionId: match.sessionId, encodedFilepath: match.encodedFilepath })
      })
      .catch(err => setError(String(err)))
    return () => { cancelled = true }
  }, [projectDirName])

  // SSE tail
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
        const rendered = renderLine(msg)
        if (!rendered) return
        setLines(prev => {
          const next = [...prev, rendered]
          return next.length > 60 ? next.slice(-60) : next
        })
      } catch { /* ignore */ }
    }
    return () => es.close()
  }, [session])

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight, behavior: 'smooth' })
  }, [lines])

  return (
    <>
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
          backdropFilter: 'blur(4px)', zIndex: 250,
        }}
      />
      <aside style={{
        position: 'fixed', top: 0, right: 0, bottom: 0,
        width: 'min(460px, 92vw)', zIndex: 251,
        display: 'flex', flexDirection: 'column',
        background: 'var(--glass-bg)',
        backdropFilter: 'var(--glass-blur-lg)',
        WebkitBackdropFilter: 'var(--glass-blur-lg)',
        borderLeft: '1px solid var(--glass-border)',
        boxShadow: '-4px 0 40px rgba(0,0,0,0.3)',
        animation: 'slideInRight 0.22s cubic-bezier(0.4,0,0.2,1)',
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '14px 16px', borderBottom: '1px solid var(--glass-border)', flexShrink: 0,
        }}>
          <span className={connected ? 'dot-live' : ''} style={!connected ? {
            width: 6, height: 6, borderRadius: '50%', background: 'var(--text3)', display: 'inline-block',
          } : {}} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {projectDisplayName}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text3)' }}>
              {connected ? 'Live tail' : session ? 'Connecting…' : 'Finding session…'}
            </div>
          </div>
          {session && (
            <Link
              href={`/session?f=${session.encodedFilepath}`}
              style={{ fontSize: 12, color: 'var(--accent)', textDecoration: 'none' }}
            >
              Open →
            </Link>
          )}
          <button
            onClick={onClose}
            aria-label="Close"
            style={{ background: 'none', border: 'none', color: 'var(--text2)', fontSize: 18, cursor: 'pointer', padding: '4px 6px' }}
          >✕</button>
        </div>

        <div ref={bodyRef} style={{ flex: 1, overflowY: 'auto', padding: '10px 14px', fontSize: 12, lineHeight: 1.5 }}>
          {error && <div style={{ color: 'var(--red, #ef4444)', fontSize: 13 }}>{error}</div>}
          {!error && lines.length === 0 && (
            <div style={{ color: 'var(--text3)', fontSize: 13, textAlign: 'center', marginTop: 24 }}>
              {session ? 'Waiting for messages…' : 'Loading…'}
            </div>
          )}
          {lines.map((line, i) => (
            <div key={i} style={{
              padding: '6px 8px', marginBottom: 4, borderRadius: 6,
              background: 'var(--glass-bg-hover, rgba(255,255,255,0.03))',
              color: 'var(--text2)', fontFamily: 'ui-monospace, monospace',
              whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            }}>{line}</div>
          ))}
        </div>
      </aside>
      <style>{`@keyframes slideInRight { from { transform: translateX(100%); } to { transform: translateX(0); } }`}</style>
    </>
  )
}

function renderLine(msg: ParsedMessage): string | null {
  if (msg.isMeta) return null
  if (msg.type === 'user') {
    const text = msg.content.find(b => b.type === 'text')?.text ?? ''
    if (!text) return null
    return `📨 ${truncate(text, 280)}`
  }
  if (msg.type === 'assistant') {
    const parts: string[] = []
    for (const b of msg.content) {
      if (b.type === 'text' && b.text) parts.push(truncate(b.text, 500))
      if (b.type === 'tool_use') parts.push(`⚙ ${b.tool_name ?? 'tool'}`)
      if (b.type === 'thinking' && b.thinking) parts.push(`💭 ${truncate(b.thinking, 200)}`)
    }
    const text = parts.join('\n').trim()
    return text || null
  }
  return null
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s
}
