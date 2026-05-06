'use client'
import { useEffect, useState, useCallback } from 'react'
import type { BriefRecord, BriefTask, TaskStatus } from '@/lib/daily-brief'

interface HistoryData {
  records: BriefRecord[]
}

export default function DailyBriefHistory() {
  const [data, setData] = useState<HistoryData | null>(null)
  const [error, setError] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [approving, setApproving] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/daily-brief/history')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setData(await res.json() as HistoryData)
    } catch (err) {
      setError(String(err))
    }
  }, [])

  useEffect(() => {
    load()
    const t = setInterval(load, 10000)
    return () => clearInterval(t)
  }, [load])

  async function approveTask(briefId: string, taskId: string) {
    setApproving(taskId)
    try {
      await fetch(`/api/daily-brief/brief/${briefId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'approve', taskIds: [taskId] }),
      })
      await load()
    } finally {
      setApproving(null)
    }
  }

  async function rejectTask(briefId: string, taskId: string) {
    await fetch(`/api/daily-brief/brief/${briefId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'reject', taskIds: [taskId] }),
    })
    await load()
  }

  async function approveAll(briefId: string, tasks: BriefTask[]) {
    const ids = tasks.filter(t => t.status === 'pending').map(t => t.id)
    if (!ids.length) return
    await fetch(`/api/daily-brief/brief/${briefId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'approve', taskIds: ids }),
    })
    await load()
  }

  async function skipBrief(briefId: string) {
    await fetch(`/api/daily-brief/brief/${briefId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'skip' }),
    })
    await load()
  }

  if (!data) return <div style={{ padding: 16, color: 'var(--text3)', fontSize: 13 }}>Loading history…</div>
  if (error) return <div style={{ padding: 16, color: 'var(--red, #ef4444)', fontSize: 13 }}>{error}</div>
  if (data.records.length === 0) {
    return <div style={{ padding: 16, color: 'var(--text3)', fontSize: 13 }}>No briefs yet. Configure projects and run the agent on St3ve.</div>
  }

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {data.records.map(record => (
        <BriefCard
          key={record.id}
          record={record}
          isExpanded={expanded === record.id}
          onToggle={() => setExpanded(v => v === record.id ? null : record.id)}
          onApproveTask={taskId => approveTask(record.id, taskId)}
          onRejectTask={taskId => rejectTask(record.id, taskId)}
          onApproveAll={() => approveAll(record.id, record.tasks)}
          onSkip={() => skipBrief(record.id)}
          approving={approving}
        />
      ))}
    </div>
  )
}

