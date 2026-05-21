import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { parseJsonlFilePaginated, decodeB64, safePath, getClaudeDir } from '@/lib/claude-fs'
import { parseOpenCodeSession, isOpenCodePath, openCodeSessionId } from '@/lib/opencode-fs'
import type { PaginatedSession } from '@/lib/types'

export async function GET(req: NextRequest) {
  const authErr = await requireAuth(req)
  if (authErr) return authErr

  const encoded = req.nextUrl.searchParams.get('f')
  if (!encoded) return NextResponse.json({ error: 'Missing f param' }, { status: 400 })

  const filepath = decodeB64(encoded)

  // ── OpenCode session ───────────────────────────────────────────────────────
  if (isOpenCodePath(filepath)) {
    const sessionId = openCodeSessionId(filepath)
    const messages  = parseOpenCodeSession(sessionId)
    const response: PaginatedSession = {
      firstMessage: messages[0] ?? null,
      messages,
      total:        messages.length,
      hiddenCount:  0,
      hasMore:      false,
    }
    return NextResponse.json(response)
  }

  // ── Claude session ─────────────────────────────────────────────────────────
  if (!safePath(filepath, getClaudeDir())) {
    return NextResponse.json({ error: 'Invalid path' }, { status: 403 })
  }

  const limit    = Math.min(parseInt(req.nextUrl.searchParams.get('limit') ?? '50', 10), 200)
  const olderThan = req.nextUrl.searchParams.get('before') ?? undefined
  const around    = req.nextUrl.searchParams.get('around') ?? undefined

  return NextResponse.json(parseJsonlFilePaginated(filepath, limit, olderThan, around))
}
