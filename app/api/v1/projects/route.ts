import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { discoverProjects } from '@/lib/claude-fs'
import { discoverCodexProjects } from '@/lib/codex-fs'

// GET /api/v1/projects?provider=claude|codex|all&active=1
export async function GET(req: NextRequest) {
  const authErr = await requireAuth(req)
  if (authErr) return authErr

  const params = req.nextUrl.searchParams
  const provider = params.get('provider') ?? 'all'
  const activeOnly = params.get('active') === '1'

  const claude = provider === 'codex' ? [] : discoverProjects()
  const codex = provider === 'claude' ? [] : discoverCodexProjects()

  let projects = [...claude, ...codex].sort((a, b) => b.latestMtime - a.latestMtime)
  if (activeOnly) projects = projects.filter(p => p.hasActive)

  return NextResponse.json({ total: projects.length, projects })
}
