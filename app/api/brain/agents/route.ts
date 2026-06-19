import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { encodeB64, getRecentSessions } from '@/lib/claude-fs'
import { getRecentCodexSessions } from '@/lib/codex-fs'

export async function GET(req: NextRequest) {
  const authErr = await requireAuth(req)
  if (authErr) return authErr

  const claude = getRecentSessions(30).map(session => ({
    id: session.sessionId,
    provider: 'claude' as const,
    project: session.projectDisplayName,
    task: session.firstPrompt,
    activity: session.currentActivity,
    active: session.isActive,
    updatedAt: session.mtime,
    href: `/session?f=${session.encodedFilepath}`,
  }))

  const codex = getRecentCodexSessions(30).map(session => ({
    id: session.sessionId,
    provider: 'codex' as const,
    project: session.projectDisplayName,
    task: session.firstPrompt,
    activity: session.isActive ? 'working' : null,
    active: session.isActive,
    updatedAt: session.mtime,
    href: `/session?mode=codex&f=${encodeB64(session.filepath)}`,
  }))

  const agents = [...claude, ...codex]
    .sort((a, b) => Number(b.active) - Number(a.active) || b.updatedAt - a.updatedAt)
    .slice(0, 40)

  return NextResponse.json({ agents, runningCount: agents.filter(agent => agent.active).length })
}
