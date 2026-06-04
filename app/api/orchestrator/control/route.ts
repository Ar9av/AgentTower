import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { execSync, spawn } from 'child_process'
import path from 'path'

function getDaemonStatus(): { running: boolean; pid: number | null; uptimeSec: number | null } {
  try {
    const out = execSync('ps -A -o pid=,etimes=,command=', { encoding: 'utf-8' })
    for (const line of out.split('\n')) {
      if (!line.includes('orchestrator-bot')) continue
      if (/grep|orchestrator-control/.test(line)) continue
      const m = line.trim().match(/^(\d+)\s+(\d+)/)
      if (!m) continue
      return { running: true, pid: parseInt(m[1], 10), uptimeSec: parseInt(m[2], 10) }
    }
  } catch {}
  return { running: false, pid: null, uptimeSec: null }
}

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
    const status = getDaemonStatus()
    if (status.running) {
      return NextResponse.json({ ok: true, note: 'already running', pid: status.pid })
    }

    const botPath = path.resolve(process.cwd(), 'scripts/orchestrator/orchestrator-bot.ts')
    const proc = spawn(
      'ts-node',
      ['--transpile-only', botPath],
      { detached: true, stdio: 'ignore', env: process.env },
    )
    proc.unref()

    return NextResponse.json({ ok: true, pid: proc.pid })
  }

  return NextResponse.json({ error: 'action must be status|start|stop' }, { status: 400 })
}
