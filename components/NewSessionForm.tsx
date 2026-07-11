'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import ImageAttachment, { AttachedImage, useImagePaste } from './ImageAttachment'
import type { AgentMode } from '@/lib/types'
import { useCodexModelSelection } from '@/lib/use-codex-model-selection'

interface Props {
  projectPath: string
  hasActive?: boolean
  isGitRepo?: boolean
  mode?: AgentMode
}

export default function NewSessionForm({ projectPath, hasActive, isGitRepo, mode = 'claude' }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [prompt, setPrompt] = useState('')
  const [launching, setLaunching] = useState(false)
  const [error, setError] = useState('')
  const [image, setImage] = useState<AttachedImage | null>(null)
  const [skipPerms, setSkipPerms] = useState(true)
  const [useWorktree, setUseWorktree] = useState(false)
  const handlePaste = useImagePaste(setImage)
  const {
    options: codexModelOptions,
    codexModelPreset,
    customCodexModel,
    customModelValue,
    setCodexModelPreset,
    setCustomCodexModel,
  } = useCodexModelSelection()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if ((!prompt.trim() && !image) || launching) return
    setLaunching(true)
    setError('')
    try {
      let finalPrompt = prompt.trim()

      // Upload file/image if attached
      if (image) {
        try {
          const isImage = image.mediaType.startsWith('image/')
          const endpoint = isImage ? '/api/upload-image' : '/api/upload-file'
          const body = isImage
            ? { data: image.base64, mediaType: image.mediaType }
            : { data: image.base64, name: image.name }
          const uploadRes = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          })
          if (uploadRes.ok) {
            const { filepath } = await uploadRes.json()
            const tag = isImage ? `[Image: ${filepath}]` : `[File: ${filepath}]`
            finalPrompt = finalPrompt ? `${finalPrompt}\n\n${tag}` : tag
          }
        } catch {
          // Continue if upload fails
        }
      }

      const res = await fetch('/api/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_path: projectPath,
          prompt: finalPrompt,
          model: mode === 'codex'
            ? (codexModelPreset === '__custom__' ? customCodexModel.trim() : codexModelPreset)
            : undefined,
          skip_permissions: skipPerms,
          use_worktree: useWorktree,
          mode,
        }),
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
            Start a new {mode === 'codex' ? 'Codex exec session' : 'Claude session'} in{' '}
            <span style={{ fontFamily: 'ui-monospace, monospace', color: 'var(--accent)', fontSize: 12 }}>
              {projectPath.split('/').pop()}
            </span>
          </p>

          <form onSubmit={handleSubmit} className="new-session-form">
            <div className="new-session-row">
              <ImageAttachment image={image} onAttach={setImage} onRemove={() => setImage(null)} />
              <textarea
                className="glass-input"
                value={prompt}
                onChange={e => setPrompt(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(e) }
                }}
                onPaste={handlePaste}
                placeholder={mode === 'codex' ? 'What do you want Codex to do? Paste an image with Cmd+V' : 'What do you want Claude to do? Paste an image with Cmd+V'}
                autoFocus
                rows={3}
                style={{ flex: 1, fontSize: 16, padding: '10px 14px', borderRadius: 10, resize: 'none', lineHeight: 1.5 }}
              />
            </div>
            {mode === 'codex' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <span style={{ fontSize: 12, color: 'var(--text2)' }}>Model</span>
                  <select
                    className="glass-input"
                    value={codexModelPreset}
                    onChange={e => setCodexModelPreset(e.target.value)}
                    style={{ fontSize: 13, padding: '10px 12px', borderRadius: 10 }}
                  >
                    {codexModelOptions.map(option => (
                      <option key={option.value} value={option.value}>
                        {option.label} {option.note ? `· ${option.note}` : ''}
                      </option>
                    ))}
                  </select>
                </label>
                {codexModelPreset === customModelValue && (
                  <input
                    className="glass-input"
                    value={customCodexModel}
                    onChange={e => setCustomCodexModel(e.target.value)}
                    placeholder="e.g. gpt-5.5 or another Codex-supported model"
                    style={{ fontSize: 13, padding: '10px 12px', borderRadius: 10 }}
                  />
                )}
                <p style={{ margin: 0, fontSize: 11, color: 'var(--text3)' }}>
                  Passed to <code>codex exec --model</code>. Availability depends on your Codex account, sign-in method, and CLI version.
                </p>
              </div>
            )}
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text2)', cursor: 'pointer', userSelect: 'none', padding: '4px 0' }}>
              <input
                type="checkbox"
                checked={skipPerms}
                onChange={e => setSkipPerms(e.target.checked)}
                style={{ width: 14, height: 14, accentColor: 'var(--accent)', cursor: 'pointer' }}
              />
              <span>Skip permission prompts</span>
              <span style={{ color: 'var(--text3)', fontSize: 11 }}>
                {mode === 'codex' ? '(--dangerously-bypass-approvals-and-sandbox)' : '(--dangerously-skip-permissions)'}
              </span>
            </label>
            {mode !== 'codex' && isGitRepo && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, cursor: 'pointer', userSelect: 'none', padding: '4px 0',
                color: useWorktree ? 'var(--accent)' : 'var(--text2)',
                background: useWorktree ? 'color-mix(in srgb, var(--accent) 8%, transparent)' : 'transparent',
                borderRadius: 8, marginLeft: -6, paddingLeft: 6,
              }}>
                <input
                  type="checkbox"
                  checked={useWorktree}
                  onChange={e => setUseWorktree(e.target.checked)}
                  style={{ width: 14, height: 14, accentColor: 'var(--accent)', cursor: 'pointer' }}
                />
                <span>Isolated worktree</span>
                <span style={{ color: 'var(--text3)', fontSize: 11 }}>
                  {hasActive ? '— avoids conflicts with running session' : '— work on a separate branch'}
                </span>
              </label>
            )}
            <button
              type="submit"
              className="glass-btn-prominent"
              disabled={(!prompt.trim() && !image) || launching}
              style={{ width: '100%', padding: '12px 20px', fontSize: 14 }}
            >
              {launching ? '…' : 'Launch ↗'}
            </button>
          </form>

          {error && (
            <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--red)' }}>⚠ {error}</p>
          )}
          {launching && (
            <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--text2)' }}>
              Starting {mode === 'codex' ? 'Codex' : 'Claude'}… new session will appear shortly.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
