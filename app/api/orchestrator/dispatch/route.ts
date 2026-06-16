import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import {
  loadOrchestratorConfig,
  loadActiveRuns,
  saveRunRecord,
  generateRunId,
} from '@/lib/orchestrator-config'
import { getDaemonStatus, startDaemon } from '@/lib/orchestrator-daemon'
import type { RunRecord } from '@/lib/orchestrator-types'

// POST /api/orchestrator/dispatch — approval-gated manual dispatch
// Enqueues a RunRecord; the daemon picks it up and owns spawning.
export async function POST(req: NextRequest) {
  const authErr = await requireAuth(req)
  if (authErr) return authErr

  let body: { repoId?: string; issueNumber?: number; issueTitle?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Bad JSON' }, { status: 400 }) }

  const { repoId, issueNumber, issueTitle } = body
  if (!repoId || !issueNumber) {
    return NextResponse.json({ error: 'repoId and issueNumber required' }, { status: 400 })
  }

  const cfg = loadOrchestratorConfig()
  if (!cfg.enabled) {
    return NextResponse.json(
      { error: 'Orchestrator is disabled. Enable it in Config before dispatching issues.' },
      { status: 409 },
    )
  }

  const repo = cfg.repos.find(r => r.id === repoId)
  if (!repo) return NextResponse.json({ error: `Repo ${repoId} not found` }, { status: 404 })
  if (!repo.enabled) {
    return NextResponse.json({ error: `Repo ${repo.repo} is disabled in orchestrator config.` }, { status: 409 })
  }

  // Guard: don't create a duplicate active run for the same issue
  const active = loadActiveRuns()
  const existing = active.find(r => r.repoId === repoId && r.issueNumber === issueNumber)
  if (existing) {
    return NextResponse.json({ ok: true, id: existing.id, note: 'already active' })
  }

  const daemon = getDaemonStatus()
  if (!daemon.running) {
    const started = startDaemon()
    if (!started.ok) {
      return NextResponse.json(
        { error: `Orchestrator daemon is not running and could not be started: ${started.error}` },
        { status: 500 },
      )
    }
  }

  const run: RunRecord = {
    id: generateRunId(),
    repoId,
    issueNumber,
    issueTitle: issueTitle ?? `Issue #${issueNumber}`,
    status: 'queued',
    attempt: 1,
    maxRetries: repo.maxRetries,
    createdAt: new Date().toISOString(),
  }

  saveRunRecord(run)
  return NextResponse.json({ ok: true, id: run.id })
}
