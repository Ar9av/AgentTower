import fs from 'fs'
import { execFileSync, spawnSync } from 'child_process'
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'

function runGit(projectPath: string, args: string[]): string {
  return execFileSync('git', ['-C', projectPath, ...args], {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

function inspectGit(projectPath: string) {
  try {
    runGit(projectPath, ['rev-parse', '--show-toplevel'])
  } catch {
    return {
      isGitRepo: false,
      dirty: false,
      branch: null,
      upstream: null,
      ahead: 0,
      behind: 0,
      changed: 0,
      untracked: 0,
      conflicted: 0,
      summary: 'Not a git repository',
    }
  }

  const raw = runGit(projectPath, ['status', '--short', '--branch'])
  const lines = raw ? raw.split('\n') : []
  const header = lines[0] ?? ''
  const entries = lines.slice(1).filter(Boolean)

  let branch: string | null = null
  let upstream: string | null = null
  let ahead = 0
  let behind = 0

  const match = header.match(/^##\s+([^\.]+)(?:\.\.\.([^\s]+))?(?:\s+\[(.+)\])?/)
  if (match) {
    branch = match[1] ?? null
    upstream = match[2] ?? null
    const detail = match[3] ?? ''
    const aheadMatch = detail.match(/ahead\s+(\d+)/)
    const behindMatch = detail.match(/behind\s+(\d+)/)
    ahead = aheadMatch ? parseInt(aheadMatch[1], 10) : 0
    behind = behindMatch ? parseInt(behindMatch[1], 10) : 0
  }

  let changed = 0
  let untracked = 0
  let conflicted = 0

  for (const line of entries) {
    const code = line.slice(0, 2)
    if (code === '??') {
      untracked++
      continue
    }
    if (code.includes('U') || code === 'AA' || code === 'DD') conflicted++
    changed++
  }

  const dirty = entries.length > 0
  const parts: string[] = []
  parts.push(branch ? `On ${branch}` : 'Git repository')
  if (dirty) {
    const detail: string[] = []
    if (changed) detail.push(`${changed} changed`)
    if (untracked) detail.push(`${untracked} untracked`)
    if (conflicted) detail.push(`${conflicted} conflicted`)
    parts.push(`dirty: ${detail.join(', ')}`)
  } else {
    parts.push('clean working tree')
  }
  if (ahead || behind) {
    const remoteBits: string[] = []
    if (ahead) remoteBits.push(`ahead ${ahead}`)
    if (behind) remoteBits.push(`behind ${behind}`)
    parts.push(remoteBits.join(', '))
  }

  return {
    isGitRepo: true,
    dirty,
    branch,
    upstream,
    ahead,
    behind,
    changed,
    untracked,
    conflicted,
    summary: parts.join(' · '),
  }
}

function ensureProjectDir(projectPath: string): string | null {
  try {
    const stat = fs.statSync(projectPath)
    if (!stat.isDirectory()) throw new Error('not a directory')
    return null
  } catch {
    return 'Invalid project path'
  }
}

export async function GET(req: NextRequest) {
  const authErr = await requireAuth(req)
  if (authErr) return authErr

  const projectPath = (req.nextUrl.searchParams.get('project_path') ?? '').trim()
  if (!projectPath) {
    return NextResponse.json({ error: 'project_path required' }, { status: 400 })
  }

  const dirError = ensureProjectDir(projectPath)
  if (dirError) return NextResponse.json({ error: dirError }, { status: 400 })

  return NextResponse.json(inspectGit(projectPath))
}

export async function POST(req: NextRequest) {
  const authErr = await requireAuth(req)
  if (authErr) return authErr

  const { project_path, action } = await req.json().catch(() => ({}))
  const projectPath = typeof project_path === 'string' ? project_path.trim() : ''
  if (!projectPath || !action) {
    return NextResponse.json({ error: 'project_path and action required' }, { status: 400 })
  }

  const dirError = ensureProjectDir(projectPath)
  if (dirError) return NextResponse.json({ error: dirError }, { status: 400 })

  const before = inspectGit(projectPath)
  if (!before.isGitRepo) {
    return NextResponse.json({ error: 'This project is not a git repository' }, { status: 400 })
  }

  if (action !== 'stash-and-pull') {
    return NextResponse.json({ error: 'Unsupported action' }, { status: 400 })
  }

  const stashLabel = `agenttower pre-pull ${new Date().toISOString()}`
  const stashBefore = runGit(projectPath, ['stash', 'list'])
  const stashRun = spawnSync('git', ['-C', projectPath, 'stash', 'push', '-u', '-m', stashLabel], {
    encoding: 'utf-8',
    timeout: 30000,
  })
  if (stashRun.status !== 0) {
    const reason = `${stashRun.stderr || stashRun.stdout || 'git stash failed'}`.trim()
    return NextResponse.json({ error: reason }, { status: 500 })
  }

  const stashAfter = runGit(projectPath, ['stash', 'list'])
  const stashCreated = stashAfter !== stashBefore
  const stashRef = stashCreated ? (stashAfter.split('\n')[0]?.split(':')[0] ?? null) : null

  const pullRun = spawnSync('git', ['-C', projectPath, 'pull'], {
    encoding: 'utf-8',
    timeout: 60000,
  })
  const after = inspectGit(projectPath)
  const pullOutput = `${pullRun.stdout || ''}${pullRun.stderr || ''}`.trim()

  if (pullRun.status !== 0) {
    return NextResponse.json({
      ok: false,
      action,
      stashCreated,
      stashRef,
      pullOutput,
      status: after,
      error: 'git pull failed',
    }, { status: 409 })
  }

  return NextResponse.json({
    ok: true,
    action,
    stashCreated,
    stashRef,
    pullOutput,
    status: after,
  })
}
