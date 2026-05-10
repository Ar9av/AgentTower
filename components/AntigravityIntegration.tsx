'use client'
import { useEffect, useState, useCallback } from 'react'
import type { AntigravityAgent } from '@/lib/types'

interface AntigravityData {
  antigravity: {
    enabled: boolean
    apiKeySet: boolean
    workspaceId: string
    apiBaseUrl: string
  }
  agents: AntigravityAgent[]
  error: string | null
}

export default function AntigravityIntegration() {
  const [data, setData] = useState<AntigravityData | null>(null)
  const [saveError, setSaveError] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ connected: boolean; agentCount?: number; error?: string } | null>(null)

  const [enabled, setEnabled] = useState(false)
  const [apiKey, setApiKey] = useState('')
  const [workspaceId, setWorkspaceId] = useState('')
  const [apiBaseUrl, setApiBaseUrl] = useState('')

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/integrations/antigravity')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const d = await res.json() as AntigravityData
      setData(d)
      setEnabled(d.antigravity.enabled)
      setWorkspaceId(d.antigravity.workspaceId)
      setApiBaseUrl(d.antigravity.apiBaseUrl)
    } catch (err) {
      setSaveError(String(err))
    }
  }, [])

  useEffect(() => {
    load()
    const t = setInterval(load, 10000)
    return () => clearInterval(t)
  }, [load])

  async function save() {
    setSaving(true)
    setSaveError('')
    setSaved(false)
    setTestResult(null)
    try {
      const res = await fetch('/api/integrations/antigravity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled,
          workspaceId,
          apiBaseUrl,
          ...(apiKey ? { apiKey } : {}),
        }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setApiKey('')
      setSaved(true)
      await load()
      setTimeout(() => setSaved(false), 2000)
    } catch (err) {
      setSaveError(String(err))
    } finally {
      setSaving(false)
    }
  }

  async function clearKey() {
    if (!confirm('Clear stored Antigravity API key?')) return
    await fetch('/api/integrations/antigravity', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clearApiKey: true }),
    })
    await load()
  }

  async function testConnection() {
    setTesting(true)
    setTestResult(null)
    try {
      const res = await fetch('/api/integrations/antigravity?test=1')
      const d = await res.json() as { connected: boolean; agentCount?: number; error?: string }
      setTestResult(d)
    } catch (err) {
      setTestResult({ connected: false, error: String(err) })
    } finally {
      setTesting(false)
    }
  }

  if (!data) {
    return <div className="glass" style={{ borderRadius: 16, padding: 24 }}>Loading…</div>
  }

  const { antigravity, agents } = data
  const hasAgents = agents.length > 0
  const statusColor = antigravity.enabled && antigravity.apiKeySet
    ? (hasAgents ? 'var(--green)' : 'var(--text3)')
    : 'var(--text3)'
  const statusText = antigravity.enabled && antigravity.apiKeySet
    ? (hasAgents ? `${agents.length} agent${agents.length !== 1 ? 's' : ''}` : 'No agents')
    : 'Not configured'

  return (
    <div className="glass" style={{ borderRadius: 16, padding: 'clamp(16px, 3vw, 24px)', marginBottom: 20 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
        <div style={{ fontSize: 26 }}>🚀</div>
        <div style={{ flex: 1 }}>
          <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>Antigravity</h2>
          <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--text3)' }}>
            Show Antigravity agents alongside Claude sessions.
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{
            display: 'inline-block', width: 8, height: 8, borderRadius: 4,
            background: statusColor,
            boxShadow: hasAgents && antigravity.enabled ? '0 0 8px rgba(61,214,140,0.6)' : 'none',
          }} />
          <span style={{ fontSize: 12, color: 'var(--text2)' }}>{statusText}</span>
        </div>
      </div>

      {/* Config form */}
      <div style={{ marginTop: 20, display: 'grid', gap: 14 }}>
        <Field label="Enabled" hint="Fetches agent list from Antigravity and shows it on the Projects page.">
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} />
            <span style={{ fontSize: 13, color: 'var(--text2)' }}>{enabled ? 'On' : 'Off'}</span>
          </label>
        </Field>

        <Field
          label="API Key"
          hint={antigravity.apiKeySet
            ? 'Stored. Leave blank to keep; type a new key to replace.'
            : 'Your Antigravity API key (ag-…).'}
        >
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              className="glass-input"
              type="password"
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              placeholder={antigravity.apiKeySet ? '•••••••••••• (stored)' : 'ag-...'}
              style={{ fontSize: 13, padding: '8px 12px', borderRadius: 8, minHeight: 36, flex: 1, fontFamily: 'ui-monospace, monospace' }}
            />
            {antigravity.apiKeySet && (
              <button className="glass-btn" onClick={clearKey} style={{ fontSize: 12, padding: '0 12px', minHeight: 36 }}>
                Clear
              </button>
            )}
          </div>
        </Field>

        <Field label="Workspace ID (optional)" hint="Filter agents to a specific workspace. Leave empty to fetch all.">
          <input
            className="glass-input"
            value={workspaceId}
            onChange={e => setWorkspaceId(e.target.value)}
            placeholder="ws_..."
            style={{ fontSize: 13, padding: '8px 12px', borderRadius: 8, minHeight: 36, fontFamily: 'ui-monospace, monospace' }}
          />
        </Field>

        <Field label="API Base URL (optional)" hint="Defaults to https://api.antigravity.dev — only change for self-hosted instances.">
          <input
            className="glass-input"
            value={apiBaseUrl}
            onChange={e => setApiBaseUrl(e.target.value)}
            placeholder="https://api.antigravity.dev"
            style={{ fontSize: 13, padding: '8px 12px', borderRadius: 8, minHeight: 36, fontFamily: 'ui-monospace, monospace' }}
          />
        </Field>
      </div>

      {/* Action row */}
      <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <button
          onClick={save}
          disabled={saving}
          className="glass-btn"
          style={{ padding: '8px 16px', minHeight: 36, fontSize: 13, fontWeight: 600, opacity: saving ? 0.6 : 1 }}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button
          onClick={testConnection}
          disabled={testing || !antigravity.apiKeySet}
          className="glass-btn"
          style={{ padding: '8px 16px', minHeight: 36, fontSize: 13, opacity: (testing || !antigravity.apiKeySet) ? 0.5 : 1 }}
        >
          {testing ? 'Testing…' : 'Test Connection'}
        </button>
        {saved && <span style={{ fontSize: 12, color: 'var(--green)' }}>✓ Saved</span>}
        {testResult && (
          <span style={{ fontSize: 12, color: testResult.connected ? 'var(--green)' : 'var(--red, #ef4444)' }}>
            {testResult.connected
              ? `✓ Connected · ${testResult.agentCount} agent${testResult.agentCount !== 1 ? 's' : ''}`
              : `✗ ${testResult.error ?? 'Connection failed'}`}
          </span>
        )}
        {saveError && <span style={{ fontSize: 12, color: 'var(--red, #ef4444)' }}>{saveError}</span>}
        {data.error && !saveError && (
          <span style={{ fontSize: 12, color: 'var(--red, #ef4444)' }}>Fetch error: {data.error}</span>
        )}
      </div>

      {/* Setup instructions */}
      <details style={{ marginTop: 18 }}>
        <summary style={{ cursor: 'pointer', fontSize: 13, color: 'var(--text2)' }}>How to get your API key</summary>
        <div style={{ marginTop: 10, fontSize: 12, color: 'var(--text2)', lineHeight: 1.6 }}>
          <p style={{ margin: '0 0 8px' }}>1. Open your Antigravity workspace and go to <strong>Settings → API Keys</strong>.</p>
          <p style={{ margin: '0 0 8px' }}>2. Create a new key with <strong>read:agents</strong> scope.</p>
          <p style={{ margin: '0 0 8px' }}>3. Copy the key (starts with <code>ag-</code>) and paste it above.</p>
          <p style={{ margin: '0 0 8px' }}>4. Optionally copy your Workspace ID from the workspace URL.</p>
        </div>
      </details>

      {/* Agent list */}
      {hasAgents && (
        <div style={{ marginTop: 22 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8 }}>
            <h3 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>Active agents</h3>
            <span style={{ fontSize: 11, color: 'var(--text3)' }}>{agents.length} agents</span>
          </div>
          <div style={{
            maxHeight: 260, overflowY: 'auto',
            border: '1px solid var(--border, rgba(255,255,255,0.08))',
            borderRadius: 10, padding: '4px 0',
          }}>
            {agents.map((a, i) => (
              <div key={a.id} style={{
                padding: '7px 12px', fontSize: 11,
                borderBottom: i < agents.length - 1 ? '1px solid var(--border, rgba(255,255,255,0.05))' : 'none',
                display: 'grid', gridTemplateColumns: '90px 70px 80px 1fr 70px', gap: 8, alignItems: 'baseline',
              }}>
                <span style={{ color: 'var(--text)', fontFamily: 'ui-monospace, monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={a.id}>{a.id}</span>
                <span style={{ color: agentStatusColor(a.status), fontWeight: 600 }}>{a.status}</span>
                <span style={{ color: 'var(--text3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.model ?? '—'}</span>
                <span style={{ color: 'var(--text2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.task ?? a.name}</span>
                <span style={{ color: 'var(--text3)' }}>{formatRelative(a.updatedAt)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
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

function agentStatusColor(status: string): string {
  if (status === 'running') return 'var(--green, #3dd68c)'
  if (status === 'completed') return 'var(--blue, #3b82f6)'
  if (status === 'error') return 'var(--red, #ef4444)'
  return 'var(--text3)'
}

function formatRelative(iso: string): string {
  try {
    const diff = Date.now() - new Date(iso).getTime()
    if (diff < 60_000) return 'just now'
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
    return `${Math.floor(diff / 86_400_000)}d ago`
  } catch {
    return ''
  }
}
