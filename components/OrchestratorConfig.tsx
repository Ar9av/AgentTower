'use client'
import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import type { OrchestratorConfig as Cfg, RepoConfig } from '@/lib/orchestrator-types'
import { appPath } from '@/lib/base-path'

interface ConfigData {
  config: Cfg
  configPath: string
  runsPath: string
}

interface DaemonStatus {
  running: boolean
  pid: number | null
  uptimeSec: number | null
}

interface GitHubStatus {
  tokenSet: boolean
  usingEnvVar: boolean
  usingGhCli: boolean
  tokenHint: string | null
}

interface GhRepo {
  fullName: string
  name: string
  private: boolean
  description: string | null
  defaultBranch: string
}

interface ProjectMeta {
  displayName?: string
  githubUrl?: string
}

interface ProjectMetaStore {
  projects: Record<string, ProjectMeta>
}

function repoFromGithubUrl(url: string): string {
  const m = url.match(/github\.com[/:]([^/]+\/[^/.]+)/)
  return m ? m[1] : ''
}

function newRepo(): RepoConfig {
  return {
    id: Math.random().toString(36).slice(2),
    enabled: true,
    tracker: 'github',
    repo: '',
    localPath: '',
    labelPrefix: 'agenttower:',
    autonomy: 'approval',
    maxConcurrentAgents: 1,
    maxRetries: 2,
    useWorkflowFile: false,
    promptTemplate: '',
    baseBranch: 'main',
    issueFilter: '',
    model: '',
    maxTurns: 30,
  }
}

