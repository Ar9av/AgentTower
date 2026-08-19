'use client'
import { appPath } from '@/lib/base-path'
import { useCallback, useEffect, useState } from 'react'

interface SettingsData {
  settings: {
    projectIgnoreRules: string[]
    terminalEnabled: boolean
  }
  configPath: string
  defaultProjectIgnoreRegexes: string[]
  compiledProjectIgnoreRegexes: string[]
}

function toRegexPreview(rule: string): string {
  const trimmed = rule.trim()
  if (!trimmed) return ''
  if (trimmed.startsWith('regex:')) return trimmed.slice('regex:'.length).trim() || '(invalid empty regex)'

  let source = '^'
  for (const ch of trimmed) {
    if (ch === '*') source += '.*'
    else if (ch === '?') source += '.'
    else if ('\\^$+?.()|{}[]'.includes(ch)) source += `\\${ch}`
    else source += ch
  }
  if (!trimmed.includes('*') && !trimmed.includes('?')) {
    source = `^${trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`
  }
  return `${source}$`
}

export default function SettingsConfig() {
  const [data, setData] = useState<SettingsData | null>(null)
  const [rulesText, setRulesText] = useState('')
  const [terminalEnabled, setTerminalEnabled] = useState(false)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch(appPath('/api/settings'))
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const next = await res.json() as SettingsData
      setData(next)
      setRulesText(next.settings.projectIgnoreRules.join('\n'))
      setTerminalEnabled(next.settings.terminalEnabled)
    } catch (err) {
      setError(String(err))
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function save() {
    setSaving(true)
    setSaved(false)
    setError('')
    try {
      const rules = rulesText.split('\n').map(v => v.trim()).filter(Boolean)
      const res = await fetch(appPath('/api/settings'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectIgnoreRules: rules, terminalEnabled }),
      })
      const payload = await res.json() as { error?: string }
      if (!res.ok) throw new Error(payload.error || `HTTP ${res.status}`)
      setSaved(true)
      await load()
      setTimeout(() => setSaved(false), 2000)
    } catch (err) {
      setError(String(err))
    } finally {
      setSaving(false)
    }
  }

  if (!data) {
    return <div className="glass" style={{ borderRadius: 16, padding: 24 }}>Loading…</div>
  }

  const liveRules = rulesText.split('\n').map(v => v.trim()).filter(Boolean)

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div className="glass" style={{ borderRadius: 16, padding: 'clamp(16px, 3vw, 24px)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ fontSize: 26 }}>💻</div>
          <div style={{ flex: 1 }}>
            <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>Terminal</h2>
            <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--text3)' }}>
              Lets you run shell commands on this host from the browser. Off by default — anyone with your login password
              can then run arbitrary commands, so only enable this if you trust everyone with access to this deployment.
            </p>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', flexShrink: 0 }}>
            <input
              type="checkbox"
              checked={terminalEnabled}
              onChange={e => setTerminalEnabled(e.target.checked)}
              style={{ width: 16, height: 16 }}
            />
            <span style={{ fontSize: 13, fontWeight: 600 }}>{terminalEnabled ? 'Enabled' : 'Disabled'}</span>
          </label>
        </div>
      </div>

      <div className="glass" style={{ borderRadius: 16, padding: 'clamp(16px, 3vw, 24px)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
        <div style={{ fontSize: 26 }}>⚙️</div>
        <div style={{ flex: 1 }}>
          <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>Project visibility</h2>
          <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--text3)' }}>
            Hide projects by exact path, glob, or regex. Globs like <code>/home/ubuntu/xyz/*</code> compile into regex automatically.
          </p>
        </div>
      </div>

      {error && (
        <div style={{ marginBottom: 14, padding: '8px 12px', borderRadius: 8, background: '#ff444420', border: '1px solid #ff4444', fontSize: 12, color: '#ff6666' }}>
          {error}
        </div>
      )}

      <div style={{ display: 'grid', gap: 16 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6 }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>Ignore rules</span>
            <span style={{ fontSize: 11, color: 'var(--text3)' }}>One per line</span>
          </div>
          <textarea
            className="glass-input"
            value={rulesText}
            onChange={e => setRulesText(e.target.value)}
            placeholder={`/home/ubuntu/xyz/*\nregex:^/home/ubuntu/(tmp|scratch)/.*$`}
            spellCheck={false}
            style={{
              width: '100%',
              minHeight: 150,
              resize: 'vertical',
              padding: '12px 14px',
              borderRadius: 10,
              fontSize: 13,
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              lineHeight: 1.5,
            }}
          />
          <p style={{ margin: '8px 0 0', fontSize: 11, color: 'var(--text3)' }}>
            Plain paths match exactly. Use <code>*</code> and <code>?</code> for glob-style rules, or prefix with <code>regex:</code> for raw regex.
          </p>
        </div>

        <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
          <div className="glass" style={{ padding: 14, borderRadius: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>Live regex preview</div>
            {liveRules.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--text3)' }}>No custom rules yet.</div>
            ) : (
              <div style={{ display: 'grid', gap: 6 }}>
                {liveRules.map(rule => (
                  <div key={rule} style={{ fontSize: 11, color: 'var(--text2)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', wordBreak: 'break-all' }}>
                    {rule} → {toRegexPreview(rule)}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="glass" style={{ padding: 14, borderRadius: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>Always-on defaults</div>
            <div style={{ display: 'grid', gap: 6 }}>
              {data.defaultProjectIgnoreRegexes.map(source => (
                <div key={source} style={{ fontSize: 11, color: 'var(--text2)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', wordBreak: 'break-all' }}>
                  {source}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="glass" style={{ padding: 14, borderRadius: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>Saved compiled regexes</div>
          <div style={{ display: 'grid', gap: 6 }}>
            {data.compiledProjectIgnoreRegexes.map(source => (
              <div key={source} style={{ fontSize: 11, color: 'var(--text2)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', wordBreak: 'break-all' }}>
                {source}
              </div>
            ))}
          </div>
          <p style={{ margin: '10px 0 0', fontSize: 11, color: 'var(--text3)' }}>
            Config file: <code>{data.configPath}</code>
          </p>
        </div>
      </div>

      <div style={{ marginTop: 18, display: 'flex', alignItems: 'center', gap: 12 }}>
        <button
          className="glass-btn"
          onClick={save}
          disabled={saving}
          style={{ padding: '8px 16px', minHeight: 36, fontSize: 13, fontWeight: 600 }}
        >
          {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save settings'}
        </button>
      </div>
      </div>
    </div>
  )
}
