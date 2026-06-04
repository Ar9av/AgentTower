import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { loadOrchestratorConfig } from '@/lib/orchestrator-config'
import { loadActiveRuns } from '@/lib/orchestrator-config'
import { createTracker } from '@/lib/tracker/github'
import type { IssueRecord } from '@/lib/orchestrator-types'

// Simple in-memory cache keyed by repoId
const cache = new Map<string, { data: IssueRecord[]; ts: number }>()
const CACHE_TTL_MS = 10_000

export async function GET(req: NextRequest) {
  const authErr = await requireAuth(req)
  if (authErr) return authErr

  const url = new URL(req.url)
  const repoId = url.searchParams.get('repoId')

  const cfg = loadOrchestratorConfig()
  const repos = repoId ? cfg.repos.filter(r => r.id === repoId) : cfg.repos.filter(r => r.enabled)

  const activeRuns = loadActiveRuns()
  const runByIssue = new Map<string, string>()
  for (const run of activeRuns) {
    runByIssue.set(`${run.repoId}:${run.issueNumber}`, run.id)
  }

  const allIssues: IssueRecord[] = []
  for (const repo of repos) {
    const cached = cache.get(repo.id)
    if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
      allIssues.push(...cached.data)
      continue
    }
    try {
      const tracker = createTracker(repo)
      const issues = await tracker.listIssues()
      for (const issue of issues) {
        const key = `${issue.repoId}:${issue.number}`
        issue.assignedRunId = runByIssue.get(key)
      }
      cache.set(repo.id, { data: issues, ts: Date.now() })
      allIssues.push(...issues)
    } catch (e) {
      // Skip repos that fail (gh not authed, network error, etc.)
      console.error(`orchestrator/issues: failed for ${repo.id}`, e)
    }
  }

  return NextResponse.json({ issues: allIssues })
}
