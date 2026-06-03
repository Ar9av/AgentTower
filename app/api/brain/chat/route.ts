import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { getRecentSessions, getClaudeDir } from '@/lib/claude-fs'
import { scanClaudeSessions } from '@/lib/process'
import { getClaudeBin } from '@/lib/spawn-claude'
import { spawn } from 'child_process'
import type { RecentSession } from '@/lib/claude-fs'
import type { ClaudeProcess } from '@/lib/types'

interface Message { role: 'user' | 'brain'; content: string }

function relTime(ms: number): string {
  const d = Date.now() - ms
  if (d < 60_000) return 'just now'
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m ago`
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h ago`
  return `${Math.floor(d / 86_400_000)}d ago`
}

function buildContext(
  sessions: RecentSession[],
  processes: Record<string, ClaudeProcess>
): string {
  const now = Date.now()
  const active = sessions.filter(s => s.isActive)
  const recent = sessions
    .filter(s => !s.isActive && now - s.mtime < 24 * 60 * 60 * 1000)
    .slice(0, 12)

  const lines: string[] = [`## System State — ${new Date().toLocaleString()}`, '']

  if (active.length > 0) {
    lines.push(`### Running (${active.length})`)
    for (const s of active) {
      const proc = processes[s.sessionId]
      const dur = proc ? Math.floor((now - (proc.startedAt ?? now)) / 60_000) : 0
      const activity = s.currentActivity ? ` · ${s.currentActivity}` : ''
      lines.push(`- **${s.projectDisplayName}** pid=${proc?.pid ?? '?'} ${dur}m${activity}`)
      lines.push(`  Task: "${s.firstPrompt.slice(0, 120)}"`)
      if (proc?.cwd) lines.push(`  Dir: ${proc.cwd}`)
    }
    lines.push('')
  } else {
    lines.push('### No agents currently running\n')
  }

  if (recent.length > 0) {
    lines.push(`### Recently completed (${recent.length} in last 24h)`)
    for (const s of recent) {
      lines.push(`- **${s.projectDisplayName}** — "${s.firstPrompt.slice(0, 80)}" — ${relTime(s.mtime)}`)
    }
    lines.push('')
  }

  // List all known projects from running processes
  const projectPaths = new Set<string>()
  for (const proc of Object.values(processes)) {
    if (proc.cwd) projectPaths.add(proc.cwd)
  }
  // Also from recent sessions via dir names
  const allProjects = sessions
    .filter(s => s.isActive)
    .map(s => ({ name: s.projectDisplayName, path: processes[s.sessionId]?.cwd ?? '' }))
    .filter(p => p.path)

  if (allProjects.length > 0) {
    lines.push('### Active project paths')
    for (const p of allProjects) {
      lines.push(`- ${p.name}: ${p.path}`)
    }
  }

  return lines.join('\n')
}

const SYSTEM_PROMPT = `You are AgentTower Brain — an intelligent assistant embedded in AgentTower, a dashboard for monitoring and controlling Claude Code agent sessions.

You have real-time visibility into all running agents, their tasks, activity, and recent completed work. You help the user:
- Understand what their agents are working on
- Identify stuck, stalled, or blocked agents
- Suggest what to start next
- Coordinate multiple agents intelligently
- Take action (start sessions, open sessions)

When suggesting an action, emit it on its own line in this exact format (do not include in code blocks):
ACTION:start_session:{"project":"<full_absolute_path>","prompt":"<what to do>","model":"sonnet"}
ACTION:open_session:{"encodedFilepath":"<encoded>","label":"<short label>"}

Rules:
- Be concise, direct, intelligent
- Use bullet points for lists
- Highlight problems (stalls, errors, blocked)
- Suggest concrete next steps with reasoning
- Max 300 words unless explicitly asked for more
- Don't add unnecessary caveats or disclaimers`

export async function POST(req: NextRequest) {
  const authErr = await requireAuth(req)
  if (authErr) return authErr

  const body = await req.json().catch(() => ({}))
  const { messages, userMessage } = body as { messages: Message[]; userMessage: string }

  if (!userMessage?.trim()) {
    return NextResponse.json({ error: 'userMessage required' }, { status: 400 })
  }

  // Gather live system state
  const claudeDir = getClaudeDir()
  const sessions = getRecentSessions(30)
  const processes = scanClaudeSessions(claudeDir)
  const context = buildContext(sessions, processes)

  // Build conversation history (last 8 turns)
  const historyLines = (messages ?? []).slice(-8).map(m =>
    `${m.role === 'user' ? 'User' : 'Brain'}: ${m.content}`
  ).join('\n\n')

  const prompt = [
    SYSTEM_PROMPT,
    '',
    context,
    historyLines ? `## Conversation History\n${historyLines}\n` : '',
    `## User\n${userMessage.trim()}`,
  ].filter(Boolean).join('\n')

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    start(controller) {
      const proc = spawn(getClaudeBin(), ['--dangerously-skip-permissions', '-p', prompt], {
        stdio: ['ignore', 'pipe', 'pipe'],
      })

      proc.stdout?.on('data', (chunk: Buffer) => {
        controller.enqueue(encoder.encode(chunk.toString()))
      })

      proc.stderr?.on('data', () => { /* suppress */ })

      proc.on('close', () => {
        try { controller.close() } catch { /* already closed */ }
      })

      proc.on('error', (err: Error) => {
        controller.enqueue(encoder.encode(`\nError: ${err.message}`))
        try { controller.close() } catch { /* ignore */ }
      })
    },
  })

  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no',
    },
  })
}
