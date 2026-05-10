import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import {
  loadIntegrations,
  saveIntegrations,
  fetchAntigravityAgents,
} from '@/lib/integrations'

export async function GET(req: NextRequest) {
  const authErr = await requireAuth(req)
  if (authErr) return authErr

  const cfg = loadIntegrations()
  const ag = cfg.antigravity

  const isTest = req.nextUrl.searchParams.get('test') === '1'

  if (isTest) {
    try {
      const agents = await fetchAntigravityAgents(ag)
      return NextResponse.json({ connected: true, agentCount: agents.length })
    } catch (err) {
      return NextResponse.json({ connected: false, error: String(err) })
    }
  }

  let agents: Awaited<ReturnType<typeof fetchAntigravityAgents>> = []
  let fetchError: string | null = null
  if (ag.enabled && ag.apiKey) {
    try {
      agents = await fetchAntigravityAgents(ag)
    } catch (err) {
      fetchError = String(err)
    }
  }

  return NextResponse.json({
    antigravity: {
      enabled: ag.enabled,
      apiKeySet: Boolean(ag.apiKey),
      workspaceId: ag.workspaceId ?? '',
      apiBaseUrl: ag.apiBaseUrl ?? '',
    },
    agents,
    error: fetchError,
  })
}

export async function POST(req: NextRequest) {
  const authErr = await requireAuth(req)
  if (authErr) return authErr

  let body: {
    enabled?: boolean
    apiKey?: string
    workspaceId?: string
    apiBaseUrl?: string
    clearApiKey?: boolean
  }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Bad JSON' }, { status: 400 }) }

  const current = loadIntegrations()
  const next = { ...current.antigravity }

  if (typeof body.enabled === 'boolean') next.enabled = body.enabled
  if (typeof body.workspaceId === 'string') next.workspaceId = body.workspaceId.trim() || undefined
  if (typeof body.apiBaseUrl === 'string') next.apiBaseUrl = body.apiBaseUrl.trim() || undefined

  if (body.clearApiKey) next.apiKey = undefined
  else if (typeof body.apiKey === 'string' && body.apiKey.length > 0) {
    next.apiKey = body.apiKey
  }

  saveIntegrations({ ...current, antigravity: next })
  return NextResponse.json({ ok: true })
}
