import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import {
  loadDailyBriefConfig,
  saveDailyBriefConfig,
  getConfigPath,
  getHistoryPath,
  type DailyBriefConfig,
} from '@/lib/daily-brief'

export async function GET(req: NextRequest) {
  const authErr = await requireAuth(req)
  if (authErr) return authErr

  const cfg = loadDailyBriefConfig()
  return NextResponse.json({
    config: cfg,
    configPath: getConfigPath(),
    historyPath: getHistoryPath(),
  })
}

export async function POST(req: NextRequest) {
  const authErr = await requireAuth(req)
  if (authErr) return authErr

  let body: Partial<DailyBriefConfig>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Bad JSON' }, { status: 400 }) }

  const current = loadDailyBriefConfig()
  const next: DailyBriefConfig = {
    ...current,
    ...body,
    // Never overwrite apiKey with empty string
    apiKey: body.apiKey && body.apiKey.length >= 32 ? body.apiKey : current.apiKey,
  }

  saveDailyBriefConfig(next)
  return NextResponse.json({ ok: true })
}
