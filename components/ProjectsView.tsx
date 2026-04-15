'use client'
import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { ProjectInfo } from '@/lib/types'

interface Props {
  initialProjects: ProjectInfo[]
}

// Client-side b64url — must match server encodeB64
function b64url(s: string): string {
  if (typeof window === 'undefined') return ''
  return btoa(unescape(encodeURIComponent(s)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export default function ProjectsView({ initialProjects }: Props) {
  const router = useRouter()
  const [projects, setProjects] = useState(initialProjects)
  const [showAdd, setShowAdd] = useState(false)
  const [renaming, setRenaming] = useState<string | null>(null)

  const activeCount = projects.filter(p => p.hasActive).length

  async function handleRename(projectPath: string, displayName: string) {
    const res = await fetch('/api/projects/meta', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectPath, displayName }),
    })
    if (res.ok) {
      setProjects(ps => ps.map(p => p.decodedPath === projectPath ? { ...p, displayName } : p))
      setRenaming(null)
    } else {
      alert('Rename failed')
    }
  }

  async function handleCreate(payload: { name: string; githubUrl: string; displayName: string }) {
    const res = await fetch('/api/projects/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
    setShowAdd(false)
    router.refresh()
    // Navigate to the newly created project so user can start a chat
    const dirName = data.path.replace(/\./g, '--').replace(/\//g, '-')
    router.push(`/project?p=${b64url(dirName)}`)
  }

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 28, gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ margin: '0 0 4px', fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em' }}>Projects</h1>
          <p style={{ margin: 0, color: 'var(--text2)', fontSize: 13 }}>
            {projects.length} project{projects.length !== 1 ? 's' : ''}
            {activeCount > 0 && (
              <span style={{ marginLeft: 10 }}>
                <span className="dot-active" style={{ marginRight: 5 }} />
                <span style={{ color: 'var(--green)' }}>{activeCount} active</span>
              </span>
            )}
          </p>
        </div>
        <button
          className="glass-btn-prominent"
          onClick={() => setShowAdd(true)}
          style={{ padding: '10px 18px', fontSize: 13, fontWeight: 600, minHeight: 40 }}
        >
          + Add Project
        </button>
      </div>

      {projects.length === 0 ? (
        <div className="glass" style={{ borderRadius: 16, padding: '60px 40px', textAlign: 'center' }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>🗂</div>
          <p style={{ fontSize: 16, color: 'var(--text)', margin: '0 0 8px' }}>No projects yet</p>
          <p style={{ fontSize: 13, color: 'var(--text2)', margin: 0 }}>Click &quot;Add Project&quot; to clone a repo or create a new workspace.</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 280px), 1fr))', gap: 12 }}>
          {projects.map(p => (
            <ProjectCard
              key={p.decodedPath}
              project={p}
              renaming={renaming === p.decodedPath}
              onStartRename={() => setRenaming(p.decodedPath)}
              onCancelRename={() => setRenaming(null)}
              onRename={name => handleRename(p.decodedPath, name)}
            />
          ))}
        </div>
      )}

      {showAdd && <AddProjectModal onClose={() => setShowAdd(false)} onCreate={handleCreate} />}
    </>
  )
}

