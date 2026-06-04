#!/usr/bin/env ts-node
/**
 * AgentTower Orchestrator Daemon
 * Polls GitHub Issues, dispatches Claude Code agents into isolated git worktrees,
 * tracks lifecycle, and moves labels through the state machine.
 *
 * Start: npm run orchestrator
 * Stop:  pkill -f "orchestrator-bot"
 */
import path from 'path'
import fs from 'fs'
import { spawn } from 'child_process'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const rootPath = path.resolve(__dirname, '../../')
process.chdir(rootPath)

import {
  loadOrchestratorConfig,
  loadActiveRuns,
  loadRunById,
  saveRunRecord,
  generateRunId,
} from '../../lib/orchestrator-config'
import { createTracker } from '../../lib/tracker/github'
import { prepareWorkspace, cleanupWorkspace, hasChanges, commitAndPush, diffStat } from '../../lib/orchestrator-workspace'
import { buildAgentPrompt } from '../../lib/orchestrator-prompt'
import { scanClaudeSessions, isProcessAlive } from '../../lib/process'
import { getClaudeDir } from '../../lib/claude-fs'
import { upsertSessionTags } from '../../lib/session-tags'
import { getClaudeBin } from '../../lib/spawn-claude'
import type { RunRecord, RepoConfig, IssueRecord } from '../../lib/orchestrator-types'

const STALL_THRESHOLD_MS = 30 * 60 * 1000  // 30 min of no JSONL activity
const BACKOFF_BASE_MS = 5 * 60 * 1000       // 5 min base for exponential backoff

function log(msg: string): void {
  const ts = new Date().toISOString()
  console.log(`[orchestrator ${ts}] ${msg}`)
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function getJsonlMtime(sessionId: string, claudeDir: string): number {
  try {
    const projectsDir = path.join(claudeDir, 'projects')
    for (const proj of fs.readdirSync(projectsDir)) {
      const f = path.join(projectsDir, proj, `${sessionId}.jsonl`)
      if (fs.existsSync(f)) return fs.statSync(f).mtimeMs
    }
  } catch {}
  return 0
}

function resolveSessionId(workspaceDir: string, claudeDir: string): string | null {
  const sessions = scanClaudeSessions(claudeDir)
  for (const [sessionId, proc] of Object.entries(sessions)) {
    if (proc.cwd === workspaceDir) return sessionId
  }
  return null
}

async function finalizeRun(run: RunRecord, repo: RepoConfig): Promise<void> {
  const tracker = createTracker(repo)

  if (!run.workspaceDir) {
    run.status = 'failed'
    run.error = 'No workspace dir recorded'
    run.finishedAt = new Date().toISOString()
    saveRunRecord(run)
    await tracker.moveIssue(run.issueNumber, 'rework')
    return
  }

  const changed = hasChanges(run.workspaceDir)

  if (changed && run.branch) {
    try {
      commitAndPush(
        run.workspaceDir,
        run.branch,
        `feat: resolve issue #${run.issueNumber} (agenttower run ${run.id})`,
        repo.repo,
      )
      const prBody = `Closes #${run.issueNumber}\n\nAutomated by AgentTower run \`${run.id}\`.`
      const pr = await tracker.createPr({
        branch: run.branch,
        title: `fix: ${run.issueTitle}`,
        body: prBody,
        base: repo.baseBranch,
      })
      run.prUrl = pr.url
      run.prNumber = pr.number
      run.status = 'pr-open'
      run.finishedAt = new Date().toISOString()
      saveRunRecord(run)
      await tracker.moveIssue(run.issueNumber, 'done')
      await tracker.comment(run.issueNumber, `✅ PR opened: ${pr.url}`)
      log(`run ${run.id}: PR created → ${pr.url}`)
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e)
      log(`run ${run.id}: PR creation failed — ${err}`)
      await handleFailure(run, repo, err)
    }
    return
  }

  // No changes — treat as failure
  const stat = run.workspaceDir ? diffStat(run.workspaceDir) : ''
  await handleFailure(run, repo, `Agent completed with no changes. Diff stat: ${stat || 'empty'}`)
}

