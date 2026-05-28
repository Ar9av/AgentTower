import { NextRequest } from 'next/server'
import { requireAuth } from '@/lib/auth'
import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export async function POST(req: NextRequest) {
  const authErr = await requireAuth(req)
  if (authErr) return authErr

  if (!process.env.ANTHROPIC_API_KEY) {
    return new Response(JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const { query, results } = await req.json() as {
    query: string
    results: Array<{ sessionId: string; decodedProjectPath: string; context: string; lineNo: number; mtime: number }>
  }

  if (!query || !Array.isArray(results) || results.length === 0) {
    return new Response(JSON.stringify({ error: 'Missing query or results' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // Group hits by session and cap at 60 snippets to keep the prompt lean
  const bySession = new Map<string, typeof results>()
  for (const r of results) {
    const arr = bySession.get(r.sessionId) ?? []
    arr.push(r)
    bySession.set(r.sessionId, arr)
  }

  const sessionBlocks = [...bySession.entries()].slice(0, 20).map(([sid, hits]) => {
    const project = hits[0].decodedProjectPath.split('/').pop() ?? hits[0].decodedProjectPath
    const date = new Date(hits[0].mtime).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
    const snippets = hits.slice(0, 3).map(h => `  [L${h.lineNo}] ${h.context.replace(/\s+/g, ' ').trim()}`).join('\n')
    return `Session ${sid.slice(0, 8)} — ${project} (${date}):\n${snippets}`
  }).join('\n\n')

  const prompt = `The user searched their Claude Code session archive for: "${query}"

Here are the matching snippets, grouped by session (up to 20 sessions, 3 snippets each):

${sessionBlocks}

Based on these results:
1. **What were they working on?** Infer the likely task, problem, or topic from the snippets.
2. **Key themes** — bullet the 2–4 most important patterns or recurring ideas across the sessions.
3. **Suggested next steps** — give 2–3 concrete things they could do now (e.g. open a specific session, refine the search with a new term, or look at a related concept).

Be specific and direct. Reference actual content from the snippets where it helps.`

  const stream = await client.messages.stream({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    system: 'You are a concise assistant helping a developer navigate their Claude Code session archive. Answer in plain markdown with short, scannable sections.',
    messages: [{ role: 'user', content: prompt }],
  })

  const encoder = new TextEncoder()
  const readable = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of stream) {
          if (
            chunk.type === 'content_block_delta' &&
            chunk.delta.type === 'text_delta'
          ) {
            controller.enqueue(encoder.encode(chunk.delta.text))
          }
        }
      } catch (err) {
        controller.error(err)
      } finally {
        controller.close()
      }
    },
  })

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Transfer-Encoding': 'chunked',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
