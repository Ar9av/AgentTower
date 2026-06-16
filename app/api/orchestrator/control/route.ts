import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { getDaemonStatus, startDaemon } from '@/lib/orchestrator-daemon'

export async function POST(req: NextRequest) {
  const authErr = await requireAuth(req)
  if (authErr) return authErr

  let body: { action?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Bad JSON' }, { status: 400 }) }

  const action = body.action

  if (action === 'status') {
    return NextResponse.json(getDaemonStatus())
  }

  if (action === 'stop') {
    const status = getDaemonStatus()
    if (!status.running || !status.pid) {
      return NextResponse.json({ ok: true, note: 'not running' })
    }
    try {
      process.kill(status.pid, 'SIGTERM')
      return NextResponse.json({ ok: true })
    } catch (e) {
      return NextResponse.json({ error: String(e) }, { status: 500 })
    }
  }

  if (action === 'start') {
    const result = startDaemon()
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 500 })
    }
    return NextResponse.json({ ok: true, pid: result.pid })
  }

  return NextResponse.json({ error: 'action must be status|start|stop' }, { status: 400 })
}
