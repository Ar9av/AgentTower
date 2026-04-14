import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"
import { spawn } from "child_process"
import { findSessionProjectCwd } from "@/lib/claude-fs"

export async function POST(req: NextRequest) {
  const authErr = await requireAuth(req)
  if (authErr) return authErr

  const { session_id, prompt } = await req.json().catch(() => ({}))
  if (!session_id || !prompt) {
    return NextResponse.json({ error: "session_id and prompt required" }, { status: 400 })
  }

  const cwd = findSessionProjectCwd(session_id)
  if (!cwd) {
    return NextResponse.json({ error: "session not found" }, { status: 404 })
  }

  const proc = spawn("claude", ["--dangerously-skip-permissions", "-r", session_id, "-p", prompt], {
    cwd,
    detached: true,
    stdio: "ignore",
  })
  proc.unref()

  return NextResponse.json({ ok: true, cwd, pid: proc.pid })
}
