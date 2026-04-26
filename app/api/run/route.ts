import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { spawnClaude } from "@/lib/spawn-claude"
import path from 'path'
import fs from 'fs'

export async function POST(req: NextRequest) {
  const authErr = await requireAuth(req)
  if (authErr) return authErr

  const { project_path, prompt, model } = await req.json().catch(() => ({}))
  if (!project_path || !prompt) {
    return NextResponse.json({ error: 'project_path and prompt required' }, { status: 400 })
  }

  // Validate that project_path exists and is a directory
  try {
    const stat = fs.statSync(project_path)
    if (!stat.isDirectory()) throw new Error('not a directory')
  } catch {
    return NextResponse.json({ error: 'Invalid project path' }, { status: 400 })
  }

  const args = ['--dangerously-skip-permissions']
  if (typeof model === 'string' && model.trim()) args.push('--model', model.trim())
  args.push('-p', prompt)

  const proc = spawnClaude(args, {
    cwd: project_path,
    detached: true,
    stdio: 'ignore',
  })
  proc.unref()

  return NextResponse.json({ ok: true, pid: proc.pid })
}
