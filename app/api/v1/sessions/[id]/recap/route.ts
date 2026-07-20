import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { parseJsonlFile } from '@/lib/claude-fs'
import { parseCodexJsonlFile } from '@/lib/codex-fs'
import { resolveSession, messageText, lastNonMeta } from '@/lib/api-v1'
import { spawnClaude } from '@/lib/spawn-claude'

const LLM_TIMEOUT_MS = 60_000

// GET /api/v1/sessions/:id/recap?llm=1 — cheap last-message recap by default,
// or an LLM-generated one-liner summary of the recent turns when llm=1.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authErr = await requireAuth(req)
  if (authErr) return authErr

  const { id } = await params
  const resolved = resolveSession(id)
  if (!resolved) return NextResponse.json({ error: 'Session not found' }, { status: 404 })

  const messages = resolved.mode === 'codex'
    ? parseCodexJsonlFile(resolved.filepath)
    : parseJsonlFile(resolved.filepath)
  const nonMeta = messages.filter(m => !m.isMeta)
  const last = lastNonMeta(nonMeta)
  if (!last) return NextResponse.json({ error: 'Session has no messages' }, { status: 404 })

  const base = {
    sessionId: resolved.sessionId,
    provider: resolved.mode,
    cwd: resolved.cwd,
    messageCount: nonMeta.length,
    lastRole: last.role,
    lastTimestamp: last.timestamp,
    lastMessage: messageText(last).slice(0, 4000),
  }

  if (req.nextUrl.searchParams.get('llm') !== '1' || resolved.mode === 'codex') {
    return NextResponse.json(base)
  }

  // LLM recap: summarize the last handful of turns in one or two sentences.
  const recentTurns = nonMeta.slice(-10)
    .map(m => ({ role: m.role, text: messageText(m).slice(0, 1000) }))
    .filter(m => m.text.length > 0)
    .map(m => `${m.role}: ${m.text}`)
    .join('\n\n')

  const prompt = `Summarize what's happening in this conversation excerpt in 1-2 concise sentences. Focus on the current state/outcome, not a blow-by-blow.\n\n${recentTurns}`

  try {
    const summary = await new Promise<string>((resolve, reject) => {
      const proc = spawnClaude(['-p', prompt], { stdio: ['ignore', 'pipe', 'ignore'] })
      let out = ''
      const timer = setTimeout(() => { proc.kill('SIGTERM'); reject(new Error('LLM recap timed out')) }, LLM_TIMEOUT_MS)
      proc.stdout!.on('data', chunk => { out += chunk.toString() })
      proc.on('close', () => { clearTimeout(timer); resolve(out.trim()) })
      proc.on('error', err => { clearTimeout(timer); reject(err) })
    })
    return NextResponse.json({ ...base, recap: summary })
  } catch (err) {
    return NextResponse.json({ ...base, recap: null, recapError: (err as Error).message })
  }
}
