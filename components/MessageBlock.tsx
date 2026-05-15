'use client'
import { useState, useMemo } from 'react'
import { ParsedMessage, ContentBlock } from '@/lib/types'

// ── Copy button ───────────────────────────────────────────────────────────────
function CopyBtn({ text, style }: { text: string; style?: object }) {
  const [copied, setCopied] = useState(false)
  function copy() {
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }
  return (
    <button
      onClick={copy}
      style={{
        background: 'var(--bg2)', border: '1px solid var(--glass-border)',
        borderRadius: 4, padding: '2px 7px', fontSize: 11,
        color: copied ? 'var(--green)' : 'var(--text3)',
        cursor: 'pointer', lineHeight: 1.6, flexShrink: 0,
        ...style,
      }}
      title="Copy"
    >
      {copied ? '✓' : '⎘'}
    </button>
  )
}

// ── Code block with copy button ───────────────────────────────────────────────
function CodeBlock({ code }: { code: string }) {
  return (
    <div style={{ position: 'relative', margin: '8px 0' }}>
      <pre style={{ background: 'var(--bg3)', border: '1px solid var(--glass-border)', borderRadius: 8, padding: '10px 40px 10px 14px', overflowX: 'auto', fontSize: 13, margin: 0, fontFamily: 'ui-monospace, monospace' }}>
        <code>{code}</code>
      </pre>
      <CopyBtn text={code} style={{ position: 'absolute', top: 6, right: 8 }} />
    </div>
  )
}

