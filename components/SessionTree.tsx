'use client'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ParsedMessage, ContentBlock } from '@/lib/types'
import BrandIcon from './icons/BrandIcon'
import AutoBrandIcon from './icons/AutoBrandIcon'
import { brandForAgentType } from '@/lib/brands'
import SubagentTraceModal from './SubagentTraceModal'

interface AgentBranch {
  id: string                  // tool_id (unique per spawn)
  spawnMessageUuid: string     // message the Agent/Task tool_use lives in
  block: ContentBlock          // the raw tool_use block — reused to render an isolated trace
  agentType: string
  description: string
  prompt: string
  status: 'running' | 'done' | 'error'
  resultText: string
  ts: string
}

function collectBranches(firstMessage: ParsedMessage | null, messages: ParsedMessage[], toolResultMap: Map<string, ContentBlock>): AgentBranch[] {
  const all = firstMessage ? [firstMessage, ...messages] : messages
  const branches: AgentBranch[] = []
  for (const msg of all) {
    if (msg.isMeta) continue
    for (const block of msg.content) {
      if (block.type !== 'tool_use') continue
      if (block.tool_name !== 'Agent' && block.tool_name !== 'Task') continue
      const input = block.tool_input as { description?: string; prompt?: string; subagent_type?: string } | null
      const result = block.tool_id ? toolResultMap.get(block.tool_id) : undefined
      const resultText = result?.tool_result?.map(b => b.text ?? '').join('') ?? ''
      const description = input?.description ?? (input?.prompt ? input.prompt.slice(0, 90) + (input.prompt.length > 90 ? '…' : '') : '')
      branches.push({
        id: block.tool_id ?? `${msg.uuid}-${branches.length}`,
        spawnMessageUuid: msg.uuid,
        block,
        agentType: input?.subagent_type ?? '',
        description,
        prompt: input?.prompt ?? '',
        status: !result ? 'running' : result.is_error ? 'error' : 'done',
        resultText,
        ts: msg.timestamp,
      })
    }
  }
  return branches
}

function extractRootPrompt(firstMessage: ParsedMessage | null, messages: ParsedMessage[]): string {
  const all = firstMessage ? [firstMessage, ...messages] : messages
  for (const m of all) {
    if (m.isMeta || m.type !== 'user') continue
    for (const block of m.content) {
      if (block.type === 'text' && block.text) {
        const text = block.text.replace(/<[^>]+>/g, '').trim()
        if (text) return text
      }
    }
  }
  return '(no prompt)'
}

const STATUS_COLOR: Record<AgentBranch['status'], string> = {
  running: 'var(--yellow)',
  done: 'var(--green)',
  error: 'var(--red)',
}
const STATUS_LABEL: Record<AgentBranch['status'], string> = {
  running: 'running…',
  done: 'done',
  error: 'error',
}

interface Path { id: string; d: string; active: boolean }

