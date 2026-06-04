import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { computeBrainAlerts } from '@/lib/brain-context'

export async function GET(req: NextRequest) {
  const authErr = await requireAuth(req)
  if (authErr) return authErr

  const alerts = computeBrainAlerts()
  return NextResponse.json({ alerts, count: alerts.length })
}
