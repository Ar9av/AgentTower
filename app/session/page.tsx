import { redirect } from 'next/navigation'
import path from 'path'
import { getSessionToken, validateSession } from '@/lib/auth'
import { parseJsonlFilePaginated, decodeB64, safePath, getClaudeDir, getSessionId, decodeProjectPath } from '@/lib/claude-fs'
import { scanClaudeSessions, getProcessState } from '@/lib/process'
import Nav from '@/components/Nav'
import LiveSession from '@/components/LiveSession'

export const dynamic = 'force-dynamic'

interface Props {
  searchParams: Promise<{ f?: string; msg?: string }>
}

export default async function SessionPage({ searchParams }: Props) {
  const token = await getSessionToken()
  if (!validateSession(token)) redirect('/login')

  const params = await searchParams
  const encoded = params.f ?? ''
  if (!encoded) redirect('/projects')

  const filepath = decodeB64(encoded)
  if (!safePath(filepath, getClaudeDir())) redirect('/projects')

  const scrollTarget = params.msg ?? undefined
  const sessionData = parseJsonlFilePaginated(filepath, 50, undefined, scrollTarget)
  const sessionId = getSessionId(filepath)
  const running = scanClaudeSessions(getClaudeDir())
  const proc = running[sessionId]
  const processState = proc ? getProcessState(proc.pid) : 'dead'
  const pid = proc?.pid ?? null

  const projectDirName = path.basename(path.dirname(filepath))
  const projectPath = proc?.cwd ?? decodeProjectPath(projectDirName)

  return (
    <>
      <Nav />
      <LiveSession
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
