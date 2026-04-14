import { NextRequest } from 'next/server'
import { validateSession } from '@/lib/auth'
import { decodeB64, safePath, getClaudeDir, parseJsonlFile, readNewLines } from '@/lib/claude-fs'

const HEARTBEAT_INTERVAL = 15_000
const POLL_INTERVAL = 1_500
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
      // Send catchup: last CATCHUP_COUNT non-meta messages
      const messages = parseJsonlFile(filepath)
      const catchup = messages.filter(m => !m.isMeta).slice(-CATCHUP_COUNT)
      for (const msg of catchup) {
        const data = JSON.stringify({ type: 'catchup', message: msg })
        controller.enqueue(encoder.encode(`data: ${data}\n\n`))
      }

      // Track file offset and known message count
      let offset = 0
      try {
        const fs = require('fs') as typeof import('fs')
        offset = fs.statSync(filepath).size
      } catch {
        // file might not exist yet
      }

      const tailState = { offset, messageCount: messages.length }
      let lastHeartbeat = Date.now()
      let aborted = false

      req.signal.addEventListener('abort', () => {
        aborted = true
      })

      async function poll() {
        while (!aborted) {
          await new Promise(r => setTimeout(r, POLL_INTERVAL))
          if (aborted) break

          // Heartbeat
          const now = Date.now()
          if (now - lastHeartbeat >= HEARTBEAT_INTERVAL) {
            try {
              controller.enqueue(encoder.encode(': heartbeat\n\n'))
              lastHeartbeat = now
            } catch {
              break
            }
          }

          // Read new bytes
          const { lines, newOffset } = readNewLines(filepath, tailState)
          if (newOffset !== tailState.offset) {
            tailState.offset = newOffset
            for (const line of lines) {
              if (!line.trim()) continue
              try {
                const obj = JSON.parse(line)
                if (obj.type !== 'user' && obj.type !== 'assistant') continue
                if (!obj.message || !obj.uuid) continue
                // Re-parse through our parser for consistency
                const allMessages = parseJsonlFile(filepath)
                const newMessages = allMessages.filter(m => !m.isMeta).slice(tailState.messageCount)
                if (newMessages.length > 0) {
                  tailState.messageCount += newMessages.length
                  for (const msg of newMessages) {
                    const data = JSON.stringify({ type: 'message', message: msg })
                    try {
                      controller.enqueue(encoder.encode(`data: ${data}\n\n`))
                    } catch {
                      aborted = true
                      break
                    }
                  }
                }
                break // only need to trigger once per poll
              } catch {
                continue
              }
            }
          }
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
