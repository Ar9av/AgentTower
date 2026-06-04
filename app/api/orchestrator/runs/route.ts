import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { validateApiKey, loadRuns, loadActiveRuns, saveRunRecord } from '@/lib/orchestrator-config'
import type { RunRecord } from '@/lib/orchestrator-types'

function authOk(req: NextRequest): boolean {
  const bearer = req.headers.get('authorization')?.replace('Bearer ', '') ?? ''
  return validateApiKey(bearer)
}

// GET /api/orchestrator/runs — list recent + active runs
export async function GET(req: NextRequest) {
  const sessionErr = await requireAuth(req)
  if (sessionErr && !authOk(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const limit = parseInt(url.searchParams.get('limit') ?? '100', 10)
  const activeOnly = url.searchParams.get('active') === '1'

  const runs = activeOnly ? loadActiveRuns() : loadRuns(limit)
  return NextResponse.json({ runs })
}

// POST /api/orchestrator/runs — upsert a run record (called by daemon with Bearer auth)
export async function POST(req: NextRequest) {
  const sessionErr = await requireAuth(req)
  if (sessionErr && !authOk(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: Partial<RunRecord>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Bad JSON' }, { status: 400 }) }

  if (!body.id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  saveRunRecord(body as RunRecord)
  return NextResponse.json({ ok: true, id: body.id })
}
