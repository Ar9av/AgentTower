import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { discoverProjects } from '@/lib/claude-fs'
import { discoverOpenCodeProjects } from '@/lib/opencode-fs'
import type { ProjectInfo } from '@/lib/types'

export async function GET(req: NextRequest) {
  const authErr = await requireAuth(req)
  if (authErr) return authErr

  const claude: ProjectInfo[]   = discoverProjects()
  const opencode: ProjectInfo[] = discoverOpenCodeProjects()

  // Merge and sort by most recently active, Claude projects first when tied
  const all = [
    ...claude.map(p => ({ ...p, source: 'claude'   as const })),
    ...opencode,
  ].sort((a, b) => b.latestMtime - a.latestMtime)

  return NextResponse.json(all)
}
