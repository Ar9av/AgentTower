import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { loadBriefHistory } from '@/lib/daily-brief'

export async function GET(req: NextRequest) {
  const authErr = await requireAuth(req)
  if (authErr) return authErr

  const url = new URL(req.url)
  const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '30', 10), 100)
  const records = loadBriefHistory(limit)
  return NextResponse.json({ records })
}
