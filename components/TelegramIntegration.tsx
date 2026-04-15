'use client'
import { useEffect, useState, useCallback } from 'react'

interface TelegramData {
  telegram: {
    enabled: boolean
    allowedChatIds: number[]
    projectsDir: string
    openaiApiKeySet: boolean
    botTokenSet: boolean
  }
  status: { running: boolean; pid: number | null; uptimeSec: number | null }
  audit: Array<{ ts: string; chatId: number; user: string; action: string; text?: string }>
  configPath: string
  auditPath: string
}

export default function TelegramIntegration() {
  const [data, setData] = useState<TelegramData | null>(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  // Form state (draft)
  const [enabled, setEnabled] = useState(false)
  const [chatIdsText, setChatIdsText] = useState('')
  const [projectsDir, setProjectsDir] = useState('')
  const [openaiKey, setOpenaiKey] = useState('')

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/integrations/telegram')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const d = await res.json() as TelegramData
      setData(d)
      setEnabled(d.telegram.enabled)
      setChatIdsText(d.telegram.allowedChatIds.join(', '))
      setProjectsDir(d.telegram.projectsDir)
    } catch (err) {
      setError(String(err))
    }
  }, [])

  useEffect(() => {
    load()
    const t = setInterval(load, 5000)
    return () => clearInterval(t)
  }, [load])

  async function save() {
    setSaving(true)
    setError('')
    setSaved(false)
    const chatIds = chatIdsText
      .split(/[,\s]+/)
      .map(s => s.trim())
      .filter(Boolean)
      .map(Number)
      .filter(n => !Number.isNaN(n) && n !== 0)
    try {
      const res = await fetch('/api/integrations/telegram', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled,
          allowedChatIds: chatIds,
          projectsDir,
          ...(openaiKey ? { openaiApiKey: openaiKey } : {}),
        }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setOpenaiKey('')
      setSaved(true)
      await load()
      setTimeout(() => setSaved(false), 2000)
    } catch (err) {
      setError(String(err))
    } finally {
      setSaving(false)
    }
  }

  async function clearOpenai() {
    if (!confirm('Clear stored OpenAI API key?')) return
    await fetch('/api/integrations/telegram', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clearOpenaiApiKey: true }),
    })
    await load()
  }

  if (!data) {
    return <div className="glass" style={{ borderRadius: 16, padding: 24 }}>Loading…</div>
  }

  const { status, telegram, audit } = data
  const statusColor = status.running ? 'var(--green)' : 'var(--text3)'
  const statusText  = status.running
    ? `Running · PID ${status.pid} · up ${fmtDuration(status.uptimeSec ?? 0)}`
    : 'Not running'

  return (
    <div className="glass" style={{ borderRadius: 16, padding: 'clamp(16px, 3vw, 24px)', marginBottom: 20 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
        <div style={{ fontSize: 26 }}>✈️</div>
        <div style={{ flex: 1 }}>
          <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>Telegram Bot</h2>
          <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--text3)' }}>
            Control Claude sessions from your phone.
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{
            display: 'inline-block', width: 8, height: 8, borderRadius: 4,
            background: statusColor,
            boxShadow: status.running ? '0 0 8px rgba(61,214,140,0.6)' : 'none',
          }} />
          <span style={{ fontSize: 12, color: 'var(--text2)' }}>{statusText}</span>
        </div>
      </div>

      {/* Token hint */}
      {!telegram.botTokenSet && (
        <div style={{
          marginTop: 16, padding: '10px 14px', borderRadius: 10,
          background: 'rgba(255, 180, 0, 0.08)', border: '1px solid rgba(255,180,0,0.25)',
          fontSize: 12, color: 'var(--text)',
        }}>
          <strong>BOT_TOKEN</strong> env var not detected in this server process. The bot runs as a separate process — start it with <code>BOT_TOKEN=xxx npm run telegram</code>.
        </div>
      )}

      {/* Config form */}
      <div style={{ marginTop: 20, display: 'grid', gap: 14 }}>
        <Field label="Enabled" hint="Soft toggle — the bot still needs to be running as a process.">
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} />
            <span style={{ fontSize: 13, color: 'var(--text2)' }}>{enabled ? 'On' : 'Off'}</span>
          </label>
        </Field>

        <Field label="Allowed chat IDs" hint="Comma or space separated. Leave empty to allow anyone (not recommended).">
          <input
            className="glass-input"
            value={chatIdsText}
            onChange={e => setChatIdsText(e.target.value)}
            placeholder="111111111, 222222222"
            style={{ fontSize: 13, padding: '8px 12px', borderRadius: 8, minHeight: 36, fontFamily: 'ui-monospace, monospace' }}
          />
        </Field>

        <Field label="Default project dir" hint="New /task commands start here (users can override per-chat with /cd).">
          <input
            className="glass-input"
            value={projectsDir}
            onChange={e => setProjectsDir(e.target.value)}
            placeholder="/Users/you/code"
            style={{ fontSize: 13, padding: '8px 12px', borderRadius: 8, minHeight: 36, fontFamily: 'ui-monospace, monospace' }}
          />
        </Field>

        <Field
          label="OpenAI API key (optional)"
          hint={telegram.openaiApiKeySet
            ? 'Stored. Enables voice-message transcription. Leave blank to keep; type a new key to replace.'
            : 'Paste an sk-… key to enable Whisper voice transcription.'}
        >
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              className="glass-input"
              type="password"
              value={openaiKey}
              onChange={e => setOpenaiKey(e.target.value)}
              placeholder={telegram.openaiApiKeySet ? '•••••••••••• (stored)' : 'sk-...'}
              style={{ fontSize: 13, padding: '8px 12px', borderRadius: 8, minHeight: 36, flex: 1, fontFamily: 'ui-monospace, monospace' }}
            />
            {telegram.openaiApiKeySet && (
              <button className="glass-btn" onClick={clearOpenai} style={{ fontSize: 12, padding: '0 12px', minHeight: 36 }}>
                Clear
              </button>
            )}
          </div>
        </Field>
      </div>

      {/* Save row */}
      <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 10 }}>
        <button
          onClick={save}
          disabled={saving}
          className="glass-btn"
          style={{ padding: '8px 16px', minHeight: 36, fontSize: 13, fontWeight: 600, opacity: saving ? 0.6 : 1 }}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        {saved && <span style={{ fontSize: 12, color: 'var(--green)' }}>✓ Saved</span>}
        {error && <span style={{ fontSize: 12, color: 'var(--red, #ef4444)' }}>{error}</span>}
        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text3)', fontFamily: 'ui-monospace, monospace' }}>
          {data.configPath}
        </span>
      </div>

      {/* Setup snippet */}
      <details style={{ marginTop: 18 }}>
        <summary style={{ cursor: 'pointer', fontSize: 13, color: 'var(--text2)' }}>How to run the bot</summary>
        <div style={{ marginTop: 10, fontSize: 12, color: 'var(--text2)', lineHeight: 1.6 }}>
          <p style={{ margin: '0 0 8px' }}>
            1. Create a bot via <a href="https://t.me/BotFather" target="_blank" rel="noreferrer" style={{ color: 'var(--blue, #3b82f6)' }}>@BotFather</a> → copy the token.
          </p>
          <p style={{ margin: '0 0 8px' }}>
            2. Get your chat id via <a href="https://t.me/userinfobot" target="_blank" rel="noreferrer" style={{ color: 'var(--blue, #3b82f6)' }}>@userinfobot</a> and paste it above.
          </p>
          <p style={{ margin: '0 0 8px' }}>3. Run the bot:</p>
          <pre style={{
            background: 'rgba(0,0,0,0.25)', padding: 10, borderRadius: 8,
            fontSize: 12, fontFamily: 'ui-monospace, monospace', overflowX: 'auto',
          }}>{`BOT_TOKEN=your-token npm run telegram`}</pre>
          <p style={{ margin: '8px 0 0' }}>
            Config in this form is re-read every 5 seconds by the bot — no restart needed for allowlist/key changes.
          </p>
        </div>
      </details>

      {/* Audit log */}
      <div style={{ marginTop: 22 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8 }}>
          <h3 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>Recent activity</h3>
          <span style={{ fontSize: 11, color: 'var(--text3)' }}>{audit.length} entries</span>
        </div>
        {audit.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--text3)', padding: '10px 0' }}>No activity yet.</div>
        ) : (
          <div style={{
            maxHeight: 260, overflowY: 'auto',
            border: '1px solid var(--border, rgba(255,255,255,0.08))',
            borderRadius: 10, padding: '4px 0',
          }}>
            {audit.map((e, i) => (
              <div key={i} style={{
                padding: '6px 12px', fontSize: 11,
                fontFamily: 'ui-monospace, monospace',
                borderBottom: i < audit.length - 1 ? '1px solid var(--border, rgba(255,255,255,0.05))' : 'none',
                display: 'grid', gridTemplateColumns: '100px 80px 90px 1fr', gap: 8, alignItems: 'baseline',
              }}>
                <span style={{ color: 'var(--text3)' }}>{fmtTime(e.ts)}</span>
                <span style={{ color: 'var(--text2)' }}>{e.user.slice(0, 12)}</span>
                <span style={{ color: actionColor(e.action) }}>{e.action}</span>
                <span style={{ color: 'var(--text2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {e.text ?? ''}
                </span>
              </div>
            ))}
          </div>
        )}
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

function fmtDuration(s: number): string {
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}

function fmtTime(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  } catch {
    return iso
  }
}

function actionColor(a: string): string {
  if (a === 'denied') return 'var(--red, #ef4444)'
  if (a.startsWith('cb:')) return 'var(--blue, #3b82f6)'
  if (a === 'voice' || a === 'photo' || a === 'document' || a === 'audio') return 'var(--green, #3dd68c)'
  return 'var(--text2)'
}
