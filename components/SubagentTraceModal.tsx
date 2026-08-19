'use client'
import { useEffect, useMemo, useState } from 'react'
import { ParsedMessage, ContentBlock } from '@/lib/types'
import MessageBlock from './MessageBlock'

// Shared "subagent page" — used from both the Tree graph and the linear
// Timeline. Shows the spawn (prompt + final result, same as the inline
// Agent/Task block) plus the subagent's own full step-by-step transcript,
// fetched on demand from /api/subagent-trace.
export default function SubagentTraceModal({
  toolId,
  block,
  spawnTimestamp,
  toolResultMap,
  encodedFilepath,
  onClose,
}: {
  toolId: string
  block: ContentBlock
  spawnTimestamp: string
  toolResultMap: Map<string, ContentBlock>
  encodedFilepath: string
  onClose: () => void
}) {
  const [traceMessages, setTraceMessages] = useState<ParsedMessage[] | null>(null)
  const [traceLoading, setTraceLoading] = useState(false)

  useEffect(() => {
    setTraceMessages(null)
    setTraceLoading(true)
    fetch(`/api/subagent-trace?f=${encodedFilepath}&toolId=${encodeURIComponent(toolId)}`)
      .then(res => res.ok ? res.json() : null)
      .then(data => setTraceMessages(data?.messages ?? []))
      .catch(() => setTraceMessages([]))
      .finally(() => setTraceLoading(false))
  }, [toolId, encodedFilepath])

  // tool_use -> tool_result pairing WITHIN the subagent's own transcript —
  // separate from the parent session's toolResultMap.
  const traceToolResultMap = useMemo(() => {
    const map = new Map<string, ContentBlock>()
    for (const msg of traceMessages ?? []) {
      if (msg.type !== 'user') continue
      for (const b of msg.content) {
        if (b.type === 'tool_result' && b.tool_id) map.set(b.tool_id, b)
      }
    }
    return map
  }, [traceMessages])

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 600,
        background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        overflowY: 'auto', padding: '48px 20px',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 760,
          background: 'var(--bg2)', border: '1px solid var(--glass-border-hi, var(--glass-border))',
          borderRadius: 16, boxShadow: '0 20px 70px rgba(0,0,0,0.6)',
          padding: '16px 20px 20px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
          <span style={{ fontSize: 12, color: 'var(--text2)', fontWeight: 600 }}>
            Subagent trace
            {traceMessages && traceMessages.length > 0 && (
              <span style={{ color: 'var(--text3)', fontWeight: 400 }}> · {traceMessages.length} steps</span>
            )}
          </span>
          <button
            onClick={onClose}
            title="Close"
            style={{
              marginLeft: 'auto', background: 'var(--glass-bg)', border: '1px solid var(--glass-border)',
              borderRadius: 8, color: 'var(--text2)', fontSize: 13, width: 26, height: 26, cursor: 'pointer',
            }}
          >
            ✕
          </button>
        </div>

        {/* The spawn itself — description/prompt/final result */}
        <MessageBlock
          message={{
            uuid: `isolated-${toolId}`,
            parentUuid: null,
            type: 'assistant',
            role: 'assistant',
            timestamp: spawnTimestamp,
            isMeta: false,
            isSidechain: false,
            sessionId: '',
            content: [block],
          }}
          toolResultMap={toolResultMap}
        />

        {/* What the subagent actually did — its own Bash/Read/Edit/etc. calls */}
        {traceLoading && (
          <div style={{ textAlign: 'center', fontSize: 12, color: 'var(--text3)', padding: '16px 0', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
            <span style={{ animation: 'spin 1s linear infinite', display: 'inline-block' }}>⟳</span>
            Loading what it actually ran…
          </div>
        )}
        {!traceLoading && traceMessages && traceMessages.length === 0 && (
          <div style={{ textAlign: 'center', fontSize: 12, color: 'var(--text3)', padding: '16px 0' }}>
            No step-by-step trace on disk for this subagent (older session, or it hasn&apos;t written any tool calls yet).
          </div>
        )}
        {!traceLoading && traceMessages && traceMessages.length > 0 && (
          <div style={{ marginTop: 4 }}>
            {traceMessages.filter(m => !m.isMeta).map(m => (
              <MessageBlock key={m.uuid} message={m} toolResultMap={traceToolResultMap} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
