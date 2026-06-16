import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { discoverProjects } from '@/lib/claude-fs'
import { discoverCodexProjects } from '@/lib/codex-fs'
import type { AgentMode } from '@/lib/types'

export async function GET(req: NextRequest) {
  const authErr = await requireAuth(req)
  if (authErr) return authErr
  const mode = (req.nextUrl.searchParams.get('mode') === 'codex' ? 'codex' : 'claude') as AgentMode
  return NextResponse.json(mode === 'codex' ? discoverCodexProjects() : discoverProjects())
}
