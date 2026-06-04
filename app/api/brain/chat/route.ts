import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { assembleBrainContext } from '@/lib/brain-context'
import { getClaudeBin } from '@/lib/spawn-claude'
import { spawn } from 'child_process'

interface Message { role: 'user' | 'brain'; content: string }

const SYSTEM_PROMPT = `You are the AgentTower Brain — a unified intelligent orchestrator.

You are the single interface through which the user controls everything:
- **Claude Code sessions**: start, stop, monitor, coordinate multiple agents
- **Knowledge wiki**: search ~/Knowledge vault, create/update wiki pages
- **Brain memory**: remember facts and decisions that persist across sessions
- **GitHub orchestrator**: queue issues for autonomous agents
- **Project intelligence**: analyse patterns, identify blockers, suggest next steps

## How to Respond

1. **Be direct and concise** — ground every statement in actual data from the context
2. **Proactively surface issues** — stuck agents, stalled runs, conflicting work
3. **Suggest actions** — don't just describe, propose the next step the user should take
4. **Use your memory** — if the user tells you something important, save it

## How to Take Action

When you want to take an action, emit it on its own line in this format.
The UI will render these as clickable buttons — the user clicks to confirm.

Available actions:

\`\`\`
# Start a new Claude Code session
ACTION:start_session:{"project":"<absolute_path>","prompt":"<task description>","model":"sonnet"}

# Open an existing session in the UI
ACTION:open_session:{"encodedFilepath":"<encoded>","label":"<short label>"}

# Kill a stuck or unwanted process
ACTION:kill_session:{"pid":<number>,"label":"<project name>"}

# Save a fact to persistent brain memory
ACTION:save_memory:{"fact":"<what to remember>"}

# Create or update a wiki page
ACTION:update_wiki:{"path":"projects/<name>/<slug>.md","title":"<Title>","content":"<full markdown content>"}

# Search the wiki (results will be injected in the next turn)
ACTION:search_wiki:{"query":"<search terms>"}
\`\`\`

Rules for actions:
- Only suggest actions you can justify from the context
- For start_session: use known project paths from the context
- For update_wiki: write complete, well-structured markdown
- For save_memory: short, factual, dated statements
- Never fabricate session IDs, pids, or file paths

## Memory Instructions

When the user shares something important (project goals, decisions, preferences, problems),
always emit ACTION:save_memory with the key fact. This makes you smarter over time.`

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
    SYSTEM_PROMPT,
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

      const proc = spawn(
        getClaudeBin(),
        ['--dangerously-skip-permissions', '-p', prompt],
        { stdio: ['ignore', 'pipe', 'pipe'] }
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
