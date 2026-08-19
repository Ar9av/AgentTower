'use client'
import { appPath } from '@/lib/base-path'
import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import type { IssueRecord, RunRecord } from '@/lib/orchestrator-types'

interface RecentSession {
  sessionId: string
  encodedFilepath: string
}

type IssueState = 'todo' | 'in-progress' | 'done' | 'rework' | 'cancelled'

interface BoardData {
  issues: IssueRecord[]
}

interface RunsData {
  runs: RunRecord[]
}

interface OrchestratorConfigData {
  config: {
    enabled: boolean
  }
}

interface DaemonStatus {
  running: boolean
  pid: number | null
  uptimeSec: number | null
}

const STATE_LABEL: Record<IssueState, string> = {
  'todo': 'Todo',
  'in-progress': 'In progress',
  'done': 'Done',
  'rework': 'Rework',
  'cancelled': 'Cancelled',
}

const STATE_COLOR: Record<IssueState, string> = {
  'todo': 'var(--text3)',
  'in-progress': '#fb923c',
  'done': '#22c55e',
  'rework': '#eab308',
  'cancelled': '#ef4444',
}

const STATUS_EMOJI: Record<string, string> = {
  'queued': '🕐',
  'awaiting-approval': '⏳',
  'dispatching': '🚀',
  'running': '🤖',
  'succeeded': '✅',
  'failed': '❌',
  'pr-open': '🔀',
  'retrying': '🔄',
  'cancelled': '🚫',
}

const COLUMNS: IssueState[] = ['todo', 'in-progress', 'done', 'rework']

function RelativeTime({ ts, nowMs }: { ts: string; nowMs: number }) {
  const diff = nowMs - new Date(ts).getTime()
  const m = Math.floor(diff / 60_000)
  if (m < 1) return <span>just now</span>
  if (m < 60) return <span>{m}m ago</span>
  const h = Math.floor(m / 60)
  if (h < 24) return <span>{h}h ago</span>
  return <span>{Math.floor(h / 24)}d ago</span>
}

function IssueCard({
  issue,
  run,
  onDispatch,
  dispatching,
  sessionPath,
  nowMs,
}: {
  issue: IssueRecord
  run?: RunRecord
  onDispatch: (repoId: string, number: number, title: string) => void
  dispatching: boolean
  sessionPath?: string
  nowMs: number
}) {
  const sessionLink = sessionPath ? `/session?f=${encodeURIComponent(sessionPath)}` : null

  return (
    <div style={{
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 10,
      padding: 12,
      marginBottom: 8,
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <span style={{ color: 'var(--text3)', fontSize: 11, whiteSpace: 'nowrap', paddingTop: 2 }}>
          #{issue.number}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <a
            href={issue.url}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: 'var(--text1)', fontSize: 13, fontWeight: 500, textDecoration: 'none', display: 'block' }}
          >
            {issue.title}
          </a>
          <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>
            {issue.repoId} · <RelativeTime ts={issue.updatedAt} nowMs={nowMs} />
          </div>
        </div>
      </div>

      {run && (
        <div style={{ marginTop: 10, paddingTop: 8, borderTop: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12 }}>{STATUS_EMOJI[run.status] ?? '•'} {run.status}</span>
            {run.attempt > 1 && (
              <span style={{ fontSize: 11, color: 'var(--text3)' }}>attempt {run.attempt}</span>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
            {sessionLink && (
              <Link href={sessionLink} style={{ fontSize: 11, color: 'var(--accent)', textDecoration: 'none' }}>
                View session →
              </Link>
            )}
            {run.prUrl && (
              <a href={run.prUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: 'var(--accent)', textDecoration: 'none' }}>
                PR →
              </a>
            )}
            {run.branch && !run.prUrl && (
              <span style={{ fontSize: 11, color: 'var(--text3)', fontFamily: 'monospace' }}>{run.branch}</span>
            )}
          </div>
          {run.error && (
            <p style={{ margin: '6px 0 0', fontSize: 11, color: '#f87171', wordBreak: 'break-word' }}>
              {run.error.slice(0, 120)}
            </p>
          )}
          {run.nextRetryAt && run.status === 'retrying' && (
            <p style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--text3)' }}>
              Retry at <RelativeTime ts={run.nextRetryAt} nowMs={nowMs} />
            </p>
          )}
        </div>
      )}

      {/* Dispatch button for approval-gated issues */}
      {(issue.state === 'todo' && (!run || run.status === 'awaiting-approval')) && (
        <button
          className="glass-btn"
          onClick={() => onDispatch(issue.repoId, issue.number, issue.title)}
          disabled={dispatching}
          style={{ marginTop: 8, width: '100%', fontSize: 12, padding: '5px 0', fontWeight: 500 }}
        >
          {dispatching ? 'Dispatching…' : '🚀 Dispatch agent'}
        </button>
      )}
    </div>
  )
}

