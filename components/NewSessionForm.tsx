'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import ImageAttachment, { AttachedImage, useImagePaste } from './ImageAttachment'

interface Props {
  projectPath: string
}

export default function NewSessionForm({ projectPath }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [prompt, setPrompt] = useState('')
  const [launching, setLaunching] = useState(false)
  const [error, setError] = useState('')
  const [image, setImage] = useState<AttachedImage | null>(null)

  const handlePaste = useImagePaste(setImage)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if ((!prompt.trim() && !image) || launching) return
    setLaunching(true)
    setError('')
    try {
      let finalPrompt = prompt.trim()

      // Upload image if attached
      if (image) {
        try {
          const uploadRes = await fetch('/api/upload-image', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ data: image.base64, mediaType: image.mediaType }),
          })
          if (uploadRes.ok) {
            const { filepath } = await uploadRes.json()
            finalPrompt = finalPrompt ? `${finalPrompt}\n\n[Image: ${filepath}]` : `[Image: ${filepath}]`
          }
        } catch {
          // Continue without image if upload fails
        }
      }

      const res = await fetch('/api/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project_path: projectPath, prompt: finalPrompt }),
      })
      if (!res.ok) {
        const d = await res.json()
        setError(d.error ?? 'Failed to start session')
        return
      }
      setPrompt('')
      setImage(null)
      setOpen(false)
      setTimeout(() => router.refresh(), 2000)
    } finally {
      setLaunching(false)
    }
  }

  return (
    <div style={{ marginBottom: open ? 20 : 0 }}>
      <button
        onClick={() => { setOpen(v => !v); setPrompt(''); setImage(null); setError('') }}
        className="glass-btn"
        style={{
          fontSize: 13,
          padding: '7px 16px',
          borderColor: open ? 'var(--glass-border-hi)' : undefined,
          color: open ? 'var(--text2)' : 'var(--text)',
        }}
      >
        {open ? '✕ Cancel' : '+ New session'}
      </button>

      {open && (
        <div
          className="glass"
          style={{
            borderRadius: 12,
            padding: '16px 18px',
            marginTop: 14,
            animation: 'fadeIn 0.15s ease',
          }}
        >
          <p style={{ margin: '0 0 10px', fontSize: 13, color: 'var(--text2)' }}>
            Start a new Claude session in{' '}
            <span style={{ fontFamily: 'ui-monospace, monospace', color: 'var(--accent)', fontSize: 12 }}>
              {projectPath.split('/').pop()}
            </span>
          </p>

          <form onSubmit={handleSubmit} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <ImageAttachment image={image} onAttach={setImage} onRemove={() => setImage(null)} />
            <textarea
              className="glass-input"
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(e) }
              }}
              onPaste={handlePaste}
              placeholder="What do you want Claude to do? Paste an image with Cmd+V"
              autoFocus
              rows={2}
              style={{ flex: 1, fontSize: 14, padding: '10px 14px', borderRadius: 10, resize: 'none', lineHeight: 1.5 }}
            />
            <button
              type="submit"
              className="glass-btn-prominent"
              disabled={(!prompt.trim() && !image) || launching}
              style={{ width: 'auto', padding: '0 20px', fontSize: 14, flexShrink: 0, alignSelf: 'stretch' }}
            >
              {launching ? '…' : 'Launch ↗'}
            </button>
          </form>

          {error && (
            <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--red)' }}>⚠ {error}</p>
          )}
          {launching && (
            <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--text2)' }}>
              Starting Claude… new session will appear shortly.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
