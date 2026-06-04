'use client'
import { useEffect, useRef, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import type { ProjectInfo } from '@/lib/types'
import ImageAttachment, { AttachedImage, useImagePaste } from './ImageAttachment'

const MODEL_IDS: Record<string, string> = {
  sonnet: 'claude-sonnet-4-6',
  opus:   'claude-opus-4-8',
  haiku:  'claude-haiku-4-5-20251001',
}

function PlusIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  )
}

export default function QuickLaunch() {
  const router = useRouter()
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const [projects, setProjects] = useState<ProjectInfo[]>([])
  const [selected, setSelected] = useState<ProjectInfo | null>(null)
  const [filter, setFilter] = useState('')
  const [prompt, setPrompt] = useState('')
  const [model, setModel] = useState('sonnet')
  const [image, setImage] = useState<AttachedImage | null>(null)
  const [launching, setLaunching] = useState(false)
  const [error, setError] = useState('')
  const promptRef = useRef<HTMLTextAreaElement>(null)
  const handlePaste = useImagePaste(setImage)

  // Load model preference
  useEffect(() => {
    const m = localStorage.getItem('claude-model')
    if (m) setModel(m)
  }, [])

  // Fetch projects when opened
  useEffect(() => {
    if (!open) return
    fetch('/api/projects')
      .then(r => r.ok ? r.json() : [])
      .then((p: ProjectInfo[]) => {
        // Sort: active first, then most recent
        p.sort((a, b) => (Number(b.hasActive) - Number(a.hasActive)) || (b.latestMtime - a.latestMtime))
        setProjects(p)
      })
      .catch(() => {})
  }, [open])

  // Keyboard shortcut: ⌘J / Ctrl+J to open
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'j') {
        e.preventDefault()
        setOpen(true)
      }
      if (e.key === 'Escape' && open) close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  function close() {
    setOpen(false)
    setSelected(null)
    setFilter('')
    setPrompt('')
    setImage(null)
    setError('')
  }

  function pick(p: ProjectInfo) {
    setSelected(p)
    setTimeout(() => promptRef.current?.focus(), 80)
  }

  async function launch() {
    if (!selected || (!prompt.trim() && !image) || launching) return
    setLaunching(true)
    setError('')
    try {
      let finalPrompt = prompt.trim()
      if (image) {
        try {
          const isImage = image.mediaType.startsWith('image/')
          const endpoint = isImage ? '/api/upload-image' : '/api/upload-file'
          const body = isImage
            ? { data: image.base64, mediaType: image.mediaType }
            : { data: image.base64, name: image.name }
          const up = await fetch(endpoint, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
          })
          if (up.ok) {
            const { filepath } = await up.json()
            const tag = isImage ? `[Image: ${filepath}]` : `[File: ${filepath}]`
            finalPrompt = finalPrompt ? `${finalPrompt}\n\n${tag}` : tag
          }
        } catch { /* continue */ }
      }

      const res = await fetch('/api/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project_path: selected.decodedPath, prompt: finalPrompt, model: MODEL_IDS[model] }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setError(d.error ?? 'Failed to start session')
        return
      }
      close()
      // Navigate to the project so the new session shows up
      router.push(`/projects`)
      setTimeout(() => router.refresh(), 1500)
    } finally {
      setLaunching(false)
    }
  }

  const filtered = filter.trim()
    ? projects.filter(p =>
        p.displayName.toLowerCase().includes(filter.toLowerCase()) ||
        p.decodedPath.toLowerCase().includes(filter.toLowerCase()))
    : projects

  // Hide on login and inside session view (session has its own input)
  if (pathname === '/login' || pathname?.startsWith('/session')) return null

  return (
    <>
      {/* Floating launch button */}
      <button
        onClick={() => setOpen(true)}
        className="quick-launch-fab"
        aria-label="Start a new session (⌘J)"
        title="New session (⌘J)"
      >
        <PlusIcon />
      </button>

      {open && (
        <>
          <div onClick={close} style={{
            position: 'fixed', inset: 0, zIndex: 600,
            background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(6px)',
          }} />
          <div className="quick-launch-sheet">
            {/* Header */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '14px 18px', borderBottom: '1px solid var(--glass-border)',
            }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>
                  {selected ? `New session` : 'Start a session'}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text3)' }}>
                  {selected
                    ? selected.displayName
                    : 'Pick a project'}
                </div>
              </div>
              {selected && (
                <button onClick={() => setSelected(null)} style={{
                  background: 'var(--glass-bg)', border: '1px solid var(--glass-border)',
                  color: 'var(--text2)', borderRadius: 8, padding: '5px 10px', fontSize: 12, cursor: 'pointer',
                }}>← Back</button>
              )}
              <button onClick={close} style={{
                background: 'var(--glass-bg)', border: '1px solid var(--glass-border)',
                color: 'var(--text2)', borderRadius: 8, padding: '5px 9px', fontSize: 14, cursor: 'pointer', lineHeight: 1,
              }}>✕</button>
            </div>

            {/* Step 1: project picker */}
            {!selected && (
              <>
                <div style={{ padding: '12px 18px 8px' }}>
                  <input
                    autoFocus
                    value={filter}
                    onChange={e => setFilter(e.target.value)}
                    placeholder="Filter projects…"
                    className="glass-input"
                    style={{ fontSize: 14, padding: '9px 14px', borderRadius: 10 }}
                  />
                </div>
                <div style={{ flex: 1, overflowY: 'auto', padding: '0 10px 10px' }}>
                  {filtered.length === 0 && (
                    <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>
                      No projects found
                    </div>
                  )}
                  {filtered.map(p => (
                    <button
                      key={p.dirName}
                      onClick={() => pick(p)}
                      style={{
                        width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 9,
                        padding: '10px 12px', borderRadius: 10, border: '1px solid transparent',
                        background: 'transparent', cursor: 'pointer', color: 'var(--text)',
                        transition: 'background 0.12s',
                      }}
                      onMouseEnter={e => (e.currentTarget.style.background = 'var(--glass-bg-hover)')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                    >
                      {p.hasActive
                        ? <span className="dot-active" style={{ width: 7, height: 7, flexShrink: 0 }} />
                        : <span style={{ width: 7, height: 7, flexShrink: 0 }} />}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 14, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {p.displayName}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text3)', fontFamily: 'ui-monospace, monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {p.decodedPath}
                        </div>
                      </div>
                      {p.hasActive && <span className="chip chip-green" style={{ fontSize: 10, flexShrink: 0 }}>Live</span>}
                    </button>
                  ))}
                </div>
              </>
            )}

            {/* Step 2: prompt */}
            {selected && (
              <div style={{ padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                  <ImageAttachment image={image} onAttach={setImage} onRemove={() => setImage(null)} />
                  <textarea
                    ref={promptRef}
                    value={prompt}
                    onChange={e => setPrompt(e.target.value)}
                    onPaste={handlePaste}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); launch() }
                    }}
                    placeholder="What do you want Claude to do?"
                    rows={4}
                    className="glass-input"
                    style={{ flex: 1, fontSize: 16, padding: '11px 14px', borderRadius: 10, resize: 'none', lineHeight: 1.5 }}
                  />
                </div>

                {/* Model picker + launch */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <div className="model-picker">
                    {['sonnet', 'opus', 'haiku'].map(m => (
                      <button key={m} type="button"
                        className={`model-btn${model === m ? ' model-btn-active' : ''}`}
                        onClick={() => { setModel(m); localStorage.setItem('claude-model', m) }}>
                        {m[0].toUpperCase() + m.slice(1)}
                      </button>
                    ))}
                  </div>
                  <button
                    onClick={launch}
                    disabled={(!prompt.trim() && !image) || launching}
                    className="glass-btn-prominent"
                    style={{ flex: 1, minWidth: 120, padding: '11px 18px', fontSize: 14 }}
                  >
                    {launching ? 'Launching…' : 'Launch ↗'}
                  </button>
                </div>

                {error && <p style={{ margin: 0, fontSize: 12, color: 'var(--red)' }}>⚠ {error}</p>}
              </div>
            )}
          </div>
        </>
      )}
    </>
  )
}
