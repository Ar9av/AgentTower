'use client'
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useSidebar } from './SidebarProvider'
import { RecentSession } from '@/lib/claude-fs'

function relTime(ms: number): string {
  const d = Date.now() - ms
  if (d < 60_000) return 'just now'
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m ago`
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h ago`
  return `${Math.floor(d / 86_400_000)}d ago`
}

export default function Sidebar() {
  const { open, close } = useSidebar()
  const [sessions, setSessions] = useState<RecentSession[]>([])
  const [loading, setLoading] = useState(false)
  const drawerRef = useRef<HTMLDivElement>(null)

  // Touch swipe-to-close
  const touchStartX = useRef(0)
  function onTouchStart(e: React.TouchEvent) { touchStartX.current = e.touches[0].clientX }
  function onTouchEnd(e: React.TouchEvent) {
    const dx = e.changedTouches[0].clientX - touchStartX.current
    if (dx < -60) close() // swipe left to close
  }

  // Fetch recent sessions when opened
  useEffect(() => {
    if (!open) return
    setLoading(true)
    fetch('/api/recent-sessions')
      .then(r => r.ok ? r.json() : [])
      .then(setSessions)
      .finally(() => setLoading(false))
  }, [open])

  // Close on Escape
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, close])

  // Prevent body scroll when open
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [open])

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={close}
        style={{
          position: 'fixed', inset: 0, zIndex: 200,
          background: 'rgba(0,0,0,0.45)',
          backdropFilter: 'blur(4px)',
          opacity: open ? 1 : 0,
          pointerEvents: open ? 'auto' : 'none',
          transition: 'opacity 0.25s ease',
        }}
      />

      {/* Drawer */}
      <div
        ref={drawerRef}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        style={{
          position: 'fixed',
          top: 0, left: 0, bottom: 0,
          width: 'min(280px, 85vw)',
          zIndex: 201,
          display: 'flex',
          flexDirection: 'column',
          transform: open ? 'translateX(0)' : 'translateX(-100%)',
          transition: 'transform 0.28s cubic-bezier(0.4, 0, 0.2, 1)',
          background: 'var(--glass-bg)',
          backdropFilter: 'var(--glass-blur-lg)',
          WebkitBackdropFilter: 'var(--glass-blur-lg)',
          borderRight: '1px solid var(--glass-border)',
          boxShadow: '4px 0 40px rgba(0,0,0,0.3)',
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '16px 18px',
          borderBottom: '1px solid var(--glass-border)',
          flexShrink: 0,
        }}>
          <span style={{ fontWeight: 700, fontSize: 15, color: 'var(--text)' }}>Recent Sessions</span>
          <button
            onClick={close}
            style={{
              background: 'none', border: 'none', color: 'var(--text2)',
              fontSize: 18, cursor: 'pointer', padding: '8px 12px',
              borderRadius: 6, lineHeight: 1, minHeight: 44, minWidth: 44,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
            aria-label="Close sidebar"
          >
            ✕
          </button>
        </div>

        {/* Session list */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '10px 0' }}>
          {loading && (
            <div style={{ padding: '32px 18px', textAlign: 'center', color: 'var(--text3)', fontSize: 14 }}>
              Loading…
            </div>
          )}

          {!loading && sessions.length === 0 && (
            <div style={{ padding: '32px 18px', textAlign: 'center', color: 'var(--text3)', fontSize: 14 }}>
              No sessions yet
            </div>
          )}

          {!loading && sessions.map(s => (
            <Link
              key={s.sessionId}
              href={`/session?f=${s.encodedFilepath}`}
              onClick={close}
              style={{ textDecoration: 'none', display: 'block' }}
            >
              <div style={{
                padding: '11px 18px',
                borderBottom: '1px solid var(--glass-border)',
                transition: 'background 0.12s',
                cursor: 'pointer',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--glass-bg-hover)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                {/* Project name + status */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  {s.isActive && <span className="dot-active" style={{ width: 6, height: 6 }} />}
                  <span style={{ fontSize: 11, fontWeight: 600, color: s.isActive ? 'var(--green)' : 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    {s.projectDisplayName}
                  </span>
                  <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text3)', flexShrink: 0 }}>
                    {relTime(s.mtime)}
                  </span>
                </div>

                {/* Prompt */}
                <p style={{
                  margin: 0, fontSize: 13, color: 'var(--text)',
                  overflow: 'hidden', textOverflow: 'ellipsis',
                  display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                  lineHeight: 1.4,
                }}>
                  {s.firstPrompt === '(no prompt)' ? (
                    <span style={{ color: 'var(--text3)', fontStyle: 'italic' }}>No prompt</span>
                  ) : s.firstPrompt}
                </p>
              </div>
            </Link>
          ))}
        </div>

        {/* Footer — link to all projects */}
        <div style={{
          padding: '12px 18px',
          borderTop: '1px solid var(--glass-border)',
          flexShrink: 0,
        }}>
          <Link
            href="/projects"
            onClick={close}
            style={{ fontSize: 13, color: 'var(--accent)', textDecoration: 'none', fontWeight: 500 }}
          >
            View all projects →
          </Link>
        </div>
      </div>
    </>
  )
}