// ── Inline segments (shared by TextContent and table cells) ──────────────────
function renderInline(line: string): React.ReactNode[] {
  const segments = line.split(/(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/)
  return segments.map((seg, i) => {
    if (seg.startsWith('`') && seg.endsWith('`') && seg.length > 2)
      return <code key={i} style={{ background: 'var(--bg3)', padding: '1px 4px', borderRadius: 4, fontSize: 13, fontFamily: 'ui-monospace, monospace' }}>{seg.slice(1, -1)}</code>
    if (seg.startsWith('**') && seg.endsWith('**') && seg.length > 4)
      return <strong key={i}>{seg.slice(2, -2)}</strong>
    if (seg.startsWith('*') && seg.endsWith('*') && seg.length > 2)
      return <em key={i}>{seg.slice(1, -1)}</em>
    return seg
  })
}

// ── Markdown table ────────────────────────────────────────────────────────────
function MarkdownTable({ rows }: { rows: string[] }) {
  const parsed = rows.map(r => {
    const cells = r.split('|')
    // strip leading/trailing empty cells from surrounding pipes
    const start = cells[0].trim() === '' ? 1 : 0
    const end = cells[cells.length - 1].trim() === '' ? cells.length - 1 : cells.length
    return cells.slice(start, end).map(c => c.trim())
  })

  if (parsed.length < 2) return null
  const isSep = (row: string[]) => row.every(c => /^:?-{1,}:?$/.test(c))
  const sepIdx = parsed.findIndex(isSep)
  if (sepIdx < 1) return null

  const headers = parsed[sepIdx - 1]
  const body = parsed.slice(sepIdx + 1)

  return (
    <div style={{ overflowX: 'auto', margin: '10px 0' }}>
      <table style={{ borderCollapse: 'collapse', fontSize: 13, width: '100%', minWidth: 'max-content' }}>
        <thead>
          <tr>
            {headers.map((cell, i) => (
              <th key={i} style={{
                padding: '7px 14px', background: 'var(--bg3)',
                border: '1px solid var(--glass-border)',
                fontWeight: 600, textAlign: 'left', color: 'var(--text)',
                whiteSpace: 'nowrap',
              }}>
                {renderInline(cell)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((row, ri) => (
            <tr key={ri} style={{ background: ri % 2 === 1 ? 'rgba(255,255,255,0.03)' : 'transparent' }}>
              {row.map((cell, ci) => (
                <td key={ci} style={{
                  padding: '6px 14px',
                  border: '1px solid var(--glass-border)',
                  color: cell === '—' || cell === '-' ? 'var(--text3)' : 'var(--text2)',
                  verticalAlign: 'top',
                }}>
                  {renderInline(cell)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Text content ──────────────────────────────────────────────────────────────
function TextContent({ text }: { text: string }) {
  const lines = text.split('\n')
  const parts: React.ReactNode[] = []
  let inFence = false
  let fenceLang = ''
  let fenceLines: string[] = []
  let tableLines: string[] = []
  let key = 0

  function flushFence() {
    parts.push(<CodeBlock key={key++} code={fenceLines.join('\n')} />)
    fenceLines = []; fenceLang = ''
  }

  function flushTable() {
    if (tableLines.length > 0) {
      parts.push(<MarkdownTable key={key++} rows={tableLines} />)
      tableLines = []
    }
  }

  for (const line of lines) {
    if (!inFence && line.startsWith('```')) {
      flushTable()
      inFence = true; fenceLang = line.slice(3); continue
    }
    if (inFence) {
      if (line.startsWith('```')) { inFence = false; flushFence() }
      else fenceLines.push(line)
      continue
    }
    // Table lines start with |
    if (line.trim().startsWith('|')) {
      tableLines.push(line)
      continue
    }
    flushTable()
    parts.push(<span key={key++}>{renderInline(line)}<br /></span>)
  }
  flushTable()
  if (inFence && fenceLines.length) flushFence()

  void fenceLang
  return <div style={{ lineHeight: 1.6, fontSize: 14, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{parts}</div>
}

// ── LCS diff ──────────────────────────────────────────────────────────────────
type DiffLine = { type: 'context' | 'remove' | 'add'; line: string }

function computeDiff(a: string[], b: string[]): DiffLine[] {
  const m = a.length, n = b.length
  if (m * n > 80000) {
    return [...a.map(l => ({ type: 'remove' as const, line: l })), ...b.map(l => ({ type: 'add' as const, line: l }))]
  }
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
  for (let i = m - 1; i >= 0; i--)
    for (let j = n - 1; j >= 0; j--)
      dp[i][j] = a[i] === b[j] ? dp[i+1][j+1] + 1 : Math.max(dp[i+1][j], dp[i][j+1])

  const result: DiffLine[] = []
  let i = 0, j = 0
  while (i < m || j < n) {
    if (i < m && j < n && a[i] === b[j]) { result.push({ type: 'context', line: a[i] }); i++; j++ }
    else if (j >= n || (i < m && dp[i+1][j] >= dp[i][j+1])) result.push({ type: 'remove', line: a[i++] })
    else result.push({ type: 'add', line: b[j++] })
  }
  return result
}

// ── Shared status icon ────────────────────────────────────────────────────────
function StatusDot({ isDone, isError }: { isDone: boolean; isError?: boolean }) {
  const c = isError ? 'var(--red)' : isDone ? 'var(--green)' : 'rgba(192,132,252,0.9)'
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      width: 18, height: 18, borderRadius: '50%',
      background: `color-mix(in srgb, ${c} 18%, transparent)`,
      border: `1px solid color-mix(in srgb, ${c} 35%, transparent)`,
      fontSize: 10, color: c, flexShrink: 0,
      animation: !isDone ? 'spin 1.4s linear infinite' : undefined,
    }}>
      {isError ? '✗' : isDone ? '✓' : '⟳'}
    </span>
  )
}

const SUMMARY_STYLE = {
  padding: '8px 12px', cursor: 'pointer', fontSize: 13, userSelect: 'none' as const,
  display: 'flex', alignItems: 'center', gap: 8, fontWeight: 500, listStyle: 'none' as const,
}

// ── Edit / MultiEdit diff block ───────────────────────────────────────────────
function EditDiffBlock({ block, result }: { block: ContentBlock; result?: ContentBlock }) {
  const [open, setOpen] = useState(false)
  const input = block.tool_input as Record<string, unknown> | null
  const isMulti = block.tool_name === 'MultiEdit'
  const isDone = result !== undefined
  const isError = !!result?.is_error

  // For MultiEdit, use first edit's old/new; for Edit, direct fields
  const edits: Array<{ file_path?: string; old_string?: string; new_string?: string }> = isMulti
    ? ((input?.edits as Array<{ old_string?: string; new_string?: string }> | undefined) ?? []).map(e => ({
        file_path: input?.file_path as string | undefined,
        old_string: e.old_string, new_string: e.new_string,
      }))
    : [{ file_path: input?.file_path as string | undefined, old_string: input?.old_string as string | undefined, new_string: input?.new_string as string | undefined }]

  const filePath = (input?.file_path as string | undefined) ?? ''
  const shortPath = filePath.split('/').slice(-2).join('/')

  const diffLines = useMemo((): DiffLine[] => {
    if (!open) return []
    const all: DiffLine[] = []
    edits.forEach(e => {
      all.push(...computeDiff((e.old_string ?? '').split('\n'), (e.new_string ?? '').split('\n')))
      if (edits.length > 1) all.push({ type: 'context', line: '' })
    })
    return all
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const removed = diffLines.filter(d => d.type === 'remove').length
  const added = diffLines.filter(d => d.type === 'add').length

  return (
    <details
      style={{ margin: '5px 0', background: 'rgba(192,132,252,0.05)', border: '1px solid rgba(192,132,252,0.16)', borderRadius: 10, overflow: 'hidden' }}
      onToggle={e => setOpen((e.target as HTMLDetailsElement).open)}
    >
      <summary style={SUMMARY_STYLE}>
        <StatusDot isDone={isDone} isError={isError} />
        <span style={{ color: 'var(--purple)', fontFamily: 'ui-monospace, monospace', fontSize: 12, fontWeight: 600, flexShrink: 0 }}>
          {block.tool_name}
        </span>
        <span style={{ color: 'var(--text3)', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
          {shortPath}
        </span>
        {open && (removed > 0 || added > 0) && (
          <span style={{ fontSize: 11, flexShrink: 0 }}>
            {removed > 0 && <span style={{ color: 'var(--red)' }}>−{removed}</span>}
            {added > 0 && <span style={{ color: 'var(--green)', marginLeft: 4 }}>+{added}</span>}
          </span>
        )}
        {!isDone && <span style={{ marginLeft: 'auto', fontSize: 11, color: 'rgba(192,132,252,0.7)', flexShrink: 0 }}>running…</span>}
      </summary>

      <div style={{ borderTop: '1px solid rgba(192,132,252,0.16)' }}>
        <div style={{ padding: '3px 12px', fontSize: 10, color: 'var(--text3)', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', background: 'rgba(0,0,0,0.18)' }}>
          {filePath}
        </div>
        <div style={{ maxHeight: 380, overflowY: 'auto', fontFamily: 'ui-monospace, monospace', fontSize: 12 }}>
          {diffLines.map((d, i) => (
            <div key={i} style={{
              padding: '0 14px', lineHeight: 1.55,
              background: d.type === 'remove' ? 'rgba(255,90,90,0.13)' : d.type === 'add' ? 'rgba(61,214,140,0.10)' : 'transparent',
              color: d.type === 'remove' ? '#ff7878' : d.type === 'add' ? '#5dda9e' : 'var(--text3)',
              whiteSpace: 'pre',
            }}>
              {d.type === 'remove' ? '- ' : d.type === 'add' ? '+ ' : '  '}{d.line}
            </div>
          ))}
        </div>
        {isDone && isError && (
          <pre style={{ margin: 0, padding: '8px 14px', fontSize: 12, maxHeight: 200, overflowY: 'auto', color: 'var(--red)', fontFamily: 'ui-monospace, monospace', background: 'var(--bg3)', borderTop: '1px solid var(--glass-border)' }}>
            {result?.tool_result?.map(b => b.text ?? '').join('\n') || '(error)'}
          </pre>
        )}
      </div>
    </details>
  )
}

// ── Write block ───────────────────────────────────────────────────────────────
function WriteBlock({ block, result }: { block: ContentBlock; result?: ContentBlock }) {
  const input = block.tool_input as Record<string, string> | null
  const filePath = input?.file_path ?? ''
  const content = input?.content ?? ''
  const isDone = result !== undefined
  const isError = !!result?.is_error
  const shortPath = filePath.split('/').slice(-2).join('/')
  const lines = content.split('\n')
  const preview = lines.slice(0, 8).join('\n') + (lines.length > 8 ? `\n… (+${lines.length - 8} lines)` : '')

  return (
    <details style={{ margin: '5px 0', background: 'rgba(192,132,252,0.05)', border: '1px solid rgba(192,132,252,0.16)', borderRadius: 10, overflow: 'hidden' }}>
      <summary style={SUMMARY_STYLE}>
        <StatusDot isDone={isDone} isError={isError} />
        <span style={{ color: 'var(--purple)', fontFamily: 'ui-monospace, monospace', fontSize: 12, fontWeight: 600, flexShrink: 0 }}>Write</span>
        <span style={{ color: 'var(--text3)', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{shortPath}</span>
        <span style={{ fontSize: 11, color: 'var(--green)', marginLeft: 'auto', flexShrink: 0 }}>{lines.length} lines</span>
        {!isDone && <span style={{ marginLeft: 4, fontSize: 11, color: 'rgba(192,132,252,0.7)', flexShrink: 0 }}>running…</span>}
      </summary>
      <div style={{ borderTop: '1px solid rgba(192,132,252,0.16)' }}>
        <div style={{ padding: '3px 12px', fontSize: 10, color: 'var(--text3)', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', background: 'rgba(0,0,0,0.18)' }}>{filePath}</div>
        <pre style={{ margin: 0, padding: '8px 14px', fontSize: 12, overflowX: 'auto', overflowY: 'auto', maxHeight: 320, color: 'var(--text2)', fontFamily: 'ui-monospace, monospace' }}>
          {preview}
        </pre>
      </div>
    </details>
  )
}

// ── Bash block ────────────────────────────────────────────────────────────────
function BashBlock({ block, result }: { block: ContentBlock; result?: ContentBlock }) {
  const command = (block.tool_input as { command?: string })?.command ?? ''
  const isDone = result !== undefined
  const isError = !!result?.is_error
  const output = result?.tool_result?.map(b => b.text ?? '').join('\n') ?? ''
  const cmdSingle = command.trim().replace(/\s*\n\s*/g, ' ↵ ')
  const cmdShort = cmdSingle.length > 72 ? cmdSingle.slice(0, 72) + '…' : cmdSingle

  return (
    <details style={{ margin: '5px 0', background: 'rgba(0,0,0,0.18)', border: '1px solid rgba(192,132,252,0.16)', borderRadius: 10, overflow: 'hidden' }}>
      <summary style={SUMMARY_STYLE}>
        <StatusDot isDone={isDone} isError={isError} />
        <span style={{ color: 'var(--purple)', fontFamily: 'ui-monospace, monospace', fontSize: 12, fontWeight: 600, flexShrink: 0 }}>Bash</span>
        <span style={{ color: 'var(--text3)', fontSize: 12, fontFamily: 'ui-monospace, monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
          $ {cmdShort}
        </span>
        {!isDone && <span style={{ marginLeft: 'auto', fontSize: 11, color: 'rgba(192,132,252,0.7)', flexShrink: 0 }}>running…</span>}
      </summary>

      {/* Full command in terminal style */}
      <div style={{ borderTop: '1px solid rgba(192,132,252,0.16)', background: '#0d1117', padding: '8px 14px', fontFamily: 'ui-monospace, monospace', fontSize: 12 }}>
        <span style={{ color: '#3dd68c', userSelect: 'none' }}>$ </span>
        <span style={{ color: '#e2e8f0', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{command}</span>
      </div>

      {isDone && (
        <pre style={{ margin: 0, padding: '8px 14px', fontSize: 12, overflowX: 'auto', overflowY: 'auto', maxHeight: 320, background: 'var(--bg3)', color: isError ? 'var(--red)' : 'var(--text2)', fontFamily: 'ui-monospace, monospace', borderTop: '1px solid var(--glass-border)' }}>
          {output || '(no output)'}
        </pre>
      )}
    </details>
  )
}

// ── Todo list block ───────────────────────────────────────────────────────────
interface TodoItem { id?: string; content?: string; status?: string; priority?: string }

function TodoListBlock({ block, result }: { block: ContentBlock; result?: ContentBlock }) {
  const input = block.tool_input as { todos?: TodoItem[] } | null
  const todos: TodoItem[] = input?.todos ?? []
  const isDone = result !== undefined
  const isError = !!result?.is_error

  const priorityColor = (p?: string) =>
    p === 'high' ? 'var(--red)' : p === 'medium' ? 'var(--yellow)' : 'var(--text3)'
  const statusIcon = (s?: string) =>
    s === 'completed' ? '✓' : s === 'in_progress' ? '⟳' : '○'
  const statusColor = (s?: string) =>
    s === 'completed' ? 'var(--green)' : s === 'in_progress' ? 'var(--yellow)' : 'var(--text3)'

  const done = todos.filter(t => t.status === 'completed').length

  return (
    <details style={{ margin: '5px 0', background: 'rgba(192,132,252,0.05)', border: '1px solid rgba(192,132,252,0.16)', borderRadius: 10, overflow: 'hidden' }}>
      <summary style={SUMMARY_STYLE}>
        <StatusDot isDone={isDone} isError={isError} />
        <span style={{ color: 'var(--purple)', fontFamily: 'ui-monospace, monospace', fontSize: 12, fontWeight: 600, flexShrink: 0 }}>
          {block.tool_name}
        </span>
        <span style={{ color: 'var(--text3)', fontSize: 12 }}>
          {todos.length} tasks{done > 0 ? ` · ${done}/${todos.length} done` : ''}
        </span>
        {!isDone && <span style={{ marginLeft: 'auto', fontSize: 11, color: 'rgba(192,132,252,0.7)', flexShrink: 0 }}>running…</span>}
      </summary>
      <div style={{ borderTop: '1px solid rgba(192,132,252,0.16)', padding: '6px 12px' }}>
        {todos.map((t, i) => (
          <div key={t.id ?? i} style={{
            display: 'flex', alignItems: 'flex-start', gap: 8, padding: '5px 0', fontSize: 13,
            borderBottom: i < todos.length - 1 ? '1px solid rgba(255,255,255,0.05)' : 'none',
          }}>
            <span style={{ color: statusColor(t.status), flexShrink: 0, marginTop: 1, fontSize: 12, fontFamily: 'ui-monospace, monospace' }}>
              {statusIcon(t.status)}
            </span>
            <span style={{
              flex: 1, color: t.status === 'completed' ? 'var(--text3)' : 'var(--text)',
              textDecoration: t.status === 'completed' ? 'line-through' : 'none',
            }}>
              {t.content ?? ''}
            </span>
            {t.priority && (
              <span style={{ fontSize: 10, color: priorityColor(t.priority), flexShrink: 0, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                {t.priority}
              </span>
            )}
          </div>
        ))}
      </div>
    </details>
  )
}

// ── Generic tool block (fallback) ─────────────────────────────────────────────
function getInputSummary(block: ContentBlock): string {
  const input = block.tool_input
  if (!input) return ''
  const name = block.tool_name ?? ''

  if ((name === 'Bash' || name === 'Shell') && typeof input.command === 'string') {
    const cmd = input.command.trim()
    return cmd.length > 72 ? cmd.slice(0, 72) + '…' : cmd
  }
  if ((name === 'Read' || name === 'Write' || name === 'Edit' || name === 'MultiEdit') && typeof input.file_path === 'string')
    return input.file_path
  if (name === 'WebSearch' && typeof input.query === 'string') return input.query
  if (name === 'WebFetch' && typeof input.url === 'string') return input.url
  if (name === 'Agent' && typeof input.description === 'string') {
    const d = input.description as string
    return d.length > 72 ? d.slice(0, 72) + '…' : d
  }
  if ((name === 'TodoWrite' || name === 'TaskCreate') && typeof input.content === 'string')
    return (input.content as string).slice(0, 72)

  for (const v of Object.values(input)) {
    if (typeof v === 'string' && v.trim()) return v.length > 72 ? v.slice(0, 72) + '…' : v
  }
  return ''
}

function GenericToolBlock({ block, result }: { block: ContentBlock; result?: ContentBlock }) {
  const isDone = result !== undefined
  const isError = result?.is_error
  const resultText = result?.tool_result?.map(b => b.text ?? '').join('\n') ?? ''
  const inputSummary = getInputSummary(block)

  const accentColor = isError ? 'var(--red)' : isDone ? 'var(--green)' : 'rgba(192,132,252,0.9)'
  const bgColor = isError ? 'color-mix(in srgb, var(--red) 5%, var(--glass-bg))' : 'rgba(192,132,252,0.05)'
  const borderColor = isError ? 'color-mix(in srgb, var(--red) 22%, transparent)' : 'rgba(192,132,252,0.16)'

  return (
    <details style={{ margin: '5px 0', background: bgColor, border: `1px solid ${borderColor}`, borderRadius: 10, backdropFilter: 'blur(8px)', overflow: 'hidden' }}>
      <summary style={SUMMARY_STYLE}>
        <StatusDot isDone={isDone} isError={!!isError} />
        <span style={{ color: 'var(--purple)', fontFamily: 'ui-monospace, monospace', fontSize: 12, fontWeight: 600, flexShrink: 0 }}>
          {block.tool_name}
        </span>
        {inputSummary && (
          <span style={{ color: 'var(--text3)', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
            {inputSummary}
          </span>
        )}
        {!isDone && <span style={{ marginLeft: 'auto', fontSize: 11, color: `color-mix(in srgb, ${accentColor} 70%, transparent)`, flexShrink: 0 }}>running…</span>}
      </summary>

      <div style={{ borderTop: `1px solid ${borderColor}` }}>
        <div style={{ padding: '4px 12px', fontSize: 10, color: 'var(--text3)', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', background: 'rgba(0,0,0,0.18)' }}>
          Input
        </div>
        <pre style={{ margin: 0, padding: '8px 14px', fontSize: 12, overflowX: 'auto', overflowY: 'auto', maxHeight: 220, color: 'var(--text2)', fontFamily: 'ui-monospace, monospace' }}>
          {JSON.stringify(block.tool_input, null, 2)}
        </pre>
      </div>

      {isDone && (
        <div style={{ borderTop: '1px solid var(--glass-border)' }}>
          <div style={{ padding: '4px 12px', fontSize: 10, color: isError ? 'var(--red)' : 'var(--text3)', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', background: 'rgba(0,0,0,0.18)' }}>
            {isError ? 'Error' : 'Output'}
          </div>
          <pre style={{ margin: 0, padding: '8px 14px', fontSize: 12, overflowX: 'auto', overflowY: 'auto', maxHeight: 320, background: 'var(--bg3)', color: isError ? 'var(--red)' : 'var(--text2)', fontFamily: 'ui-monospace, monospace' }}>
            {resultText || '(empty)'}
          </pre>
        </div>
      )}
    </details>
  )
}

// ── Router ────────────────────────────────────────────────────────────────────
function CombinedToolBlock({ block, result }: { block: ContentBlock; result?: ContentBlock }) {
  const name = block.tool_name ?? ''
  if (name === 'Edit' || name === 'MultiEdit') return <EditDiffBlock block={block} result={result} />
  if (name === 'Write') return <WriteBlock block={block} result={result} />
  if (name === 'Bash' || name === 'Shell') return <BashBlock block={block} result={result} />
  if (name === 'TodoWrite' || name === 'TaskCreate') {
    const hasTodos = Array.isArray((block.tool_input as { todos?: unknown })?.todos)
    if (hasTodos) return <TodoListBlock block={block} result={result} />
  }
  return <GenericToolBlock block={block} result={result} />
}

// ── Fallback standalone tool_result ──────────────────────────────────────────
function ToolResultBlock({ block }: { block: ContentBlock }) {
  const text = block.tool_result?.map(b => b.text ?? '').join('\n') ?? ''
  const isError = block.is_error
  return (
    <details style={{ margin: '6px 0', background: isError ? 'color-mix(in srgb, var(--red) 8%, var(--glass-bg))' : 'var(--glass-bg)', border: `1px solid ${isError ? 'color-mix(in srgb, var(--red) 28%, transparent)' : 'var(--glass-border)'}`, borderRadius: 8, backdropFilter: 'blur(8px)' }}>
      <summary style={{ padding: '7px 12px', cursor: 'pointer', fontSize: 12, color: isError ? 'var(--red)' : 'var(--text2)', userSelect: 'none', fontWeight: 500 }}>
        {isError ? '✗ Tool error' : '↩ Tool result'}
      </summary>
      <pre style={{ margin: 0, padding: '8px 14px', fontSize: 12, overflowX: 'auto', borderTop: '1px solid var(--glass-border)', color: 'var(--text2)', fontFamily: 'ui-monospace, monospace', maxHeight: 300, background: 'var(--bg3)', borderRadius: '0 0 8px 8px' }}>
        {text || '(empty)'}
      </pre>
    </details>
  )
}

// ── Thinking block ────────────────────────────────────────────────────────────
function ThinkingBlock({ block }: { block: ContentBlock }) {
  return (
    <div style={{ margin: '6px 0', borderLeft: '2px solid color-mix(in srgb, var(--yellow) 45%, transparent)', paddingLeft: 10, paddingTop: 2, paddingBottom: 2 }}>
      <div style={{ fontSize: 10, color: 'color-mix(in srgb, var(--yellow) 70%, transparent)', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 4 }}>
        Thinking
      </div>
      <div style={{ fontSize: 12, color: 'var(--text3)', fontStyle: 'italic', whiteSpace: 'pre-wrap', lineHeight: 1.55, maxHeight: 180, overflowY: 'auto', wordBreak: 'break-word' }}>
        {block.thinking}
      </div>
    </div>
  )
}

// ── Image block ───────────────────────────────────────────────────────────────
function ImageBlock({ block, message, encodedFilepath }: { block: ContentBlock; message: ParsedMessage; encodedFilepath?: string }) {
  const src = encodedFilepath
    ? `/api/image?f=${encodedFilepath}&uuid=${message.uuid}&idx=${block.imageBlockIdx ?? 0}`
    : null
  if (!src) return <div style={{ fontSize: 12, color: 'var(--text3)', fontStyle: 'italic' }}>[image]</div>
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="Session image" style={{ maxWidth: '100%', maxHeight: 480, borderRadius: 8, border: '1px solid rgba(255,255,255,0.08)', display: 'block', marginTop: 6, objectFit: 'contain' }} loading="lazy" />
  )
}

// ── Message text extractor (for copy) ─────────────────────────────────────────
function extractMessageText(message: ParsedMessage): string {
  return message.content
    .filter(b => b.type === 'text' && b.text)
    .map(b => b.text ?? '')
    .join('\n\n')
    .trim()
}

// ── MessageBlock ──────────────────────────────────────────────────────────────
export default function MessageBlock({
  message,
  encodedFilepath,
  toolResultMap,
}: {
  message: ParsedMessage
  encodedFilepath?: string
  toolResultMap?: Map<string, ContentBlock>
}) {
  const [msgCopied, setMsgCopied] = useState(false)
  const isUser = message.type === 'user'
  const isPending = message.uuid.startsWith('__optimistic__')
  if (message.isMeta) return null

  const displayBlocks = message.content.filter(b =>
    b.type === 'text' || b.type === 'tool_use' || b.type === 'tool_result' || b.type === 'thinking' || b.type === 'image'
  )
  if (displayBlocks.length === 0) return null

  const msgText = extractMessageText(message)

  function copyMsg() {
    navigator.clipboard?.writeText(msgText).then(() => {
      setMsgCopied(true)
      setTimeout(() => setMsgCopied(false), 1500)
    })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: isUser ? 'flex-end' : 'flex-start', opacity: isPending ? 0.65 : 1, transition: 'opacity 0.3s ease', margin: '12px 0' }}>
      <div style={{
        fontSize: 11, color: 'var(--text2)', marginBottom: 4,
        paddingLeft: isUser ? 0 : 4, paddingRight: isUser ? 4 : 0,
        display: 'flex', alignItems: 'center', gap: 6,
        flexDirection: isUser ? 'row-reverse' : 'row',
      }}>
        <span>{isUser ? 'You' : 'Claude'} · {new Date(message.timestamp).toLocaleTimeString()}</span>
        {msgText && !isPending && (
          <button
            onClick={copyMsg}
            style={{ background: 'none', border: 'none', color: msgCopied ? 'var(--green)' : 'var(--text3)', cursor: 'pointer', fontSize: 12, padding: '0 2px', lineHeight: 1, opacity: 0.7 }}
            title="Copy message text"
          >
            {msgCopied ? '✓' : '⎘'}
          </button>
        )}
      </div>

      <div style={{
        maxWidth: 'min(92%, 700px)',
        background: isUser ? 'color-mix(in srgb, var(--accent) 22%, var(--glass-bg))' : 'var(--glass-bg)',
        backdropFilter: isUser ? undefined : 'blur(16px) saturate(1.5)',
        WebkitBackdropFilter: isUser ? undefined : 'blur(16px) saturate(1.5)',
        color: 'var(--text)',
        borderRadius: isUser ? '14px 14px 2px 14px' : '14px 14px 14px 2px',
        padding: 'clamp(9px,2vw,12px) clamp(12px,2vw,16px)',
        border: isUser ? '1px solid color-mix(in srgb, var(--accent) 50%, transparent)' : '1px solid var(--glass-border)',
        boxShadow: isUser
          ? 'inset 0 1px 0 rgba(255,255,255,0.2), 0 4px 16px color-mix(in srgb, var(--accent) 25%, transparent)'
          : 'var(--specular), 0 4px 20px rgba(0,0,0,0.12)',
        width: isUser ? 'fit-content' : '100%',
      }}>
        {displayBlocks.map((block, i) => {
          if (block.type === 'text') return <TextContent key={i} text={block.text ?? ''} />
          if (block.type === 'tool_use') {
            const result = toolResultMap?.get(block.tool_id ?? '')
            return <CombinedToolBlock key={i} block={block} result={result} />
          }
          if (block.type === 'tool_result') return <ToolResultBlock key={i} block={block} />
          if (block.type === 'thinking') return <ThinkingBlock key={i} block={block} />
          if (block.type === 'image') return <ImageBlock key={i} block={block} message={message} encodedFilepath={encodedFilepath} />
          return null
        })}
      </div>

      {isPending && <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 3, paddingRight: 4 }}>Sending…</div>}
      {message.usage && !isPending && (
        <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 3, paddingRight: isUser ? 4 : 0 }}>
          {message.usage.input_tokens}↑ {message.usage.output_tokens}↓
          {message.usage.cache_read_input_tokens ? ` ${message.usage.cache_read_input_tokens} cached` : ''}
        </div>
      )}
    </div>
  )
}
