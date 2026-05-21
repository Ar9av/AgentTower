import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { getRecentSessions } from '@/lib/claude-fs'
import { getOpenCodeRecentSessions } from '@/lib/opencode-fs'

export async function GET(req: NextRequest) {
  const authErr = await requireAuth(req)
  if (authErr) return authErr

  const limit = Math.min(parseInt(req.nextUrl.searchParams.get('limit') ?? '20', 10), 50)

  const claude   = getRecentSessions(limit)
  const opencode = getOpenCodeRecentSessions(limit)

  // Merge and return the `limit` most recent across both sources
  const merged = [...claude, ...opencode]
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, limit)

  return NextResponse.json(merged)
}
