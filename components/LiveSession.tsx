'use client'
import { useEffect, useRef, useState, useCallback } from 'react'
import { ParsedMessage, PaginatedSession } from '@/lib/types'
import MessageBlock from './MessageBlock'
import ImageAttachment, { AttachedImage, useImagePaste } from './ImageAttachment'
import { useRouter } from 'next/navigation'
import { useVoice, UseVoiceReturn } from '@/hooks/useVoice'
import VoiceBar from './VoiceBar'

type ProcState = 'running' | 'paused' | 'dead' | 'unknown'

interface Props {
  initialData: PaginatedSession
  encodedFilepath: string
  sessionId: string
  projectPath: string
  pid: number | null
  processState: ProcState
}

function lastRole(messages: ParsedMessage[]): 'user' | 'assistant' | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (!messages[i].isMeta) return messages[i].role
  }
  return null
}

function extractSpeakableText(content: ParsedMessage['content']): string {
  return content
    .filter(b => b.type === 'text')
    .map(b => (b.type === 'text' ? b.text : ''))
    .join(' ')
    .replace(/```[\s\S]*?```/g, 'code block')
    .replace(/`[^`]+`/g, 'code')
    .trim()
    .slice(0, 500)
}

export default function LiveSession({
  initialData, encodedFilepath, sessionId, projectPath, pid: initialPid, processState: initialProcState,
}: Props) {
  const [firstMessage, setFirstMessage] = useState<ParsedMessage | null>(initialData.firstMessage)
  const [messages, setMessages]         = useState<ParsedMessage[]>(initialData.messages)
  const [total, setTotal]               = useState(initialData.total)
  const [hiddenCount, setHiddenCount]   = useState(initialData.hiddenCount)
  const [hasMore, setHasMore]           = useState(initialData.hasMore)
  const [loadingMore, setLoadingMore]   = useState(false)
  const [connected, setConnected]             = useState(false)
  const [procState, setProcState]             = useState<ProcState>(initialProcState)
  const [pid, setPid]                         = useState<number | null>(initialPid)
  const [inputText, setInputText]             = useState('')
  const [sending, setSending]                 = useState(false)
  const [wasInterrupted, setWasInterrupted]   = useState(false)
  const [attachedImage, setAttachedImage]     = useState<AttachedImage | null>(null)
  const [copiedId, setCopiedId]               = useState(false)
  const [waitingForReply, setWaitingForReply] = useState(false)
  const [replyTimedOut, setReplyTimedOut]     = useState(false)
  const [continuationUrl, setContinuationUrl] = useState<string | null>(null)
  const [notifPerm, setNotifPerm]             = useState<NotificationPermission>('default')

  useEffect(() => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      setNotifPerm(Notification.permission)
    }
  }, [])

  async function requestNotifPermission() {
    if (typeof window === 'undefined' || !('Notification' in window)) return
    try { const p = await Notification.requestPermission(); setNotifPerm(p) } catch { /* ignore */ }
  }

  function fireNotification(title: string, body: string) {
    if (typeof window === 'undefined' || !('Notification' in window)) return
    if (Notification.permission !== 'granted') return
    try { new Notification(title, { body, icon: '/icon.svg', tag: `session-${sessionId}` }) } catch { /* ignore */ }
  }

  const voice    = useVoice()
  const speakRef = useRef<(text: string) => void>(() => {})
  speakRef.current = voice.speak

  const router              = useRouter()
  const bottomRef           = useRef<HTMLDivElement>(null)
  const containerRef        = useRef<HTMLDivElement>(null)
  const atBottomRef         = useRef(true)
  const replyTimeoutRef     = useRef<ReturnType<typeof setTimeout> | null>(null)
  const continuationPollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const seenUuids = useRef(new Set([
    ...(initialData.firstMessage ? [initialData.firstMessage.uuid] : []),
    ...initialData.messages.map(m => m.uuid),
  ]))
  const prevState = useRef<ProcState>(initialProcState)

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
    const es = new EventSource(`/api/tail?f=${encodedFilepath}`)
    es.onopen  = () => setConnected(true)
    es.onerror = () => setConnected(false)
    function handleMsg(msg: ParsedMessage) {
      if (seenUuids.current.has(msg.uuid)) return
      seenUuids.current.add(msg.uuid)
      setMessages(prev => {
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
        if (replyTimeoutRef.current)     { clearTimeout(replyTimeoutRef.current);    replyTimeoutRef.current    = null }
        if (continuationPollRef.current) { clearInterval(continuationPollRef.current); continuationPollRef.current = null }
        const text = extractSpeakableText(msg.content)
        if (text) {
          // Debounce TTS — if multiple messages arrive in a burst (e.g. SSE catchup),
          // cancel any queued speech first so only the final message is spoken.
          if (typeof window !== 'undefined') window.speechSynthesis?.cancel()
          // Small delay so burst cancels settle before speaking
          setTimeout(() => speakRef.current(text), 120)
        }
      }
    }
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data)
        if (data.type === 'catchup' || data.type === 'message') handleMsg(data.message as ParsedMessage)
      } catch { /* ignore */ }
    }
    return () => es.close()
  }, [encodedFilepath])

  const pollProcessState = useCallback(async () => {
    if (!pid) return
    try {
      const res = await fetch(`/api/process-state?pid=${pid}`)
      if (!res.ok) return
      const { state } = await res.json() as { state: ProcState }
      if (state === 'dead' && (prevState.current === 'running' || prevState.current === 'paused')) {
        setWasInterrupted(lastRole(messages) === 'user')
        fireNotification('AgentTower — Claude finished', `Session ${sessionId.slice(0, 8)}… completed`)
      }
      prevState.current = state
      setProcState(state)
    } catch { /* ignore */ }
  }, [pid, messages, sessionId])

  useEffect(() => {
    if (!pid) return
    const id = setInterval(pollProcessState, 3000)
    return () => clearInterval(id)
  }, [pid, pollProcessState])

  async function loadMore() {
    if (loadingMore || !hasMore) return
    setLoadingMore(true)
    const oldestUuid = messages[0]?.uuid
    if (!oldestUuid) { setLoadingMore(false); return }
    try {
      const res = await fetch(`/api/session?f=${encodedFilepath}&limit=50&before=${oldestUuid}`)
      if (!res.ok) return
      const data: PaginatedSession = await res.json()
      setMessages(prev => {
        const existingUuids = new Set(prev.map(m => m.uuid))
        const newOnes = data.messages.filter(m => !existingUuids.has(m.uuid))
        newOnes.forEach(m => seenUuids.current.add(m.uuid))
        return [...newOnes, ...prev]
      })
      setHiddenCount(data.hiddenCount)
      setHasMore(data.hasMore)
      if (data.firstMessage && !firstMessage) setFirstMessage(data.firstMessage)
    } finally { setLoadingMore(false) }
  }

  function watchForContinuation(sentAt: number) {
    if (continuationPollRef.current) clearInterval(continuationPollRef.current)
    setContinuationUrl(null)
    let attempts = 0
    continuationPollRef.current = setInterval(async () => {
      attempts++
      if (attempts > 20) { clearInterval(continuationPollRef.current!); continuationPollRef.current = null; return }
      try {
        const res = await fetch('/api/recent-sessions?limit=5')
        if (!res.ok) return
        const sessions: Array<{ mtime: number; encodedFilepath: string; firstPrompt: string }> = await res.json()
        const newer = sessions.find(s => s.mtime > sentAt - 500 && s.encodedFilepath !== encodedFilepath)
        if (newer) {
          clearInterval(continuationPollRef.current!); continuationPollRef.current = null
          setWaitingForReply(false); setProcState('dead')
          setContinuationUrl(`/session?f=${newer.encodedFilepath}`)
          if (replyTimeoutRef.current) { clearTimeout(replyTimeoutRef.current); replyTimeoutRef.current = null }
          setMessages(prev => prev.filter(m => !m.uuid.startsWith('__optimistic__')))
        }
      } catch { /* ignore */ }
    }, 2000)
  }

  async function sendInput(e: React.FormEvent) {
    e.preventDefault()
    if ((!inputText.trim() && !attachedImage) || sending) return
    setSending(true)
    let prompt = inputText.trim()
    const optimisticId = `__optimistic__${Date.now()}`
    const optimisticMsg: ParsedMessage = {
      uuid: optimisticId, parentUuid: null, type: 'user', role: 'user',
      timestamp: new Date().toISOString(), isMeta: false, isSidechain: false, sessionId,
      content: [{ type: 'text', text: attachedImage ? `${prompt}${prompt ? '\n' : ''}[Image attached]` : prompt }],
    }
    setMessages(prev => [...prev, optimisticMsg])
    setTotal(t => t + 1)
    setInputText(''); setAttachedImage(null); atBottomRef.current = true
    try {
      if (attachedImage) {
        const isImage   = attachedImage.mediaType.startsWith('image/')
        const endpoint  = isImage ? '/api/upload-image' : '/api/upload-file'
        const body      = isImage
          ? { data: attachedImage.base64, mediaType: attachedImage.mediaType }
          : { data: attachedImage.base64, name: attachedImage.name }
        const uploadRes = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        if (uploadRes.ok) {
          const { filepath } = await uploadRes.json()
          const tag = isImage ? `[Image: ${filepath}]` : `[File: ${filepath}]`
          prompt = prompt ? `${prompt}\n\n${tag}` : tag
        }
      }
      const res = await fetch('/api/input', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ session_id: sessionId, prompt }) })
      if (res.ok) {
        setProcState('running'); setWaitingForReply(true)
        const sentAt = Date.now()
        if (initialProcState === 'dead' || procState === 'dead') watchForContinuation(sentAt)
        replyTimeoutRef.current = setTimeout(() => {
          setWaitingForReply(false); setProcState('dead')
          setMessages(prev => prev.filter(m => m.uuid !== optimisticId))
          setTotal(t => t - 1); setReplyTimedOut(true)
          if (continuationPollRef.current) { clearInterval(continuationPollRef.current); continuationPollRef.current = null }
        }, 60_000)
      } else {
        setMessages(prev => prev.filter(m => m.uuid !== optimisticId))
        setTotal(t => t - 1); setInputText(prompt)
      }
    } finally { setSending(false) }
  }

  async function resumeProcess() {
    if (!pid) return
    await fetch('/api/resume', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pid }) })
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
      const res = await fetch('/api/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project_path: projectPath, prompt: promptText }) })
      if (res.ok) {
        const { pid: newPid } = await res.json()
        setInputText(''); setPid(newPid); setProcState('running'); setWasInterrupted(false)
        setTimeout(async () => {
          try {
            const r = await fetch('/api/recent-sessions?limit=3')
            if (!r.ok) return
            const sessions = await r.json() as Array<{ encodedFilepath: string; mtime: number }>
            const newest = sessions[0]
            if (newest && newest.encodedFilepath !== encodedFilepath) router.push(`/session?f=${newest.encodedFilepath}`)
          } catch { /* ignore */ }
        }, 2000)
      }
    } finally { setSending(false) }
  }

  async function stopAndResend(e: React.FormEvent) {
    e.preventDefault()
    if (!inputText.trim() || sending) return
    setSending(true)
    try {
      if (pid) {
        await fetch('/api/kill', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pid }) })
        setPid(null)
      }
      await new Promise(r => setTimeout(r, 300))
      const res = await fetch('/api/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project_path: projectPath, prompt: inputText.trim() }) })
      if (res.ok) {
        const { pid: newPid } = await res.json()
        setPid(newPid); setProcState('running'); setWasInterrupted(false); setWaitingForReply(true)
        const optimisticId = `__optimistic__${Date.now()}`
        setMessages(prev => [...prev, {
          uuid: optimisticId, parentUuid: null, type: 'user', role: 'user',
          timestamp: new Date().toISOString(), isMeta: false, isSidechain: false,
          sessionId, content: [{ type: 'text', text: inputText.trim() }],
        }])
        setTotal(t => t + 1); setInputText(''); atBottomRef.current = true
        replyTimeoutRef.current = setTimeout(() => {
          setWaitingForReply(false); setProcState('dead')
          setMessages(prev => prev.filter(m => m.uuid !== optimisticId))
          setTotal(t => t - 1); setReplyTimedOut(true)
        }, 60_000)
      }
    } finally { setSending(false) }
  }

  const isRunning     = procState === 'running'
  const isPaused      = procState === 'paused'
  const isDead        = procState === 'dead' || procState === 'unknown'
  const isThinking    = (isRunning && lastRole(messages) === 'user') || waitingForReply
  const firstInWindow = firstMessage && messages.some(m => m.uuid === firstMessage.uuid)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 56px)' }}>

      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="glass-lg" style={{
        padding: '8px 16px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
        flexShrink: 0, borderLeft: 'none', borderRight: 'none', borderTop: 'none', borderRadius: 0,
        minHeight: 48, position: 'relative', zIndex: 10,
      }}>
        <button onClick={() => router.back()}
          style={{ background: 'none', border: 'none', color: 'var(--text2)', fontSize: 13, cursor: 'pointer', padding: 0, flexShrink: 0 }}>
          ← Back
        </button>

        <button className="hide-mobile"
          onClick={() => { navigator.clipboard?.writeText(sessionId).then(() => { setCopiedId(true); setTimeout(() => setCopiedId(false), 1200) }) }}
          title={copiedId ? 'Copied!' : `Copy session ID: ${sessionId}`}
          style={{
            fontFamily: 'ui-monospace, monospace', fontSize: 11, color: copiedId ? 'var(--green)' : 'var(--text3)',
            background: 'var(--glass-bg)', border: '1px solid var(--glass-border)',
            borderRadius: 6, padding: '2px 8px', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5,
          }}>
          <span>{copiedId ? 'Copied' : `${sessionId.slice(0, 16)}…`}</span>
          <span style={{ fontSize: 10, opacity: 0.7 }}>{copiedId ? '✓' : '⎘'}</span>
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span className={connected ? 'dot-live' : ''} style={!connected ? {
            width: 6, height: 6, borderRadius: '50%', background: 'var(--text3)', display: 'inline-block',
          } : {}} />
          <span style={{ fontSize: 12, color: connected ? 'var(--green)' : 'var(--text3)' }}>
            {connected ? 'Live' : '…'}
          </span>
        </div>

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {notifPerm === 'default' && (
            <button onClick={requestNotifPermission} className="chip hide-mobile"
              title="Get notified when Claude finishes"
              style={{ cursor: 'pointer', padding: '3px 10px', gap: 4, display: 'inline-flex', alignItems: 'center' }}>
              🔔 <span>Enable alerts</span>
            </button>
          )}
          {notifPerm === 'granted' && (
            <span className="chip chip-green hide-mobile" title="Push notifications enabled">🔔 Alerts on</span>
          )}
          <button className="chip" onClick={() => window.location.reload()} title="Refresh" style={{ cursor: 'pointer', padding: '3px 10px' }}>
            ⟳<span className="hide-mobile" style={{ marginLeft: 4 }}>Refresh</span>
          </button>
          <span className="chip hide-mobile">{total} msgs</span>
          {isRunning && isThinking && <span className="chip chip-green"><span style={{ animation: 'spin 1s linear infinite', display: 'inline-block' }}>⟳</span><span className="hide-mobile"> Thinking…</span></span>}
          {isRunning && !isThinking && <span className="chip chip-green">Running</span>}
          {isPaused  && <span className="chip chip-yellow">Paused</span>}
          {isDead    && <span className="chip">{wasInterrupted ? 'Interrupted' : 'Done'}</span>}
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

      {/* ── Messages ──────────────────────────────────────────── */}
      <div ref={containerRef} onScroll={checkAtBottom} style={{ flex: 1, overflowY: 'auto', padding: 'clamp(14px,3vw,24px) clamp(12px,4vw,28px)' }}>
        <div style={{ maxWidth: 840, margin: '0 auto' }}>

          {firstMessage && !firstInWindow && (
            <>
              <div style={{ marginBottom: 4 }}>
                <span style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Original instruction</span>
              </div>
              <MessageBlock message={firstMessage} encodedFilepath={encodedFilepath} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '20px 0' }}>
                <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.07)' }} />
                <button onClick={loadMore} disabled={loadingMore || !hasMore} style={{
                  background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.10)',
                  borderRadius: 99, color: hasMore ? 'var(--accent)' : 'var(--text3)',
                  fontSize: 12, padding: '5px 14px', cursor: hasMore ? 'pointer' : 'default',
                  whiteSpace: 'nowrap', backdropFilter: 'blur(8px)',
                }}>
                  {loadingMore ? 'Loading…' : hasMore ? `↑ Load 50 earlier  ·  ${hiddenCount} hidden` : `${hiddenCount} messages in between`}
                </button>
                <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.07)' }} />
              </div>
            </>
          )}

          {hasMore && (firstInWindow || !firstMessage) && (
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 20 }}>
              <button onClick={loadMore} disabled={loadingMore} style={{
                background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.10)',
                borderRadius: 99, color: 'var(--accent)', fontSize: 12, padding: '5px 16px',
                cursor: 'pointer', backdropFilter: 'blur(8px)',
              }}>
                {loadingMore ? 'Loading…' : '↑ Load 50 earlier messages'}
              </button>
            </div>
          )}

          {messages.length === 0 ? (
            <div style={{ textAlign: 'center', color: 'var(--text2)', marginTop: 80 }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>💬</div>
              <p>No messages yet</p>
            </div>
          ) : (
            messages.map(msg => <MessageBlock key={msg.uuid} message={msg} encodedFilepath={encodedFilepath} />)
          )}

          {continuationUrl && (
            <div style={{
              margin: '12px 0', padding: '12px 16px',
              background: 'color-mix(in srgb, var(--green) 8%, var(--glass-bg))',
              border: '1px solid color-mix(in srgb, var(--green) 25%, transparent)',
              borderRadius: 12, fontSize: 13, display: 'flex', alignItems: 'center', gap: 10,
              animation: 'fadeIn 0.2s ease',
            }}>
              <span style={{ fontSize: 18 }}>↩</span>
              <div>
                <div style={{ color: 'var(--text)', fontWeight: 600, marginBottom: 2 }}>Claude replied in a new session</div>
                <div style={{ color: 'var(--text2)', fontSize: 12 }}>Your message started a continuation thread</div>
              </div>
              <a href={continuationUrl} style={{
                marginLeft: 'auto', padding: '7px 16px', borderRadius: 8, flexShrink: 0,
                background: 'color-mix(in srgb, var(--green) 18%, transparent)',
                border: '1px solid color-mix(in srgb, var(--green) 35%, transparent)',
                color: 'var(--green)', fontWeight: 600, fontSize: 13, textDecoration: 'none',
              }}>Open →</a>
            </div>
          )}

          {replyTimedOut && !continuationUrl && (
            <div style={{
              margin: '12px 0', padding: '10px 14px',
              background: 'color-mix(in srgb, var(--yellow) 8%, var(--glass-bg))',
              border: '1px solid color-mix(in srgb, var(--yellow) 25%, transparent)',
              borderRadius: 10, fontSize: 13, color: 'var(--text2)', display: 'flex', alignItems: 'center', gap: 8,
            }}>
              <span style={{ color: 'var(--yellow)' }}>⚠</span>
              <span>No reply detected — check <strong style={{ color: 'var(--text)' }}>Recent Sessions</strong> in the sidebar.</span>
            </div>
          )}

          {isThinking && !replyTimedOut && (
            <div style={{ display: 'flex', justifyContent: 'flex-start', margin: '12px 0' }}>
              <div style={{
                background: 'rgba(255,255,255,0.055)', backdropFilter: 'blur(16px)',
                border: '1px solid rgba(255,255,255,0.09)', borderRadius: '14px 14px 14px 2px',
                padding: '12px 18px', display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: 'var(--text2)',
              }}>
                <ThinkingDots /> Claude is thinking…
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      </div>

      {/* ── Bottom bar ─────────────────────────────────────────── */}
      <BottomBar
        procState={procState} wasInterrupted={wasInterrupted}
        inputText={inputText} setInputText={setInputText}
        sending={sending} isThinking={isThinking}
        attachedImage={attachedImage} onAttachImage={setAttachedImage}
        onSendInput={sendInput} onKillAndRestart={killAndRestart}
        onResumeProcess={resumeProcess} onStopAndResend={stopAndResend}
        projectPath={projectPath} pid={pid} voice={voice}
      />

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes dot-bounce {
          0%, 80%, 100% { transform: translateY(0); opacity: .4; }
          40%            { transform: translateY(-5px); opacity: 1; }
        }
        @keyframes pulse-glow {
          0%, 100% { opacity: 1; transform: scale(1); }
          50%       { opacity: 0.5; transform: scale(0.7); }
        }
      `}</style>
    </div>
  )
}

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
  attachedImage: AttachedImage | null; onAttachImage: (img: AttachedImage | null) => void
  onSendInput: (e: React.FormEvent) => void; onKillAndRestart: (e: React.FormEvent) => void
  onResumeProcess: () => void; onStopAndResend: (e: React.FormEvent) => void
  projectPath: string; pid: number | null; voice: UseVoiceReturn
}

