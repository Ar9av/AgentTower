'use client'
import { ParsedMessage, ContentBlock } from '@/lib/types'

function TextContent({ text }: { text: string }) {
  // Very basic markdown: code fences → <pre>, inline code, bold, newlines
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
    // Inline: bold **x** and `code`
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

  return <div style={{ lineHeight: 1.6, fontSize: 14, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{parts}</div>
}

function ToolUseBlock({ block }: { block: ContentBlock }) {
  return (
    <details style={{ margin: '6px 0', background: 'rgba(192,132,252,0.06)', border: '1px solid rgba(192,132,252,0.18)', borderRadius: 8, backdropFilter: 'blur(8px)' }}>
      <summary style={{ padding: '7px 12px', cursor: 'pointer', fontSize: 12, color: 'var(--purple)', userSelect: 'none', display: 'flex', alignItems: 'center', gap: 6, fontWeight: 500 }}>
        <span style={{ opacity: 0.8 }}>⚙</span> {block.tool_name}
      </summary>
      <pre style={{ margin: 0, padding: '8px 14px', fontSize: 12, overflowX: 'auto', borderTop: '1px solid rgba(192,132,252,0.15)', color: 'var(--text2)', fontFamily: 'ui-monospace, monospace' }}>
        {JSON.stringify(block.tool_input, null, 2)}
      </pre>
    </details>
  )
}

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
}: {
  message: ParsedMessage
  encodedFilepath?: string
}) {
  const isUser = message.type === 'user'
  const isPending = message.uuid.startsWith('__optimistic__')
  if (message.isMeta) return null

  // Skip messages with only internal content blocks (attachments etc)
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
          if (block.type === 'tool_use') return <ToolUseBlock key={i} block={block} />
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
