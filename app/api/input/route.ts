import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { spawn } from 'child_process'

export async function POST(req: NextRequest) {
  const authErr = await requireAuth(req)
  if (authErr) return authErr

  const { session_id, prompt } = await req.json().catch(() => ({}))
  if (!session_id || !prompt) {
    return NextResponse.json({ error: 'session_id and prompt required' }, { status: 400 })
  }

  const proc = spawn('claude', ['--resume', session_id, '--print', prompt], {
    detached: true,
    stdio: 'ignore',
  })
  proc.unref()

  return NextResponse.json({ ok: true })
}
