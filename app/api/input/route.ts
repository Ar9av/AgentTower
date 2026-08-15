import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"
import { findSessionProjectCwd } from "@/lib/claude-fs"
import { findCodexSessionProjectCwd } from '@/lib/codex-fs'
import { spawnClaude } from "@/lib/spawn-claude"
import { spawnCodex } from '@/lib/spawn-codex'

export async function POST(req: NextRequest) {
  const authErr = await requireAuth(req)
  if (authErr) return authErr

  const { session_id, prompt, model, mode } = await req.json().catch(() => ({}))
  if (!session_id || !prompt) {
    return NextResponse.json({ error: "session_id and prompt required" }, { status: 400 })
  }

  const cwd = mode === 'codex'
    ? findCodexSessionProjectCwd(session_id)
    : findSessionProjectCwd(session_id)
  if (!cwd) {
    return NextResponse.json({ error: "session not found" }, { status: 404 })
  }

  // Watch the child briefly to catch start-up failures (bad model, expired
  // auth, missing binary) — without this the client just spins for 60s and
  // reports "no reply". The signal is the *exit code*, not the clock: a
  // non-zero exit inside the window is a failure, while a run that exits 0 or
  // is still going is fine. So the window only trades latency (the UI is
  // already optimistic by then), never correctness. Measured on a live box:
  // bad model exits 1 at ~3.8s, a successful turn takes ~5.4s and up.
  const STARTUP_WATCH_MS = 6_000

  let proc
  if (mode === 'codex') {
    const args = ['exec', 'resume']
    if (typeof model === 'string' && model.trim()) args.push('-m', model.trim())
    args.push('--dangerously-bypass-approvals-and-sandbox', session_id, prompt)
    proc = spawnCodex(args, { cwd, detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
  } else {
    const args = ["--dangerously-skip-permissions", "-r", session_id]
    if (typeof model === "string" && model.trim()) args.push("--model", model.trim())
    args.push("-p", prompt)
    proc = spawnClaude(args, { cwd, detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
  }

  // Claude reports the model error on stdout, not stderr — collect both.
  let output = ''
  const collect = (chunk: Buffer) => {
    if (output.length < 4_000) output += chunk.toString()
  }
  proc.stdout?.on('data', collect)
  proc.stderr?.on('data', collect)

  const failure = await new Promise<{ code: number | null; output: string } | null>(resolve => {
    const timer = setTimeout(() => {
      proc.removeListener('exit', onExit)
      proc.removeListener('error', onError)
      resolve(null)
    }, STARTUP_WATCH_MS)

    function onExit(code: number | null) {
      clearTimeout(timer)
      resolve(code === 0 ? null : { code, output })
    }
    function onError(err: Error) {
      clearTimeout(timer)
      resolve({ code: null, output: err.message })
    }
    proc.once('exit', onExit)
    proc.once('error', onError)
  })

  if (failure) {
    const detail = failure.output.trim().split('\n').slice(0, 4).join('\n')
    return NextResponse.json(
      { error: detail || `${mode === 'codex' ? 'codex' : 'claude'} exited immediately (code ${failure.code}).` },
      { status: 502 }
    )
  }

  // Still running — let it finish on its own. Drain the pipes so a full buffer
  // can never block the child, and detach.
  proc.stdout?.removeListener('data', collect)
  proc.stderr?.removeListener('data', collect)
  proc.stdout?.resume()
  proc.stderr?.resume()
  proc.on('error', () => { /* orphaned child; nothing to report */ })
  proc.unref()

  return NextResponse.json({ ok: true, cwd, pid: proc.pid })
}
