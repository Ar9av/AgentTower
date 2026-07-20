import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { getRecentSessions } from '@/lib/claude-fs'
import { getRecentCodexSessions } from '@/lib/codex-fs'

const HARD_CAP = 5000

// GET /api/v1/sessions
//   ?provider=claude|codex|all   (default all)
//   ?active=1                    only currently-active sessions
//   ?project=<substring>         match against project display name (case-insensitive)
//   ?all=1                       return every matching session, no limit
//   ?limit=&offset=              pagination (default limit=20, offset=0)
export async function GET(req: NextRequest) {
  const authErr = await requireAuth(req)
  if (authErr) return authErr

  const params = req.nextUrl.searchParams
  const provider = params.get('provider') ?? 'all'
  const activeOnly = params.get('active') === '1'
  const projectFilter = params.get('project')?.toLowerCase()
  const wantAll = params.get('all') === '1'

  const claude = provider === 'codex' ? [] : getRecentSessions(HARD_CAP).map(s => ({
    provider: 'claude' as const,
    sessionId: s.sessionId,
    project: s.projectDisplayName,
    firstPrompt: s.firstPrompt,
    mtime: s.mtime,
    isActive: s.isActive,
  }))

  const codex = provider === 'claude' ? [] : getRecentCodexSessions(HARD_CAP).map(s => ({
    provider: 'codex' as const,
    sessionId: s.sessionId,
    project: s.projectDisplayName,
    firstPrompt: s.firstPrompt,
    mtime: s.mtime,
    isActive: s.isActive,
  }))

  let sessions = [...claude, ...codex].sort((a, b) => b.mtime - a.mtime)

  if (activeOnly) sessions = sessions.filter(s => s.isActive)
  if (projectFilter) sessions = sessions.filter(s => s.project.toLowerCase().includes(projectFilter))

  const total = sessions.length
  const offset = Math.max(parseInt(params.get('offset') ?? '0', 10) || 0, 0)
  const limit = wantAll && !params.get('limit')
    ? total
    : Math.min(parseInt(params.get('limit') ?? '20', 10) || 20, HARD_CAP)

  const page = sessions.slice(offset, offset + limit)

  return NextResponse.json({ total, offset, limit, sessions: page })
}
