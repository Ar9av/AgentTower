import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getSessionToken, validateSession } from '@/lib/auth'
import { discoverProjects, listSessions, encodeB64, resolveProjectPath } from '@/lib/claude-fs'
import { loadSessionTags } from '@/lib/session-tags'
import Nav from '@/components/Nav'
import SessionTagsButton from '@/components/SessionTagsButton'
import ProcessControls from '@/components/ProcessControls'

export const dynamic = 'force-dynamic'

type SessionState = 'thinking' | 'permission' | 'active' | 'paused' | 'finished'

function getSessionState(processState: string, currentActivity?: string | null): SessionState {
  if (processState === 'paused') return 'paused'
  if (processState !== 'running') return 'finished'
  if (!currentActivity) return 'active'
  const act = currentActivity.toLowerCase()
  if (act.includes('ask') || act.includes('permission')) return 'permission'
  if (act === 'thinking') return 'thinking'
  return 'active'
}

function activityLabel(processState: string, currentActivity?: string | null): string {
  if (processState === 'paused') return 'Paused'
  if (processState !== 'running') return 'Finished'
  if (!currentActivity) return 'Running'
  if (currentActivity === 'thinking') return 'Thinking…'
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

function modelShortName(model?: string | null) {
  if (!model) return null
  const m = model.toLowerCase()
  if (m.includes('haiku')) return 'haiku'
  if (m.includes('opus')) return 'opus'
  if (m.includes('sonnet')) return 'sonnet'
  if (m.includes('fable')) return 'fable'
  return null
}

function formatCost(usd: number) {
  if (usd < 0.001) return '<$0.001'
  if (usd < 0.01) return `$${usd.toFixed(3)}`
  return `$${usd.toFixed(2)}`
}

function formatRelative(ms: number) {
  const diff = Date.now() - ms
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

export default async function BookmarksPage() {
  const token = await getSessionToken()
  if (!validateSession(token)) redirect('/login')

  const tagStore = loadSessionTags()
  const favoriteIds = new Set(
    Object.entries(tagStore.sessions)
      .filter(([, v]) => v.favorite)
      .map(([id]) => id)
  )

  type BookmarkedSession = ReturnType<typeof listSessions>[0] & {
    projectDirName: string
    projectDisplayName: string
    projectEncoded: string
    initialTags: string[]
  }

  const bookmarks: BookmarkedSession[] = []

  if (favoriteIds.size > 0) {
    const projects = discoverProjects()
    for (const proj of projects) {
      const sessions = listSessions(proj.dirName)
      for (const s of sessions) {
        if (!favoriteIds.has(s.sessionId)) continue
        bookmarks.push({
          ...s,
          projectDirName: proj.dirName,
          projectDisplayName: proj.displayName,
          projectEncoded: encodeB64(resolveProjectPath(proj.dirName)),
          initialTags: tagStore.sessions[s.sessionId]?.tags ?? [],
        })
      }
    }
    bookmarks.sort((a, b) => b.mtime - a.mtime)
  }

  // Group by project
  const byProject = new Map<string, { displayName: string; encoded: string; sessions: BookmarkedSession[] }>()
  for (const s of bookmarks) {
    if (!byProject.has(s.projectDirName)) {
      byProject.set(s.projectDirName, {
        displayName: s.projectDisplayName,
        encoded: s.projectEncoded,
        sessions: [],
      })
    }
    byProject.get(s.projectDirName)!.sessions.push(s)
  }

  return (
    <>
      <Nav />
      <main style={{ padding: '32px 28px', maxWidth: 1100, margin: '0 auto', width: '100%' }}>
        <div style={{ marginBottom: 28 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <span style={{ fontSize: 22 }}>★</span>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em' }}>
              Bookmarks
            </h1>
          </div>
          <p style={{ margin: 0, color: 'var(--text3)', fontSize: 13 }}>
            Sessions you&apos;ve starred — across all projects.
          </p>
        </div>

        {bookmarks.length === 0 ? (
          <div className="glass" style={{ padding: '48px 28px', textAlign: 'center', borderRadius: 14 }}>
            <div style={{ fontSize: 36, marginBottom: 14 }}>☆</div>
            <p style={{ color: 'var(--text2)', fontSize: 15, margin: '0 0 6px', fontWeight: 500 }}>No bookmarks yet</p>
            <p style={{ color: 'var(--text3)', fontSize: 13, margin: 0 }}>
              Star a session from any project page to save it here.
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
            {[...byProject.entries()].map(([dirName, group]) => (
              <section key={dirName}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                  <Link
                    href={`/project?p=${group.encoded}`}
                    style={{ fontSize: 13, fontWeight: 600, color: 'var(--text2)', textDecoration: 'none', letterSpacing: '0.02em' }}
                  >
                    {group.displayName} →
                  </Link>
                  <span className="chip" style={{ fontSize: 11 }}>{group.sessions.length}</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {group.sessions.map(s => {
                    const state = getSessionState(s.processState, s.currentActivity)
                    const chipClass =
                      state === 'thinking'   ? 'chip chip-blue' :
                      state === 'permission' ? 'chip chip-orange' :
                      state === 'active'     ? 'chip chip-green' :
                      state === 'paused'     ? 'chip chip-yellow' : 'chip'
                    return (
                      <div key={s.sessionId} className="glass" style={{
                        borderRadius: 12, padding: '14px 18px',
                        display: 'flex', alignItems: 'center', gap: 14,
                        borderColor: s.processState === 'running' ? 'rgba(61,214,140,0.20)' : undefined,
                      }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 4 }}>
                            <StatusDot processState={s.processState} currentActivity={s.currentActivity} />
                            <Link
                              href={`/session?f=${encodeB64(s.filepath)}`}
                              style={{ color: 'var(--text)', fontWeight: 500, fontSize: 14, textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}
                            >
                              {s.firstPrompt}
                            </Link>
                          </div>
                          {s.lastSummary && (
                            <p style={{ margin: '0 0 6px 14px', fontSize: 12, color: 'var(--text3)', overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 1, WebkitBoxOrient: 'vertical', lineHeight: 1.4 }}>
                              {s.lastSummary}
                            </p>
                          )}
                          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                            <span className={chipClass}>{activityLabel(s.processState, s.currentActivity)}</span>
                            <span className="chip">{s.messageCount} msg{s.messageCount !== 1 ? 's' : ''}</span>
                            {s.estimatedCostUsd != null && s.estimatedCostUsd > 0 && (
                              <span className="chip">{formatCost(s.estimatedCostUsd)}</span>
                            )}
                            {modelShortName(s.primaryModel) && (
                              <span className="chip">{modelShortName(s.primaryModel)}</span>
                            )}
                            {s.gitBranch && (
                              <span className="chip" style={{ fontFamily: 'ui-monospace, monospace' }}>⎇ {s.gitBranch}</span>
                            )}
                            <span className="chip">{formatRelative(s.mtime)}</span>
                            <SessionTagsButton
                              sessionId={s.sessionId}
                              initialFavorite={true}
                              initialTags={s.initialTags}
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
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
      </main>
    </>
  )
}
