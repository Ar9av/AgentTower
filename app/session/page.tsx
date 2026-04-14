import { redirect } from 'next/navigation'
import path from 'path'
import { getSessionToken, validateSession } from '@/lib/auth'
import { parseJsonlFile, decodeB64, safePath, getClaudeDir, getSessionId, decodeProjectPath } from '@/lib/claude-fs'
import { scanClaudeSessions, getProcessState } from '@/lib/process'
import Nav from '@/components/Nav'
import LiveSession from '@/components/LiveSession'

export const dynamic = 'force-dynamic'

interface Props {
  searchParams: Promise<{ f?: string }>
}

export default async function SessionPage({ searchParams }: Props) {
  const token = await getSessionToken()
  if (!validateSession(token)) redirect('/login')

  const params = await searchParams
  const encoded = params.f ?? ''
  if (!encoded) redirect('/projects')

  const filepath = decodeB64(encoded)
  if (!safePath(filepath, getClaudeDir())) redirect('/projects')

  const messages = parseJsonlFile(filepath)
  const sessionId = getSessionId(filepath)
  const running = scanClaudeSessions(getClaudeDir())
  const proc = running[sessionId]
  const processState = proc ? getProcessState(proc.pid) : 'dead'
  const pid = proc?.pid ?? null

  // Derive the real project path from the JSONL file location
  // filepath = ~/.claude/projects/<encoded-dir>/<session-id>.jsonl
  const projectDirName = path.basename(path.dirname(filepath))
  const projectPath = proc?.cwd ?? decodeProjectPath(projectDirName)

  return (
    <>
      <Nav />
      <LiveSession
        initialMessages={messages}
        encodedFilepath={encoded}
        sessionId={sessionId}
        projectPath={projectPath}
        pid={pid}
        processState={processState}
      />
    </>
  )
}
