import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { assembleBrainContext, getVaultPath } from '@/lib/brain-context'
import { getClaudeBin } from '@/lib/spawn-claude'
import { spawn } from 'child_process'
import os from 'os'
import path from 'path'

interface Message { role: 'user' | 'brain'; content: string }

const CLAUDE_PROJECTS = path.join(os.homedir(), '.claude', 'projects')

function buildSystemPrompt(): string {
  return `You are the AgentTower Brain — a unified intelligent orchestrator with REAL investigative tools.

You are the single interface through which the user controls everything:
- **Claude Code sessions**: start, stop, steer, monitor, coordinate multiple agents
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
# Start a new Claude Code session
ACTION:start_session:{"project":"<absolute_path>","prompt":"<task>","model":"sonnet"}

# Send a message INTO a running session (steer a live agent)
ACTION:send_to_session:{"sessionId":"<id>","message":"<instruction>","label":"<project>"}

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
  const { messages, userMessage } = body as {
    messages: Message[]
    userMessage: string
  }

  if (!userMessage?.trim()) {
    return NextResponse.json({ error: 'userMessage required' }, { status: 400 })
  }

  // Assemble the full unified context
  const ctx = assembleBrainContext(userMessage)

  // Build conversation history (last 10 turns)
  const historyBlock = (messages ?? [])
    .slice(-10)
    .map(m => `**${m.role === 'user' ? 'User' : 'Brain'}:** ${m.content}`)
    .join('\n\n')

  const prompt = [
    buildSystemPrompt(),
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
      // First chunk: metadata for the UI
      controller.enqueue(encoder.encode(`\x00${meta}\x00`))

      // Run with read-only investigative tools enabled. cwd = home so it can
      // reach ~/.claude/projects and ~/Knowledge. Restrict to safe tools.
      const proc = spawn(
        getClaudeBin(),
        [
          '--dangerously-skip-permissions',
          '--allowedTools', 'Read,Grep,Glob,Bash(cat *),Bash(tail *),Bash(head *),Bash(ls *),Bash(grep *),Bash(rg *),Bash(git log *),Bash(git status)',
          '-p', prompt,
        ],
        { stdio: ['ignore', 'pipe', 'pipe'], cwd: os.homedir() }
      )

      proc.stdout?.on('data', (chunk: Buffer) => {
        controller.enqueue(encoder.encode(chunk.toString()))
      })
      proc.stderr?.on('data', () => { /* suppress */ })
      proc.on('close', () => { try { controller.close() } catch { /* ignore */ } })
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
