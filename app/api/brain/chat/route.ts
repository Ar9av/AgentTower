import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { assembleBrainContext, getVaultPath } from '@/lib/brain-context'
import { getClaudeBin } from '@/lib/spawn-claude'
import { getCodexBin } from '@/lib/spawn-codex'
import { spawn } from 'child_process'
import os from 'os'
import path from 'path'

interface Message { role: 'user' | 'brain'; content: string }
type BrainProvider = 'auto' | 'claude' | 'codex'

const CLAUDE_PROJECTS = path.join(os.homedir(), '.claude', 'projects')

function buildSystemPrompt(): string {
  return `You are the AgentTower Brain — a unified intelligent orchestrator with REAL investigative tools.

You are the single interface through which the user controls everything:
- **Claude Code sessions**: start, stop, steer, monitor, coordinate multiple agents
- **Codex CLI sessions**: inspect Codex work, continue sessions, and reason across Codex transcripts
- **Knowledge wiki**: search ~/Knowledge vault, create/update wiki pages
- **Brain memory**: remember facts and decisions that persist across sessions
- **GitHub orchestrator**: queue issues for autonomous agents
- **Project intelligence**: analyse patterns, identify blockers, suggest next steps

## You have tools — USE them to investigate before answering

You can run Bash, Read, and Grep. When a question needs detail you don't already have
in the context, INVESTIGATE instead of guessing:
- Session transcripts live in: ${CLAUDE_PROJECTS}/<encoded-project>/<sessionId>.jsonl
  (each line is a JSON event: user/assistant messages, tool_use, system away_summary recaps)
- To see what an agent did or why it failed: read the tail of its .jsonl and look for
  errors, the last assistant text, and away_summary recaps.
- The knowledge wiki is at: ${getVaultPath()} — grep it for project notes.
- For "what patterns keep recurring", read recaps across several recent sessions and synthesise.

Keep investigation focused (a few targeted reads/greps). Then give a grounded answer.

## How to Respond

1. **Be direct and concise** — ground every statement in real data you read or were given
2. **Proactively surface issues** — stuck agents, stalled runs, recurring errors
3. **Synthesise across sessions** when asked about patterns or history
4. **Suggest the next action** — don't just describe

## How to Take Action

Emit actions on their own line. The UI renders them as buttons the user clicks to confirm.

\`\`\`
# Start a new Claude Code or Codex session
ACTION:start_session:{"project":"<absolute_path>","prompt":"<task>","provider":"auto|claude|codex","model":"sonnet"}

# Send a message INTO a running session (steer a live agent)
ACTION:send_to_session:{"sessionId":"<id>","message":"<instruction>","label":"<project>","provider":"claude|codex"}

# Open an existing session in the UI
ACTION:open_session:{"encodedFilepath":"<encoded>","label":"<short label>"}

# Kill a stuck or unwanted process
ACTION:kill_session:{"pid":<number>,"label":"<project name>"}

# Save a typed fact to persistent brain memory
ACTION:save_memory:{"fact":"<what to remember>","type":"decision|preference|project|blocker|fact"}

# Create or update a wiki page
ACTION:update_wiki:{"path":"projects/<name>/<slug>.md","title":"<Title>","content":"<markdown>"}

# Search the wiki (results injected next turn)
ACTION:search_wiki:{"query":"<terms>"}
\`\`\`

Rules:
- Only suggest actions you can justify from real data
- start_session / send_to_session: use the exact paths and sessionIds in the context
- For delegation, provider "auto" tries Claude first and switches to Codex if Claude is rate/usage limited. Honor an explicit user provider choice.
- save_memory: short factual statements; pick the most fitting type
- Never fabricate sessionIds, pids, or paths — read them or use the context

## Memory

When the user shares something durable (a goal, decision, preference, or recurring blocker),
emit ACTION:save_memory with the right type. This is how you get smarter over time.`
}