function BriefCard({
  record, isExpanded, onToggle,
  onApproveTask, onRejectTask, onApproveAll, onSkip, approving,
}: {
  record: BriefRecord
  isExpanded: boolean
  onToggle: () => void
  onApproveTask: (id: string) => void
  onRejectTask: (id: string) => void
  onApproveAll: () => void
  onSkip: () => void
  approving: string | null
}) {
  const pendingCount = record.tasks.filter(t => t.status === 'pending').length
  const completedCount = record.tasks.filter(t => t.status === 'completed').length
  const runningCount = record.tasks.filter(t => t.status === 'running').length

  return (
    <div className="glass" style={{ borderRadius: 12, overflow: 'hidden' }}>
      {/* Summary row */}
      <div
        onClick={onToggle}
        style={{
          display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px',
          cursor: 'pointer', userSelect: 'none',
        }}
      >
        <span style={{ fontSize: 16 }}>{record.type === 'morning' ? '🌅' : '🌙'}</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>
            {record.date} · {record.type === 'morning' ? 'Morning brief' : 'Evening summary'}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 1 }}>
            {record.tasks.length} tasks · {completedCount} done
            {runningCount > 0 && ` · ${runningCount} running`}
            {pendingCount > 0 && ` · ${pendingCount} pending approval`}
            {record.sentAt && ` · sent ${fmtTime(record.sentAt)}`}
          </div>
        </div>
        <StatusBadge status={record.status} />
        <span style={{ fontSize: 11, color: 'var(--text3)', marginLeft: 4 }}>
          {isExpanded ? '▲' : '▼'}
        </span>
      </div>

      {/* Expanded task list */}
      {isExpanded && (
        <div style={{ borderTop: '1px solid var(--border, rgba(255,255,255,0.06))' }}>
          {/* Bulk actions for pending briefs */}
          {pendingCount > 0 && (
            <div style={{ padding: '10px 16px', display: 'flex', gap: 8, borderBottom: '1px solid var(--border, rgba(255,255,255,0.06))' }}>
              <button
                onClick={onApproveAll} className="glass-btn"
                style={{ fontSize: 12, padding: '6px 14px', fontWeight: 600 }}
              >
                Approve all ({pendingCount})
              </button>
              <button
                onClick={onSkip} className="glass-btn"
                style={{ fontSize: 12, padding: '6px 14px', color: 'var(--text3)' }}
              >
                Skip
              </button>
            </div>
          )}

          {record.tasks.map((task, i) => (
            <TaskRow
              key={task.id}
              task={task}
              index={i + 1}
              onApprove={() => onApproveTask(task.id)}
              onReject={() => onRejectTask(task.id)}
              approving={approving === task.id}
              isLast={i === record.tasks.length - 1}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function TaskRow({
  task, index, onApprove, onReject, approving, isLast
}: {
  task: BriefTask
  index: number
  onApprove: () => void
  onReject: () => void
  approving: boolean
  isLast: boolean
}) {
  return (
    <div style={{
      padding: '10px 16px',
      borderBottom: isLast ? 'none' : '1px solid var(--border, rgba(255,255,255,0.04))',
      display: 'grid', gridTemplateColumns: '20px 1fr auto', gap: 10, alignItems: 'start',
    }}>
      <span style={{ fontSize: 11, color: 'var(--text3)', paddingTop: 2 }}>{index}</span>
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>{task.title}</span>
          <EffortBadge effort={task.effort} />
          <TypeBadge type={task.type} />
        </div>
        <div style={{ fontSize: 12, color: 'var(--text2)' }}>{task.description}</div>
        {task.rationale && (
          <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 3, fontStyle: 'italic' }}>
            {task.rationale}
          </div>
        )}
        {task.result && (
          <div style={{ marginTop: 6, fontSize: 11 }}>
            {task.result.prUrl && (
              <a href={task.result.prUrl} target="_blank" rel="noreferrer"
                style={{ color: 'var(--blue, #3b82f6)', textDecoration: 'none' }}>
                PR: {task.result.prUrl.split('/').slice(-2).join('/')}
              </a>
            )}
            {task.result.summary && (
              <div style={{ color: 'var(--text2)', marginTop: 3, maxWidth: 400 }}>{task.result.summary}</div>
            )}
            {task.result.error && (
              <div style={{ color: 'var(--red, #ef4444)' }}>{task.result.error}</div>
            )}
          </div>
        )}
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        {task.status === 'pending' && (
          <>
            <button
              onClick={onApprove} disabled={approving} className="glass-btn"
              style={{ fontSize: 11, padding: '4px 10px', opacity: approving ? 0.6 : 1 }}
            >
              {approving ? '…' : 'Approve'}
            </button>
            <button
              onClick={onReject} className="glass-btn"
              style={{ fontSize: 11, padding: '4px 8px', color: 'var(--text3)' }}
            >
              ✕
            </button>
          </>
        )}
        {task.status !== 'pending' && <TaskStatusBadge status={task.status} />}
      </div>
    </div>
  )
}

function StatusBadge({ status }: { status: BriefRecord['status'] }) {
  const map: Record<string, { label: string; color: string }> = {
    'pending-approval': { label: 'Pending', color: 'rgba(255,180,0,0.2)' },
    executing: { label: 'Running', color: 'rgba(61,214,140,0.15)' },
    completed: { label: 'Done', color: 'rgba(61,214,140,0.15)' },
    skipped: { label: 'Skipped', color: 'rgba(150,150,150,0.15)' },
  }
  const s = map[status] ?? { label: status, color: 'rgba(150,150,150,0.15)' }
  return (
    <span style={{
      fontSize: 11, padding: '2px 8px', borderRadius: 6,
      background: s.color, color: 'var(--text)',
    }}>
      {s.label}
    </span>
  )
}

function TaskStatusBadge({ status }: { status: TaskStatus }) {
  const icons: Partial<Record<TaskStatus, string>> = {
    approved: '✓ Approved', running: '⏳ Running',
    completed: '✅ Done', failed: '✗ Failed', rejected: '— Skipped',
  }
  const colors: Partial<Record<TaskStatus, string>> = {
    completed: 'var(--green, #3dd68c)', failed: 'var(--red, #ef4444)',
    running: 'var(--blue, #3b82f6)',
  }
  return (
    <span style={{ fontSize: 11, color: colors[status] ?? 'var(--text3)' }}>
      {icons[status] ?? status}
    </span>
  )
}

function EffortBadge({ effort }: { effort: string }) {
  const colors: Record<string, string> = {
    low: 'rgba(61,214,140,0.15)', medium: 'rgba(255,180,0,0.15)', high: 'rgba(239,68,68,0.15)',
  }
  return (
    <span style={{
      fontSize: 10, padding: '1px 6px', borderRadius: 4,
      background: colors[effort] ?? 'rgba(150,150,150,0.15)', color: 'var(--text2)',
    }}>
      {effort}
    </span>
  )
}

function TypeBadge({ type }: { type: string }) {
  return (
    <span style={{ fontSize: 10, color: 'var(--text3)' }}>
      {type.replace('-', ' ')}
    </span>
  )
}

function fmtTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  } catch { return iso }
}
