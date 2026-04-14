import { NextRequest } from 'next/server'
import fs from 'fs'
import { validateSession } from '@/lib/auth'
import { decodeB64, safePath, getClaudeDir, parseJsonlFile } from '@/lib/claude-fs'

const HEARTBEAT_INTERVAL = 15_000
const POLL_INTERVAL = 1_000   // reduced to 1s for snappier live updates
const CATCHUP_COUNT = 30

export async function GET(req: NextRequest) {
  const token = req.cookies.get('clv_session')?.value
  if (!validateSession(token)) {
    return new Response('Unauthorized', { status: 401 })
  }

  const encoded = req.nextUrl.searchParams.get('f') ?? ''
  const filepath = decodeB64(encoded)
  if (!safePath(filepath, getClaudeDir())) {
    return new Response('Forbidden', { status: 403 })
  }

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    start(controller) {
      function send(payload: string) {
        try { controller.enqueue(encoder.encode(payload)); return true }
        catch { return false }
      }

      // ── Read offset BEFORE parsing to avoid race condition ────────────────
      // If we read offset AFTER parsing, any messages written between the two
      // reads would be skipped forever (counted in offset but not in messageCount).
      let offset = 0
      try { offset = fs.statSync(filepath).size } catch { /* file may not exist yet */ }

      // ── Send catchup ──────────────────────────────────────────────────────
      const initial = parseJsonlFile(filepath)
      const catchup = initial.filter(m => !m.isMeta).slice(-CATCHUP_COUNT)
      for (const msg of catchup) {
        send(`data: ${JSON.stringify({ type: 'catchup', message: msg })}\n\n`)
      }

      // messageCount tracks how many non-meta messages we've delivered total
      let messageCount = initial.filter(m => !m.isMeta).length
      let lastMtime    = 0
      try { lastMtime = fs.statSync(filepath).mtimeMs } catch { /* ignore */ }
      let lastHeartbeat = Date.now()
      let aborted = false

      req.signal.addEventListener('abort', () => { aborted = true })

      async function poll() {
        while (!aborted) {
          await new Promise(r => setTimeout(r, POLL_INTERVAL))
          if (aborted) break

          // Heartbeat
          const now = Date.now()
          if (now - lastHeartbeat >= HEARTBEAT_INTERVAL) {
            if (!send(': heartbeat\n\n')) break
            lastHeartbeat = now
          }

          // Check if file changed
          let newMtime = 0
          let newSize  = 0
          try {
            const stat = fs.statSync(filepath)
            newMtime = stat.mtimeMs
            newSize  = stat.size
          } catch { continue }

          if (newMtime === lastMtime && newSize === offset) continue

          // File changed — re-parse and send only new messages
          // Re-parse always uses the freshest file (cache is mtime-keyed, so it re-parses on change)
          const all = parseJsonlFile(filepath).filter(m => !m.isMeta)
          const newMsgs = all.slice(messageCount)

          if (newMsgs.length > 0) {
            for (const msg of newMsgs) {
              if (!send(`data: ${JSON.stringify({ type: 'message', message: msg })}\n\n`)) {
                aborted = true; break
              }
            }
            messageCount = all.length
          }

          lastMtime = newMtime
          offset    = newSize
        }
        try { controller.close() } catch { /* already closed */ }
      }

      poll()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
