import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getSessionToken, validateSession } from '@/lib/auth'
import { listSessions, decodeB64, encodeB64, resolveProjectPath, detectContinuationChains, getProjectGitStatus } from '@/lib/claude-fs'
import { getProjectMeta } from '@/lib/project-meta'
import { loadSessionTags } from '@/lib/session-tags'
import Nav from '@/components/Nav'
import ProcessControls from '@/components/ProcessControls'
import NewSessionForm from '@/components/NewSessionForm'
import SessionTagsButton from '@/components/SessionTagsButton'
import type { GitStatus } from '@/lib/types'

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
  const projectPath = resolveProjectPath(dirName)
  const meta = getProjectMeta(projectPath)
  const title = meta?.displayName || projectPath.split('/').pop() || projectPath
  const chains = detectContinuationChains(dirName)
  const tagStore = loadSessionTags()
  const gitStatus = getProjectGitStatus(projectPath)

  // Build reverse map: parentId → childId
  const childOf = new Map<string, string>()
  for (const [child, parent] of chains.entries()) {
    childOf.set(parent, child)
  }

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
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
                <p style={{ margin: 0, color: 'var(--text3)', fontSize: 12, fontFamily: 'ui-monospace, monospace' }}>
                  {projectPath}
                </p>
                {gitStatus && (
                  <span className="chip" style={{ fontFamily: 'ui-monospace, monospace', fontSize: 11 }} title="Git status">
                    ⎇ {gitStatus.branch ?? 'HEAD'}
                    {gitStatus.linesAdded > 0 && <span style={{ color: 'var(--green)', marginLeft: 4 }}>+{gitStatus.linesAdded}</span>}
                    {gitStatus.linesRemoved > 0 && <span style={{ color: 'var(--red)', marginLeft: 2 }}>-{gitStatus.linesRemoved}</span>}
                    {gitStatus.isDirty && !gitStatus.linesAdded && !gitStatus.linesRemoved && <span style={{ color: 'var(--yellow)', marginLeft: 4 }}>dirty</span>}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* New session — full-width block below header */}
          <div style={{ marginTop: 16 }}>
            <NewSessionForm projectPath={projectPath} hasActive={active.length > 0} isGitRepo={gitStatus !== null} />
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
                <SessionRow
                  key={s.sessionId}
                  session={s}
                  parentId={chains.get(s.sessionId)}
                  childId={childOf.get(s.sessionId)}
                  allSessions={sessions}
                  initialFavorite={tagStore.sessions[s.sessionId]?.favorite ?? false}
                  initialTags={tagStore.sessions[s.sessionId]?.tags ?? []}
                />
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
                <SessionRow
                  key={s.sessionId}
                  session={s}
                  parentId={chains.get(s.sessionId)}
                  childId={childOf.get(s.sessionId)}
                  allSessions={sessions}
                  initialFavorite={tagStore.sessions[s.sessionId]?.favorite ?? false}
                  initialTags={tagStore.sessions[s.sessionId]?.tags ?? []}
                />
              ))}
            </div>
          )}
        </section>
      </main>
    </>
  )
}

type SessionState = 'thinking' | 'permission' | 'active' | 'paused' | 'finished'

function getSessionState(processState: string, currentActivity?: string | null): SessionState {
  if (processState === 'paused') return 'paused'
  if (processState !== 'running') return 'finished'
  if (!currentActivity) return 'active'
  const act = currentActivity.toLowerCase()
  if (act.includes('ask') || act.includes('permission') || act === 'askuserquestion') return 'permission'
  if (act === 'thinking') return 'thinking'
  return 'active'
}

function activityLabel(processState: string, currentActivity?: string | null): string {
  if (processState === 'paused') return 'Paused'
  if (processState !== 'running') return 'Finished'
  if (!currentActivity) return 'Running'
  if (currentActivity === 'thinking') return 'Thinking…'
  if (currentActivity === 'writing') return 'Writing…'
  return `${currentActivity}…`
}

