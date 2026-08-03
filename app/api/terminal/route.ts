import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { loadSettings } from '@/lib/settings'
import { createSession, killSession, listSessions, subscribe, writeInput } from '@/lib/terminal'

function requireEnabled(): NextResponse | null {
  if (!loadSettings().terminalEnabled) {
    return NextResponse.json({ error: 'Terminal is disabled. Enable it in Settings first.' }, { status: 403 })
  }
  return null
}

// GET — list sessions, or stream one session's output as SSE with ?sid=
export async function GET(req: NextRequest) {
  const authErr = await requireAuth(req)
  if (authErr) return authErr
  const disabledErr = requireEnabled()
  if (disabledErr) return disabledErr

  const sid = req.nextUrl.searchParams.get('sid')
  if (!sid) {
    return NextResponse.json({ sessions: listSessions() })
  }

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    start(controller) {
      function send(payload: string) {
        try { controller.enqueue(encoder.encode(payload)); return true }
        catch { return false }
      }

      const sub = subscribe(sid, chunk => {
        send(`data: ${JSON.stringify({ type: 'output', chunk })}\n\n`)
      })

      if (!sub) {
        send(`data: ${JSON.stringify({ type: 'error', message: 'Session not found' })}\n\n`)
        controller.close()
        return
      }

      if (sub.catchup) {
        send(`data: ${JSON.stringify({ type: 'output', chunk: sub.catchup })}\n\n`)
      }

      const heartbeat = setInterval(() => { if (!send(': heartbeat\n\n')) cleanup() }, 15_000)

      function cleanup() {
        clearInterval(heartbeat)
        sub!.unsubscribe()
        try { controller.close() } catch { /* already closed */ }
      }

      req.signal.addEventListener('abort', cleanup)
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

// POST — create a session ({}) or send input ({ sid, input })
export async function POST(req: NextRequest) {
  const authErr = await requireAuth(req)
  if (authErr) return authErr
  const disabledErr = requireEnabled()
  if (disabledErr) return disabledErr

  const body = await req.json().catch(() => ({} as Record<string, unknown>))
  const { sid, input, cwd } = body as { sid?: string; input?: string; cwd?: string }

  if (!sid) {
    try {
      const session = createSession(typeof cwd === 'string' ? cwd : undefined)
      return NextResponse.json(session)
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to start terminal' }, { status: 500 })
    }
  }

  if (typeof input !== 'string') {
    return NextResponse.json({ error: 'input required' }, { status: 400 })
  }

  const ok = writeInput(sid, input)
  if (!ok) return NextResponse.json({ error: 'Session not found or exited' }, { status: 404 })
  return NextResponse.json({ ok: true })
}

// DELETE — kill a session (?sid=)
export async function DELETE(req: NextRequest) {
  const authErr = await requireAuth(req)
  if (authErr) return authErr
  const disabledErr = requireEnabled()
  if (disabledErr) return disabledErr

  const sid = req.nextUrl.searchParams.get('sid')
  if (!sid) return NextResponse.json({ error: 'sid required' }, { status: 400 })
  const ok = killSession(sid)
  return NextResponse.json({ ok })
}
