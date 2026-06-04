import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { loadIntegrations, saveIntegrations, getGitHubToken, getGitHubTokenSource } from '@/lib/integrations'

export async function GET(req: NextRequest) {
  const authErr = await requireAuth(req)
  if (authErr) return authErr

  const cfg = loadIntegrations()
  const source = getGitHubTokenSource()
  const token = getGitHubToken()
  return NextResponse.json({
    github: {
      enabled: cfg.github.enabled,
      tokenSet: Boolean(token),
      tokenHint: cfg.github.token ? `…${cfg.github.token.slice(-4)}` : null,
      usingEnvVar: source === 'env',
      usingGhCli: source === 'gh-cli',
    },
  })
}

export async function POST(req: NextRequest) {
  const authErr = await requireAuth(req)
  if (authErr) return authErr

  let body: { enabled?: boolean; token?: string; clearToken?: boolean }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Bad JSON' }, { status: 400 }) }

  const current = loadIntegrations()
  const next = { ...current.github }

  if (typeof body.enabled === 'boolean') next.enabled = body.enabled
  if (body.clearToken) next.token = undefined
  else if (typeof body.token === 'string' && body.token.length > 0) next.token = body.token

  saveIntegrations({ ...current, github: next })
  return NextResponse.json({ ok: true })
}
