'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { PaginatedSession, ParsedMessage } from '@/lib/types'
import MessageBlock from './MessageBlock'
import ImageAttachment, { AttachedImage, useImagePaste } from './ImageAttachment'

interface Props {
  initialData: PaginatedSession
  encodedFilepath: string
  sessionId: string
  projectPath: string
  scrollTarget?: string
}

export default function CodexLiveSession({
  initialData,
  encodedFilepath,
  sessionId,
  projectPath,
  scrollTarget,
}: Props) {
  const router = useRouter()
  const [firstMessage, setFirstMessage] = useState<ParsedMessage | null>(initialData.firstMessage)
  const [messages, setMessages] = useState<ParsedMessage[]>(initialData.messages)
  const [total, setTotal] = useState(initialData.total)
  const [hiddenCount, setHiddenCount] = useState(initialData.hiddenCount)
  const [hasMore, setHasMore] = useState(initialData.hasMore)
  const [loadingMore, setLoadingMore] = useState(false)
  const [connected, setConnected] = useState(false)
  const [inputText, setInputText] = useState('')
  const [sending, setSending] = useState(false)
  const [waitingForReply, setWaitingForReply] = useState(false)
  const [attachedImage, setAttachedImage] = useState<AttachedImage | null>(null)
  const [copiedId, setCopiedId] = useState(false)
  const [exported, setExported] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [sessionFilter, setSessionFilter] = useState('')
  const [replyTimedOut, setReplyTimedOut] = useState(false)

  const bottomRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const atBottomRef = useRef(true)
  const seenUuids = useRef(new Set([
    ...(initialData.firstMessage ? [initialData.firstMessage.uuid] : []),
    ...initialData.messages.map(m => m.uuid),
  ]))

  function checkAtBottom() {
    const el = containerRef.current
    if (!el) return
    atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
  }

  function scrollToBottom() {
    if (atBottomRef.current) bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => { scrollToBottom() }, [messages])

  useEffect(() => {
    if (!scrollTarget) return
    const timer = setTimeout(() => {
      const el = document.getElementById(scrollTarget)
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 120)
    return () => clearTimeout(timer)
  }, [scrollTarget, messages.length])

  useEffect(() => {
    const es = new EventSource(`/api/tail?mode=codex&f=${encodedFilepath}`)
    es.onopen = () => setConnected(true)
    es.onerror = () => setConnected(false)
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data) as { type?: string; message?: ParsedMessage }
        if (!data.message) return
        const msg = data.message
        if (seenUuids.current.has(msg.uuid)) return
        seenUuids.current.add(msg.uuid)
        setMessages(prev => [...prev, msg])
        setTotal(t => t + 1)
        if (msg.type === 'assistant') {
          setWaitingForReply(false)
          setReplyTimedOut(false)
        }
      } catch {}
    }
    return () => es.close()
  }, [encodedFilepath])

  async function loadMore() {
    if (loadingMore || !hasMore) return
    setLoadingMore(true)
    const oldestUuid = messages[0]?.uuid
    if (!oldestUuid) { setLoadingMore(false); return }
    try {
      const res = await fetch(`/api/session?mode=codex&f=${encodedFilepath}&limit=50&before=${oldestUuid}`)
      if (!res.ok) return
      const data: PaginatedSession = await res.json()
      setMessages(prev => {
        const existing = new Set(prev.map(m => m.uuid))
        const newOnes = data.messages.filter(m => !existing.has(m.uuid))
        newOnes.forEach(m => seenUuids.current.add(m.uuid))
        return [...newOnes, ...prev]
      })
      setHiddenCount(data.hiddenCount)
      setHasMore(data.hasMore)
      if (data.firstMessage && !firstMessage) setFirstMessage(data.firstMessage)
    } finally {
      setLoadingMore(false)
    }
  }

  const handlePaste = useImagePaste(setAttachedImage)

  async function sendInput(e: React.FormEvent) {
    e.preventDefault()
    if ((!inputText.trim() && !attachedImage) || sending) return
    setSending(true)
    setReplyTimedOut(false)
    let prompt = inputText.trim()

    const optimisticId = `__optimistic__${Date.now()}`
    const optimisticMsg: ParsedMessage = {
      uuid: optimisticId,
      parentUuid: null,
      type: 'user',
      role: 'user',
      timestamp: new Date().toISOString(),
      isMeta: false,
      isSidechain: false,
      sessionId,
      content: [{ type: 'text', text: attachedImage ? `${prompt}${prompt ? '\n' : ''}[Image attached]` : prompt }],
    }
    setMessages(prev => [...prev, optimisticMsg])
    setTotal(t => t + 1)
    setInputText('')
    setAttachedImage(null)
    atBottomRef.current = true

    try {
      if (attachedImage) {
        const isImage = attachedImage.mediaType.startsWith('image/')
        const endpoint = isImage ? '/api/upload-image' : '/api/upload-file'
        const body = isImage
          ? { data: attachedImage.base64, mediaType: attachedImage.mediaType }
          : { data: attachedImage.base64, name: attachedImage.name }
        const uploadRes = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        if (uploadRes.ok) {
          const { filepath } = await uploadRes.json()
          const tag = isImage ? `[Image: ${filepath}]` : `[File: ${filepath}]`
          prompt = prompt ? `${prompt}\n\n${tag}` : tag
        }
      }

      const res = await fetch('/api/input', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId, prompt, mode: 'codex' }),
      })

      if (res.ok) {
        setWaitingForReply(true)
        setTimeout(() => {
          setWaitingForReply(false)
          setReplyTimedOut(true)
        }, 60000)
      } else {
        setMessages(prev => prev.filter(m => m.uuid !== optimisticId))
        setTotal(t => t - 1)
        setInputText(prompt)
      }
    } finally {
      setSending(false)
    }
  }

  async function exportMarkdown() {
    if (exporting) return
    setExporting(true)
    try {
      const res = await fetch(`/api/export?mode=codex&f=${encodedFilepath}`)
      if (!res.ok) throw new Error('export failed')
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `codex-session-${sessionId.slice(0, 8)}.md`
      a.click()
      URL.revokeObjectURL(url)
      setExported(true)
      setTimeout(() => setExported(false), 1500)
    } finally {
      setExporting(false)
    }
  }

  const toolResultMap = useMemo(() => new Map<string, import('@/lib/types').ContentBlock>(), [])
  const firstInWindow = firstMessage && messages.some(m => m.uuid === firstMessage.uuid)
  const displayMessages = useMemo(() => {
    const q = sessionFilter.trim().toLowerCase()
    if (q.length < 2) return messages
    return messages.filter(msg => msg.content.some(block =>
      block.type === 'text' && (block.text ?? '').toLowerCase().includes(q)
    ))
  }, [messages, sessionFilter])

  return (
    <div className="session-view" style={{ display: 'flex', flexDirection: 'column', height: 'calc(100dvh - 54px)' }}>
      <div className="glass-lg session-header" style={{
        padding: '8px 16px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
        flexShrink: 0, borderLeft: 'none', borderRight: 'none', borderTop: 'none', borderRadius: 0,
        minHeight: 48, position: 'relative', zIndex: 10,
      }}>
        <button
          onClick={() => router.back()}
          style={{ background: 'none', border: 'none', color: 'var(--text2)', fontSize: 13, cursor: 'pointer', padding: 0, flexShrink: 0 }}
        >
          ← Back
        </button>

        <button
          className="hide-mobile"
          onClick={() => {
            const cmd = `cd ${projectPath} && codex exec resume ${sessionId}`
            navigator.clipboard?.writeText(cmd).then(() => {
              setCopiedId(true)
              setTimeout(() => setCopiedId(false), 1200)
            })
          }}
          title={copiedId ? 'Copied!' : `Copy resume command for session ${sessionId}`}
          style={{
            fontFamily: 'ui-monospace, monospace', fontSize: 11,
            color: copiedId ? 'var(--green)' : 'var(--text3)',
            background: 'var(--glass-bg)', border: '1px solid var(--glass-border)',
            borderRadius: 6, padding: '2px 8px', cursor: 'pointer',
            display: 'inline-flex', alignItems: 'center', gap: 5,
          }}
        >
          <span>{copiedId ? 'Copied' : `${sessionId.slice(0, 16)}…`}</span>
          <span style={{ fontSize: 10, opacity: 0.7 }}>{copiedId ? '✓' : '⎘'}</span>
        </button>

        <input
          value={sessionFilter}
          onChange={e => setSessionFilter(e.target.value)}
          placeholder="Filter…"
          className="hide-mobile"
          style={{
            background: 'var(--glass-bg)', border: '1px solid var(--glass-border)',
            borderRadius: 6, padding: '3px 10px', fontSize: 12, color: 'var(--text)',
            outline: 'none', width: sessionFilter ? 160 : 80, transition: 'width 0.2s ease',
          }}
        />

        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span className={connected ? 'dot-live' : ''} style={!connected ? {
            width: 6, height: 6, borderRadius: '50%', background: 'var(--text3)', display: 'inline-block',
          } : {}} />
          <span style={{ fontSize: 12, color: connected ? 'var(--green)' : 'var(--text3)' }}>
            {connected ? 'Live' : '…'}
          </span>
        </div>

        <div className="session-header-chips" style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <button className="chip" onClick={() => window.location.reload()} style={{ cursor: 'pointer', padding: '3px 10px' }}>
            ⟳<span className="hide-mobile" style={{ marginLeft: 4 }}>Refresh</span>
          </button>
          <button
            className="chip"
            onClick={exportMarkdown}
            disabled={exporting}
            style={{ cursor: exporting ? 'default' : 'pointer', padding: '3px 10px', color: exported ? 'var(--green)' : undefined }}
          >
            {exported ? '✓' : exporting ? '…' : '↓'}
            <span className="hide-mobile" style={{ marginLeft: 4 }}>{exported ? 'Saved' : 'Export MD'}</span>
          </button>
          <span className="chip">Codex exec</span>
          <span className="chip hide-mobile">{total} msgs</span>
          {waitingForReply && <span className="chip chip-green">Running</span>}
        </div>
      </div>

      <div ref={containerRef} onScroll={checkAtBottom} style={{ flex: 1, overflowY: 'auto', padding: 'clamp(10px,3vw,24px) clamp(8px,3vw,20px)' }}>
        <div style={{ maxWidth: 'min(100%, 840px)', margin: '0 auto' }}>
          {firstMessage && !firstInWindow && (
            <>
              <div style={{ marginBottom: 4 }}>
                <span style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Original instruction
                </span>
              </div>
              <div id={firstMessage.uuid} className="msg-row">
                <MessageBlock message={firstMessage} encodedFilepath={encodedFilepath} toolResultMap={toolResultMap} />
              </div>
            </>
          )}

          {hasMore && (
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 20 }}>
              <button
                onClick={loadMore}
                disabled={loadingMore}
                style={{
                  background: 'rgba(255,255,255,0.06)',
                  border: '1px solid rgba(255,255,255,0.10)',
                  borderRadius: 99,
                  color: 'var(--accent)',
                  fontSize: 12,
                  padding: '5px 16px',
                  cursor: 'pointer',
                }}
              >
                {loadingMore ? 'Loading…' : `↑ Load earlier messages${hiddenCount > 0 ? ` · ${hiddenCount} hidden` : ''}`}
              </button>
            </div>
          )}

          {displayMessages.map(msg => (
            <div key={msg.uuid} id={msg.uuid} className="msg-row">
              <MessageBlock message={msg} encodedFilepath={encodedFilepath} toolResultMap={toolResultMap} />
            </div>
          ))}

          {replyTimedOut && (
            <div style={{
              margin: '12px 0', padding: '10px 14px',
              background: 'color-mix(in srgb, var(--yellow) 8%, var(--glass-bg))',
              border: '1px solid color-mix(in srgb, var(--yellow) 25%, transparent)',
              borderRadius: 10, fontSize: 13, color: 'var(--text2)',
            }}>
              No new assistant message detected yet. Refresh or wait for the transcript file to update.
            </div>
          )}

          {waitingForReply && (
            <div style={{ display: 'flex', justifyContent: 'flex-start', margin: '12px 0' }}>
              <div style={{
                background: 'rgba(255,255,255,0.055)', backdropFilter: 'blur(16px)',
                border: '1px solid rgba(255,255,255,0.09)', borderRadius: '14px 14px 14px 2px',
                padding: '12px 18px', display: 'flex', alignItems: 'center', gap: 8,
                fontSize: 14, color: 'var(--text2)',
              }}>
                Codex is running…
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      <div className="chat-input-wrap">
        <form onSubmit={sendInput}>
          {attachedImage && (
            <div style={{ maxWidth: 760, margin: '0 auto 8px', display: 'flex', alignItems: 'center', gap: 10,
              padding: '8px 12px', background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', borderRadius: 12 }}>
              <span style={{ fontSize: 12, color: 'var(--text2)' }}>{attachedImage.name}</span>
              <button type="button" onClick={() => setAttachedImage(null)}
                style={{ background: 'none', border: 'none', color: 'var(--text3)', cursor: 'pointer', marginLeft: 'auto', fontSize: 16, padding: '4px 6px' }}>✕</button>
            </div>
          )}
          <div className="chat-pill">
            <ImageAttachment image={attachedImage} onAttach={setAttachedImage} onRemove={() => setAttachedImage(null)} />
            <textarea
              className="chat-pill-textarea"
              value={inputText}
              onChange={e => setInputText(e.target.value)}
              onPaste={handlePaste}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendInput(e) }
              }}
              placeholder="Continue this Codex session…"
              rows={1}
            />
            <button type="submit" className="chat-send-btn" disabled={(!inputText.trim() && !attachedImage) || sending}>
              {sending ? '…' : '↗'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
