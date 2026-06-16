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

  let proc
  if (mode === 'codex') {
    const args = ['exec', 'resume']
    if (typeof model === 'string' && model.trim()) args.push('-m', model.trim())
    args.push('--dangerously-bypass-approvals-and-sandbox', session_id, prompt)
    proc = spawnCodex(args, { cwd, detached: true, stdio: 'ignore' })
  } else {
    const args = ["--dangerously-skip-permissions", "-r", session_id]
    if (typeof model === "string" && model.trim()) args.push("--model", model.trim())
    args.push("-p", prompt)
    proc = spawnClaude(args, { cwd, detached: true, stdio: "ignore" })
  }
  proc.unref()

  return NextResponse.json({ ok: true, cwd, pid: proc.pid })
}
