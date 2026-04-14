'use client'
import { useEffect, useRef, useState } from 'react'
import { ParsedMessage } from '@/lib/types'
import MessageBlock from './MessageBlock'
import ProcessControls from './ProcessControls'
import Link from 'next/link'

interface Props {
  initialMessages: ParsedMessage[]
  filepath: string
  encodedFilepath: string
  sessionId: string
  pid: number | null
  processState: 'running' | 'paused' | 'dead' | 'unknown'
}

export default function LiveSession({ initialMessages, encodedFilepath, sessionId, pid, processState: initialState }: Props) {
  const [messages, setMessages] = useState<ParsedMessage[]>(initialMessages.filter(m => !m.isMeta))
  const [connected, setConnected] = useState(false)
  const [inputText, setInputText] = useState('')
  const [sending, setSending] = useState(false)
  const [procState] = useState(initialState)
  const bottomRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const atBottomRef = useRef(true)
  const seenUuids = useRef(new Set(initialMessages.map(m => m.uuid)))

  function checkAtBottom() {
    const el = containerRef.current
    if (!el) return
    atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
  }

  function scrollToBottom() {
    if (atBottomRef.current) bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    const es = new EventSource(`/api/tail?f=${encodedFilepath}`)
    es.onopen = () => setConnected(true)
    es.onerror = () => setConnected(false)
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data)
        if (data.type === 'catchup') return
        if (data.type === 'message') {
          const msg: ParsedMessage = data.message
          if (!seenUuids.current.has(msg.uuid)) {
            seenUuids.current.add(msg.uuid)
            setMessages(prev => [...prev, msg])
          }
        }
      } catch { /* ignore */ }
    }
    return () => es.close()
  }, [encodedFilepath])

  useEffect(() => { scrollToBottom() }, [messages])

  async function sendInput(e: React.FormEvent) {
    e.preventDefault()
    if (!inputText.trim() || sending) return
    setSending(true)
    try {
      await fetch('/api/input', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId, prompt: inputText.trim() }),
      })
      setInputText('')
    } finally {
      setSending(false)
    }
  }

  const isLive = procState === 'running' || procState === 'paused'
  const msgCount = messages.filter(m => !m.isMeta).length

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 56px)' }}>

      {/* Glass header bar */}
      <div className="glass-lg" style={{
        padding: '10px 24px',
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        flexShrink: 0,
        borderLeft: 'none',
        borderRight: 'none',
        borderTop: 'none',
        borderRadius: 0,
      }}>
        <Link href="javascript:history.back()" style={{ color: 'var(--text2)', fontSize: 13, textDecoration: 'none' }}>
          ← Back
        </Link>

        <span style={{
          fontFamily: 'ui-monospace, monospace',
          fontSize: 11,
          color: 'var(--text3)',
          background: 'rgba(255,255,255,0.05)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 6,
          padding: '2px 8px',
        }}>
          {sessionId.slice(0, 16)}…
        </span>

        {/* Live indicator */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span className={connected ? 'dot-live' : ''} style={!connected ? {
            width: 7, height: 7, borderRadius: '50%', background: 'var(--text3)', display: 'inline-block',
          } : {}} />
          <span style={{ fontSize: 12, color: connected ? 'var(--green)' : 'var(--text3)' }}>
            {connected ? 'Live' : 'Connecting…'}
          </span>
        </div>

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 14 }}>
          {msgCount > 0 && (
            <span className="chip">{msgCount} messages</span>
          )}
          {procState !== 'dead' && procState !== 'unknown' && pid && (
            <ProcessControls pid={pid} state={procState} />
          )}
        </div>
      </div>

      {/* Messages area */}
      <div
        ref={containerRef}
        onScroll={checkAtBottom}
        style={{ flex: 1, overflowY: 'auto', padding: '24px 28px' }}
      >
        <div style={{ maxWidth: 840, margin: '0 auto' }}>
          {messages.length === 0 ? (
            <div style={{ textAlign: 'center', color: 'var(--text2)', marginTop: 80 }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>💬</div>
              <p style={{ fontSize: 15 }}>No messages yet</p>
            </div>
          ) : (
            messages.map(msg => <MessageBlock key={msg.uuid} message={msg} />)
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      {/* Glass input bar */}
      <div className="glass-lg" style={{
        padding: '14px 24px',
        flexShrink: 0,
        borderLeft: 'none',
        borderRight: 'none',
        borderBottom: 'none',
        borderRadius: 0,
      }}>
        <form onSubmit={sendInput} style={{ display: 'flex', gap: 10, maxWidth: 840, margin: '0 auto' }}>
          <input
            className="glass-input"
            value={inputText}
            onChange={e => setInputText(e.target.value)}
            placeholder={isLive ? 'Send a message to this session…' : 'Continue this session with a follow-up…'}
            style={{ flex: 1, fontSize: 14, padding: '10px 16px', borderRadius: 12 }}
          />
          <button
            type="submit"
            className="glass-btn-prominent"
            disabled={!inputText.trim() || sending}
            style={{ width: 'auto', padding: '10px 20px', fontSize: 14, flexShrink: 0 }}
          >
            {sending ? '…' : 'Send'}
          </button>
        </form>
      </div>
    </div>
  )
}
