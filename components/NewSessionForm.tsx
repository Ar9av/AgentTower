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

interface ProjectGitStatus {
  isGitRepo: boolean
  dirty: boolean
  branch: string | null
  upstream: string | null
  ahead: number
  behind: number
  changed: number
  untracked: number
  conflicted: number
  summary: string
}

const QUICK_PROMPTS = {
  empty: 'hi',
  gitPull: 'Run `git pull` in this repository now. If the pull succeeds, summarize what changed. If it fails, report the exact blocker and the safest next step.',
  fixToLatest: 'Update this repository to the latest working state. Start by checking git status, remotes, and branch state. Fetch and pull the latest changes, resolve straightforward issues if safe, run the relevant tests or checks, and summarize what changed plus any remaining blockers.',
  pullAnyway: 'Attempt `git pull` in this repository even though the working tree is dirty. Do not discard or overwrite local work. If git blocks the pull, report the exact reason and recommend the next safe action.',
  stashAndPull: 'Stash all local changes including untracked files, run `git pull`, then report the result and show the exact stash command needed to restore the changes. Do not drop the stash.',
  commitAndPull: 'Review the current local changes, create a sensible checkpoint commit if safe, then run `git pull` and summarize the result. If the changes are too ambiguous to commit safely, stop and explain why.',
  cleanAndPull: 'List the local uncommitted and untracked changes that would be removed, then explain that the user must explicitly confirm before deleting them to allow a clean `git pull`. Do not delete anything yet.',
} as const