export default function SessionTree({
  messages,
  firstMessage,
  toolResultMap,
  loadingFullHistory,
  encodedFilepath,
}: {
  messages: ParsedMessage[]
  firstMessage: ParsedMessage | null
  toolResultMap: Map<string, ContentBlock>
  loadingFullHistory?: boolean
  encodedFilepath: string
}) {
  const branches = useMemo(() => collectBranches(firstMessage, messages, toolResultMap), [firstMessage, messages, toolResultMap])
  const rootPrompt = useMemo(() => extractRootPrompt(firstMessage, messages), [firstMessage, messages])

  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [dimsVersion, setDimsVersion] = useState(0)
  const [paths, setPaths] = useState<Path[]>([])
  const [canvasH, setCanvasH] = useState(0)
  const [rootHighlight, setRootHighlight] = useState(false)
  const [viewingBranchId, setViewingBranchId] = useState<string | null>(null)
  const viewingBranch = branches.find(b => b.id === viewingBranchId) ?? null

  const wrapRef = useRef<HTMLDivElement | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const nodeRefs = useRef<Map<string, HTMLDivElement>>(new Map())

  // "↑ Parent" — pure in-tree navigation back up to the root card, no leaving Tree view
  function scrollToRoot() {
    rootRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    setRootHighlight(true)
    setTimeout(() => setRootHighlight(false), 1400)
  }

  // Recompute connector curves whenever layout-affecting things change
  useLayoutEffect(() => {
    const wrap = wrapRef.current
    const root = rootRef.current
    if (!wrap || !root) return

    const rx = root.offsetLeft + root.offsetWidth / 2
    const ry = root.offsetTop + root.offsetHeight

    const next: Path[] = []
    let maxBottom = ry
    for (const b of branches) {
      const el = nodeRefs.current.get(b.id)
      if (!el) continue
      const bx = el.offsetLeft + el.offsetWidth / 2
      const by = el.offsetTop
      const bottom = el.offsetTop + el.offsetHeight
      if (bottom > maxBottom) maxBottom = bottom
      const dy = Math.max(24, (by - ry) / 2)
      next.push({
        id: b.id,
        d: `M ${rx} ${ry} C ${rx} ${ry + dy}, ${bx} ${by - dy}, ${bx} ${by}`,
        active: expandedId === b.id,
      })
    }
    setPaths(next)
    setCanvasH(maxBottom + 24)
  }, [branches, expandedId, dimsVersion])

  // Redraw on container resize (sidebar toggle, window resize)
  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => setDimsVersion(v => v + 1))
    ro.observe(wrap)
    return () => ro.disconnect()
  }, [])

  if (branches.length === 0) {
    return (
      <div style={{ textAlign: 'center', color: 'var(--text2)', marginTop: 80 }}>
        <div style={{ fontSize: 32, marginBottom: 12 }}>{loadingFullHistory ? '⏳' : '🌳'}</div>
        <p>{loadingFullHistory ? 'Loading full session history…' : 'No subagents spawned in this session yet'}</p>
      </div>
    )
  }

  return (
    <>
    <div ref={wrapRef} style={{ position: 'relative', padding: '28px 16px 56px', minHeight: canvasH || undefined }}>
      {loadingFullHistory && (
        <div style={{
          textAlign: 'center', fontSize: 12, color: 'var(--text3)', marginBottom: 16,
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
        }}>
          <span style={{ animation: 'spin 1s linear infinite', display: 'inline-block' }}>⟳</span>
          Loading earlier subagents…
        </div>
      )}
      <svg
        width="100%"
        height={canvasH}
        style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none', overflow: 'visible' }}
      >
        {paths.map(p => (
          <path
            key={p.id}
            d={p.d}
            fill="none"
            stroke={p.active ? 'var(--accent)' : 'var(--glass-border)'}
            strokeWidth={p.active ? 2 : 1.5}
            strokeDasharray="4 5"
            strokeLinecap="round"
          />
        ))}
      </svg>

      {/* Root card — no `position` here: keeps rootRef's offsetParent resolving to
          `wrapRef` above, which the connector-path math in the layout effect assumes. */}
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 56 }}>
        <div
          ref={rootRef}
          style={{
            maxWidth: 420, width: '100%',
            background: 'color-mix(in srgb, var(--accent) 8%, var(--glass-bg))',
            border: '1px solid color-mix(in srgb, var(--accent) 40%, var(--glass-border))',
            borderRadius: 14, padding: '12px 16px',
            boxShadow: rootHighlight
              ? 'var(--specular), 0 0 0 3px color-mix(in srgb, var(--accent) 45%, transparent), 0 4px 20px rgba(0,0,0,0.12)'
              : 'var(--specular), 0 4px 20px rgba(0,0,0,0.12)',
            position: 'relative', zIndex: 1,
            transition: 'box-shadow 0.2s ease',
          }}
        >
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--accent)', marginBottom: 4 }}>
            Session
          </div>
          <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.4, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical' }}>
            {rootPrompt}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 6 }}>
            {branches.length} subagent{branches.length !== 1 ? 's' : ''} spawned
          </div>
        </div>
      </div>

      {/* Branch cards — same offsetParent constraint as the root wrapper above */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, justifyContent: 'center' }}>
        {branches.map(b => {
          const isExpanded = expandedId === b.id
          const brand = brandForAgentType(b.agentType)
          return (
            <div
              key={b.id}
              ref={el => { if (el) nodeRefs.current.set(b.id, el); else nodeRefs.current.delete(b.id) }}
              onClick={() => setExpandedId(isExpanded ? null : b.id)}
              style={{
                width: isExpanded ? 340 : 220,
                background: 'var(--glass-bg)',
                backdropFilter: 'blur(16px) saturate(1.5)',
                border: `1px solid ${isExpanded ? 'color-mix(in srgb, var(--accent) 50%, var(--glass-border))' : 'var(--glass-border)'}`,
                borderRadius: 12,
                padding: '10px 12px',
                cursor: 'pointer',
                transition: 'width 0.18s ease, border-color 0.18s ease',
                boxShadow: isExpanded ? 'var(--specular), 0 6px 24px rgba(0,0,0,0.16)' : 'var(--specular)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: STATUS_COLOR[b.status], flexShrink: 0, animation: b.status === 'running' ? 'pulse-permission 1.4s ease-in-out infinite' : undefined }} />
                {brand
                  ? <BrandIcon name={brand} size={13} title={b.agentType || 'Agent'} />
                  : b.agentType.includes(':')
                    ? <AutoBrandIcon name={b.agentType.split(':')[0]} size={13} title={b.agentType} />
                    : <BrandIcon name="claude" size={13} title={b.agentType || 'Agent'} />}
                <span style={{ fontSize: 11, color: 'var(--text3)', fontFamily: 'ui-monospace, monospace' }}>{b.agentType || 'agent'}</span>
                <span style={{ marginLeft: 'auto', fontSize: 10, color: STATUS_COLOR[b.status], flexShrink: 0 }}>{STATUS_LABEL[b.status]}</span>
              </div>

              <div style={{
                fontSize: 12.5, color: 'var(--text)', marginTop: 6, lineHeight: 1.4,
                overflow: 'hidden',
                display: isExpanded ? 'block' : '-webkit-box',
                WebkitLineClamp: isExpanded ? undefined : 2,
                WebkitBoxOrient: 'vertical',
              }}>
                {b.description || '(no description)'}
              </div>

              {isExpanded && (
                <div style={{ marginTop: 8, borderTop: '1px solid var(--glass-border)', paddingTop: 8 }} onClick={e => e.stopPropagation()}>
                  {b.prompt && (
                    <>
                      <div style={{ fontSize: 10, color: 'var(--text3)', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 3 }}>Prompt</div>
                      <pre style={{ margin: 0, marginBottom: 8, fontSize: 11.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: 'var(--text2)', fontFamily: 'ui-monospace, monospace', maxHeight: 160, overflowY: 'auto' }}>
                        {b.prompt.slice(0, 800)}{b.prompt.length > 800 ? '…' : ''}
                      </pre>
                    </>
                  )}
                  {b.status !== 'running' && (
                    <>
                      <div style={{ fontSize: 10, color: b.status === 'error' ? 'var(--red)' : 'var(--text3)', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 3 }}>
                        {b.status === 'error' ? 'Error' : 'Result'}
                      </div>
                      <pre style={{ margin: 0, marginBottom: 8, fontSize: 11.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: b.status === 'error' ? 'var(--red)' : 'var(--text2)', fontFamily: 'ui-monospace, monospace', maxHeight: 200, overflowY: 'auto' }}>
                        {b.resultText || '(no output)'}
                      </pre>
                    </>
                  )}
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      onClick={scrollToRoot}
                      title="Scroll up to the session root"
                      style={{
                        background: 'none', border: '1px solid var(--glass-border)', borderRadius: 6,
                        color: 'var(--text2)', fontSize: 11.5, padding: '4px 10px', cursor: 'pointer',
                      }}
                    >
                      ↑ Parent
                    </button>
                    <button
                      onClick={() => setViewingBranchId(b.id)}
                      title="Open this subagent's trace on its own"
                      style={{
                        background: 'none', border: '1px solid var(--glass-border)', borderRadius: 6,
                        color: 'var(--accent)', fontSize: 11.5, padding: '4px 10px', cursor: 'pointer',
                      }}
                    >
                      ↩ View trace
                    </button>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>

    {viewingBranch && (
      <SubagentTraceModal
        toolId={viewingBranch.id}
        block={viewingBranch.block}
        spawnTimestamp={viewingBranch.ts}
        toolResultMap={toolResultMap}
        encodedFilepath={encodedFilepath}
        onClose={() => setViewingBranchId(null)}
      />
    )}
    </>
  )
}
