import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { loadProjectMeta, upsertProjectMeta } from '@/lib/project-meta'

export async function GET(req: NextRequest) {
  const authErr = await requireAuth(req)
  if (authErr) return authErr
  return NextResponse.json(loadProjectMeta())
}

export async function POST(req: NextRequest) {
  const authErr = await requireAuth(req)
  if (authErr) return authErr
  const body = await req.json().catch(() => ({})) as {
    projectPath?: string
    displayName?: string
  }
  const projectPath = (body.projectPath ?? '').trim()
  const displayName = (body.displayName ?? '').trim()
  if (!projectPath || !displayName) {
    return NextResponse.json({ error: 'projectPath and displayName required' }, { status: 400 })
  }
  const meta = upsertProjectMeta(projectPath, { displayName })
  return NextResponse.json({ ok: true, meta })
}
