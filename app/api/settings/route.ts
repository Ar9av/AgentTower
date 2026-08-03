import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import {
  compileProjectIgnoreRule,
  getCompiledProjectIgnoreRegexes,
  getDefaultProjectIgnoreRegexes,
  getSettingsPath,
  loadSettings,
  saveSettings,
  type AppSettings,
} from '@/lib/settings'

export async function GET(req: NextRequest) {
  const authErr = await requireAuth(req)
  if (authErr) return authErr

  const settings = loadSettings()
  return NextResponse.json({
    settings,
    configPath: getSettingsPath(),
    defaultProjectIgnoreRegexes: getDefaultProjectIgnoreRegexes(),
    compiledProjectIgnoreRegexes: getCompiledProjectIgnoreRegexes(settings),
  })
}

export async function POST(req: NextRequest) {
  const authErr = await requireAuth(req)
  if (authErr) return authErr

  let body: Partial<AppSettings>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Bad JSON' }, { status: 400 }) }

  const rules = Array.isArray(body.projectIgnoreRules)
    ? body.projectIgnoreRules.filter((v): v is string => typeof v === 'string').map(v => v.trim()).filter(Boolean)
    : loadSettings().projectIgnoreRules

  try {
    for (const rule of rules) compileProjectIgnoreRule(rule)
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Invalid ignore rule' }, { status: 400 })
  }

  const terminalEnabled = typeof body.terminalEnabled === 'boolean'
    ? body.terminalEnabled
    : loadSettings().terminalEnabled

  const next: AppSettings = { projectIgnoreRules: rules, terminalEnabled }
  saveSettings(next)

  return NextResponse.json({
    ok: true,
    compiledProjectIgnoreRegexes: getCompiledProjectIgnoreRegexes(next),
  })
}
