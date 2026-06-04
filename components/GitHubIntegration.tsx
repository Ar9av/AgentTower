'use client'
import { useEffect, useState, useCallback } from 'react'

interface GitHubData {
  github: {
    enabled: boolean
    tokenSet: boolean
    tokenHint: string | null
    usingEnvVar: boolean
    usingGhCli: boolean
  }
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 5 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text1)' }}>{label}</span>
        {hint && <span style={{ fontSize: 11, color: 'var(--text3)' }}>{hint}</span>}
      </div>
      {children}
    </div>
  )
}

export default function GitHubIntegration() {
  const [data, setData] = useState<GitHubData | null>(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const [enabled, setEnabled] = useState(false)
  const [token, setToken] = useState('')

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/integrations/github')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const d = await res.json() as GitHubData
      setData(d)
      setEnabled(d.github.enabled)
    } catch (err) {
      setError(String(err))
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function save() {
    setSaving(true)
    setError('')
    try {
      const body: Record<string, unknown> = { enabled }
      if (token) body.token = token
      const res = await fetch('/api/integrations/github', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setToken('')
      setSaved(true)
      await load()
      setTimeout(() => setSaved(false), 2000)
    } catch (err) {
      setError(String(err))
    } finally {
      setSaving(false)
    }
  }

  async function clearToken() {
    if (!confirm('Clear stored GitHub token?')) return
    await fetch('/api/integrations/github', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clearToken: true }),
    })
    await load()
  }

  if (!data) {
    return <div className="glass" style={{ borderRadius: 16, padding: 24 }}>Loading…</div>
  }

  const { github } = data
  const tokenStatus = github.usingEnvVar
    ? 'Token from environment variable (GITHUB_TOKEN / GH_TOKEN)'
    : github.usingGhCli
    ? 'Token from gh CLI (gh auth login)'
    : github.tokenSet
    ? `Token stored (${github.tokenHint})`
    : 'No token set'

  return (
    <div className="glass" style={{ borderRadius: 16, padding: 'clamp(16px, 3vw, 24px)', marginBottom: 20 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
        <div style={{ fontSize: 26 }}>🐙</div>
        <div style={{ flex: 1 }}>
          <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>GitHub</h2>
          <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--text3)' }}>
            Token used by the orchestrator to read issues, move labels, and open PRs.
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{
            display: 'inline-block', width: 8, height: 8, borderRadius: 4,
            background: github.tokenSet ? '#22c55e' : 'var(--text3)',
            boxShadow: github.tokenSet ? '0 0 8px rgba(34,197,94,0.5)' : 'none',
          }} />
          <span style={{ fontSize: 12, color: 'var(--text2)' }}>{tokenStatus}</span>
        </div>
      </div>

      {error && (
        <div style={{ marginTop: 12, padding: '8px 12px', borderRadius: 8, background: '#ff444420', border: '1px solid #ff4444', fontSize: 12, color: '#ff6666' }}>
          {error}
        </div>
      )}

      <div style={{ marginTop: 20, display: 'grid', gap: 14 }}>
        <Field label="Enabled" hint="Gate for orchestrator tracker calls.">
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} />
            <span style={{ fontSize: 13, color: 'var(--text2)' }}>{enabled ? 'On' : 'Off'}</span>
          </label>
        </Field>

        <Field
          label="Personal Access Token"
          hint="Needs repo scope (issues, PRs, labels). Leave blank to keep existing."
        >
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              className="glass-input"
              type="password"
              value={token}
              onChange={e => setToken(e.target.value)}
              placeholder={github.tokenSet ? '••••••••••••••••••••' : 'ghp_…'}
              style={{ fontSize: 13, padding: '8px 12px', borderRadius: 8, minHeight: 36, fontFamily: 'ui-monospace, monospace', flex: 1 }}
            />
            {github.tokenSet && !github.usingEnvVar && (
              <button
                className="glass-btn"
                onClick={clearToken}
                style={{ fontSize: 12, padding: '6px 12px', whiteSpace: 'nowrap', color: '#f87171' }}
              >
                Clear
              </button>
            )}
          </div>
          {github.usingEnvVar && (
            <p style={{ margin: '6px 0 0', fontSize: 11, color: 'var(--text3)' }}>
              GITHUB_TOKEN or GH_TOKEN env var detected — that takes priority over any stored token.
            </p>
          )}
          {github.usingGhCli && (
            <p style={{ margin: '6px 0 0', fontSize: 11, color: 'var(--text3)' }}>
              Token from <code>gh auth login</code> — takes priority over any stored token.
            </p>
          )}
          <p style={{ margin: '6px 0 0', fontSize: 11, color: 'var(--text3)' }}>
            Token is stored in <code>~/.claude/agenttower-integrations.json</code> (mode 0600).
            You can also set <code>GITHUB_TOKEN</code> in .env.local — env vars take priority.
          </p>
        </Field>
      </div>

      <div style={{ marginTop: 20, display: 'flex', alignItems: 'center', gap: 12 }}>
        <button
          className="glass-btn"
          onClick={save}
          disabled={saving}
          style={{ padding: '7px 18px', fontSize: 13, fontWeight: 600 }}
        >
          {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save'}
        </button>
      </div>
    </div>
  )
}
