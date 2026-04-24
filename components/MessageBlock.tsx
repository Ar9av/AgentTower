'use client'
import { ParsedMessage, ContentBlock } from '@/lib/types'

function TextContent({ text }: { text: string }) {
  const lines = text.split('\n')
  const parts: React.ReactNode[] = []
  let inFence = false
  let fenceLang = ''
  let fenceLines: string[] = []
  let key = 0

  function flushFence() {
    parts.push(
      <pre key={key++} style={{ background: 'var(--bg3)', border: '1px solid var(--glass-border)', borderRadius: 8, padding: '10px 14px', overflowX: 'auto', fontSize: 13, margin: '8px 0', fontFamily: 'ui-monospace, monospace' }}>
        <code>{fenceLines.join('\n')}</code>
      </pre>
    )
    fenceLines = []
    fenceLang = ''
  }

  for (const line of lines) {
    if (!inFence && line.startsWith('```')) {
      inFence = true
      fenceLang = line.slice(3)
      continue
    }
    if (inFence) {
      if (line.startsWith('```')) {
        inFence = false
        flushFence()
      } else {
        fenceLines.push(line)
      }
      continue
    }
    const segments = line.split(/(`[^`]+`|\*\*[^*]+\*\*)/)
    const inline = segments.map((seg, i) => {
      if (seg.startsWith('`') && seg.endsWith('`')) {
        return <code key={i} style={{ background: 'var(--bg3)', padding: '1px 4px', borderRadius: 4, fontSize: 13, fontFamily: 'ui-monospace, monospace' }}>{seg.slice(1, -1)}</code>
      }
      if (seg.startsWith('**') && seg.endsWith('**')) {
        return <strong key={i}>{seg.slice(2, -2)}</strong>
      }
      return seg
    })
    parts.push(<span key={key++}>{inline}<br /></span>)
  }
  if (inFence && fenceLines.length) flushFence()

  // suppress unused var warning from linter — fenceLang is set but only used for future syntax highlighting
  void fenceLang

  return <div style={{ lineHeight: 1.6, fontSize: 14, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{parts}</div>
}

function getInputSummary(block: ContentBlock): string {
  const input = block.tool_input
  if (!input) return ''
  const name = block.tool_name ?? ''

  if ((name === 'Bash' || name === 'Shell') && typeof input.command === 'string') {
    const cmd = input.command.trim()
    return cmd.length > 72 ? cmd.slice(0, 72) + '…' : cmd
  }
  if ((name === 'Read' || name === 'Write' || name === 'Edit' || name === 'MultiEdit') && typeof input.file_path === 'string') {
    return input.file_path
  }
  if (name === 'WebSearch' && typeof input.query === 'string') {
    return input.query
  }
  if (name === 'WebFetch' && typeof input.url === 'string') {
    return input.url
  }
  if (name === 'Agent' && typeof input.description === 'string') {
    const d = input.description as string
    return d.length > 72 ? d.slice(0, 72) + '…' : d
  }
  if ((name === 'TodoWrite' || name === 'TaskCreate') && typeof input.content === 'string') {
    return (input.content as string).slice(0, 72)
  }

  // Generic fallback: first non-empty string value
  for (const v of Object.values(input)) {
    if (typeof v === 'string' && v.trim()) {
      return v.length > 72 ? v.slice(0, 72) + '…' : v
    }
  }
  return ''
}

function CombinedToolBlock({ block, result }: { block: ContentBlock; result?: ContentBlock }) {
  const isDone = result !== undefined
  const isError = result?.is_error
  const resultText = result?.tool_result?.map(b => b.text ?? '').join('\n') ?? ''
  const inputSummary = getInputSummary(block)

  const accentColor = isError ? 'var(--red)' : isDone ? 'var(--green)' : 'rgba(192,132,252,0.9)'
  const bgColor = isError
    ? 'color-mix(in srgb, var(--red) 5%, var(--glass-bg))'
    : 'rgba(192,132,252,0.05)'
  const borderColor = isError
    ? 'color-mix(in srgb, var(--red) 22%, transparent)'
    : 'rgba(192,132,252,0.16)'

  return (
    <details style={{
      margin: '5px 0',
      background: bgColor,
      border: `1px solid ${borderColor}`,
      borderRadius: 10,
      backdropFilter: 'blur(8px)',
      overflow: 'hidden',
    }}>
      <summary style={{
        padding: '8px 12px',
        cursor: 'pointer',
        fontSize: 13,
        userSelect: 'none',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        fontWeight: 500,
        listStyle: 'none',
      }}>
        {/* Status indicator */}
        <span style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 18,
          height: 18,
          borderRadius: '50%',
          background: `color-mix(in srgb, ${accentColor} 18%, transparent)`,
          border: `1px solid color-mix(in srgb, ${accentColor} 35%, transparent)`,
          fontSize: 10,
          color: accentColor,
          flexShrink: 0,
          animation: !isDone ? 'spin 1.4s linear infinite' : undefined,
        }}>
          {isError ? '✗' : isDone ? '✓' : '⟳'}
        </span>

        {/* Tool name */}
        <span style={{ color: 'var(--purple)', fontFamily: 'ui-monospace, monospace', fontSize: 12, fontWeight: 600, flexShrink: 0 }}>
          {block.tool_name}
        </span>

        {/* Input summary */}
        {inputSummary && (
          <span style={{
            color: 'var(--text3)',
            fontSize: 12,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            minWidth: 0,
          }}>
            {inputSummary}
          </span>
        )}

        {/* Running badge */}
        {!isDone && (
          <span style={{
            marginLeft: 'auto',
            fontSize: 11,
            color: 'rgba(192,132,252,0.7)',
            flexShrink: 0,
          }}>
            running…
          </span>
        )}
      </summary>

      {/* Input */}
      <div style={{ borderTop: `1px solid ${borderColor}` }}>
        <div style={{
          padding: '4px 12px',
          fontSize: 10,
          color: 'var(--text3)',
          fontWeight: 700,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          background: 'rgba(0,0,0,0.18)',
        }}>
          Input
        </div>
        <pre style={{
          margin: 0,
          padding: '8px 14px',
          fontSize: 12,
          overflowX: 'auto',
          overflowY: 'auto',
          maxHeight: 220,
          color: 'var(--text2)',
          fontFamily: 'ui-monospace, monospace',
        }}>
          {JSON.stringify(block.tool_input, null, 2)}
        </pre>
      </div>

      {/* Result */}
      {isDone && (
        <div style={{ borderTop: '1px solid var(--glass-border)' }}>
          <div style={{
            padding: '4px 12px',
            fontSize: 10,
            color: isError ? 'var(--red)' : 'var(--text3)',
            fontWeight: 700,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            background: 'rgba(0,0,0,0.18)',
          }}>
            {isError ? 'Error' : 'Output'}
          </div>
          <pre style={{
            margin: 0,
            padding: '8px 14px',
            fontSize: 12,
            overflowX: 'auto',
            overflowY: 'auto',
            maxHeight: 320,
            background: 'var(--bg3)',
            color: isError ? 'var(--red)' : 'var(--text2)',
            fontFamily: 'ui-monospace, monospace',
          }}>
            {resultText || '(empty)'}
          </pre>
        </div>
      )}
    </details>
  )
}

// Fallback for standalone tool_result blocks (shouldn't normally render after grouping)
function ToolResultBlock({ block }: { block: ContentBlock }) {
  const text = block.tool_result?.map(b => b.text ?? '').join('\n') ?? ''
  const isError = block.is_error
  return (
    <details style={{
      margin: '6px 0',
      background: isError
        ? 'color-mix(in srgb, var(--red) 8%, var(--glass-bg))'
        : 'var(--glass-bg)',
      border: `1px solid ${isError ? 'color-mix(in srgb, var(--red) 28%, transparent)' : 'var(--glass-border)'}`,
      borderRadius: 8,
      backdropFilter: 'blur(8px)',
    }}>
      <summary style={{ padding: '7px 12px', cursor: 'pointer', fontSize: 12, color: isError ? 'var(--red)' : 'var(--text2)', userSelect: 'none', fontWeight: 500 }}>
        {isError ? '✗ Tool error' : '↩ Tool result'}
      </summary>
      <pre style={{
        margin: 0, padding: '8px 14px', fontSize: 12, overflowX: 'auto',
        borderTop: `1px solid var(--glass-border)`,
        color: 'var(--text2)', fontFamily: 'ui-monospace, monospace', maxHeight: 300,
        background: 'var(--bg3)', borderRadius: '0 0 8px 8px',
      }}>
        {text || '(empty)'}
      </pre>
    </details>
  )
}

function ThinkingBlock({ block }: { block: ContentBlock }) {
  return (
    <details style={{
      margin: '6px 0',
      background: 'color-mix(in srgb, var(--yellow) 8%, var(--glass-bg))',
      border: '1px solid color-mix(in srgb, var(--yellow) 22%, transparent)',
      borderRadius: 8,
      backdropFilter: 'blur(8px)',
    }}>
      <summary style={{ padding: '7px 12px', cursor: 'pointer', fontSize: 12, color: 'var(--yellow)', userSelect: 'none', fontWeight: 500 }}>
        💭 Thinking
      </summary>
      <div style={{ padding: '8px 14px', fontSize: 13, color: 'var(--text2)', borderTop: '1px solid color-mix(in srgb, var(--yellow) 18%, transparent)', whiteSpace: 'pre-wrap', fontStyle: 'italic' }}>
        {block.thinking}
      </div>
    </details>
  )
}

function ImageBlock({ block, message, encodedFilepath }: { block: ContentBlock; message: ParsedMessage; encodedFilepath?: string }) {
  const src = encodedFilepath
    ? `/api/image?f=${encodedFilepath}&uuid=${message.uuid}&idx=${block.imageBlockIdx ?? 0}`
    : null

  if (!src) return (
    <div style={{ fontSize: 12, color: 'var(--text3)', fontStyle: 'italic' }}>[image]</div>
  )

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt="Session image"
      style={{
        maxWidth: '100%',
        maxHeight: 480,
        borderRadius: 8,
        border: '1px solid rgba(255,255,255,0.08)',
        display: 'block',
        marginTop: 6,
        objectFit: 'contain',
      }}
      loading="lazy"
    />
  )
}

export default function MessageBlock({
  message,
  encodedFilepath,
  toolResultMap,
}: {
  message: ParsedMessage
  encodedFilepath?: string
  toolResultMap?: Map<string, ContentBlock>
}) {
  const isUser = message.type === 'user'
  const isPending = message.uuid.startsWith('__optimistic__')
  if (message.isMeta) return null

  const displayBlocks = message.content.filter(b =>
    b.type === 'text' || b.type === 'tool_use' || b.type === 'tool_result' || b.type === 'thinking' || b.type === 'image'
  )
  if (displayBlocks.length === 0) return null

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: isUser ? 'flex-end' : 'flex-start',
      opacity: isPending ? 0.65 : 1,
      transition: 'opacity 0.3s ease',
      margin: '12px 0',
    }}>
      <div style={{
        fontSize: 11,
        color: 'var(--text2)',
        marginBottom: 4,
        paddingLeft: isUser ? 0 : 4,
        paddingRight: isUser ? 4 : 0,
      }}>
        {isUser ? 'You' : 'Claude'} · {new Date(message.timestamp).toLocaleTimeString()}
      </div>
      <div style={{
        maxWidth: 'min(80%, 700px)',
        background: isUser
          ? 'color-mix(in srgb, var(--accent) 22%, var(--glass-bg))'
          : 'var(--glass-bg)',
        backdropFilter: isUser ? undefined : 'blur(16px) saturate(1.5)',
        WebkitBackdropFilter: isUser ? undefined : 'blur(16px) saturate(1.5)',
        color: 'var(--text)',
        borderRadius: isUser ? '14px 14px 2px 14px' : '14px 14px 14px 2px',
        padding: 'clamp(9px,2vw,12px) clamp(12px,2vw,16px)',
        border: isUser
          ? '1px solid color-mix(in srgb, var(--accent) 50%, transparent)'
          : '1px solid var(--glass-border)',
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
      {isPending && (
        <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 3, paddingRight: 4 }}>
          Sending…
        </div>
      )}
      {message.usage && !isPending && (
        <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 3, paddingRight: isUser ? 4 : 0 }}>
          {message.usage.input_tokens}↑ {message.usage.output_tokens}↓
          {message.usage.cache_read_input_tokens ? ` ${message.usage.cache_read_input_tokens} cached` : ''}
        </div>
      )}
    </div>
  )
}