export async function POST(req: NextRequest) {
  const authErr = await requireAuth(req)
  if (authErr) return authErr

  const body = await req.json().catch(() => ({}))
  const { messages, userMessage, provider = 'auto' } = body as {
    messages: Message[]
    userMessage: string
    provider?: BrainProvider
  }

  if (!userMessage?.trim()) {
    return NextResponse.json({ error: 'userMessage required' }, { status: 400 })
  }
  const selectedProvider: BrainProvider = ['auto', 'claude', 'codex'].includes(provider) ? provider : 'auto'

  // Assemble the full unified context
  const ctx = assembleBrainContext(userMessage)

  // Build conversation history (last 10 turns)
  const historyBlock = (messages ?? [])
    .slice(-10)
    .map(m => `**${m.role === 'user' ? 'User' : 'Brain'}:** ${m.content}`)
    .join('\n\n')

  const prompt = [
    buildSystemPrompt(),
    `\nBrain/delegation provider preference: ${selectedProvider}.`,
    '',
    ctx.text,
    historyBlock ? `\n## Conversation History\n${historyBlock}` : '',
    `\n## User\n${userMessage.trim()}`,
  ].filter(Boolean).join('\n')

  const encoder = new TextEncoder()

  // Prepend a metadata line the client can parse for context indicators
  const meta = JSON.stringify({
    _meta: true,
    runningCount: ctx.runningCount,
    completedTodayCount: ctx.completedTodayCount,
    hasWiki: ctx.hasWiki,
    hasMemory: ctx.hasMemory,
    hasOrchestrator: ctx.hasOrchestrator,
  })

  const stream = new ReadableStream({
    start(controller) {
      let closed = false
      let fallbackStarted = false
      const write = (value: string) => {
        if (!closed) controller.enqueue(encoder.encode(value))
      }
      const control = (value: Record<string, unknown>) => write(`\x00${JSON.stringify(value)}\x00`)
      const close = () => {
        if (closed) return
        closed = true
        try { controller.close() } catch { /* ignore */ }
      }

      // First chunk: metadata for the UI
      control({ ...JSON.parse(meta), requestedProvider: selectedProvider })

      const runCodex = (fallbackReason?: string) => {
        if (closed || fallbackStarted) return
        fallbackStarted = true
        if (fallbackReason) write(`\n\n> Claude is unavailable (${fallbackReason}). Switched to Codex automatically.\n\n`)
        control({ _event: 'provider', provider: 'codex' })
        const proc = spawn(
          getCodexBin(),
          ['exec', '--sandbox', 'read-only', '--skip-git-repo-check', '-C', os.homedir(), prompt],
          { stdio: ['ignore', 'pipe', 'pipe'], cwd: os.homedir() }
        )
        let stderr = ''
        proc.stdout?.on('data', (chunk: Buffer) => write(chunk.toString()))
        proc.stderr?.on('data', (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-4000) })
        proc.on('close', (code) => {
          if (code && stderr.trim()) write(`\n\nCodex error: ${stderr.trim().slice(-1000)}`)
          close()
        })
        proc.on('error', (err: Error) => { write(`\nError starting Codex: ${err.message}`); close() })
      }

      if (selectedProvider === 'codex') {
        runCodex()
        return
      }

      // Run with read-only investigative tools enabled. cwd = home so it can
      // reach ~/.claude/projects and ~/Knowledge. Restrict to safe tools.
      control({ _event: 'provider', provider: 'claude' })
      const proc = spawn(
        getClaudeBin(),
        [
          '--dangerously-skip-permissions',
          '--allowedTools', 'Read,Grep,Glob,Bash(cat *),Bash(tail *),Bash(head *),Bash(ls *),Bash(grep *),Bash(rg *),Bash(git log *),Bash(git status)',
          '-p', prompt,
        ],
        { stdio: ['ignore', 'pipe', 'pipe'], cwd: os.homedir() }
      )

      let stderr = ''
      let wroteOutput = false
      proc.stdout?.on('data', (chunk: Buffer) => {
        wroteOutput = true
        write(chunk.toString())
      })
      proc.stderr?.on('data', (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-8000) })
      proc.on('close', (code) => {
        const isLimit = /rate.?limit|usage.?limit|credit balance|quota|overloaded|capacity|too many requests|429/i.test(stderr)
        if (selectedProvider === 'auto' && (isLimit || (code && !wroteOutput))) {
          runCodex(isLimit ? 'usage or rate limit reached' : 'Claude exited before responding')
          return
        }
        if (code && stderr.trim()) write(`\n\nClaude error: ${stderr.trim().slice(-1000)}`)
        close()
      })
      proc.on('error', (err: Error) => {
        if (selectedProvider === 'auto') runCodex('Claude could not be started')
        else { write(`\nError starting Claude: ${err.message}`); close() }
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
