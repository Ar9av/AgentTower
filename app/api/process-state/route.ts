import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { getProcessState, isProcessAlive } from '@/lib/process'

export async function GET(req: NextRequest) {
  const authErr = await requireAuth(req)
  if (authErr) return authErr

  const pidStr = req.nextUrl.searchParams.get('pid')
  if (!pidStr) return NextResponse.json({ error: 'pid required' }, { status: 400 })

  const pid = parseInt(pidStr, 10)
  if (isNaN(pid)) return NextResponse.json({ error: 'invalid pid' }, { status: 400 })

  if (!isProcessAlive(pid)) {
    return NextResponse.json({ state: 'dead' })
  }

  const state = getProcessState(pid)
  return NextResponse.json({ state })
}
