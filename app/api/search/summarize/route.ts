import { NextRequest } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { spawnClaude } from '@/lib/spawn-claude'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const authErr = await requireAuth(req)
  if (authErr) return authErr

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

  // Group hits by session, cap at 20 sessions × 3 snippets
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

  const prompt = `You are helping a developer navigate their Claude Code session archive.

They searched for: "${query}"

Here are the matching snippets grouped by session (up to 20 sessions, 3 snippets each):

${sessionBlocks}

Based on these results:
1. **What were they working on?** Infer the likely task, problem, or topic.
2. **Key themes** — bullet the 2–4 most important patterns or recurring ideas.
3. **Suggested next steps** — give 2–3 concrete things they could do now (e.g. open a specific session, refine the search, look at a related concept).

Be specific and direct. Reference actual content from the snippets where helpful. Use plain markdown.`

  const readable = new ReadableStream({
    start(controller) {
      const proc = spawnClaude(['-p', prompt], { stdio: ['ignore', 'pipe', 'ignore'] })

      proc.stdout!.on('data', (chunk: Buffer) => {
        controller.enqueue(chunk)
      })

      proc.on('close', () => {
        controller.close()
      })

      proc.on('error', (err: Error) => {
        controller.error(err)
      })
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
