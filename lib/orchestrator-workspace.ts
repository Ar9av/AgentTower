import { execFileSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import { getGitHubToken } from './integrations'
import type { RepoConfig } from './orchestrator-types'

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8', timeout: 60_000 }).trim()
}

export interface WorkspaceResult {
  dir: string
  branch: string
}

export function prepareWorkspace(
  repo: RepoConfig,
  workspaceRoot: string,
  issueNumber: number,
  attempt: number,
): WorkspaceResult {
  const repoSlug = repo.repo.replace('/', '-')
  const dir = path.join(workspaceRoot, repoSlug, `issue-${issueNumber}`)
  const branch = `agenttower/issue-${issueNumber}`

  fs.mkdirSync(path.dirname(dir), { recursive: true })

  // Fetch latest from remote
  try {
    git(['fetch', 'origin'], repo.localPath)
  } catch {
    // Non-fatal — continue with local state
  }

  const base = repo.baseBranch ?? 'main'

  if (fs.existsSync(dir)) {
    // Worktree exists (retry case) — reset to base branch tip
    try {
      git(['checkout', branch], dir)
      git(['reset', '--hard', `origin/${base}`], dir)
    } catch {
      // Worktree is in a bad state — remove and recreate
      try {
        git(['worktree', 'remove', '--force', dir], repo.localPath)
      } catch {}
      fs.rmSync(dir, { recursive: true, force: true })
      git(['worktree', 'add', '-B', branch, dir, `origin/${base}`], repo.localPath)
    }
  } else {
    // Fresh worktree — attempt==1 or first time
    git(['worktree', 'add', '-B', branch, dir, `origin/${base}`], repo.localPath)
  }

  return { dir, branch }
}

export function cleanupWorkspace(repo: RepoConfig, dir: string): void {
  try {
    git(['worktree', 'remove', '--force', dir], repo.localPath)
  } catch {}
  fs.rmSync(dir, { recursive: true, force: true })
}

export function hasChanges(dir: string): boolean {
  try {
    const status = git(['status', '--porcelain'], dir)
    if (status.length > 0) return true
    // Check if branch has commits ahead of remote
    const ahead = git(['rev-list', '--count', '@{u}..HEAD'], dir)
    return parseInt(ahead, 10) > 0
  } catch {
    return false
  }
}

export function diffStat(dir: string): string {
  try {
    return git(['diff', '--stat', 'HEAD'], dir)
  } catch {
    return ''
  }
}

export function commitAndPush(dir: string, branch: string, message: string, repo?: string): void {
  try {
    git(['add', '-A'], dir)
    git(['commit', '-m', message, '--allow-empty'], dir)
  } catch {}

  // Use token-authenticated HTTPS remote when available
  const token = getGitHubToken()
  if (token && repo) {
    const httpsRemote = `https://x-access-token:${token}@github.com/${repo}.git`
    git(['push', httpsRemote, `HEAD:refs/heads/${branch}`, '--force'], dir)
  } else {
    git(['push', 'origin', branch, '--force-with-lease'], dir)
  }
}

export function validateLocalPath(localPath: string): boolean {
  try {
    execFileSync('git', ['-C', localPath, 'rev-parse', '--git-dir'], { encoding: 'utf-8', timeout: 5_000 })
    return true
  } catch {
    return false
  }
}
