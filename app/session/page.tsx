import { redirect } from 'next/navigation'
import path from 'path'
import { getSessionToken, validateSession } from '@/lib/auth'
import { parseJsonlFilePaginated, decodeB64, safePath, getClaudeDir, getSessionId, resolveProjectPath } from '@/lib/claude-fs'
import { parseOpenCodeSession, getOpenCodeSessionMeta, isOpenCodePath, openCodeSessionId } from '@/lib/opencode-fs'
import { scanClaudeSessions, getProcessState } from '@/lib/process'
import Nav from '@/components/Nav'
import LiveSession from '@/components/LiveSession'
import type { PaginatedSession } from '@/lib/types'

export const dynamic = 'force-dynamic'

interface Props {
  searchParams: Promise<{ f?: string; msg?: string }>
}

export default async function SessionPage({ searchParams }: Props) {
  const token = await getSessionToken()
  if (!validateSession(token)) redirect('/login')

  const params  = await searchParams
  const encoded = params.f ?? ''
  if (!encoded) redirect('/projects')

  const filepath    = decodeB64(encoded)
  const scrollTarget = params.msg ?? undefined

  // ── OpenCode session ──────────────────────────────────────────────────────
  if (isOpenCodePath(filepath)) {
    const sessionId = openCodeSessionId(filepath)
    const messages  = parseOpenCodeSession(sessionId)
    const ocMeta    = getOpenCodeSessionMeta(sessionId)

    const sessionData: PaginatedSession = {
      firstMessage: messages[0] ?? null,
      messages,
      total:       messages.length,
      hiddenCount: 0,
      hasMore:     false,
    }

    return (
      <>
        <Nav />
        <LiveSession
          key={sessionId}
          initialData={sessionData}
          encodedFilepath={encoded}
          sessionId={sessionId}
          projectPath={ocMeta?.directory ?? 'OpenCode Session'}
          pid={null}
          processState="dead"
          scrollTarget={scrollTarget}
          source="opencode"
        />
      </>
    )
  }

  // ── Claude session ────────────────────────────────────────────────────────
  if (!safePath(filepath, getClaudeDir())) redirect('/projects')

  const sessionData  = parseJsonlFilePaginated(filepath, 50, undefined, scrollTarget)
  const sessionId    = getSessionId(filepath)
  const running      = scanClaudeSessions(getClaudeDir())
  const proc         = running[sessionId]
  const processState = proc ? getProcessState(proc.pid) : 'dead'
  const pid          = proc?.pid ?? null

  const projectDirName = path.basename(path.dirname(filepath))
  const projectPath    = proc?.cwd ?? resolveProjectPath(projectDirName)

  return (
    <>
      <Nav />
      <LiveSession
        key={sessionId}
        initialData={sessionData}
        encodedFilepath={encoded}
        sessionId={sessionId}
        projectPath={projectPath}
        pid={pid}
        processState={processState}
        scrollTarget={scrollTarget}
        source="claude"
      />
    </>
  )
}
