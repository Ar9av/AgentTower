import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getSessionToken, validateSession } from '@/lib/auth'
import { discoverProjects, encodeB64 } from '@/lib/claude-fs'
import Nav from '@/components/Nav'

export const dynamic = 'force-dynamic'

export default async function ProjectsPage() {
  const token = await getSessionToken()
  if (!validateSession(token)) redirect('/login')

  const projects = discoverProjects()
  const activeCount = projects.filter(p => p.hasActive).length

  return (
    <>
      <Nav />
      <main style={{ padding: '32px 28px', maxWidth: 1240, margin: '0 auto', width: '100%' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 28 }}>
          <div>
            <h1 style={{ margin: '0 0 4px', fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em' }}>Projects</h1>
            <p style={{ margin: 0, color: 'var(--text2)', fontSize: 13 }}>
              {projects.length} project{projects.length !== 1 ? 's' : ''}
              {activeCount > 0 && (
                <span style={{ marginLeft: 10 }}>
                  <span className="dot-active" style={{ marginRight: 5 }} />
                  <span style={{ color: 'var(--green)' }}>{activeCount} active</span>
                </span>
              )}
            </p>
          </div>
        </div>

        {projects.length === 0 ? (
          <div className="glass" style={{ borderRadius: 16, padding: '60px 40px', textAlign: 'center' }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>🗂</div>
            <p style={{ fontSize: 16, color: 'var(--text)', margin: '0 0 8px' }}>No sessions found</p>
            <p style={{ fontSize: 13, color: 'var(--text2)', margin: 0 }}>Run Claude Code in any project to see it here.</p>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(290px, 1fr))', gap: 14 }}>
            {projects.map(p => (
              <Link key={p.dirName} href={`/project?p=${encodeB64(p.dirName)}`} style={{ textDecoration: 'none' }}>
                <div
                  className="glass-interactive"
                  style={{
                    borderRadius: 14,
                    padding: '18px 20px',
                    borderColor: p.hasActive ? 'rgba(61,214,140,0.25)' : undefined,
                    boxShadow: p.hasActive
                      ? 'inset 0 1px 0 rgba(255,255,255,0.14), 0 4px 20px rgba(0,0,0,0.3), 0 0 0 1px rgba(61,214,140,0.1)'
                      : undefined,
                  }}
                >
                  {/* Project name row */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    {p.hasActive && <span className="dot-active" />}
                    <span style={{
                      fontWeight: 600,
                      fontSize: 15,
                      color: 'var(--text)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      letterSpacing: '-0.01em',
                    }}>
                      {p.displayName}
                    </span>
                  </div>

                  {/* Path */}
                  <p style={{
                    margin: '0 0 14px',
                    fontSize: 12,
                    color: 'var(--text3)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    fontFamily: 'ui-monospace, monospace',
                  }}>
                    {p.decodedPath}
                  </p>

                  {/* Footer chips */}
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <span className="chip">{p.sessionCount} session{p.sessionCount !== 1 ? 's' : ''}</span>
                    <span className="chip">{formatRelative(p.latestMtime)}</span>
                    {p.hasActive && <span className="chip chip-green">Live</span>}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </main>
    </>
  )
}

function formatRelative(ms: number): string {
  const diff = Date.now() - ms
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return `${Math.floor(diff / 86_400_000)}d ago`
}
