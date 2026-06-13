'use client'
import { useEffect, useRef, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import type { ProjectInfo } from '@/lib/types'

interface RecentSession {
  sessionId: string
  encodedFilepath: string
  projectDisplayName: string
  firstPrompt: string
  mtime: number
  isActive: boolean
}

// URL-safe base64 (mirrors server-side encodeB64)
function encodeB64(s: string): string {
  const bytes = new TextEncoder().encode(s)
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

type Result =
  | { kind: 'project'; item: ProjectInfo }
  | { kind: 'session'; item: RecentSession }

export default function CommandPalette() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [projects, setProjects] = useState<ProjectInfo[]>([])
  const [sessions, setSessions] = useState<RecentSession[]>([])
  const [selectedIdx, setSelectedIdx] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const close = useCallback(() => {
    setOpen(false)
    setQuery('')
    setSelectedIdx(0)
  }, [])

  // ⌘K / Ctrl+K to open
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setOpen(o => !o)
      }
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [close])

  // Fetch on open
  useEffect(() => {
    if (!open) return
    Promise.all([
      fetch('/api/projects').then(r => r.ok ? r.json() : []),
      fetch('/api/recent-sessions').then(r => r.ok ? r.json() : []),
    ]).then(([p, s]) => { setProjects(p); setSessions(s) }).catch(() => {})
    setTimeout(() => inputRef.current?.focus(), 40)
  }, [open])

  const q = query.toLowerCase()
  const filteredProjects = projects.filter(p =>
    !q || p.displayName.toLowerCase().includes(q) || p.decodedPath.toLowerCase().includes(q)
  ).slice(0, 5)
  const filteredSessions = sessions.filter(s =>
    !q || s.firstPrompt.toLowerCase().includes(q) || s.projectDisplayName.toLowerCase().includes(q)
  ).slice(0, 8)

  const results: Result[] = [
    ...filteredProjects.map(item => ({ kind: 'project' as const, item })),
    ...filteredSessions.map(item => ({ kind: 'session' as const, item })),
  ]

  function navigate(r: Result) {
    if (r.kind === 'project') {
      router.push(`/project?p=${encodeB64(r.item.dirName)}`)
    } else {
      router.push(`/session?f=${r.item.encodedFilepath}`)
    }
    close()
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIdx(i => Math.min(i + 1, results.length - 1)) }
    if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedIdx(i => Math.max(i - 1, 0)) }
    if (e.key === 'Enter' && results[selectedIdx]) navigate(results[selectedIdx])
  }

  if (!open) return null

  return (
    <>
      <div
        onClick={close}
        style={{ position: 'fixed', inset: 0, zIndex: 700, background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(6px)' }}
      />
      <div style={{
        position: 'fixed', zIndex: 701,
        left: '50%', top: '18%',
        transform: 'translateX(-50%)',
        width: 'min(580px, 94vw)',
        background: 'var(--bg2)',
        border: '1px solid var(--glass-border-hi)',
        borderRadius: 18,
        overflow: 'hidden',
        boxShadow: '0 20px 70px rgba(0,0,0,0.6)',
        animation: 'quickLaunchIn 0.15s ease',
      }}>
        {/* Search bar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', borderBottom: '1px solid var(--glass-border)' }}>
          <span style={{ color: 'var(--text3)', fontSize: 18, lineHeight: 1 }}>⌕</span>
          <input
            ref={inputRef}
            value={query}
            onChange={e => { setQuery(e.target.value); setSelectedIdx(0) }}
            onKeyDown={handleKeyDown}
            placeholder="Search sessions and projects…"
            style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', fontSize: 15, color: 'var(--text)', fontFamily: 'inherit' }}
          />
          <kbd style={{ fontSize: 11, color: 'var(--text3)', background: 'var(--bg3)', border: '1px solid var(--glass-border)', borderRadius: 5, padding: '2px 7px', whiteSpace: 'nowrap' }}>ESC</kbd>
        </div>

        {/* Results */}
        <div style={{ maxHeight: 'min(420px, 60vh)', overflowY: 'auto' }}>
          {results.length === 0 && (
            <div style={{ padding: '28px', textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>
              No results — try a different search
            </div>
          )}

          {filteredProjects.length > 0 && (
            <div style={{ padding: '8px 16px 3px', fontSize: 10, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>
              Projects
            </div>
          )}
          {filteredProjects.map((p, i) => (
            <button
              key={p.dirName}
              onClick={() => navigate({ kind: 'project', item: p })}
              onMouseEnter={() => setSelectedIdx(i)}
              style={{
                width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 10,
                padding: '9px 16px', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                background: i === selectedIdx ? 'var(--glass-bg-hover)' : 'transparent',
                color: 'var(--text)',
              }}
            >
              {p.hasActive
                ? <span className="dot-active" style={{ width: 7, height: 7, flexShrink: 0 }} />
                : <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--glass-border)', display: 'inline-block', flexShrink: 0 }} />}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.displayName}</div>
                <div style={{ fontSize: 11, color: 'var(--text3)', fontFamily: 'ui-monospace, monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.decodedPath}</div>
              </div>
              {p.hasActive && <span className="chip chip-green" style={{ fontSize: 10, flexShrink: 0 }}>Live</span>}
              <span className="chip" style={{ fontSize: 10, flexShrink: 0 }}>{p.sessionCount} sessions</span>
            </button>
          ))}

          {filteredSessions.length > 0 && (
            <div style={{
              padding: '8px 16px 3px', fontSize: 10, fontWeight: 700, color: 'var(--text3)',
              textTransform: 'uppercase', letterSpacing: '0.07em',
              borderTop: filteredProjects.length > 0 ? '1px solid var(--glass-border)' : undefined,
              marginTop: filteredProjects.length > 0 ? 4 : 0,
            }}>
              Recent Sessions
            </div>
          )}
          {filteredSessions.map((s, i) => {
            const idx = filteredProjects.length + i
            return (
              <button
                key={s.sessionId}
                onClick={() => navigate({ kind: 'session', item: s })}
                onMouseEnter={() => setSelectedIdx(idx)}
                style={{
                  width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 10,
                  padding: '9px 16px', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                  background: idx === selectedIdx ? 'var(--glass-bg-hover)' : 'transparent',
                  color: 'var(--text)',
                }}
              >
                {s.isActive
                  ? <span className="dot-active" style={{ width: 7, height: 7, flexShrink: 0 }} />
                  : <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--glass-border)', display: 'inline-block', flexShrink: 0 }} />}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {s.firstPrompt === '(no prompt)' ? <span style={{ color: 'var(--text3)', fontStyle: 'italic' }}>No prompt</span> : s.firstPrompt}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text3)' }}>{s.projectDisplayName}</div>
                </div>
                {s.isActive && <span className="chip chip-green" style={{ fontSize: 10, flexShrink: 0 }}>Active</span>}
              </button>
            )
          })}
        </div>

        {/* Footer */}
        <div style={{ padding: '8px 16px', borderTop: '1px solid var(--glass-border)', display: 'flex', gap: 14, fontSize: 11, color: 'var(--text3)' }}>
          <span>↑↓ navigate</span>
          <span>↵ open</span>
          <span style={{ marginLeft: 'auto' }}>⌘K to close</span>
        </div>
      </div>
    </>
  )
}
