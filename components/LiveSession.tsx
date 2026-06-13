'use client'
import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { ParsedMessage, PaginatedSession } from '@/lib/types'
import MessageBlock from './MessageBlock'
import ImageAttachment, { AttachedImage, useImagePaste } from './ImageAttachment'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import SessionTagsButton from './SessionTagsButton'
import SkillPicker, { useSkills } from './SkillPicker'

type ProcState = 'running' | 'paused' | 'dead' | 'unknown'

interface Props {
  initialData: PaginatedSession
  encodedFilepath: string
  sessionId: string
  projectPath: string
  pid: number | null
  processState: ProcState
  scrollTarget?: string
}

function lastRole(messages: ParsedMessage[]): 'user' | 'assistant' | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (!messages[i].isMeta) return messages[i].role
  }
  return null
}

export default function LiveSession({
  initialData,
  encodedFilepath,
  sessionId,
  projectPath,
  pid: initialPid,
  processState: initialProcState,
  scrollTarget,
}: Props) {
  // ── message state ─────────────────────────────────────────────────────────
  const [firstMessage, setFirstMessage]   = useState<ParsedMessage | null>(initialData.firstMessage)
  const [messages, setMessages]           = useState<ParsedMessage[]>(initialData.messages)
  const [total, setTotal]                 = useState(initialData.total)
  const [hiddenCount, setHiddenCount]     = useState(initialData.hiddenCount)
  const [hasMore, setHasMore]             = useState(initialData.hasMore)
  const [loadingMore, setLoadingMore]     = useState(false)

  // ── process / UI state ────────────────────────────────────────────────────
  const [connected, setConnected]           = useState(false)
  const [procState, setProcState]           = useState<ProcState>(initialProcState)
  const [pid, setPid]                       = useState<number | null>(initialPid)
  const [inputText, setInputText]           = useState('')
  const [sending, setSending]               = useState(false)
  const [wasInterrupted, setWasInterrupted] = useState(false)
  const [attachedImage, setAttachedImage]   = useState<AttachedImage | null>(null)
  const [copiedId, setCopiedId]             = useState(false)
  const [exported, setExported]             = useState(false)
  // Optimistic "waiting for Claude" — set true immediately after send, cleared when assistant replies
  const [waitingForReply, setWaitingForReply] = useState(false)

  const [replyTimedOut, setReplyTimedOut]   = useState(false)
  const [continuationUrl, setContinuationUrl] = useState<string | null>(null)
  const [forking, setForking]               = useState<string | null>(null)
  const [sessionFilter, setSessionFilter]   = useState('')
  const router = useRouter()

  const bottomRef           = useRef<HTMLDivElement>(null)
  const containerRef        = useRef<HTMLDivElement>(null)
  const atBottomRef         = useRef(true)
  const replyTimeoutRef     = useRef<ReturnType<typeof setTimeout> | null>(null)
  const continuationPollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const seenUuids    = useRef(new Set([
    ...(initialData.firstMessage ? [initialData.firstMessage.uuid] : []),
    ...initialData.messages.map(m => m.uuid),
  ]))
  const prevState = useRef<ProcState>(initialProcState)

  // ── scroll ────────────────────────────────────────────────────────────────
  function checkAtBottom() {
    const el = containerRef.current
    if (!el) return
    atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
  }
  function scrollToBottom() {
    if (atBottomRef.current) bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }
  useEffect(() => { scrollToBottom() }, [messages])

  // Scroll to deep-link target after messages render
  useEffect(() => {
    if (!scrollTarget) return
    const timer = setTimeout(() => {
      const el = document.getElementById(scrollTarget)
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
        el.classList.add('msg-highlight')
      }
    }, 120)
    return () => clearTimeout(timer)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollTarget, messages.length])

  // ── Fork ──────────────────────────────────────────────────────────────────
  async function handleFork(uuid: string) {
    if (forking) return
    setForking(uuid)
    try {
      const res = await fetch('/api/fork', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ f: encodedFilepath, uuid }),
      })
      if (!res.ok) return
      const { encodedFilepath: newEnc } = await res.json()
      router.push(`/session?f=${newEnc}`)
    } finally {
      setForking(null)
    }
  }

  // ── SSE tail ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const es = new EventSource(`/api/tail?f=${encodedFilepath}`)
    es.onopen  = () => setConnected(true)
    es.onerror = () => setConnected(false)
    function handleMsg(msg: ParsedMessage) {
      if (seenUuids.current.has(msg.uuid)) return
      seenUuids.current.add(msg.uuid)
      setMessages(prev => {
        // Remove optimistic placeholder when the real user message arrives
        const filtered = prev.filter(m =>
          !(m.uuid.startsWith('__optimistic__') && m.type === 'user' && msg.type === 'user')
        )
        return [...filtered, msg]
      })
      setTotal(t => t + 1)
      if (msg.type === 'assistant') {
        setWaitingForReply(false)
        setReplyTimedOut(false)
        setContinuationUrl(null)
        if (replyTimeoutRef.current) { clearTimeout(replyTimeoutRef.current); replyTimeoutRef.current = null }
        if (continuationPollRef.current) { clearInterval(continuationPollRef.current); continuationPollRef.current = null }
      }
    }

    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data)
        // Handle BOTH catchup and live messages the same way — only skip if already seen.
        // This is critical: EventSource auto-reconnects and resends catchup on reconnect.
        // Any new replies that arrived during a disconnect come back as 'catchup' and
        // were previously dropped. Now we process them if their uuid is unseen.
        if (data.type === 'catchup' || data.type === 'message') {
          handleMsg(data.message as ParsedMessage)
        }
      } catch { /* ignore */ }
    }
    return () => es.close()
  }, [encodedFilepath])

  // ── Process state polling ─────────────────────────────────────────────────
  const pollProcessState = useCallback(async () => {
    if (!pid) return
    try {
      const res = await fetch(`/api/process-state?pid=${pid}`)
      if (!res.ok) return
      const { state } = await res.json() as { state: ProcState }
      if (state === 'dead' && (prevState.current === 'running' || prevState.current === 'paused')) {
        setWasInterrupted(lastRole(messages) === 'user')
      }
      prevState.current = state
      setProcState(state)
    } catch { /* ignore */ }
  }, [pid, messages])

  useEffect(() => {
    if (!pid) return
    const id = setInterval(pollProcessState, 3000)
    return () => clearInterval(id)
  }, [pid, pollProcessState])

  // ── Load earlier messages ─────────────────────────────────────────────────
  async function loadMore() {
    if (loadingMore || !hasMore) return
    setLoadingMore(true)
    const oldestUuid = messages[0]?.uuid
    if (!oldestUuid) { setLoadingMore(false); return }

    try {
      const res = await fetch(`/api/session?f=${encodedFilepath}&limit=50&before=${oldestUuid}`)
      if (!res.ok) return
      const data: PaginatedSession = await res.json()

      // Prepend new messages, dedup
      setMessages(prev => {
        const existingUuids = new Set(prev.map(m => m.uuid))
        const newOnes = data.messages.filter(m => !existingUuids.has(m.uuid))
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

  // Poll /api/recent-sessions to find the continuation session Claude spawned
  function watchForContinuation(sentAt: number) {
    if (continuationPollRef.current) clearInterval(continuationPollRef.current)
    setContinuationUrl(null)
    let attempts = 0

    continuationPollRef.current = setInterval(async () => {
      attempts++
      if (attempts > 20) { // give up after ~40s
        clearInterval(continuationPollRef.current!)
        continuationPollRef.current = null
        return
      }
      try {
        const res = await fetch('/api/recent-sessions?limit=5')
        if (!res.ok) return
        const sessions: Array<{ mtime: number; encodedFilepath: string; firstPrompt: string }> = await res.json()
        // Find a session newer than when we sent, that isn't the current one
        const newer = sessions.find(s =>
          s.mtime > sentAt - 500 &&
          s.encodedFilepath !== encodedFilepath
        )
        if (newer) {
          clearInterval(continuationPollRef.current!)
          continuationPollRef.current = null
          setWaitingForReply(false)
          setProcState('dead')
          setContinuationUrl(`/session?f=${newer.encodedFilepath}`)
          if (replyTimeoutRef.current) {
            clearTimeout(replyTimeoutRef.current)
            replyTimeoutRef.current = null
          }
          // Remove stuck optimistic messages
          setMessages(prev => prev.filter(m => !m.uuid.startsWith('__optimistic__')))
        }
      } catch { /* ignore */ }
    }, 2000)
  }

  // ── Per-message model override ────────────────────────────────────────────
  const [msgModel, setMsgModel] = useState('')

  // ── Actions ───────────────────────────────────────────────────────────────
  async function sendInput(e: React.FormEvent) {
    e.preventDefault()
    if ((!inputText.trim() && !attachedImage) || sending) return

    // ── Slash commands ────────────────────────────────────────────────────
    const trimmed = inputText.trim()
    if (trimmed === '/export') {
      setInputText('')
      exportMarkdown()
      return
    }
    if (trimmed === '/clear') {
      if (!window.confirm('Clear visible messages? Session history on disk is preserved.')) return
      setInputText('')
      setMessages([])
      setFirstMessage(null)
      setTotal(0); setHiddenCount(0); setHasMore(false)
      return
    }
    // /compact [hint] and other slash commands pass through to Claude

    setSending(true)

    let prompt = inputText.trim()

    // 1. Optimistically add the user message to the UI immediately
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
    atBottomRef.current = true // force scroll to bottom

    try {
      // 2. Upload file/image if attached
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

      // 3. Send to Claude
      const inputBody: Record<string, string> = { session_id: sessionId, prompt }
      if (msgModel) inputBody.model = msgModel
      const res = await fetch('/api/input', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(inputBody),
      })
      if (res.ok) {
        setProcState('running')
        setWaitingForReply(true)
        const sentAt = Date.now()

        // If the session was already dead, the reply will land in a continuation session.
        // Poll recent-sessions every 2s to find it (much faster than 60s timeout).
        if (initialProcState === 'dead' || procState === 'dead') {
          watchForContinuation(sentAt)
        }

        // Safety fallback: clear spinner after 60s if nothing found
        const replyTimeout = setTimeout(() => {
          setWaitingForReply(false)
          setProcState('dead')
          setMessages(prev => prev.filter(m => m.uuid !== optimisticId))
          setTotal(t => t - 1)
          setReplyTimedOut(true)
          if (continuationPollRef.current) {
            clearInterval(continuationPollRef.current)
            continuationPollRef.current = null
          }
        }, 60_000)

        replyTimeoutRef.current = replyTimeout
      } else {
        // Remove optimistic message on failure
        setMessages(prev => prev.filter(m => m.uuid !== optimisticId))
        setTotal(t => t - 1)
        setInputText(prompt) // restore input
      }
    } finally {
      setSending(false)
    }
  }

  async function resumeProcess() {
    if (!pid) return
    await fetch('/api/resume', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pid }),
    })
    setProcState('running')
  }

  async function killAndRestart(e: React.FormEvent) {
    e.preventDefault()
    if (sending) return
    const promptText = inputText.trim() || 'hi'
    setSending(true)
    try {
      if (pid) {
        await fetch('/api/kill', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pid }) })
        setProcState('dead'); setPid(null)
      }
      const res = await fetch('/api/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project_path: projectPath, prompt: promptText, model: MODEL_IDS[model] }),
      })
      if (res.ok) {
        const { pid: newPid } = await res.json()
        setInputText(''); setPid(newPid); setProcState('running'); setWasInterrupted(false)
        // Redirect to the newly spawned session
        setTimeout(async () => {
          try {
            const r = await fetch('/api/recent-sessions?limit=3')
            if (!r.ok) return
            const sessions = await r.json() as Array<{ encodedFilepath: string; projectDirName: string; mtime: number }>
            const newest = sessions[0]
            if (newest && newest.encodedFilepath !== encodedFilepath) {
              router.push(`/session?f=${newest.encodedFilepath}`)
            }
          } catch { /* ignore */ }
        }, 2000)
      }
    } finally { setSending(false) }
  }

  // Stop current task then immediately send the typed message as a new session
  async function stopAndResend(e: React.FormEvent) {
    e.preventDefault()
    if (!inputText.trim() || sending) return
    setSending(true)
    try {
      if (pid) {
        await fetch('/api/kill', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pid }),
        })
        setPid(null)
      }
      // Small pause so the kill lands before spawning
      await new Promise(r => setTimeout(r, 300))

      const res = await fetch('/api/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project_path: projectPath, prompt: inputText.trim(), model: MODEL_IDS[model] }),
      })
      if (res.ok) {
        const { pid: newPid } = await res.json()
        setPid(newPid)
        setProcState('running')
        setWasInterrupted(false)
        setWaitingForReply(true)

        // Optimistic user message
        const optimisticId = `__optimistic__${Date.now()}`
        setMessages(prev => [...prev, {
          uuid: optimisticId, parentUuid: null, type: 'user', role: 'user',
          timestamp: new Date().toISOString(), isMeta: false, isSidechain: false,
          sessionId, content: [{ type: 'text', text: inputText.trim() }],
        }])
        setTotal(t => t + 1)
        setInputText('')
        atBottomRef.current = true

        replyTimeoutRef.current = setTimeout(() => {
          setWaitingForReply(false); setProcState('dead')
          setMessages(prev => prev.filter(m => m.uuid !== optimisticId))
          setTotal(t => t - 1); setReplyTimedOut(true)
        }, 60_000)
      }
    } finally { setSending(false) }
  }

  // ── Export to Markdown ────────────────────────────────────────────────────
  const [exporting, setExporting] = useState(false)

  async function exportMarkdown() {
    if (exporting) return
    setExporting(true)
    try {
      const res = await fetch(`/api/export?f=${encodedFilepath}`)
      if (!res.ok) throw new Error('export failed')
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `session-${sessionId.slice(0, 8)}.md`
      a.click()
      URL.revokeObjectURL(url)
      setExported(true)
      setTimeout(() => setExported(false), 1500)
    } finally {
      setExporting(false)
    }
  }

  // ── Derived ───────────────────────────────────────────────────────────────
  const isRunning  = procState === 'running'
  const isPaused   = procState === 'paused'
  const isDead     = procState === 'dead' || procState === 'unknown'
  // isThinking: either process state says so, or we just sent and are waiting for the reply
  const isThinking = (isRunning && lastRole(messages) === 'user') || waitingForReply

  // Is the firstMessage already in the visible window?
  const firstInWindow = firstMessage && messages.some(m => m.uuid === firstMessage.uuid)

  // Build tool-result lookup: tool_id → ContentBlock (for inline display in CombinedToolBlock)
  const toolResultMap = useMemo(() => {
    const map = new Map<string, import('@/lib/types').ContentBlock>()
    const allMsgs = firstMessage ? [firstMessage, ...messages] : messages
    for (const msg of allMsgs) {
      if (msg.type !== 'user') continue
      for (const block of msg.content) {
        if (block.type === 'tool_result' && block.tool_id) {
          map.set(block.tool_id, block)
        }
      }
    }
    return map
  }, [firstMessage, messages])

  // Filter out user messages that contain only tool_result blocks (now shown inline)
  const displayMessages = useMemo(() => {
    const base = messages.filter(msg => {
      if (msg.type !== 'user') return true
      const relevant = msg.content.filter(b =>
        b.type === 'tool_result' || (b.type === 'text' && (b.text ?? '').trim().length > 0)
      )
      if (relevant.length === 0) return true
      return !relevant.every(b => b.type === 'tool_result')
    })

    const q = sessionFilter.trim().toLowerCase()
    if (q.length < 2) return base

    return base.filter(msg => {
      const text = msg.content.map(b => {
        if (b.type === 'text') return b.text ?? ''
        if (b.type === 'tool_use') return `${b.tool_name ?? ''} ${JSON.stringify(b.tool_input ?? '')}`
        if (b.type === 'tool_result') return b.tool_result?.map(r => r.text ?? '').join(' ') ?? ''
        return ''
      }).join(' ').toLowerCase()
      return text.includes(q)
    })
  }, [messages, sessionFilter])

  // ── Model preference — persisted in localStorage ─────────────────────────
  const [model, setModel] = useState<string>(() => {
    if (typeof window === 'undefined') return 'sonnet'
    return localStorage.getItem('claude-model') || 'sonnet'
  })
  function changeModel(m: string) {
    setModel(m)
    if (typeof window !== 'undefined') localStorage.setItem('claude-model', m)
  }
  const MODEL_IDS: Record<string, string> = {
    sonnet: 'claude-sonnet-4-6',
    opus:   'claude-opus-4-8',
    haiku:  'claude-haiku-4-5-20251001',
  }

  return (
    <div className="session-view" style={{ display: 'flex', flexDirection: 'column', height: 'calc(100dvh - 54px)' }}>

      {/* ── Header ────────────────────────────────────────────────────── */}
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

        {/* Session ID — click to copy */}
        <button
          className="hide-mobile"
          onClick={() => {
            const cmd = `cd ${projectPath} && claude --resume ${sessionId}`
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

        {/* In-session filter */}
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

        {/* Live dot */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span className={connected ? 'dot-live' : ''} style={!connected ? {
            width: 6, height: 6, borderRadius: '50%', background: 'var(--text3)', display: 'inline-block',
          } : {}} />
          <span style={{ fontSize: 12, color: connected ? 'var(--green)' : 'var(--text3)' }}>
            {connected ? 'Live' : '…'}
          </span>
        </div>

        {/* Status + controls — pushed right */}
        <div className="session-header-chips" style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <button
            className="chip"
            onClick={() => window.location.reload()}
            title="Refresh session"
            aria-label="Refresh session"
            style={{ cursor: 'pointer', padding: '3px 10px' }}
          >
            ⟳<span className="hide-mobile" style={{ marginLeft: 4 }}>Refresh</span>
          </button>
          <button
            className="chip"
            onClick={exportMarkdown}
            title="Export full chat history as Markdown"
            disabled={exporting}
            style={{ cursor: exporting ? 'default' : 'pointer', padding: '3px 10px', color: exported ? 'var(--green)' : undefined, opacity: exporting ? 0.7 : 1 }}
          >
            {exported ? '✓' : exporting ? <span style={{ animation: 'spin 1s linear infinite', display: 'inline-block' }}>⟳</span> : '↓'}
            <span className="hide-mobile" style={{ marginLeft: 4 }}>{exported ? 'Saved' : exporting ? 'Exporting…' : 'Export MD'}</span>
          </button>
          <SessionTagsButton sessionId={sessionId} />
          <span className="chip hide-mobile">{total} msgs</span>
          {sessionFilter.trim().length >= 2 && (
            <span className="chip hide-mobile" style={{ color: 'var(--yellow)' }}>
              {displayMessages.length} match{displayMessages.length !== 1 ? 'es' : ''}
            </span>
          )}
          {isRunning && isThinking && <span className="chip chip-green"><span style={{ animation: 'spin 1s linear infinite', display: 'inline-block' }}>⟳</span><span className="hide-mobile"> Thinking…</span></span>}
          {isRunning && !isThinking && <span className="chip chip-green">Running</span>}
          {isPaused && <span className="chip chip-yellow">Paused</span>}
          {isDead && <span className="chip">{wasInterrupted ? 'Interrupted' : 'Done'}</span>}

          {isRunning && pid && (
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="chip chip-yellow" style={{ cursor: 'pointer', padding: '3px 10px' }}
                onClick={() => fetch('/api/pause', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pid }) }).then(() => setProcState('paused'))}>
                Pause
              </button>
              <KillButton pid={pid} onKill={() => { setProcState('dead'); setWasInterrupted(true) }} />
            </div>
          )}
          {isPaused && pid && (
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="chip chip-green" onClick={resumeProcess} style={{ cursor: 'pointer', padding: '3px 10px' }}>Resume</button>
              <KillButton pid={pid} onKill={() => { setProcState('dead'); setWasInterrupted(true) }} />
            </div>
          )}
        </div>
      </div>

      {/* ── Messages ─────────────────────────────────────────────────── */}
      <div ref={containerRef} onScroll={checkAtBottom} style={{ flex: 1, overflowY: 'auto', padding: 'clamp(10px,3vw,24px) clamp(8px,3vw,20px)' }}>
        <div style={{ maxWidth: 'min(100%, 840px)', margin: '0 auto' }}>

          {/* Pinned first message */}
          {firstMessage && !firstInWindow && (
            <>
              <div style={{ marginBottom: 4 }}>
                <span style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Original instruction
                </span>
              </div>
              <div id={firstMessage.uuid} className="msg-row">
              <MessageBlock message={firstMessage} encodedFilepath={encodedFilepath} toolResultMap={toolResultMap} />
              <button
                className="msg-fork-btn"
                onClick={() => handleFork(firstMessage.uuid)}
                disabled={!!forking}
                title="Fork session from this message"
              >
                {forking === firstMessage.uuid ? '…' : '⑃ fork here'}
              </button>
              </div>

              {/* Load more / hidden count divider */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: 12, margin: '20px 0',
              }}>
                <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.07)' }} />
                <button
                  onClick={loadMore}
                  disabled={loadingMore || !hasMore}
                  style={{
                    background: 'rgba(255,255,255,0.06)',
                    border: '1px solid rgba(255,255,255,0.10)',
                    borderRadius: 99,
                    color: hasMore ? 'var(--accent)' : 'var(--text3)',
                    fontSize: 12,
                    padding: '5px 14px',
                    cursor: hasMore ? 'pointer' : 'default',
                    whiteSpace: 'nowrap',
                    backdropFilter: 'blur(8px)',
                  }}
                >
                  {loadingMore
                    ? 'Loading…'
                    : hasMore
                      ? `↑ Load 50 earlier  ·  ${hiddenCount} hidden`
                      : `${hiddenCount} messages in between`}
                </button>
                <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.07)' }} />
              </div>
            </>
          )}

          {/* Load more button (when first message IS in window but there are still older ones) */}
          {hasMore && (firstInWindow || !firstMessage) && (
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
                  backdropFilter: 'blur(8px)',
                }}
              >
                {loadingMore ? 'Loading…' : `↑ Load 50 earlier messages`}
              </button>
            </div>
          )}

          {/* Main message window */}
          {messages.length === 0 ? (
            <div style={{ textAlign: 'center', color: 'var(--text2)', marginTop: 80 }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>💬</div>
              <p>No messages yet</p>
            </div>
          ) : (
            displayMessages.map(msg => (
              <div key={msg.uuid} id={msg.uuid} className="msg-row">
                <MessageBlock message={msg} encodedFilepath={encodedFilepath} toolResultMap={toolResultMap} />
                {!msg.uuid.startsWith('__optimistic__') && (
                  <button
                    className="msg-fork-btn"
                    onClick={() => handleFork(msg.uuid)}
                    disabled={!!forking}
                    title="Fork session from this message"
                  >
                    {forking === msg.uuid ? '…' : '⑃ fork here'}
                  </button>
                )}
              </div>
            ))
          )}

          {/* Continuation session found — direct link */}
          {continuationUrl && (
            <div style={{
              margin: '12px 0', padding: '12px 16px',
              background: 'color-mix(in srgb, var(--green) 8%, var(--glass-bg))',
              border: '1px solid color-mix(in srgb, var(--green) 25%, transparent)',
              borderRadius: 12, fontSize: 13,
              display: 'flex', alignItems: 'center', gap: 10,
              animation: 'fadeIn 0.2s ease',
            }}>
              <span style={{ fontSize: 18 }}>↩</span>
              <div>
                <div style={{ color: 'var(--text)', fontWeight: 600, marginBottom: 2 }}>Claude replied in a new session</div>
                <div style={{ color: 'var(--text2)', fontSize: 12 }}>Your message started a continuation thread</div>
              </div>
              <a
                href={continuationUrl}
                style={{
                  marginLeft: 'auto', padding: '7px 16px', borderRadius: 8, flexShrink: 0,
                  background: 'color-mix(in srgb, var(--green) 18%, transparent)',
                  border: '1px solid color-mix(in srgb, var(--green) 35%, transparent)',
                  color: 'var(--green)', fontWeight: 600, fontSize: 13, textDecoration: 'none',
                }}
              >
                Open →
              </a>
            </div>
          )}

          {/* Reply timed out — fallback */}
          {replyTimedOut && !continuationUrl && (
            <div style={{
              margin: '12px 0', padding: '10px 14px',
              background: 'color-mix(in srgb, var(--yellow) 8%, var(--glass-bg))',
              border: '1px solid color-mix(in srgb, var(--yellow) 25%, transparent)',
              borderRadius: 10, fontSize: 13, color: 'var(--text2)',
              display: 'flex', alignItems: 'center', gap: 8,
            }}>
              <span style={{ color: 'var(--yellow)' }}>⚠</span>
              <span>No reply detected — check <strong style={{ color: 'var(--text)' }}>Recent Sessions</strong> in the sidebar.</span>
            </div>
          )}

          {/* Thinking indicator */}
          {isThinking && !replyTimedOut && (
            <div style={{ display: 'flex', justifyContent: 'flex-start', margin: '12px 0' }}>
              <div style={{
                background: 'rgba(255,255,255,0.055)', backdropFilter: 'blur(16px)',
                border: '1px solid rgba(255,255,255,0.09)', borderRadius: '14px 14px 14px 2px',
                padding: '12px 18px', display: 'flex', alignItems: 'center', gap: 8,
                fontSize: 14, color: 'var(--text2)',
              }}>
                <ThinkingDots /> Claude is thinking…
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      </div>

      {/* ── Bottom bar ────────────────────────────────────────────────── */}
      <BottomBar
        procState={procState} wasInterrupted={wasInterrupted}
        inputText={inputText} setInputText={setInputText}
        sending={sending} isThinking={isThinking}
        attachedImage={attachedImage}
        onAttachImage={setAttachedImage}
        onSendInput={sendInput} onKillAndRestart={killAndRestart}
        onResumeProcess={resumeProcess} onStopAndResend={stopAndResend}
        projectPath={projectPath} pid={pid}
        model={model} onModelChange={changeModel}
        msgModel={msgModel} onMsgModelChange={setMsgModel}
      />

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes dot-bounce {
          0%, 80%, 100% { transform: translateY(0); opacity: .4; }
          40% { transform: translateY(-5px); opacity: 1; }
        }
      `}</style>
    </div>
  )
}

// ── Sub-components (unchanged from before) ─────────────────────────────────

function ThinkingDots() {
  return (
    <span style={{ display: 'inline-flex', gap: 3, alignItems: 'center' }}>
      {[0, 1, 2].map(i => (
        <span key={i} style={{
          width: 5, height: 5, borderRadius: '50%', background: 'var(--text2)', display: 'inline-block',
          animation: `dot-bounce 1.4s ease-in-out ${i * 0.16}s infinite`,
        }} />
      ))}
    </span>
  )
}

function KillButton({ pid, onKill }: { pid: number; onKill: () => void }) {
  const [confirm, setConfirm] = useState(false)
  async function doKill() {
    await fetch('/api/kill', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pid }) })
    onKill(); setConfirm(false)
  }
  return confirm ? (
    <span style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
      <button className="chip chip-red" onClick={doKill} style={{ cursor: 'pointer', padding: '3px 10px' }}>Confirm kill</button>
      <button onClick={() => setConfirm(false)} style={{ background: 'none', border: 'none', color: 'var(--text2)', fontSize: 12, cursor: 'pointer' }}>✕</button>
    </span>
  ) : (
    <button className="chip chip-red" onClick={() => setConfirm(true)} style={{ cursor: 'pointer', padding: '3px 10px' }}>Kill</button>
  )
}

interface BarProps {
  procState: ProcState; wasInterrupted: boolean
  inputText: string; setInputText: (v: string) => void
  sending: boolean; isThinking: boolean
  attachedImage: AttachedImage | null
  onAttachImage: (img: AttachedImage | null) => void
  onSendInput: (e: React.FormEvent) => void
  onKillAndRestart: (e: React.FormEvent) => void
  onResumeProcess: () => void
  onStopAndResend: (e: React.FormEvent) => void
  projectPath: string
  pid: number | null
  model: string
  onModelChange: (m: string) => void
  msgModel: string
  onMsgModelChange: (m: string) => void
}

function ModelPicker({ value, onChange, compact }: { value: string; onChange: (v: string) => void; compact?: boolean }) {
  const models = [
    { id: 'sonnet', label: 'Sonnet' },
    { id: 'opus',   label: 'Opus' },
    { id: 'haiku',  label: 'Haiku' },
  ]
  return (
    <div className={`model-picker${compact ? ' model-picker-compact' : ''}`}>
      {models.map(m => (
        <button
          key={m.id}
          type="button"
          className={`model-btn${value === m.id ? ' model-btn-active' : ''}`}
          onClick={() => onChange(m.id)}
        >
          {m.label}
        </button>
      ))}
    </div>
  )
}

function SendIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <line x1="12" y1="19" x2="12" y2="5"/>
      <polyline points="5 12 12 5 19 12"/>
    </svg>
  )
}

function SpinIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
      style={{ animation: 'spin 0.8s linear infinite' }} aria-hidden>
      <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
    </svg>
  )
}

const MSG_MODEL_IDS: Record<string, string> = {
  sonnet: 'claude-sonnet-4-6',
  opus:   'claude-opus-4-8',
  haiku:  'claude-haiku-4-5-20251001',
}

function BottomBar({ procState, wasInterrupted, inputText, setInputText, sending, isThinking, attachedImage, onAttachImage, onSendInput, onKillAndRestart, onResumeProcess, onStopAndResend, pid, model, onModelChange, msgModel, onMsgModelChange }: BarProps) {
  const handlePaste = useImagePaste(onAttachImage)
  const canSend = !!(inputText.trim() || attachedImage)
  const [showOpts, setShowOpts] = useState(false)
  useSkills() // warm cache

  const slashMatch = inputText.match(/\/(\w*)$/)
  const showPicker = slashMatch !== null
  const skillQuery = slashMatch?.[1] ?? ''

  function handleSkillSelect(name: string) {
    setInputText(inputText.replace(/\/\w*$/, `/${name} `))
  }

  if (procState === 'running') return (
    <div className="chat-input-wrap">
      <form onSubmit={onSendInput}>
        {/* Attachment preview */}
        {attachedImage && (
          <div style={{ maxWidth: 760, margin: '0 auto 8px', display: 'flex', alignItems: 'center', gap: 10,
            padding: '8px 12px', background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', borderRadius: 12 }}>
            {attachedImage.mediaType.startsWith('image/') ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={attachedImage.dataUrl} alt="" style={{ height: 44, width: 44, objectFit: 'cover', borderRadius: 7, flexShrink: 0 }} />
            ) : (
              <span style={{ fontSize: 22, flexShrink: 0 }}>📎</span>
            )}
            <span style={{ fontSize: 12, color: 'var(--text2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{attachedImage.name}</span>
            <button type="button" onClick={() => onAttachImage(null)}
              style={{ background: 'none', border: 'none', color: 'var(--text3)', cursor: 'pointer', marginLeft: 'auto', fontSize: 16, padding: '4px 6px', flexShrink: 0 }}>✕</button>
          </div>
        )}

        <div style={{ position: 'relative' }}>
          {showPicker && (
            <SkillPicker
              query={skillQuery}
              onSelect={handleSkillSelect}
              onDismiss={() => setInputText(inputText.replace(/\/\w*$/, ''))}
            />
          )}
        <div className="chat-pill">
          <ImageAttachment image={attachedImage} onAttach={onAttachImage} onRemove={() => onAttachImage(null)} />
          <textarea
            className="chat-pill-textarea"
            value={inputText}
            onChange={e => setInputText(e.target.value)}
            onPaste={handlePaste}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey && !showPicker) { e.preventDefault(); onSendInput(e) }
            }}
            placeholder={isThinking ? 'Claude is thinking — send anyway or wait…' : 'Message Claude… (type / for skills)'}
            rows={1}
          />
          {inputText.trim() && pid && isThinking && (
            <button
              type="button"
              onClick={onStopAndResend}
              disabled={sending}
              title="Stop current task and resend as new session"
              style={{
                background: 'color-mix(in srgb, var(--red) 14%, transparent)',
                border: '1px solid color-mix(in srgb, var(--red) 30%, transparent)',
                color: 'var(--red)', borderRadius: 8, fontSize: 12, fontWeight: 600,
                padding: '5px 10px', cursor: 'pointer', flexShrink: 0, alignSelf: 'flex-end',
                marginBottom: 1, whiteSpace: 'nowrap',
              }}
            >
              {sending ? '…' : '⏹ Stop'}
            </button>
          )}
          <button type="submit" className="chat-send-btn" disabled={!canSend || sending}
            title={isThinking ? 'Send anyway' : 'Send message'}>
            {sending ? <SpinIcon /> : <SendIcon />}
          </button>
        </div>
        </div>

        <div className="chat-pill-footer">
          <ModelPicker value={model} onChange={onModelChange} compact />
          <button
            type="button"
            onClick={() => { setShowOpts(v => !v); if (showOpts) onMsgModelChange('') }}
            style={{ fontSize: 11, color: msgModel ? 'var(--accent)' : 'var(--text3)', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 6px', borderRadius: 5 }}
            title="Per-message model override"
          >
            {msgModel ? `↳ ${Object.entries(MSG_MODEL_IDS).find(([,v]) => v === msgModel)?.[0] ?? msgModel}` : '⚙ per-msg'}
          </button>
          <span className="chat-hint-inline">Enter to send · /export · /clear · /compact · type / for skills</span>
        </div>
        {showOpts && (
          <div style={{ maxWidth: 760, margin: '2px auto 0', display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, padding: '6px 4px', animation: 'fadeIn 0.12s ease' }}>
            <span style={{ color: 'var(--text3)' }}>Override model for next message:</span>
            <div className="model-picker model-picker-compact">
              {(['', 'sonnet', 'opus', 'haiku'] as const).map(m => (
                <button key={m} type="button"
                  className={`model-btn${msgModel === (m ? MSG_MODEL_IDS[m] : '') ? ' model-btn-active' : ''}`}
                  onClick={() => onMsgModelChange(m ? MSG_MODEL_IDS[m] : '')}>
                  {m || 'default'}
                </button>
              ))}
            </div>
          </div>
        )}
      </form>
    </div>
  )

  if (procState === 'paused') return (
    <div className="chat-input-wrap">
      <div className="chat-paused-banner">
        <span>⏸ Session paused</span>
        <button className="chip chip-green" onClick={onResumeProcess} style={{ cursor: 'pointer', marginLeft: 'auto', padding: '4px 14px', minHeight: 32 }}>
          Resume
        </button>
      </div>
      <form onSubmit={onKillAndRestart}>
        <div className="chat-pill">
          <textarea
            className="chat-pill-textarea"
            value={inputText}
            onChange={e => setInputText(e.target.value)}
            placeholder="Type a new prompt to kill & restart…"
            rows={1}
          />
          <button type="submit" className="chat-send-btn" disabled={!inputText.trim() || sending}
            style={{ background: inputText.trim() ? 'color-mix(in srgb, var(--red) 80%, transparent)' : undefined }}
            title="Kill and restart with this prompt">
            {sending ? <SpinIcon /> : <SendIcon />}
          </button>
        </div>
        <div className="chat-pill-footer">
          <ModelPicker value={model} onChange={onModelChange} compact />
          <span className="chat-hint-inline">Kills the paused session and starts fresh</span>
        </div>
      </form>
    </div>
  )

  return (
    <div className="chat-input-wrap">
      <form onSubmit={onSendInput}>
        {attachedImage && (
          <div style={{ maxWidth: 760, margin: '0 auto 8px', display: 'flex', alignItems: 'center', gap: 10,
            padding: '8px 12px', background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', borderRadius: 12 }}>
            {attachedImage.mediaType.startsWith('image/') ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={attachedImage.dataUrl} alt="" style={{ height: 44, width: 44, objectFit: 'cover', borderRadius: 7, flexShrink: 0 }} />
            ) : (
              <span style={{ fontSize: 22, flexShrink: 0 }}>📎</span>
            )}
            <span style={{ fontSize: 12, color: 'var(--text2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{attachedImage.name}</span>
            <button type="button" onClick={() => onAttachImage(null)}
              style={{ background: 'none', border: 'none', color: 'var(--text3)', cursor: 'pointer', marginLeft: 'auto', fontSize: 16, padding: '4px 6px', flexShrink: 0 }}>✕</button>
          </div>
        )}

        <div style={{ position: 'relative' }}>
          {showPicker && (
            <SkillPicker
              query={skillQuery}
              onSelect={handleSkillSelect}
              onDismiss={() => setInputText(inputText.replace(/\/\w*$/, ''))}
            />
          )}
          <div className="chat-pill">
            <ImageAttachment image={attachedImage} onAttach={onAttachImage} onRemove={() => onAttachImage(null)} />
            <textarea
              className="chat-pill-textarea"
              value={inputText}
              onChange={e => setInputText(e.target.value)}
              onPaste={handlePaste}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey && !showPicker) { e.preventDefault(); onSendInput(e) }
              }}
              placeholder={wasInterrupted ? 'Resume or start fresh…' : 'Continue or start new… (type / for skills)'}
              rows={1}
            />
            <button type="submit" className="chat-send-btn" disabled={!canSend || sending}
              title="Continue this session">
              {sending ? <SpinIcon /> : <SendIcon />}
            </button>
          </div>
        </div>

        <div className="chat-action-row">
          <button type="button" className="chip" onClick={onKillAndRestart as unknown as React.MouseEventHandler}
            disabled={sending}
            title="Start a new session in the same project"
            style={{ cursor: 'pointer', fontSize: 12, padding: '4px 12px', minHeight: 30 }}>
            New session ↗
          </button>
          <ModelPicker value={model} onChange={onModelChange} />
          {wasInterrupted && (
            <span style={{ fontSize: 11, color: 'var(--text3)' }}>Interrupted</span>
          )}
        </div>
      </form>
    </div>
  )
}