export default function OrchestratorBoard() {
  const [issues, setIssues] = useState<IssueRecord[]>([])
  const [runs, setRuns] = useState<RunRecord[]>([])
  const [sessionMap, setSessionMap] = useState<Map<string, string>>(new Map())
  const [orchestratorEnabled, setOrchestratorEnabled] = useState(true)
  const [daemonStatus, setDaemonStatus] = useState<DaemonStatus | null>(null)
  const [nowMs, setNowMs] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [dispatchingKey, setDispatchingKey] = useState<string | null>(null)

  const loadData = useCallback(async () => {
    try {
      const [issuesRes, runsRes, sessionsRes, configRes, daemonRes] = await Promise.all([
        fetch(appPath('/api/orchestrator/issues')),
        fetch(appPath('/api/orchestrator/runs')),
        fetch(appPath('/api/recent-sessions?limit=50')),
        fetch(appPath('/api/orchestrator/config')),
        fetch(appPath('/api/orchestrator/control'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'status' }),
        }),
      ])
      const issuesData: BoardData = await issuesRes.json()
      const runsData: RunsData = await runsRes.json()
      const sessions: RecentSession[] = (await sessionsRes.json()) ?? []
      const configData: OrchestratorConfigData = await configRes.json()
      const daemonData: DaemonStatus = await daemonRes.json()
      const map = new Map<string, string>()
      for (const s of sessions) map.set(s.sessionId, s.encodedFilepath)
      setIssues(issuesData.issues ?? [])
      setRuns(runsData.runs ?? [])
      setSessionMap(map)
      setOrchestratorEnabled(Boolean(configData.config?.enabled))
      setDaemonStatus(daemonData)
      setNowMs(new Date().getTime())
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadData()
    const iv = setInterval(loadData, 8_000)
    return () => clearInterval(iv)
  }, [loadData])

  const handleDispatch = async (repoId: string, issueNumber: number, issueTitle: string) => {
    const key = `${repoId}:${issueNumber}`
    setDispatchingKey(key)
    setError('')
    try {
      const res = await fetch(appPath('/api/orchestrator/dispatch'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoId, issueNumber, issueTitle }),
      })
      if (!res.ok) {
        const payload = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(payload.error ?? `HTTP ${res.status}`)
      }
      await loadData()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setDispatchingKey(null)
    }
  }

  // Build a lookup: (repoId, issueNumber) -> latest run
  const runByIssue = new Map<string, RunRecord>()
  for (const run of runs) {
    const key = `${run.repoId}:${run.issueNumber}`
    const prev = runByIssue.get(key)
    if (!prev || run.createdAt > prev.createdAt) runByIssue.set(key, run)
  }

  const issuesByState: Record<IssueState, IssueRecord[]> = {
    'todo': [],
    'in-progress': [],
    'done': [],
    'rework': [],
    'cancelled': [],
  }
  for (const issue of issues) {
    issuesByState[issue.state]?.push(issue)
  }

  const colStyle = {
    flex: '1 1 220px',
    minWidth: 220,
    maxWidth: 320,
  }

  const colHeaderStyle = (state: IssueState) => ({
    fontSize: 12,
    fontWeight: 700,
    color: STATE_COLOR[state],
    letterSpacing: '0.04em',
    textTransform: 'uppercase' as const,
    marginBottom: 10,
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  })

  if (loading) {
    return <div style={{ color: 'var(--text3)', fontSize: 14 }}>Loading board…</div>
  }

  if (error) {
    return (
      <div style={{ color: '#f87171', fontSize: 13, background: '#ff444415', borderRadius: 8, padding: 12 }}>
        {error}
      </div>
    )
  }

  if (issues.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text3)' }}>
        <p style={{ fontSize: 15, marginBottom: 8 }}>No issues found.</p>
        <p style={{ fontSize: 13 }}>
          Add a GitHub repo in Config, enable it, and label issues with <code>agenttower:todo</code>.
        </p>
      </div>
    )
  }

  return (
    <div>
      {(!orchestratorEnabled || !daemonStatus?.running) && (
        <div style={{
          marginBottom: 14,
          padding: '12px 14px',
          borderRadius: 10,
          border: '1px solid color-mix(in srgb, #f59e0b 35%, var(--border))',
          background: 'color-mix(in srgb, #f59e0b 8%, var(--surface))',
          color: 'var(--text2)',
          fontSize: 12,
        }}>
          {!orchestratorEnabled
            ? 'Orchestrator is disabled. Dispatch will not run until you enable it in Config.'
            : 'Orchestrator daemon is offline. New dispatches will try to start it automatically.'}
        </div>
      )}
      <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 8, alignItems: 'flex-start' }}>
        {COLUMNS.map(state => (
          <div key={state} style={colStyle}>
            <div style={colHeaderStyle(state)}>
              <span>{STATE_LABEL[state]}</span>
              <span style={{ background: 'var(--surface2)', borderRadius: 10, padding: '1px 7px', fontWeight: 500, color: 'var(--text2)' }}>
                {issuesByState[state].length}
              </span>
            </div>
            <div>
              {issuesByState[state].map(issue => {
                const key = `${issue.repoId}:${issue.number}`
                const run = runByIssue.get(key)
                return (
                  <IssueCard
                    key={key}
                    issue={issue}
                    run={run}
                    onDispatch={handleDispatch}
                    dispatching={dispatchingKey === key}
                    sessionPath={run?.sessionId ? sessionMap.get(run.sessionId) : undefined}
                    nowMs={nowMs}
                  />
                )
              })}
              {issuesByState[state].length === 0 && (
                <div style={{ color: 'var(--text3)', fontSize: 12, padding: '12px 0', textAlign: 'center' }}>
                  Empty
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