function ProjectCard({
  project, renaming, onStartRename, onCancelRename, onRename,
}: {
  project: ProjectInfo
  renaming: boolean
  onStartRename: () => void
  onCancelRename: () => void
  onRename: (name: string) => void
}) {
  const [draft, setDraft] = useState(project.displayName)
  const href = `/project?p=${b64url(project.dirName)}`

  if (renaming) {
    return (
      <div className="glass" style={{ borderRadius: 14, padding: '18px 20px' }}>
        <form
          onSubmit={e => { e.preventDefault(); if (draft.trim()) onRename(draft.trim()) }}
          style={{ display: 'flex', flexDirection: 'column', gap: 10 }}
        >
          <input
            className="glass-input"
            value={draft}
            onChange={e => setDraft(e.target.value)}
            autoFocus
            style={{ fontSize: 14, padding: '8px 12px', borderRadius: 8, minHeight: 36 }}
          />
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="submit" className="glass-btn-prominent" style={{ flex: 1, padding: '6px 12px', fontSize: 12, minHeight: 32 }}>Save</button>
            <button type="button" className="glass-btn" onClick={onCancelRename} style={{ flex: 1, padding: '6px 12px', fontSize: 12, minHeight: 32 }}>Cancel</button>
          </div>
        </form>
        <p style={{ margin: '8px 0 0', fontSize: 11, color: 'var(--text3)', fontFamily: 'ui-monospace, monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {project.decodedPath}
        </p>
      </div>
    )
  }

  return (
    <div
      className="glass-interactive"
      style={{
        borderRadius: 14,
        padding: '18px 20px',
        position: 'relative',
        borderColor: project.hasActive ? 'rgba(61,214,140,0.25)' : undefined,
        boxShadow: project.hasActive
          ? 'inset 0 1px 0 rgba(255,255,255,0.14), 0 4px 20px rgba(0,0,0,0.3), 0 0 0 1px rgba(61,214,140,0.1)'
          : undefined,
      }}
    >
      <button
        onClick={e => { e.preventDefault(); e.stopPropagation(); onStartRename() }}
        title="Rename"
        aria-label="Rename project"
        style={{
          position: 'absolute', top: 10, right: 10,
          background: 'transparent', border: 'none', cursor: 'pointer',
          color: 'var(--text3)', fontSize: 13, padding: 4, borderRadius: 6,
        }}
      >
        ✎
      </button>
      <Link href={href} style={{ textDecoration: 'none', display: 'block' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, paddingRight: 24 }}>
          {project.hasActive && <span className="dot-active" />}
          <span style={{
            fontWeight: 600, fontSize: 15, color: 'var(--text)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            letterSpacing: '-0.01em',
          }}>
            {project.displayName}
          </span>
        </div>
        <p style={{
          margin: '0 0 14px', fontSize: 12, color: 'var(--text3)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          fontFamily: 'ui-monospace, monospace',
        }}>
          {project.decodedPath}
        </p>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span className="chip">{project.sessionCount} session{project.sessionCount !== 1 ? 's' : ''}</span>
          {project.latestMtime > 0 && <span className="chip">{formatRelative(project.latestMtime)}</span>}
          {project.hasActive && <span className="chip chip-green">Live</span>}
        </div>
      </Link>
    </div>
  )
}

function AddProjectModal({
  onClose, onCreate,
}: {
  onClose: () => void
  onCreate: (p: { name: string; githubUrl: string; displayName: string }) => Promise<void>
}) {
  const [githubUrl, setGithubUrl] = useState('')
  const [name, setName] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!githubUrl.trim() && !name.trim()) {
      setError('Provide a GitHub URL or a folder name.')
      return
    }
    setBusy(true)
    try {
      await onCreate({ githubUrl: githubUrl.trim(), name: name.trim(), displayName: displayName.trim() })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 200, padding: 16, backdropFilter: 'blur(4px)',
      }}
    >
      <div
        className="glass-lg"
        onClick={e => e.stopPropagation()}
        style={{ borderRadius: 16, padding: 24, maxWidth: 460, width: '100%' }}
      >
        <h2 style={{ margin: '0 0 4px', fontSize: 18, fontWeight: 700 }}>Add Project</h2>
        <p style={{ margin: '0 0 18px', fontSize: 12, color: 'var(--text3)' }}>
          Provide a GitHub URL to clone, or just a folder name to start fresh.
        </p>
        <form onSubmit={submit} style={{ display: 'grid', gap: 12 }}>
          <Field label="GitHub URL (optional)" hint="https://github.com/user/repo or git@github.com:user/repo.git">
            <input
              className="glass-input"
              value={githubUrl}
              onChange={e => {
                setGithubUrl(e.target.value)
                if (!name) {
                  const m = e.target.value.match(/([^\/:]+?)(?:\.git)?\/?$/)
                  if (m) setName(m[1])
                }
              }}
              placeholder="https://github.com/user/repo"
              style={{ fontSize: 13, padding: '8px 12px', borderRadius: 8, minHeight: 36, fontFamily: 'ui-monospace, monospace' }}
            />
          </Field>
          <Field label="Folder name" hint="Folder created under your workspace root.">
            <input
              className="glass-input"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="my-project"
              style={{ fontSize: 13, padding: '8px 12px', borderRadius: 8, minHeight: 36, fontFamily: 'ui-monospace, monospace' }}
            />
          </Field>
          <Field label="Display name (optional)" hint="Shown in AgentTower; defaults to folder name.">
            <input
              className="glass-input"
              value={displayName}
              onChange={e => setDisplayName(e.target.value)}
              placeholder=""
              style={{ fontSize: 13, padding: '8px 12px', borderRadius: 8, minHeight: 36 }}
            />
          </Field>
          {error && <div style={{ fontSize: 12, color: 'var(--red, #ef4444)' }}>{error}</div>}
          <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
            <button type="submit" disabled={busy} className="glass-btn-prominent" style={{ flex: 1, padding: '10px 16px', minHeight: 40, fontSize: 13, fontWeight: 600, opacity: busy ? 0.6 : 1 }}>
              {busy ? 'Creating…' : 'Create'}
            </button>
            <button type="button" onClick={onClose} className="glass-btn" style={{ flex: 1, padding: '10px 16px', minHeight: 40, fontSize: 13 }}>
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>{label}</div>
      {children}
      {hint && <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>{hint}</div>}
    </div>
  )
}

function formatRelative(ms: number): string {
  const diff = Date.now() - ms
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return `${Math.floor(diff / 86_400_000)}d ago`
}