function fmtUptime(sec: number | null): string {
  if (!sec) return '—'
  if (sec < 60) return `${sec}s`
  if (sec < 3600) return `${Math.floor(sec / 60)}m`
  return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`
}

// ─── Repo dropdown ────────────────────────────────────────────────────────────
function RepoSelector({
  value,
  ghRepos,
  ghReposLoading,
  onChange,
  inputStyle,
}: {
  value: string
  ghRepos: GhRepo[]
  ghReposLoading: boolean
  onChange: (v: string) => void
  inputStyle: React.CSSProperties
}) {
  const [manual, setManual] = useState(!ghRepos.some(r => r.fullName === value) && value !== '')

  // If ghRepos loaded and current value is in the list, stay in dropdown mode
  useEffect(() => {
    if (ghRepos.length > 0 && value && !ghRepos.some(r => r.fullName === value)) {
      setManual(true)
    }
  }, [ghRepos, value])

  if (manual) {
    return (
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <input
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder="owner/repo"
          style={{ ...inputStyle, flex: 1 }}
        />
        {ghRepos.length > 0 && (
          <button
            type="button"
            onClick={() => setManual(false)}
            style={{ background: 'transparent', border: 'none', color: 'var(--accent)', fontSize: 11, cursor: 'pointer', whiteSpace: 'nowrap' }}
          >
            ↩ pick
          </button>
        )}
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        style={{ ...inputStyle, flex: 1 }}
        disabled={ghReposLoading}
      >
        <option value="">{ghReposLoading ? 'Loading repos…' : '— select a repo —'}</option>
        {ghRepos.map(r => (
          <option key={r.fullName} value={r.fullName}>
            {r.fullName}{r.private ? ' 🔒' : ''}
            {r.description ? ` — ${r.description.slice(0, 40)}` : ''}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={() => setManual(true)}
        style={{ background: 'transparent', border: 'none', color: 'var(--text3)', fontSize: 11, cursor: 'pointer', whiteSpace: 'nowrap' }}
        title="Type manually"
      >
        ✏️
      </button>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function OrchestratorConfig() {
  const [data, setData] = useState<ConfigData | null>(null)
  const [daemon, setDaemon] = useState<DaemonStatus | null>(null)
  const [githubStatus, setGithubStatus] = useState<GitHubStatus | null>(null)
  const [ghRepos, setGhRepos] = useState<GhRepo[]>([])
  const [ghReposLoading, setGhReposLoading] = useState(false)
  const [ghReposError, setGhReposError] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const [daemonLoading, setDaemonLoading] = useState(false)
  const [projects, setProjects] = useState<{ path: string; displayName: string; repo: string; defaultBranch?: string }[]>([])
  const [showProjectPicker, setShowProjectPicker] = useState(false)

  // Form state
  const [enabled, setEnabled] = useState(false)
  const [pollIntervalSec, setPollIntervalSec] = useState(60)
  const [globalMaxConcurrent, setGlobalMaxConcurrent] = useState(3)
  const [workspaceRoot, setWorkspaceRoot] = useState('')
  const [agentTowerUrl, setAgentTowerUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [repos, setRepos] = useState<RepoConfig[]>([])

  const load = useCallback(async () => {
    try {
      const res = await fetch(appPath('/api/orchestrator/config'))
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const d = await res.json() as ConfigData
      setData(d)
      const c = d.config
      setEnabled(c.enabled)
      setPollIntervalSec(c.pollIntervalSec)
      setGlobalMaxConcurrent(c.globalMaxConcurrent)
      setWorkspaceRoot(c.workspaceRoot)
      setAgentTowerUrl(c.agentTowerUrl)
      setApiKey(c.apiKey)
      setRepos(c.repos)
    } catch (err) {
      setError(String(err))
    }
  }, [])

  const loadDaemon = useCallback(async () => {
    try {
      const res = await fetch(appPath('/api/orchestrator/control'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'status' }),
      })
      if (res.ok) setDaemon(await res.json())
    } catch {}
  }, [])

  const loadGitHubRepos = useCallback(async () => {
    setGhReposLoading(true)
    setGhReposError('')
    try {
      const res = await fetch(appPath('/api/orchestrator/github-repos'))
      const d = await res.json() as { repos?: GhRepo[]; error?: string }
      if (d.error) {
        setGhReposError(d.error)
      } else {
        setGhRepos(d.repos ?? [])
      }
    } catch (e) {
      setGhReposError(String(e))
    } finally {
      setGhReposLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
    loadDaemon()

    // GitHub integration status
    fetch(appPath('/api/integrations/github'))
      .then(r => r.json())
      .then((d: { github: GitHubStatus }) => {
        setGithubStatus(d.github)
        if (d.github.tokenSet) loadGitHubRepos()
      })
      .catch(() => {})

    // Projects with githubUrl for the import picker
    fetch(appPath('/api/projects/meta'))
      .then(r => r.json())
      .then((store: ProjectMetaStore) => {
        const list = Object.entries(store.projects)
          .filter(([, m]) => m.githubUrl)
          .map(([p, m]) => ({
            path: p,
            displayName: m.displayName ?? p.split('/').pop() ?? p,
            repo: repoFromGithubUrl(m.githubUrl!),
          }))
          .filter(p => p.repo)
        setProjects(list)
      })
      .catch(() => {})

    const iv = setInterval(loadDaemon, 10_000)
    return () => clearInterval(iv)
  }, [load, loadDaemon, loadGitHubRepos])

  const save = async () => {
    setSaving(true)
    setError('')
    try {
      const cfg: Partial<Cfg> = {
        enabled, pollIntervalSec, globalMaxConcurrent, workspaceRoot, agentTowerUrl, repos,
      }
      const res = await fetch(appPath('/api/orchestrator/config'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cfg),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (err) {
      setError(String(err))
    } finally {
      setSaving(false)
    }
  }

  const daemonAction = async (action: 'start' | 'stop') => {
    setDaemonLoading(true)
    try {
      await fetch(appPath('/api/orchestrator/control'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      await new Promise(r => setTimeout(r, 1500))
      await loadDaemon()
    } finally {
      setDaemonLoading(false)
    }
  }

  const updateRepo = (idx: number, patch: Partial<RepoConfig>) => {
    setRepos(prev => prev.map((r, i) => i === idx ? { ...r, ...patch } : r))
  }

  const removeRepo = (idx: number) => {
    setRepos(prev => prev.filter((_, i) => i !== idx))
  }

  const inputStyle: React.CSSProperties = {
    background: 'var(--surface2)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    padding: '7px 10px',
    color: 'var(--text1)',
    fontSize: 13,
    width: '100%',
    outline: 'none',
  }

  const sectionStyle: React.CSSProperties = {
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: 12,
    padding: 20,
    marginBottom: 20,
  }

  const githubConfigured = githubStatus?.tokenSet === true

  return (
    <div style={{ maxWidth: 820 }}>
      {error && (
        <div style={{ background: '#ff444420', border: '1px solid #ff4444', borderRadius: 8, padding: 12, marginBottom: 16, fontSize: 13, color: '#ff6666' }}>
          {error}
        </div>
      )}

      {/* GitHub not configured — banner */}
      {githubStatus !== null && !githubConfigured && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
          background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.35)',
          borderRadius: 10, padding: '12px 16px', marginBottom: 20,
        }}>
          <span style={{ fontSize: 18 }}>⚠️</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--text1)' }}>
              GitHub token not configured
            </p>
            <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--text2)' }}>
              The orchestrator needs a GitHub token to read issues, move labels, and open PRs.
            </p>
          </div>
          <Link
            href="/integrations"
            style={{
              fontSize: 13, fontWeight: 600, padding: '6px 14px', borderRadius: 8,
              background: 'rgba(251,191,36,0.18)', border: '1px solid rgba(251,191,36,0.4)',
              color: 'var(--text1)', textDecoration: 'none', whiteSpace: 'nowrap',
            }}
          >
            Configure →
          </Link>
        </div>
      )}

      {/* GitHub repos error */}
      {githubConfigured && ghReposError && (
        <div style={{ background: '#ff444415', border: '1px solid #ff4444', borderRadius: 8, padding: '8px 12px', marginBottom: 16, fontSize: 12, color: '#f87171' }}>
          Could not load GitHub repos: {ghReposError}
          <button
            onClick={loadGitHubRepos}
            style={{ marginLeft: 10, background: 'transparent', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: 12 }}
          >
            Retry
          </button>
        </div>
      )}

      {/* Daemon status */}
      <div style={{ ...sectionStyle, display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            width: 10, height: 10, borderRadius: '50%',
            background: daemon?.running ? '#22c55e' : '#666',
            display: 'inline-block',
          }} />
          <span style={{ fontSize: 14, fontWeight: 600 }}>
            Daemon {daemon?.running ? `running (pid ${daemon.pid}, uptime ${fmtUptime(daemon.uptimeSec)})` : 'stopped'}
          </span>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          {daemon?.running ? (
            <button className="glass-btn" onClick={() => daemonAction('stop')} disabled={daemonLoading} style={{ fontSize: 13, padding: '6px 14px' }}>
              {daemonLoading ? 'Stopping…' : 'Stop daemon'}
            </button>
          ) : (
            <button className="glass-btn" onClick={() => daemonAction('start')} disabled={daemonLoading || !githubConfigured} title={!githubConfigured ? 'Configure GitHub first' : undefined} style={{ fontSize: 13, padding: '6px 14px', opacity: githubConfigured ? 1 : 0.5 }}>
              {daemonLoading ? 'Starting…' : 'Start daemon'}
            </button>
          )}
        </div>
      </div>

      {/* Global settings */}
      <div style={sectionStyle}>
        <h2 style={{ margin: '0 0 16px', fontSize: 15, fontWeight: 600 }}>Global settings</h2>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
            <span style={{ color: 'var(--text2)' }}>Enabled</span>
            <select value={enabled ? 'yes' : 'no'} onChange={e => setEnabled(e.target.value === 'yes')} style={inputStyle}>
              <option value="no">Disabled</option>
              <option value="yes">Enabled</option>
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
            <span style={{ color: 'var(--text2)' }}>Poll interval (seconds)</span>
            <input type="number" min={10} value={pollIntervalSec} onChange={e => setPollIntervalSec(parseInt(e.target.value, 10))} style={inputStyle} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
            <span style={{ color: 'var(--text2)' }}>Global max concurrent agents</span>
            <input type="number" min={1} max={20} value={globalMaxConcurrent} onChange={e => setGlobalMaxConcurrent(parseInt(e.target.value, 10))} style={inputStyle} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
            <span style={{ color: 'var(--text2)' }}>Workspace root</span>
            <input type="text" value={workspaceRoot} onChange={e => setWorkspaceRoot(e.target.value)} placeholder="~/.claude/agenttower-workspaces" style={inputStyle} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
            <span style={{ color: 'var(--text2)' }}>AgentTower URL</span>
            <input type="text" value={agentTowerUrl} onChange={e => setAgentTowerUrl(e.target.value)} placeholder="http://localhost:3000" style={inputStyle} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
            <span style={{ color: 'var(--text2)' }}>API key (Bearer, for daemon)</span>
            <input type="text" value={apiKey} readOnly style={{ ...inputStyle, opacity: 0.7, fontFamily: 'monospace', fontSize: 11 }} />
          </label>
        </div>
        {data && (
          <p style={{ margin: '12px 0 0', fontSize: 11, color: 'var(--text3)' }}>
            Config: {data.configPath} · Runs: {data.runsPath}
          </p>
        )}
      </div>

      {/* Repos */}
      <div style={sectionStyle}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16, gap: 8, flexWrap: 'wrap' }}>
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>Repositories</h2>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
            {githubConfigured && ghRepos.length > 0 && (
              <button className="glass-btn" onClick={loadGitHubRepos} disabled={ghReposLoading} style={{ fontSize: 12, padding: '5px 10px' }}>
                {ghReposLoading ? '…' : '↻ Refresh repos'}
              </button>
            )}
            {projects.length > 0 && (
              <button className="glass-btn" onClick={() => setShowProjectPicker(v => !v)} style={{ fontSize: 13, padding: '5px 12px' }}>
                Import from project ↓
              </button>
            )}
            <button className="glass-btn" onClick={() => setRepos(prev => [...prev, newRepo()])} style={{ fontSize: 13, padding: '5px 12px' }}>
              + Add repo
            </button>
          </div>
        </div>

        {/* Project picker */}
        {showProjectPicker && (
          <div style={{ border: '1px solid var(--accent)', borderRadius: 10, padding: 12, marginBottom: 14, background: 'var(--surface2)' }}>
            <p style={{ margin: '0 0 8px', fontSize: 12, color: 'var(--text2)', fontWeight: 600 }}>
              Projects with a GitHub URL — click to import:
            </p>
            {projects.map(p => (
              <button
                key={p.path}
                className="glass-btn"
                style={{ display: 'block', width: '100%', textAlign: 'left', marginBottom: 6, fontSize: 13, padding: '7px 12px' }}
                onClick={() => {
                  const ghRepo = ghRepos.find(r => r.fullName === p.repo)
                  setRepos(prev => [...prev, {
                    ...newRepo(),
                    repo: p.repo,
                    localPath: p.path,
                    baseBranch: ghRepo?.defaultBranch ?? 'main',
                  }])
                  setShowProjectPicker(false)
                }}
              >
                <strong>{p.displayName}</strong>
                <span style={{ color: 'var(--text3)', marginLeft: 8, fontFamily: 'monospace', fontSize: 11 }}>{p.repo}</span>
                <span style={{ color: 'var(--text3)', marginLeft: 8, fontSize: 11 }}>{p.path}</span>
              </button>
            ))}
          </div>
        )}

        {repos.length === 0 && (
          <p style={{ color: 'var(--text3)', fontSize: 13, textAlign: 'center', padding: '24px 0' }}>
            No repositories configured.
            {githubConfigured
              ? ghRepos.length > 0
                ? ' Add one and pick a repo from the dropdown.'
                : ' Add one to get started.'
              : ' Configure GitHub in Integrations first.'}
          </p>
        )}

        {repos.map((repo, idx) => (
          <div key={repo.id} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 16, marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
              <span style={{ fontWeight: 600, fontSize: 14 }}>{repo.repo || '(new repo)'}</span>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 16, fontSize: 13 }}>
                <input type="checkbox" checked={repo.enabled} onChange={e => updateRepo(idx, { enabled: e.target.checked })} />
                Enabled
              </label>
              <button onClick={() => removeRepo(idx)} style={{ marginLeft: 'auto', background: 'transparent', border: 'none', color: 'var(--text3)', cursor: 'pointer', fontSize: 13 }}>
                Remove
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {/* Repo selector — dropdown or text */}
              <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 12 }}>
                <span style={{ color: 'var(--text2)' }}>
                  GitHub repo
                  {githubConfigured && ghRepos.length > 0 && <span style={{ color: 'var(--text3)', marginLeft: 4 }}>(pick from your repos)</span>}
                </span>
                <RepoSelector
                  value={repo.repo}
                  ghRepos={ghRepos}
                  ghReposLoading={ghReposLoading}
                  onChange={v => {
                    const ghRepo = ghRepos.find(r => r.fullName === v)
                    updateRepo(idx, {
                      repo: v,
                      ...(ghRepo ? { baseBranch: ghRepo.defaultBranch } : {}),
                    })
                  }}
                  inputStyle={inputStyle}
                />
              </label>

              <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 12 }}>
                <span style={{ color: 'var(--text2)' }}>Local clone path</span>
                <input value={repo.localPath} onChange={e => updateRepo(idx, { localPath: e.target.value })} placeholder="/path/to/local/clone" style={inputStyle} />
              </label>

              <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 12 }}>
                <span style={{ color: 'var(--text2)' }}>Autonomy mode</span>
                <select value={repo.autonomy} onChange={e => updateRepo(idx, { autonomy: e.target.value as 'auto' | 'approval' })} style={inputStyle}>
                  <option value="approval">Approval — require manual dispatch</option>
                  <option value="auto">Auto — dispatch automatically</option>
                </select>
              </label>

              <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 12 }}>
                <span style={{ color: 'var(--text2)' }}>Max concurrent (this repo)</span>
                <input type="number" min={1} value={repo.maxConcurrentAgents} onChange={e => updateRepo(idx, { maxConcurrentAgents: parseInt(e.target.value, 10) })} style={inputStyle} />
              </label>

              <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 12 }}>
                <span style={{ color: 'var(--text2)' }}>Base branch</span>
                <input value={repo.baseBranch ?? ''} onChange={e => updateRepo(idx, { baseBranch: e.target.value })} placeholder="main" style={inputStyle} />
              </label>

              <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 12 }}>
                <span style={{ color: 'var(--text2)' }}>Label prefix</span>
                <input value={repo.labelPrefix} onChange={e => updateRepo(idx, { labelPrefix: e.target.value })} placeholder="agenttower:" style={inputStyle} />
              </label>

              <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 12 }}>
                <span style={{ color: 'var(--text2)' }}>Model (blank = default)</span>
                <input value={repo.model ?? ''} onChange={e => updateRepo(idx, { model: e.target.value })} placeholder="claude-sonnet-4-6" style={inputStyle} />
              </label>

              <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 12 }}>
                <span style={{ color: 'var(--text2)' }}>Max turns</span>
                <input type="number" min={1} value={repo.maxTurns ?? 30} onChange={e => updateRepo(idx, { maxTurns: parseInt(e.target.value, 10) })} style={inputStyle} />
              </label>

              <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 12 }}>
                <span style={{ color: 'var(--text2)' }}>Max retries</span>
                <input type="number" min={0} max={10} value={repo.maxRetries} onChange={e => updateRepo(idx, { maxRetries: parseInt(e.target.value, 10) })} style={inputStyle} />
              </label>

              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                <input type="checkbox" checked={repo.useWorkflowFile} onChange={e => updateRepo(idx, { useWorkflowFile: e.target.checked })} />
                <span>Use WORKFLOW.md from repo</span>
              </label>
            </div>

            {!repo.useWorkflowFile && (
              <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 12, marginTop: 10 }}>
                <span style={{ color: 'var(--text2)' }}>Prompt template (blank = built-in default)</span>
                <textarea
                  value={repo.promptTemplate ?? ''}
                  onChange={e => updateRepo(idx, { promptTemplate: e.target.value })}
                  rows={5}
                  placeholder="You are working on issue #{{ issue.number }}…"
                  style={{ ...inputStyle, resize: 'vertical', fontFamily: 'monospace', fontSize: 11 }}
                />
              </label>
            )}
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <button className="glass-btn" onClick={save} disabled={saving} style={{ padding: '8px 20px', fontSize: 14, fontWeight: 600 }}>
          {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save config'}
        </button>
      </div>
    </div>
  )
}
