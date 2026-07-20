import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { parseJsonlFile } from '@/lib/claude-fs'
import { parseCodexJsonlFile } from '@/lib/codex-fs'
import { resolveSession, messageText } from '@/lib/api-v1'
import { spawnClaude } from '@/lib/spawn-claude'
import { spawnCodex } from '@/lib/spawn-codex'

const DEFAULT_TIMEOUT_MS = 5 * 60_000
const MAX_TIMEOUT_MS = 20 * 60_000

// POST /api/v1/sessions/:id/message  { prompt, model?, timeoutMs? }
// Sends a prompt into an existing session and waits for the agent to finish,
// then returns the reply it appended. Blocks for the duration of the run.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authErr = await requireAuth(req)
  if (authErr) return authErr

  const { id } = await params
  const resolved = resolveSession(id)
  if (!resolved) return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  if (!resolved.cwd) return NextResponse.json({ error: 'Could not resolve session working directory' }, { status: 500 })

  const body = await req.json().catch(() => ({}))
  const { prompt, model, timeoutMs } = body ?? {}
  if (!prompt || typeof prompt !== 'string') {
    return NextResponse.json({ error: 'prompt required' }, { status: 400 })
  }
  const timeout = Math.min(Math.max(parseInt(timeoutMs, 10) || DEFAULT_TIMEOUT_MS, 1000), MAX_TIMEOUT_MS)

  const beforeCount = (resolved.mode === 'codex'
    ? parseCodexJsonlFile(resolved.filepath)
    : parseJsonlFile(resolved.filepath)
  ).filter(m => !m.isMeta).length

  let proc
  if (resolved.mode === 'codex') {
    const args = ['exec', 'resume']
    if (typeof model === 'string' && model.trim()) args.push('-m', model.trim())
    args.push('--dangerously-bypass-approvals-and-sandbox', resolved.sessionId, prompt)
    proc = spawnCodex(args, { cwd: resolved.cwd, stdio: 'ignore' })
  } else {
    const args = ['--dangerously-skip-permissions', '-r', resolved.sessionId]
    if (typeof model === 'string' && model.trim()) args.push('--model', model.trim())
    args.push('-p', prompt)
    proc = spawnClaude(args, { cwd: resolved.cwd, stdio: 'ignore' })
  }

  const exit = await new Promise<{ code: number | null; timedOut: boolean }>((resolve) => {
    const timer = setTimeout(() => {
      try { proc.kill('SIGTERM') } catch { /* already dead */ }
      resolve({ code: null, timedOut: true })
    }, timeout)
    proc.on('close', code => { clearTimeout(timer); resolve({ code, timedOut: false }) })
    proc.on('error', () => { clearTimeout(timer); resolve({ code: null, timedOut: false }) })
  })

  const afterAll = resolved.mode === 'codex'
    ? parseCodexJsonlFile(resolved.filepath)
    : parseJsonlFile(resolved.filepath)
  const after = afterAll.filter(m => !m.isMeta)
  const newMessages = after.slice(beforeCount)
  const reply = [...newMessages].reverse().find(m => m.role === 'assistant') ?? null

  return NextResponse.json({
    sessionId: resolved.sessionId,
    provider: resolved.mode,
    exitCode: exit.code,
    timedOut: exit.timedOut,
    reply: reply ? messageText(reply) : null,
    newMessages,
  })
}
