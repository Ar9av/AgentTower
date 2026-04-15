import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import {
  loadIntegrations,
  saveIntegrations,
  getTelegramBotStatus,
  readAuditTail,
  getConfigPath,
  getAuditPath,
} from '@/lib/integrations'

export async function GET(req: NextRequest) {
  const authErr = await requireAuth(req)
  if (authErr) return authErr

  const cfg = loadIntegrations()
  const status = getTelegramBotStatus()
  const audit = readAuditTail(30)

  // Redact secret before sending to browser — only report whether it's set
  const telegram = {
    enabled: cfg.telegram.enabled,
    allowedChatIds: cfg.telegram.allowedChatIds,
    projectsDir: cfg.telegram.projectsDir ?? '',
    openaiApiKeySet: Boolean(cfg.telegram.openaiApiKey),
    botTokenSet: Boolean(process.env.BOT_TOKEN),
  }

  return NextResponse.json({
    telegram,
    status,
    audit,
    configPath: getConfigPath(),
    auditPath: getAuditPath(),
  })
}

export async function POST(req: NextRequest) {
  const authErr = await requireAuth(req)
  if (authErr) return authErr

  let body: {
    enabled?: boolean
    allowedChatIds?: number[]
    projectsDir?: string
    openaiApiKey?: string      // empty string = leave unchanged; null = clear
    clearOpenaiApiKey?: boolean
  }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Bad JSON' }, { status: 400 }) }

  const current = loadIntegrations()
  const next = { ...current.telegram }

  if (typeof body.enabled === 'boolean') next.enabled = body.enabled
  if (Array.isArray(body.allowedChatIds)) {
    next.allowedChatIds = body.allowedChatIds
      .map(n => Number(n))
      .filter(n => Number.isInteger(n) && n !== 0)
  }
  if (typeof body.projectsDir === 'string') next.projectsDir = body.projectsDir.trim() || undefined

  if (body.clearOpenaiApiKey) next.openaiApiKey = undefined
  else if (typeof body.openaiApiKey === 'string' && body.openaiApiKey.length > 0) {
    next.openaiApiKey = body.openaiApiKey
  }

  saveIntegrations({ ...current, telegram: next })
  return NextResponse.json({ ok: true })
}