async function handleFailure(run: RunRecord, repo: RepoConfig, error: string): Promise<void> {
  const tracker = createTracker(repo)
  run.error = error

  if (run.attempt < run.maxRetries) {
    const backoffMs = BACKOFF_BASE_MS * Math.pow(2, run.attempt - 1)
    run.attempt += 1
    run.status = 'retrying'
    run.nextRetryAt = new Date(Date.now() + backoffMs).toISOString()
    saveRunRecord(run)
    const mins = Math.round(backoffMs / 60_000)
    await tracker.comment(run.issueNumber, `⚠️ Run failed (attempt ${run.attempt - 1}/${run.maxRetries}). Retrying in ${mins}m.\n\nError: ${error}`)
    log(`run ${run.id}: retrying in ${mins}m (attempt ${run.attempt})`)
  } else {
    run.status = 'failed'
    run.finishedAt = new Date().toISOString()
    saveRunRecord(run)
    await tracker.moveIssue(run.issueNumber, 'rework')
    await tracker.comment(run.issueNumber, `❌ All ${run.maxRetries} attempts failed. Moved to rework.\n\nLast error: ${error}`)
    log(`run ${run.id}: permanently failed after ${run.maxRetries} attempts`)
    // Clean up workspace on permanent failure
    if (run.workspaceDir) {
      try { cleanupWorkspace(repo, run.workspaceDir) } catch {}
    }
  }
}

async function dispatchRun(run: RunRecord, repo: RepoConfig, issue: IssueRecord): Promise<void> {
  const cfg = loadOrchestratorConfig()
  const tracker = createTracker(repo)

  run.status = 'dispatching'
  saveRunRecord(run)

  let workspaceDir: string
  let branch: string

  try {
    const ws = prepareWorkspace(repo, cfg.workspaceRoot, run.issueNumber, run.attempt)
    workspaceDir = ws.dir
    branch = ws.branch
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e)
    log(`run ${run.id}: workspace prep failed — ${err}`)
    await handleFailure(run, repo, `Workspace preparation failed: ${err}`)
    return
  }

  run.workspaceDir = workspaceDir
  run.branch = branch
  saveRunRecord(run)

  const prompt = buildAgentPrompt(repo, issue, run)
  const args: string[] = ['--dangerously-skip-permissions']
  if (repo.model) args.push('--model', repo.model)
  if (repo.maxTurns) args.push('--max-turns', String(repo.maxTurns))
  args.push('-p', prompt)

  const proc = spawn(getClaudeBin(), args, {
    cwd: workspaceDir,
    detached: true,
    stdio: 'ignore',
  })
  proc.unref()

  run.pid = proc.pid
  run.startedAt = new Date().toISOString()
  run.status = 'running'
  saveRunRecord(run)

  log(`run ${run.id}: dispatched pid=${proc.pid} → ${workspaceDir}`)

  await tracker.moveIssue(run.issueNumber, 'in-progress')
  await tracker.comment(run.issueNumber, `🤖 Agent dispatched (attempt ${run.attempt}/${run.maxRetries}). Branch: \`${branch}\`. Run: \`${run.id}\``)

  // Resolve sessionId asynchronously after a short delay
  await sleep(3000)
  const claudeDir = getClaudeDir()
  const sessionId = resolveSessionId(workspaceDir, claudeDir)
  if (sessionId) {
    run.sessionId = sessionId
    saveRunRecord(run)
    upsertSessionTags(sessionId, {
      tags: [`issue:${repo.repo}#${run.issueNumber}`, 'orchestrator'],
      note: run.issueTitle,
    })
    log(`run ${run.id}: resolved sessionId=${sessionId}`)
  }
}

async function reconcile(): Promise<void> {
  const cfg = loadOrchestratorConfig()
  const claudeDir = getClaudeDir()
  const active = loadActiveRuns()

  for (const run of active) {
    if (run.status !== 'running' && run.status !== 'dispatching') continue

    const repo = cfg.repos.find(r => r.id === run.repoId)
    if (!repo) continue

    // Try to resolve sessionId if missing
    if (!run.sessionId && run.workspaceDir) {
      const sessionId = resolveSessionId(run.workspaceDir, claudeDir)
      if (sessionId) {
        run.sessionId = sessionId
        saveRunRecord(run)
        upsertSessionTags(sessionId, {
          tags: [`issue:${repo.repo}#${run.issueNumber}`, 'orchestrator'],
          note: run.issueTitle,
        })
      }
    }

    if (run.pid && isProcessAlive(run.pid)) {
      // Update lastActivityAt from JSONL mtime
      if (run.sessionId) {
        const mtime = getJsonlMtime(run.sessionId, claudeDir)
        if (mtime > 0) {
          run.lastActivityAt = new Date(mtime).toISOString()
          saveRunRecord(run)
        }
        // Stall detection
        if (run.lastActivityAt) {
          const stalled = Date.now() - new Date(run.lastActivityAt).getTime()
          if (stalled > STALL_THRESHOLD_MS) {
            log(`run ${run.id}: stalled (${Math.round(stalled / 60_000)}m inactive) — killing`)
            try { process.kill(run.pid, 'SIGTERM') } catch {}
            // Will be finalized on next cycle
          }
        }
      }
    } else {
      // Process is gone — finalize
      log(`run ${run.id}: process dead, finalizing`)
      await finalizeRun(run, repo)
    }
  }
}

