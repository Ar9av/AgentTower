import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { sendSignal } from '@/lib/process'

export async function POST(req: NextRequest) {
  const authErr = await requireAuth(req)
  if (authErr) return authErr

  const { pid } = await req.json().catch(() => ({}))
  if (!pid || typeof pid !== 'number') {
    return NextResponse.json({ error: 'pid required' }, { status: 400 })
  }

  const result = sendSignal(pid, 'SIGCONT')
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ ok: true })
}
