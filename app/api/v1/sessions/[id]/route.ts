import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { parseJsonlFilePaginated } from '@/lib/claude-fs'
import { parseCodexJsonlFilePaginated } from '@/lib/codex-fs'
import { resolveSession } from '@/lib/api-v1'

// GET /api/v1/sessions/:id?limit=50&before=<uuid>&around=<uuid>
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authErr = await requireAuth(req)
  if (authErr) return authErr

  const { id } = await params
  const resolved = resolveSession(id)
  if (!resolved) return NextResponse.json({ error: 'Session not found' }, { status: 404 })

  const limit = Math.min(parseInt(req.nextUrl.searchParams.get('limit') ?? '50', 10) || 50, 200)
  const olderThan = req.nextUrl.searchParams.get('before') ?? undefined
  const around = req.nextUrl.searchParams.get('around') ?? undefined

  const page = resolved.mode === 'codex'
    ? parseCodexJsonlFilePaginated(resolved.filepath, limit, olderThan, around)
    : parseJsonlFilePaginated(resolved.filepath, limit, olderThan, around)

  return NextResponse.json({
    sessionId: resolved.sessionId,
    provider: resolved.mode,
    cwd: resolved.cwd,
    ...page,
  })
}