function BottomBar({
  procState, wasInterrupted, inputText, setInputText,
  sending, isThinking, attachedImage, onAttachImage,
  onSendInput, onKillAndRestart, onResumeProcess, onStopAndResend,
  pid, voice,
}: BarProps) {
  const base: React.CSSProperties = { flexShrink: 0, borderLeft: 'none', borderRight: 'none', borderBottom: 'none', borderRadius: 0 }
  const pad = 'clamp(10px,3vw,16px) clamp(12px,4vw,24px)'
  const handlePaste = useImagePaste(onAttachImage)
  const canSend = !!(inputText.trim() || attachedImage)

  function handleTranscript(text: string) {
    setInputText(inputText ? `${inputText} ${text}` : text)
  }

  if (procState === 'running') return (
    <div className="glass-lg" style={{ padding: pad, ...base }}>
      <form onSubmit={onSendInput} style={{ maxWidth: 840, margin: '0 auto' }}>
        {attachedImage && (
          <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 10 }}>
            {attachedImage.mediaType.startsWith('image/')
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={attachedImage.dataUrl} alt="" style={{ height: 56, width: 56, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--glass-border)', flexShrink: 0 }} />
              : <div style={{ height: 56, width: 56, borderRadius: 8, border: '1px solid var(--glass-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, flexShrink: 0 }}>📎</div>
            }
            <span style={{ fontSize: 12, color: 'var(--text2)' }}>{attachedImage.name}</span>
            <button type="button" onClick={() => onAttachImage(null)} style={{ background: 'none', border: 'none', color: 'var(--text3)', cursor: 'pointer', marginLeft: 'auto', fontSize: 16, padding: 4 }}>✕</button>
          </div>
        )}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <ImageAttachment image={attachedImage} onAttach={onAttachImage} onRemove={() => onAttachImage(null)} />
          <VoiceBar voice={voice} onTranscript={handleTranscript} />
          <textarea
            className="glass-input"
            value={inputText}
            onChange={e => setInputText(e.target.value)}
            onPaste={handlePaste}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSendInput(e) } }}
            placeholder={voice.isListening ? `Listening… ${voice.interimTranscript || ''}` : isThinking ? 'Claude is thinking — keep typing…' : 'Message Claude… (Enter to send)'}
            rows={1}
            style={{ flex: '1 1 160px', fontSize: 15, padding: '10px 16px', borderRadius: 12, resize: 'none', lineHeight: 1.5, maxHeight: 160, overflowY: 'auto' }}
          />
          {inputText.trim() && pid && isThinking && (
            <button type="button" onClick={onStopAndResend} disabled={sending} className="glass-btn"
              style={{ width: 'auto', padding: '10px 14px', fontSize: 13, flexShrink: 0, alignSelf: 'flex-end', borderColor: 'color-mix(in srgb, var(--red) 35%, transparent)', color: 'var(--red)' }}>
              {sending ? '…' : '⏹ Stop & resend'}
            </button>
          )}
          <button type="submit" className="glass-btn-prominent" disabled={!canSend || sending}
            style={{ width: 'auto', padding: '10px 20px', fontSize: 14, flexShrink: 0, alignSelf: 'flex-end' }}>
            {sending ? '…' : isThinking ? 'Send anyway' : 'Send'}
          </button>
        </div>
      </form>
    </div>
  )

  if (procState === 'paused') return (
    <div className="glass-lg" style={{ padding: pad, ...base }}>
      <div style={{ maxWidth: 840, margin: '0 auto' }}>
        <div style={{
          display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, marginBottom: 10, padding: '8px 14px',
          background: 'color-mix(in srgb, var(--yellow) 10%, transparent)',
          border: '1px solid color-mix(in srgb, var(--yellow) 28%, transparent)',
          borderRadius: 10, fontSize: 13, color: 'var(--yellow)',
        }}>
          <span>⏸ Session is paused</span>
          <button className="chip chip-green" onClick={onResumeProcess} style={{ cursor: 'pointer', marginLeft: 'auto', padding: '4px 14px', minHeight: 32 }}>Resume</button>
        </div>
        <form onSubmit={onKillAndRestart} style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <VoiceBar voice={voice} onTranscript={handleTranscript} compact />
          <input className="glass-input" value={inputText} onChange={e => setInputText(e.target.value)}
            placeholder={voice.isListening ? `Listening… ${voice.interimTranscript || ''}` : 'Kill & restart with a new prompt…'}
            style={{ flex: '1 1 180px', fontSize: 15, padding: '10px 16px', borderRadius: 12 }} />
          <button type="submit" className="glass-btn" disabled={!inputText.trim() || sending}
            style={{ width: 'auto', padding: '10px 18px', fontSize: 14, flexShrink: 0, borderColor: 'color-mix(in srgb,var(--red) 35%,transparent)', color: 'var(--red)', minHeight: 44 }}>
            {sending ? '…' : 'Kill & restart'}
          </button>
        </form>
      </div>
    </div>
  )

  return (
    <div className="glass-lg" style={{ padding: pad, ...base }}>
      <div style={{ maxWidth: 840, margin: '0 auto' }}>
        <form onSubmit={onSendInput} style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <ImageAttachment image={attachedImage} onAttach={onAttachImage} onRemove={() => onAttachImage(null)} />
          <VoiceBar voice={voice} onTranscript={handleTranscript} compact />
          <input className="glass-input" value={inputText} onChange={e => setInputText(e.target.value)}
            onPaste={handlePaste}
            placeholder={voice.isListening ? `Listening… ${voice.interimTranscript || ''}` : wasInterrupted ? 'Resume or start fresh…' : 'Continue thread or start new…'}
            style={{ flex: '1 1 200px', fontSize: 14, padding: '8px 12px', borderRadius: 10, minWidth: 0, minHeight: 36 }} />
          <button type="submit" className="glass-btn-prominent" disabled={!canSend || sending} title="Resume this session" style={{ padding: '8px 14px', fontSize: 13, minHeight: 36 }}>
            {sending ? '…' : 'Continue ↩'}
          </button>
          <button type="button" className="glass-btn" onClick={onKillAndRestart as unknown as React.MouseEventHandler} disabled={sending}
            title="Start a new session" style={{ padding: '8px 14px', fontSize: 13, minHeight: 36 }}>
            New ↗
          </button>
        </form>
      </div>
    </div>
  )
}
