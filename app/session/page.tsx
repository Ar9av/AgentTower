import { redirect } from 'next/navigation'
import path from 'path'
import { getSessionToken, validateSession } from '@/lib/auth'
import { parseJsonlFilePaginated, decodeB64, safePath, getClaudeDir, getSessionId, resolveProjectPath } from '@/lib/claude-fs'
import { getCodexDir, parseCodexJsonlFilePaginated, findCodexSessionProjectCwd, getCodexSessionId } from '@/lib/codex-fs'
import { scanClaudeSessions, getProcessState } from '@/lib/process'
import Nav from '@/components/Nav'
import LiveSession from '@/components/LiveSession'
import CodexLiveSession from '@/components/CodexLiveSession'

export const dynamic = 'force-dynamic'

interface Props {
  searchParams: Promise<{ f?: string; msg?: string; mode?: string }>
}

export default async function SessionPage({ searchParams }: Props) {
  const token = await getSessionToken()
  if (!validateSession(token)) redirect('/login')

  const params = await searchParams
  const encoded = params.f ?? ''
  const mode = params.mode === 'codex' ? 'codex' : 'claude'
  if (!encoded) redirect('/projects')

  const filepath = decodeB64(encoded)
  if (!safePath(filepath, mode === 'codex' ? getCodexDir() : getClaudeDir())) redirect('/projects')

  const scrollTarget = params.msg ?? undefined
  if (mode === 'codex') {
    const sessionData = parseCodexJsonlFilePaginated(filepath, 50, undefined, scrollTarget)
    const sessionId = getCodexSessionId(filepath)
    const projectPath = findCodexSessionProjectCwd(sessionId) || ''
    return (
      <>
        <Nav />
        <CodexLiveSession
          key={sessionId}
          initialData={sessionData}
          encodedFilepath={encoded}
          sessionId={sessionId}
          projectPath={projectPath}
          scrollTarget={scrollTarget}
        />
      </>
    )
  }

  const sessionData = parseJsonlFilePaginated(filepath, 50, undefined, scrollTarget)
  const sessionId = getSessionId(filepath)
  const running = scanClaudeSessions(getClaudeDir())
  const proc = running[sessionId]
  const processState = proc ? getProcessState(proc.pid) : 'dead'
  const pid = proc?.pid ?? null

  const projectDirName = path.basename(path.dirname(filepath))
  const projectPath = proc?.cwd ?? resolveProjectPath(projectDirName)

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
      />
    </>
  )
}
