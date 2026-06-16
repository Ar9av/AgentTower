import { NextRequest } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { decodeB64, safePath, getClaudeDir, parseJsonlFile, getSessionId } from '@/lib/claude-fs'
import { getCodexDir, parseCodexJsonlFile, getCodexSessionId } from '@/lib/codex-fs'
import { sessionToMarkdown } from '@/lib/export-utils'

export async function GET(req: NextRequest) {
  const authErr = await requireAuth(req)
  if (authErr) return authErr

  const encoded = req.nextUrl.searchParams.get('f') ?? ''
  const mode = req.nextUrl.searchParams.get('mode') === 'codex' ? 'codex' : 'claude'
  if (!encoded) return new Response('missing f', { status: 400 })

  const filepath = decodeB64(encoded)
  const safe = safePath(filepath, mode === 'codex' ? getCodexDir() : getClaudeDir())
  if (!safe) return new Response('forbidden', { status: 403 })

  const messages = mode === 'codex' ? parseCodexJsonlFile(safe) : parseJsonlFile(safe)
  const sessionId = mode === 'codex' ? getCodexSessionId(safe) : getSessionId(safe)
  const markdown = sessionToMarkdown(messages, sessionId, mode === 'codex' ? 'Codex' : 'Claude')

  return new Response(markdown, {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': `attachment; filename="session-${sessionId.slice(0, 8)}.md"`,
    },
  })
}
