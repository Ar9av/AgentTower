import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getSessionToken, validateSession } from '@/lib/auth'
import { listSessions, decodeB64, encodeB64, decodeProjectPath } from '@/lib/claude-fs'
import { getProjectMeta } from '@/lib/project-meta'
import Nav from '@/components/Nav'
import ProcessControls from '@/components/ProcessControls'
import NewSessionForm from '@/components/NewSessionForm'

export const dynamic = 'force-dynamic'

interface Props {
  searchParams: Promise<{ p?: string }>
}

export default async function ProjectPage({ searchParams }: Props) {
  const token = await getSessionToken()
  if (!validateSession(token)) redirect('/login')

  const params = await searchParams
  const encoded = params.p ?? ''
  if (!encoded) redirect('/projects')

  const dirName = decodeB64(encoded)
  const sessions = listSessions(dirName)
  const projectPath = decodeProjectPath(dirName)
  const meta = getProjectMeta(projectPath)
  const title = meta?.displayName || projectPath.split('/').pop() || projectPath

  const active = sessions.filter(s => s.processState === 'running' || s.processState === 'paused')
  const history = sessions.filter(s => s.processState !== 'running' && s.processState !== 'paused')

  return (
    <>
      <Nav />
      <main style={{ padding: '32px 28px', maxWidth: 1100, margin: '0 auto', width: '100%' }}>
        {/* Breadcrumb + header */}
        <div style={{ marginBottom: 28 }}>
          <Link href="/projects" style={{ color: 'var(--text2)', fontSize: 13, textDecoration: 'none' }}>
            ← Projects
          </Link>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, marginTop: 10 }}>
            <div>
              <h1 style={{ margin: '0 0 3px', fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em' }}>
                {title}
              </h1>
              <p style={{ margin: 0, color: 'var(--text3)', fontSize: 12, fontFamily: 'ui-monospace, monospace' }}>
                {projectPath}
              </p>
            </div>
          </div>

          {/* New session — full-width block below header */}
          <div style={{ marginTop: 16 }}>
            <NewSessionForm projectPath={projectPath} />
          </div>
        </div>

        {/* Active sessions */}
        {active.length > 0 && (
          <section style={{ marginBottom: 32 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <span className="dot-active" />
              <h2 style={{ fontSize: 12, fontWeight: 600, color: 'var(--green)', margin: 0, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Active · {active.length}
              </h2>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {active.map(s => (
                <SessionRow key={s.sessionId} session={s} />
              ))}
            </div>
          </section>
        )}

        {/* History */}
        <section>
          <h2 style={{ fontSize: 12, fontWeight: 600, color: 'var(--text2)', margin: '0 0 12px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            History · {history.length}
          </h2>
          {history.length === 0 ? (
            <p style={{ color: 'var(--text2)', fontSize: 14 }}>No completed sessions yet.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {history.map(s => (
                <SessionRow key={s.sessionId} session={s} />
              ))}
            </div>
          )}
        </section>
      </main>
    </>
  )
}

function SessionRow({ session: s }: { session: ReturnType<typeof listSessions>[0] }) {
  const chipClass =
    s.processState === 'running' ? 'chip chip-green' :
    s.processState === 'paused'  ? 'chip chip-yellow' : 'chip'
  const stateLabel =
    s.processState === 'running' ? 'Running' :
    s.processState === 'paused'  ? 'Paused'  : 'Finished'

  return (
    <div className="glass" style={{
      borderRadius: 12,
      padding: '14px 18px',
      display: 'flex',
      alignItems: 'center',
      gap: 14,
      borderColor: s.processState === 'running' ? 'rgba(61,214,140,0.20)' : undefined,
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <Link
          href={`/session?f=${encodeB64(s.filepath)}`}
          style={{
            color: 'var(--text)',
            fontWeight: 500,
            fontSize: 14,
            textDecoration: 'none',
            display: 'block',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            marginBottom: 7,
          }}
        >
          {s.firstPrompt}
        </Link>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <span className={chipClass}>{stateLabel}</span>
          <span className="chip">{s.messageCount} msg{s.messageCount !== 1 ? 's' : ''}</span>
          {s.meta?.input_tokens && <span className="chip">{s.meta.input_tokens.toLocaleString()} tok</span>}
          <span className="chip">{formatRelative(s.mtime)}</span>
          <span className="chip" style={{ fontFamily: 'ui-monospace, monospace' }}>{s.sessionId.slice(0, 8)}</span>
        </div>
      </div>

      {s.pid && <ProcessControls pid={s.pid} state={s.processState} />}

      <Link
        href={`/session?f=${encodeB64(s.filepath)}`}
        className="glass-btn"
        style={{ fontSize: 13, padding: '6px 14px', flexShrink: 0 }}
      >
        Open →
      </Link>
    </div>
  )
}

function formatRelative(ms: number): string {
  const diff = Date.now() - ms
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return `${Math.floor(diff / 86_400_000)}d ago`
}
