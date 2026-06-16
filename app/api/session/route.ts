import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { parseJsonlFilePaginated, decodeB64, safePath, getClaudeDir } from '@/lib/claude-fs'
import { getCodexDir, parseCodexJsonlFilePaginated } from '@/lib/codex-fs'

export async function GET(req: NextRequest) {
  const authErr = await requireAuth(req)
  if (authErr) return authErr

  const encoded = req.nextUrl.searchParams.get('f')
  if (!encoded) return NextResponse.json({ error: 'Missing f param' }, { status: 400 })
  const mode = req.nextUrl.searchParams.get('mode') === 'codex' ? 'codex' : 'claude'

  const filepath = decodeB64(encoded)
  const baseDir = mode === 'codex' ? getCodexDir() : getClaudeDir()
  if (!safePath(filepath, baseDir)) {
    return NextResponse.json({ error: 'Invalid path' }, { status: 403 })
  }

  const limit = Math.min(parseInt(req.nextUrl.searchParams.get('limit') ?? '50', 10), 200)
  const olderThan = req.nextUrl.searchParams.get('before') ?? undefined
  const around = req.nextUrl.searchParams.get('around') ?? undefined

  return NextResponse.json(
    mode === 'codex'
      ? parseCodexJsonlFilePaginated(filepath, limit, olderThan, around)
      : parseJsonlFilePaginated(filepath, limit, olderThan, around)
  )
}
