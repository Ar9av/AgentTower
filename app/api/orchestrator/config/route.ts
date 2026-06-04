import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import {
  loadOrchestratorConfig,
  saveOrchestratorConfig,
  getConfigPath,
  getRunsPath,
} from '@/lib/orchestrator-config'

export async function GET(req: NextRequest) {
  const authErr = await requireAuth(req)
  if (authErr) return authErr

  const cfg = loadOrchestratorConfig()
  return NextResponse.json({ config: cfg, configPath: getConfigPath(), runsPath: getRunsPath() })
}

export async function POST(req: NextRequest) {
  const authErr = await requireAuth(req)
  if (authErr) return authErr

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Bad JSON' }, { status: 400 }) }

  const existing = loadOrchestratorConfig()
  // Preserve apiKey — never overwrite with a blank value
  const merged = { ...existing, ...body, apiKey: existing.apiKey }
  saveOrchestratorConfig(merged)
  return NextResponse.json({ ok: true })
}
