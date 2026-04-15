'use client'
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'

interface RecentSession {
  sessionId: string
  encodedFilepath: string
  projectDisplayName: string
  firstPrompt: string
  mtime: number
  isActive: boolean
}

const LS_KEY = 'agenttower.lastSeenNotif'
const POLL_MS = 20_000
const WINDOW_MS = 6 * 60 * 60 * 1000  // only show completions from last 6 hours

function relTime(ms: number): string {
  const d = Date.now() - ms
  if (d < 60_000) return 'just now'
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m ago`
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h ago`
  return `${Math.floor(d / 86_400_000)}d ago`
}

export default function Notifications() {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<RecentSession[]>([])
  const [lastSeen, setLastSeen] = useState<number>(() => {
    if (typeof window === 'undefined') return 0
    const raw = localStorage.getItem(LS_KEY)
    return raw ? parseInt(raw, 10) : Date.now()
  })
  const wasActive = useRef<Map<string, boolean>>(new Map())

  async function poll() {
    try {
      const res = await fetch('/api/recent-sessions?limit=30')
      if (!res.ok) return
      const sessions = await res.json() as RecentSession[]

      // Detect transitions from active → completed using previous snapshot
      const prev = wasActive.current
      const transitions = new Set<string>()
      for (const s of sessions) {
        const prevActive = prev.get(s.sessionId)
        if (prevActive === true && !s.isActive) transitions.add(s.sessionId)
        prev.set(s.sessionId, s.isActive)
      }

      const cutoff = Date.now() - WINDOW_MS
      const completed = sessions
        .filter(s => !s.isActive && s.mtime > cutoff)
        .sort((a, b) => b.mtime - a.mtime)
        .slice(0, 15)

      setItems(completed)

      // If a fresh transition happened, ensure badge shows by not auto-advancing lastSeen.
      // (no-op here; transitions flows into the unread count via mtime > lastSeen)
      void transitions
    } catch { /* ignore */ }
  }

  useEffect(() => {
    poll()
    const id = setInterval(poll, POLL_MS)
    return () => clearInterval(id)
  }, [])

  // Close on outside click
  const rootRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  function markAllRead() {
    const now = Date.now()
    setLastSeen(now)
    localStorage.setItem(LS_KEY, String(now))
  }

  function toggle() {
    const next = !open
    setOpen(next)
    if (next) {
      // Mark read when opened after a short delay so the user sees the highlights first
      setTimeout(markAllRead, 400)
    }
  }

  const unreadCount = items.filter(i => i.mtime > lastSeen).length

  return (
    <div ref={rootRef} style={{ position: 'relative' }}>
      <button
        onClick={toggle}
        className="glass-btn"
        style={{ padding: '6px 10px', minHeight: 36, fontSize: 15, position: 'relative' }}
        aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
        title="Notifications"
      >
        🔔
        {unreadCount > 0 && (
          <span style={{
            position: 'absolute', top: 2, right: 2,
            background: 'var(--red, #ef4444)', color: '#fff',
            borderRadius: 8, fontSize: 9, fontWeight: 700,
            padding: '1px 5px', lineHeight: 1.2,
            minWidth: 14, textAlign: 'center',
          }}>{unreadCount > 9 ? '9+' : unreadCount}</span>
        )}
      </button>

      {open && (
        <div
          className="glass-lg"
          style={{
            position: 'absolute', top: 'calc(100% + 8px)', right: 0,
            width: 'min(360px, 90vw)',
            maxHeight: 460,
            borderRadius: 12,
            display: 'flex', flexDirection: 'column',
            zIndex: 150,
            boxShadow: '0 8px 40px rgba(0,0,0,0.35)',
          }}
        >
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '12px 14px', borderBottom: '1px solid var(--glass-border)',
          }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>
              Recently completed
            </span>
            <span style={{ fontSize: 11, color: 'var(--text3)' }}>
              {items.length} {items.length === 1 ? 'session' : 'sessions'}
            </span>
          </div>

          <div style={{ flex: 1, overflowY: 'auto' }}>
            {items.length === 0 ? (
              <div style={{ padding: '28px 16px', textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>
                Nothing recent to catch up on.
              </div>
            ) : (
              items.map(s => {
                const unread = s.mtime > lastSeen
                return (
                  <Link
                    key={s.sessionId}
                    href={`/session?f=${s.encodedFilepath}`}
                    onClick={() => setOpen(false)}
                    style={{ textDecoration: 'none', display: 'block' }}
                  >
                    <div style={{
                      padding: '10px 14px',
                      borderBottom: '1px solid var(--glass-border)',
                      background: unread ? 'color-mix(in srgb, var(--accent, #7c5cff) 10%, transparent)' : 'transparent',
                      transition: 'background 0.12s',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--glass-bg-hover, rgba(255,255,255,0.04))')}
                    onMouseLeave={e => (e.currentTarget.style.background = unread ? 'color-mix(in srgb, var(--accent, #7c5cff) 10%, transparent)' : 'transparent')}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                        {unread && <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--accent, #7c5cff)', display: 'inline-block' }} />}
                        <span style={{
                          fontSize: 11, fontWeight: 600, color: 'var(--text2)',
                          textTransform: 'uppercase', letterSpacing: '0.05em',
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          flex: 1, minWidth: 0,
                        }}>
                          ✓ {s.projectDisplayName}
                        </span>
                        <span style={{ fontSize: 10, color: 'var(--text3)', flexShrink: 0 }}>
                          {relTime(s.mtime)}
                        </span>
                      </div>
                      <p style={{
                        margin: 0, fontSize: 12, color: 'var(--text)',
                        overflow: 'hidden', textOverflow: 'ellipsis',
                        display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                        lineHeight: 1.35,
                      }}>
                        {s.firstPrompt === '(no prompt)' ? (
                          <span style={{ color: 'var(--text3)', fontStyle: 'italic' }}>No prompt</span>
                        ) : s.firstPrompt}
                      </p>
                    </div>
                  </Link>
                )
              })
            )}
          </div>

          {unreadCount > 0 && (
            <div style={{ padding: '8px 14px', borderTop: '1px solid var(--glass-border)', textAlign: 'right' }}>
              <button
                onClick={markAllRead}
                style={{
                  background: 'none', border: 'none', color: 'var(--accent, #7c5cff)',
                  fontSize: 12, cursor: 'pointer', padding: '2px 6px',
                }}
              >
                Mark all read
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