function StatusDot({ processState, currentActivity }: { processState: string; currentActivity?: string | null }) {
  const state = getSessionState(processState, currentActivity)
  if (state === 'thinking') return <span className="dot-thinking" />
  if (state === 'permission') return <span className="dot-permission" />
  if (state === 'active') return <span className="dot-waiting" />
  if (state === 'paused') return <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--yellow)', display: 'inline-block', flexShrink: 0 }} />
  return null
}

function modelShortName(model?: string | null): string | null {
  if (!model) return null
  const m = model.toLowerCase()
  if (m.includes('haiku')) return 'haiku'
  if (m.includes('opus')) return 'opus'
  if (m.includes('sonnet')) return 'sonnet'
  if (m.includes('fable')) return 'fable'
  return null
}

function formatCost(usd: number): string {
  if (usd < 0.001) return '<$0.001'
  if (usd < 0.01)  return `$${usd.toFixed(3)}`
  return `$${usd.toFixed(2)}`
}

function SessionRow({
  session: s,
  parentId,
  childId,
  allSessions,
  initialFavorite,
  initialTags,
}: {
  session: ReturnType<typeof listSessions>[0]
  parentId?: string
  childId?: string
  allSessions: ReturnType<typeof listSessions>
  initialFavorite: boolean
  initialTags: string[]
}) {
  const state = getSessionState(s.processState, s.currentActivity)
  const chipClass =
    state === 'thinking'   ? 'chip chip-blue' :
    state === 'permission' ? 'chip chip-orange' :
    state === 'active'     ? 'chip chip-green' :
    state === 'paused'     ? 'chip chip-yellow' : 'chip'

  const parentSession = parentId ? allSessions.find(x => x.sessionId === parentId) : null
  const childSession  = childId  ? allSessions.find(x => x.sessionId === childId)  : null

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
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 4 }}>
          <StatusDot processState={s.processState} currentActivity={s.currentActivity} />
          <Link
            href={`/session?f=${encodeB64(s.filepath)}`}
            style={{
              color: 'var(--text)',
              fontWeight: 500,
              fontSize: 14,
              textDecoration: 'none',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              flex: 1,
            }}
          >
            {s.firstPrompt}
          </Link>
        </div>
        {s.lastSummary && (
          <p style={{
            margin: '0 0 6px 14px', fontSize: 12, color: 'var(--text3)',
            overflow: 'hidden', textOverflow: 'ellipsis',
            display: '-webkit-box', WebkitLineClamp: 1, WebkitBoxOrient: 'vertical',
            lineHeight: 1.4,
          }}>
            {s.lastSummary}
          </p>
        )}
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <span className={chipClass}>{activityLabel(s.processState, s.currentActivity)}</span>
          <span className="chip">{s.messageCount} msg{s.messageCount !== 1 ? 's' : ''}</span>
          {s.estimatedCostUsd != null && s.estimatedCostUsd > 0 && (
            <span className="chip" title="Estimated cost">{formatCost(s.estimatedCostUsd)}</span>
          )}
          {modelShortName(s.primaryModel) && (
            <span className="chip" title="Model used">{modelShortName(s.primaryModel)}</span>
          )}
          {s.gitBranch && (
            <span className="chip" style={{ fontFamily: 'ui-monospace, monospace' }} title="Git branch">
              ⎇ {s.gitBranch}
            </span>
          )}
          <span className="chip">{formatRelative(s.mtime)}</span>
          <span className="chip" style={{ fontFamily: 'ui-monospace, monospace' }}>{s.sessionId.slice(0, 8)}</span>

          {parentSession && (
            <Link href={`/session?f=${encodeB64(parentSession.filepath)}`} className="chip" style={{ textDecoration: 'none' }} title="Continued from">
              ← {parentSession.sessionId.slice(0, 8)}
            </Link>
          )}
          {childSession && (
            <Link href={`/session?f=${encodeB64(childSession.filepath)}`} className="chip chip-green" style={{ textDecoration: 'none' }} title="Continues in">
              → {childSession.sessionId.slice(0, 8)}
            </Link>
          )}

          <SessionTagsButton
            sessionId={s.sessionId}
            initialFavorite={initialFavorite}
            initialTags={initialTags}
            compact
          />
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
