'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

interface Session {
  sessionId: string
  encodedFilepath: string
  projectDisplayName: string
  firstPrompt: string
  mtime: number
  isActive: boolean
  projectDirName: string
}

const POLL_MS = 10_000

function relTime(ms: number): string {
  const d = Date.now() - ms
  if (d < 60_000)       return 'just now'
  if (d < 3_600_000)    return `${Math.floor(d / 60_000)}m ago`
  if (d < 86_400_000)   return `${Math.floor(d / 3_600_000)}h ago`
  return `${Math.floor(d / 86_400_000)}d ago`
}

export default function DashboardView() {
  const [sessions, setSessions]   = useState<Session[]>([])
  const [loading,  setLoading]    = useState(true)
  const [error,    setError]      = useState('')
  const [lastPoll, setLastPoll]   = useState(Date.now())

  async function fetchSessions() {
    try {
      const res = await fetch('/api/recent-sessions?limit=50')
      if (res.status === 401) { window.location.href = '/login'; return }
      if (!res.ok) { setError('Failed to load sessions'); return }
      const data: Session[] = await res.json()
      setSessions(data)
      setError('')
    } catch {
      setError('Network error — retrying…')
    } finally {
      setLoading(false)
      setLastPoll(Date.now())
    }
  }

  useEffect(() => {
    fetchSessions()
    const id = setInterval(fetchSessions, POLL_MS)
    return () => clearInterval(id)
  }, [])

  const active    = sessions.filter(s => s.isActive)
  const completed = sessions.filter(s => !s.isActive)

  // Unique projects
  const projectSet = new Set(sessions.map(s => s.projectDirName))
  const projectCount = projectSet.size

  return (
    <div style={{ padding: 'clamp(16px,4vw,32px) clamp(12px,4vw,28px)', maxWidth: 1240, margin: '0 auto', width: '100%' }}>

      {/* ── Page header ─────────────────────────────────────────────── */}
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ margin: '0 0 4px', fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em' }}>
          Mission Control
        </h1>
        <p style={{ margin: 0, color: 'var(--text2)', fontSize: 13 }}>
          Live overview of all Claude Code sessions
          <span style={{ marginLeft: 10, color: 'var(--text3)' }}>
            · Updated {relTime(lastPoll)}
          </span>
        </p>
      </div>

      {/* ── Stats row ───────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 28 }}>
        <StatCard label="Active now"      value={active.length}    accent="var(--green)"  />
        <StatCard label="Total sessions"  value={sessions.length}  accent="var(--accent)" />
        <StatCard label="Projects"        value={projectCount}     accent="var(--purple)" />
        <StatCard label="Completed today" value={completed.filter(s => Date.now() - s.mtime < 86_400_000).length} accent="var(--text2)" />
      </div>

      {error && (
        <div style={{
          padding: '10px 16px', borderRadius: 10, marginBottom: 20,
          background: 'color-mix(in srgb, var(--yellow) 10%, transparent)',
          border: '1px solid color-mix(in srgb, var(--yellow) 25%, transparent)',
          fontSize: 13, color: 'var(--yellow)',
        }}>
          ⚠ {error}
        </div>
      )}

      {loading && sessions.length === 0 && (
        <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--text3)' }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>⟳</div>
          <p>Loading sessions…</p>
        </div>
      )}

      {/* ── Active sessions ─────────────────────────────────────────── */}
      {active.length > 0 && (
        <section style={{ marginBottom: 32 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <span className="dot-active" />
            <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: 'var(--green)' }}>
              Active — {active.length}
            </h2>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 300px), 1fr))', gap: 10 }}>
            {active.map(s => <SessionCard key={s.sessionId} session={s} />)}
          </div>
        </section>
      )}

      {/* ── Recent completed ────────────────────────────────────────── */}
      {!loading && (
        <section>
          <h2 style={{ margin: '0 0 12px', fontSize: 15, fontWeight: 700, color: 'var(--text2)' }}>
            Recent Completed
            {completed.length > 0 && (
              <span style={{ marginLeft: 8, fontWeight: 400, color: 'var(--text3)', fontSize: 13 }}>
                {completed.length}
              </span>
            )}
          </h2>

          {completed.length === 0 && !loading ? (
            <div className="glass" style={{ borderRadius: 14, padding: '40px 24px', textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>
              No completed sessions found.
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 300px), 1fr))', gap: 10 }}>
              {completed.map(s => <SessionCard key={s.sessionId} session={s} />)}
            </div>
          )}
        </section>
      )}
    </div>
  )
}

// ── Sub-components ─────────────────────────────────────────────────────────

function StatCard({ label, value, accent }: { label: string; value: number; accent: string }) {
  return (
    <div className="glass" style={{ borderRadius: 14, padding: '16px 20px' }}>
      <div style={{ fontSize: 28, fontWeight: 800, color: accent, letterSpacing: '-0.03em', lineHeight: 1 }}>
        {value}
      </div>
      <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 4, fontWeight: 500 }}>
        {label}
      </div>
    </div>
  )
}

function SessionCard({ session }: { session: Session }) {
  const href    = `/session?f=${session.encodedFilepath}`
  const active  = session.isActive

  return (
    <Link href={href} style={{ textDecoration: 'none', display: 'block' }}>
      <div
        className="glass-interactive"
        style={{
          borderRadius: 14,
          padding:      '16px 18px',
          borderColor:  active ? 'rgba(61,214,140,0.22)' : undefined,
          boxShadow:    active
            ? 'inset 0 1px 0 rgba(255,255,255,0.14), 0 4px 20px rgba(0,0,0,0.3), 0 0 0 1px rgba(61,214,140,0.08)'
            : undefined,
        }}
      >
        {/* Project name + status */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 6 }}>
          {active && <span className="dot-active" style={{ flexShrink: 0 }} />}
          {!active && <span style={{ color: 'var(--text3)', fontSize: 13 }}>✓</span>}
          <span style={{
            fontSize:      12,
            fontWeight:    700,
            color:         active ? 'var(--green)' : 'var(--text2)',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            overflow:      'hidden',
            textOverflow:  'ellipsis',
            whiteSpace:    'nowrap',
            flex:          1,
          }}>
            {session.projectDisplayName}
          </span>
          <span style={{ fontSize: 11, color: 'var(--text3)', flexShrink: 0 }}>
            {relTime(session.mtime)}
          </span>
        </div>

        {/* First prompt */}
        <p style={{
          margin:         0,
          fontSize:       13,
          color:          'var(--text)',
          overflow:       'hidden',
          display:        '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          lineHeight:     1.45,
        }}>
          {session.firstPrompt === '(no prompt)'
            ? <span style={{ color: 'var(--text3)', fontStyle: 'italic' }}>No prompt</span>
            : session.firstPrompt}
        </p>

        {/* Session ID chip */}
        <div style={{ marginTop: 10 }}>
          <span className={active ? 'chip chip-green' : 'chip'} style={{ fontSize: 10 }}>
            {active ? 'Live' : 'Done'} · {session.sessionId.slice(0, 8)}
          </span>
        </div>
      </div>
    </Link>
  )
}
