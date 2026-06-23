import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { spawnClaude } from '@/lib/spawn-claude'
import { spawnCodex } from '@/lib/spawn-codex'
import path from 'path'
import fs from 'fs'
import os from 'os'
import { execSync, type ChildProcess } from 'child_process'

function isGitRepo(dir: string): boolean {
  try {
    execSync(`git -C "${dir}" rev-parse --git-dir`, { stdio: 'ignore', timeout: 3000 })
    return true
  } catch {
    return false
  }
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

async function waitForBootstrap(proc: ChildProcess, timeoutMs = 1500): Promise<{ ok: true } | { ok: false; error: string }> {
  return await new Promise(resolve => {
    let settled = false
    let stderr = ''
    let stdout = ''

    const finish = (result: { ok: true } | { ok: false; error: string }) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      proc.removeListener('error', onError)
      proc.removeListener('close', onClose)
      proc.stderr?.removeListener('data', onStderr)
      proc.stdout?.removeListener('data', onStdout)
      resolve(result)
    }

    const onStderr = (chunk: Buffer | string) => {
      stderr = (stderr + chunk.toString()).slice(-12000)
    }
    const onStdout = (chunk: Buffer | string) => {
      stdout = (stdout + chunk.toString()).slice(-4000)
    }
    const onError = (err: Error) => {
      finish({ ok: false, error: err.message || 'Failed to start process' })
    }
    const onClose = (code: number | null) => {
      if (code === 0) {
        finish({ ok: true })
        return
      }
      const output = `${stderr}${stderr && stdout ? '\n' : ''}${stdout}`.trim()
      finish({ ok: false, error: output || `Process exited early with code ${code ?? 'unknown'}` })
    }

    const timer = setTimeout(() => finish({ ok: true }), timeoutMs)

    proc.stderr?.on('data', onStderr)
    proc.stdout?.on('data', onStdout)
    proc.once('error', onError)
    proc.once('close', onClose)
  })
}

export async function POST(req: NextRequest) {
  const authErr = await requireAuth(req)
  if (authErr) return authErr

  const { project_path, prompt, model, skip_permissions, use_worktree, mode } = await req.json().catch(() => ({}))
  if (!project_path || !prompt) {
    return NextResponse.json({ error: 'project_path and prompt required' }, { status: 400 })
  }

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

  let proc: ChildProcess
  if (mode === 'codex') {
    const args: string[] = ['exec']
    if (typeof model === 'string' && model.trim()) args.push('-m', model.trim())
    if (skip_permissions !== false) args.push('--dangerously-bypass-approvals-and-sandbox')
    if (!isGitRepo(cwd)) args.push('--skip-git-repo-check')
    args.push(prompt)
    proc = spawnCodex(args, { cwd, detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
  } else if (mode === 'auto') {
    const args: string[] = []
    if (skip_permissions !== false) args.push('--dangerously-skip-permissions')
    if (typeof model === 'string' && model.trim()) args.push('--model', model.trim())
    args.push('-p', prompt)
    proc = spawnClaude(args, { cwd, detached: true, stdio: ['ignore', 'ignore', 'pipe'] })

    let stderr = ''
    proc.stderr?.on('data', chunk => {
      stderr = (stderr + chunk.toString()).slice(-8000)
    })
    proc.on('close', code => {
      const limited = /rate.?limit|usage.?limit|credit balance|quota|overloaded|capacity|too many requests|429/i.test(stderr)
      if (!code || !limited) return
      const codexArgs = ['exec', '--dangerously-bypass-approvals-and-sandbox']
      if (!isGitRepo(cwd)) codexArgs.push('--skip-git-repo-check')
      codexArgs.push(prompt)
      const fallback = spawnCodex(codexArgs, { cwd, detached: true, stdio: 'ignore' })
      fallback.unref()
    })
  } else {
    const args: string[] = []
    if (skip_permissions !== false) args.push('--dangerously-skip-permissions')
    if (typeof model === 'string' && model.trim()) args.push('--model', model.trim())
    args.push('-p', prompt)
    proc = spawnClaude(args, { cwd, detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
  }

  const bootstrap = mode === 'claude' || mode === 'codex'
    ? await waitForBootstrap(proc)
    : { ok: true as const }

  if (!bootstrap.ok) {
    return NextResponse.json({ error: bootstrap.error }, { status: 500 })
  }

  proc.unref()

  return NextResponse.json({
    ok: true,
    pid: proc.pid,
    provider: mode === 'codex' ? 'codex' : mode === 'auto' ? 'auto' : 'claude',
    worktreePath,
    worktreeBranch,
  })
}
