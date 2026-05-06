import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { validateApiKey, saveBriefRecord, generateBriefId, type BriefRecord } from '@/lib/daily-brief'

function authOk(req: NextRequest): boolean {
  const bearer = req.headers.get('authorization')?.replace('Bearer ', '') ?? ''
  return validateApiKey(bearer)
}

// POST /api/daily-brief/brief — create a new brief (called by the agent on St3ve)
export async function POST(req: NextRequest) {
  // Accept both session auth (UI trigger) and API key auth (agent)
  const sessionErr = await requireAuth(req)
  if (sessionErr && !authOk(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: Partial<BriefRecord>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Bad JSON' }, { status: 400 }) }

  const record: BriefRecord = {
    id: body.id ?? generateBriefId(),
    date: body.date ?? new Date().toISOString().slice(0, 10),
    type: body.type ?? 'morning',
    createdAt: body.createdAt ?? new Date().toISOString(),
    sentAt: body.sentAt,
    telegramMessageId: body.telegramMessageId,
    status: body.status ?? 'pending-approval',
    tasks: body.tasks ?? [],
  }

  saveBriefRecord(record)
  return NextResponse.json({ ok: true, id: record.id })
}
