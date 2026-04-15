import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"
import { findSessionProjectCwd } from "@/lib/claude-fs"
import { spawnClaude } from "@/lib/spawn-claude"

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

  const proc = spawnClaude(
    ["--dangerously-skip-permissions", "-r", session_id, "-p", prompt],
    { cwd, detached: true, stdio: "ignore" }
  )
  proc.unref()

  return NextResponse.json({ ok: true, cwd, pid: proc.pid })
}