export default function NewSessionForm({ projectPath, hasActive, isGitRepo, mode = 'claude' }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [prompt, setPrompt] = useState('')
  const [launching, setLaunching] = useState(false)
  const [checkingGit, setCheckingGit] = useState(false)
  const [error, setError] = useState('')
  const [image, setImage] = useState<AttachedImage | null>(null)
  const [skipPerms, setSkipPerms] = useState(true)
  const [useWorktree, setUseWorktree] = useState(false)
  const [launchLabel, setLaunchLabel] = useState('')
  const [gitStatus, setGitStatus] = useState<ProjectGitStatus | null>(null)
  const [showGitChoices, setShowGitChoices] = useState(false)
  const [notice, setNotice] = useState('')

  const handlePaste = useImagePaste(setImage)
  const {
    options: codexModelOptions,
    codexModelPreset,
    customCodexModel,
    customModelValue,
    setCodexModelPreset,
    setCustomCodexModel,
  } = useCodexModelSelection()

  async function launchSession(options?: {
    promptOverride?: string
    imageOverride?: AttachedImage | null
    closeAfter?: boolean
    label?: string
    useWorktreeOverride?: boolean
  }) {
    const promptOverride = options?.promptOverride
    const imageOverride = options?.imageOverride ?? image
    const closeAfter = options?.closeAfter ?? true
    const label = options?.label ?? `Starting ${mode === 'codex' ? 'Codex' : 'Claude'}...`
    const useWorktreeValue = options?.useWorktreeOverride ?? useWorktree

    if (launching) return

    let finalPrompt = (promptOverride ?? prompt).trim()
    if (!finalPrompt && !imageOverride) return

    setLaunching(true)
    setLaunchLabel(label)
    setError('')
    setNotice('')
    try {
      if (imageOverride) {
        try {
          const isImage = imageOverride.mediaType.startsWith('image/')
          const endpoint = isImage ? '/api/upload-image' : '/api/upload-file'
          const body = isImage
            ? { data: imageOverride.base64, mediaType: imageOverride.mediaType }
            : { data: imageOverride.base64, name: imageOverride.name }
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
          use_worktree: useWorktreeValue,
          mode,
        }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setError(d.error ?? 'Failed to start session')
        return
      }
      setPrompt('')
      setImage(null)
      setShowGitChoices(false)
      if (closeAfter) setOpen(false)
      setTimeout(() => router.refresh(), 1000)
      setTimeout(() => router.refresh(), 3000)
    } finally {
      setLaunching(false)
      setLaunchLabel('')
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    await launchSession({ label: `Starting ${mode === 'codex' ? 'Codex' : 'Claude'}... new session will appear shortly.` })
  }

  async function handleStashAndPullClick() {
    if (mode === 'codex' || launching) return
    setLaunching(true)
    setLaunchLabel('Stashing local changes and pulling latest...')
    setError('')
    setNotice('')
    try {
      const res = await fetch('/api/project-git', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project_path: projectPath, action: 'stash-and-pull' }),
      })
      const data = await res.json().catch(() => ({})) as {
        ok?: boolean
        error?: string
        stashCreated?: boolean
        stashRef?: string | null
        pullOutput?: string
        status?: ProjectGitStatus
      }

      if (!res.ok || !data.ok) {
        if (data.status) setGitStatus(data.status)
        setError(data.pullOutput || data.error || 'Stash + pull failed')
        return
      }

      if (data.status) setGitStatus(data.status)
      setShowGitChoices(false)
      setNotice(data.status?.dirty
        ? `Pull completed, but the repo is still dirty. ${data.status.summary}${data.stashRef ? ` Stash saved as ${data.stashRef}.` : ''}`
        : `Pull completed successfully. ${data.stashRef ? `Stash saved as ${data.stashRef}.` : ''}`)
      setTimeout(() => router.refresh(), 1000)
      setTimeout(() => router.refresh(), 3000)
    } finally {
      setLaunching(false)
      setLaunchLabel('')
    }
  }

  async function handleGitPullClick() {
    if (mode === 'codex' || launching || checkingGit) return
    setCheckingGit(true)
    setError('')
    setNotice('')
    try {
      const res = await fetch(`/api/project-git?project_path=${encodeURIComponent(projectPath)}`)
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error ?? 'Failed to inspect git state')
        return
      }
      const status = data as ProjectGitStatus
      setGitStatus(status)
      if (!status.isGitRepo) {
        setError('This project is not a git repository')
        return
      }
      if (!status.dirty) {
        await launchSession({
          promptOverride: QUICK_PROMPTS.gitPull,
          imageOverride: null,
          closeAfter: true,
          label: 'Starting Claude with git pull instructions...',
          useWorktreeOverride: false,
        })
        return
      }
      setShowGitChoices(true)
    } finally {
      setCheckingGit(false)
    }
  }

  return (
    <div style={{ marginBottom: open || showGitChoices ? 20 : 0 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <button
          onClick={() => launchSession({ promptOverride: QUICK_PROMPTS.empty, imageOverride: null, closeAfter: true, label: `Starting ${mode === 'codex' ? 'Codex' : 'Claude'}...` })}
          className="glass-btn-prominent"
          disabled={launching || checkingGit}
          style={{ fontSize: 13, padding: '7px 16px' }}
        >
          + New session
        </button>
        {mode !== 'codex' && (
          <>
            <button
              onClick={() => { void handleGitPullClick() }}
              className="glass-btn"
              disabled={launching || checkingGit}
              style={{ fontSize: 13, padding: '7px 16px' }}
              title="Inspect git state, then pull or offer safe options if dirty"
            >
              {checkingGit ? 'Checking git...' : 'Git pull'}
            </button>
            <button
              onClick={() => launchSession({ promptOverride: QUICK_PROMPTS.fixToLatest, imageOverride: null, closeAfter: true, label: 'Starting Claude with update instructions...', useWorktreeOverride: false })}
              className="glass-btn"
              disabled={launching || checkingGit}
              style={{ fontSize: 13, padding: '7px 16px' }}
            >
              Fix to latest
            </button>
          </>
        )}
        <button
          onClick={() => {
            setOpen(v => !v)
            setPrompt('')
            setImage(null)
            setError('')
            setShowGitChoices(false)
          }}
          className="glass-btn"
          disabled={launching || checkingGit}
          style={{
            fontSize: 13,
            padding: '7px 16px',
            borderColor: open ? 'var(--glass-border-hi)' : undefined,
            color: open ? 'var(--text2)' : 'var(--text)',
          }}
        >
          {open ? 'Cancel' : 'Custom prompt'}
        </button>
      </div>

      {showGitChoices && gitStatus && (
        <div className="glass" style={{ borderRadius: 12, padding: '16px 18px', marginTop: 14, animation: 'fadeIn 0.15s ease' }}>
          <p style={{ margin: '0 0 8px', fontSize: 13, color: 'var(--text)' }}>
            This repo is dirty, so a plain `git pull` may fail. Choose how Claude should handle it.
          </p>
          <p style={{ margin: '0 0 14px', fontSize: 12, color: 'var(--text2)', fontFamily: 'ui-monospace, monospace' }}>
            {gitStatus.summary}
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <button
              onClick={() => launchSession({ promptOverride: QUICK_PROMPTS.pullAnyway, imageOverride: null, closeAfter: true, label: 'Starting Claude to attempt git pull on a dirty repo...', useWorktreeOverride: false })}
              className="glass-btn-prominent"
              disabled={launching}
              style={{ fontSize: 13, padding: '7px 16px' }}
            >
              Pull anyway
            </button>
            <button
              onClick={() => { void handleStashAndPullClick() }}
              className="glass-btn"
              disabled={launching}
              style={{ fontSize: 13, padding: '7px 16px' }}
            >
              Stash + pull
            </button>
            <button
              onClick={() => launchSession({ promptOverride: QUICK_PROMPTS.commitAndPull, imageOverride: null, closeAfter: true, label: 'Starting Claude with commit and pull instructions...', useWorktreeOverride: false })}
              className="glass-btn"
              disabled={launching}
              style={{ fontSize: 13, padding: '7px 16px' }}
            >
              Commit + pull
            </button>
            <button
              onClick={() => launchSession({ promptOverride: QUICK_PROMPTS.cleanAndPull, imageOverride: null, closeAfter: true, label: 'Starting Claude to prepare a clean-and-pull plan...', useWorktreeOverride: false })}
              className="glass-btn"
              disabled={launching}
              style={{ fontSize: 13, padding: '7px 16px' }}
            >
              Clean + pull
            </button>
            <button
              onClick={() => setShowGitChoices(false)}
              className="glass-btn"
              disabled={launching}
              style={{ fontSize: 13, padding: '7px 16px' }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

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
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void handleSubmit(e) }
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
              {launching ? '...' : 'Launch ↗'}
            </button>
          </form>

          {error && (
            <div style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--red)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              <strong style={{ display: 'block', marginBottom: 4 }}>Launch failed</strong>
              {error}
            </div>
          )}
        </div>
      )}

      {notice && (
        <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--text2)' }}>{notice}</p>
      )}
      {launching && (
        <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--text2)' }}>
          {launchLabel || `Starting ${mode === 'codex' ? 'Codex' : 'Claude'}... new session will appear shortly.`}
        </p>
      )}
      {error && !open && (
        <div style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--red)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          <strong style={{ display: 'block', marginBottom: 4 }}>Launch failed</strong>
          {error}
        </div>
      )}
    </div>
  )
}
