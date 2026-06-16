import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { spawnClaude } from "@/lib/spawn-claude"
import { spawnCodex } from '@/lib/spawn-codex'
import path from 'path'
import fs from 'fs'
import os from 'os'
import { execSync } from 'child_process'

function isGitRepo(dir: string): boolean {
  try {
    execSync(`git -C "${dir}" rev-parse --git-dir`, { stdio: 'ignore', timeout: 3000 })
    return true
  } catch { return false }
}

function createWorktree(projectPath: string): { worktreePath: string; branch: string } {
  const ts = Date.now()
  const basename = path.basename(projectPath).replace(/[^a-z0-9-]/gi, '-')
  const worktreeDir = path.join(os.homedir(), '.claude', 'worktrees')
  fs.mkdirSync(worktreeDir, { recursive: true })
  const worktreePath = path.join(worktreeDir, `${basename}-${ts}`)
  const branch = `agenttower-wt-${ts}`
  execSync(`git -C "${projectPath}" worktree add -b "${branch}" "${worktreePath}" HEAD`, { timeout: 10000 })
  return { worktreePath, branch }
}

export async function POST(req: NextRequest) {
  const authErr = await requireAuth(req)
  if (authErr) return authErr

  const { project_path, prompt, model, skip_permissions, use_worktree, mode } = await req.json().catch(() => ({}))
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

  let cwd = project_path
  let worktreePath: string | null = null
  let worktreeBranch: string | null = null

  if (mode !== 'codex' && use_worktree && isGitRepo(project_path)) {
    try {
      const wt = createWorktree(project_path)
      cwd = wt.worktreePath
      worktreePath = wt.worktreePath
      worktreeBranch = wt.branch
    } catch (err) {
      return NextResponse.json({ error: `Failed to create worktree: ${(err as Error).message}` }, { status: 500 })
    }
  }

  let proc
  if (mode === 'codex') {
    const args: string[] = ['exec']
    if (typeof model === 'string' && model.trim()) args.push('-m', model.trim())
    if (skip_permissions !== false) args.push('--dangerously-bypass-approvals-and-sandbox')
    if (!isGitRepo(cwd)) args.push('--skip-git-repo-check')
    args.push(prompt)
    proc = spawnCodex(args, { cwd, detached: true, stdio: 'ignore' })
  } else {
    const args: string[] = []
    if (skip_permissions !== false) args.push('--dangerously-skip-permissions')
    if (typeof model === 'string' && model.trim()) args.push('--model', model.trim())
    args.push('-p', prompt)
    proc = spawnClaude(args, { cwd, detached: true, stdio: 'ignore' })
  }
  proc.unref()

  return NextResponse.json({ ok: true, pid: proc.pid, worktreePath, worktreeBranch })
}