async function poll(): Promise<void> {
  const cfg = loadOrchestratorConfig()
  if (!cfg.enabled) return

  for (const repo of cfg.repos.filter(r => r.enabled)) {
    let issues: IssueRecord[]
    try {
      const tracker = createTracker(repo)
      issues = await tracker.listIssues()
    } catch (e) {
      log(`poll: failed to list issues for ${repo.id}: ${e instanceof Error ? e.message : e}`)
      continue
    }

    const active = loadActiveRuns()
    const activeByIssue = new Map(active.map(r => [`${r.repoId}:${r.issueNumber}`, r]))

    const todoIssues = issues.filter(i => i.state === 'todo')

    for (const issue of todoIssues) {
      const key = `${repo.id}:${issue.number}`
      if (activeByIssue.has(key)) continue  // already has an active run

      if (repo.autonomy === 'approval') {
        // Ensure an awaiting-approval record exists (so the UI surfaces it)
        const existingRun = loadRunById(`await-${repo.id}-${issue.number}`)
        if (!existingRun) {
          const run: RunRecord = {
            id: `await-${repo.id}-${issue.number}`,
            repoId: repo.id,
            issueNumber: issue.number,
            issueTitle: issue.title,
            status: 'awaiting-approval',
            attempt: 1,
            maxRetries: repo.maxRetries,
            createdAt: new Date().toISOString(),
          }
          saveRunRecord(run)
        }
      } else {
        // Auto-dispatch: enqueue if no run exists
        const run: RunRecord = {
          id: generateRunId(),
          repoId: repo.id,
          issueNumber: issue.number,
          issueTitle: issue.title,
          status: 'queued',
          attempt: 1,
          maxRetries: repo.maxRetries,
          createdAt: new Date().toISOString(),
        }
        saveRunRecord(run)
      }
    }
  }

  // Dispatch queued runs up to concurrency caps
  const cfg2 = loadOrchestratorConfig()  // re-read after saves
  const active = loadActiveRuns()
  const running = active.filter(r => ['dispatching', 'running'].includes(r.status))
  const globalActive = running.length

  const queued = active
    .filter(r => r.status === 'queued')
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))

  for (const run of queued) {
    if (globalActive >= cfg2.globalMaxConcurrent) break

    const repo = cfg2.repos.find(r => r.id === run.repoId)
    if (!repo) continue

    const repoActive = running.filter(r => r.repoId === repo.id).length
    if (repoActive >= repo.maxConcurrentAgents) continue

    const tracker = createTracker(repo)
    const issue = await tracker.getIssue(run.issueNumber)
    if (!issue) {
      run.status = 'cancelled'
      run.error = 'Issue not found'
      saveRunRecord(run)
      continue
    }

    await dispatchRun(run, repo, issue)
  }

  // Process retries whose backoff has elapsed
  const retrying = active.filter(r => r.status === 'retrying' && r.nextRetryAt && new Date(r.nextRetryAt) <= new Date())
  for (const run of retrying) {
    run.status = 'queued'
    saveRunRecord(run)
    log(`run ${run.id}: retry backoff elapsed, re-queued`)
  }
}

async function main(): Promise<void> {
  log('AgentTower Orchestrator starting…')

  // Startup reconcile
  await reconcile()

  while (true) {
    const cfg = loadOrchestratorConfig()
    const interval = (cfg.pollIntervalSec ?? 60) * 1000

    try {
      await reconcile()
      await poll()
    } catch (e) {
      log(`Unhandled error in main loop: ${e instanceof Error ? e.message : e}`)
    }

    await sleep(interval)
  }
}

main().catch(e => {
  console.error('Orchestrator fatal:', e)
  process.exit(1)
})
