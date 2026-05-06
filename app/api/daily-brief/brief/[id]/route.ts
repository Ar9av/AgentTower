import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import {
  validateApiKey,
  loadBriefById,
  saveBriefRecord,
  type BriefTask,
  type TaskResult,
} from '@/lib/daily-brief'

function authOk(req: NextRequest): boolean {
  const bearer = req.headers.get('authorization')?.replace('Bearer ', '') ?? ''
  return validateApiKey(bearer)
}

// GET /api/daily-brief/brief/[id]
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const sessionErr = await requireAuth(req)
  if (sessionErr && !authOk(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const record = loadBriefById(id)
  if (!record) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ record })
}

// PATCH /api/daily-brief/brief/[id]
// Body shapes:
//   { action: 'approve', taskIds: string[] }
//   { action: 'reject', taskIds: string[] }
//   { action: 'task-started', taskId: string }
//   { action: 'task-result', taskId: string, result: TaskResult, status: 'completed'|'failed' }
//   { action: 'skip' }
//   { action: 'mark-sent', sentAt: string, telegramMessageId?: number }
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const sessionErr = await requireAuth(req)
  if (sessionErr && !authOk(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const record = loadBriefById(id)
  if (!record) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  let body: {
    action: string
    taskIds?: string[]
    taskId?: string
    result?: TaskResult
    status?: BriefTask['status']
    sentAt?: string
    telegramMessageId?: number
  }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Bad JSON' }, { status: 400 }) }

  const now = new Date().toISOString()

  if (body.action === 'approve' && body.taskIds) {
    const ids = new Set(body.taskIds)
    record.tasks = record.tasks.map(t =>
      ids.has(t.id) ? { ...t, status: 'approved', approvedAt: now } : t
    )
    const anyApproved = record.tasks.some(t => t.status === 'approved')
    if (anyApproved) record.status = 'executing'
  }

  if (body.action === 'reject' && body.taskIds) {
    const ids = new Set(body.taskIds)
    record.tasks = record.tasks.map(t =>
      ids.has(t.id) ? { ...t, status: 'rejected' } : t
    )
  }

  if (body.action === 'task-started' && body.taskId) {
    record.tasks = record.tasks.map(t =>
      t.id === body.taskId ? { ...t, status: 'running', startedAt: now } : t
    )
  }

  if (body.action === 'task-result' && body.taskId && body.result) {
    record.tasks = record.tasks.map(t =>
      t.id === body.taskId
        ? { ...t, status: body.status ?? 'completed', completedAt: now, result: body.result }
        : t
    )
    const allDone = record.tasks
      .filter(t => t.status !== 'rejected' && t.status !== 'pending')
      .every(t => t.status === 'completed' || t.status === 'failed')
    if (allDone) record.status = 'completed'
  }

  if (body.action === 'skip') {
    record.status = 'skipped'
    record.tasks = record.tasks.map(t =>
      t.status === 'pending' ? { ...t, status: 'rejected' } : t
    )
  }

  if (body.action === 'mark-sent') {
    record.sentAt = body.sentAt ?? now
    if (body.telegramMessageId) record.telegramMessageId = body.telegramMessageId
  }

  saveBriefRecord(record)
  return NextResponse.json({ ok: true, record })
}
