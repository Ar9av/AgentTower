'use client'
import { useEffect, useState, useCallback } from 'react'
import type { DailyBriefConfig, ProjectBriefConfig, TaskType, OutputFormat } from '@/lib/daily-brief'

const TASK_TYPES: { value: TaskType; label: string }[] = [
  { value: 'code-improvement', label: 'Code improvements' },
  { value: 'bug-fix', label: 'Bug fixes' },
  { value: 'documentation', label: 'Documentation' },
  { value: 'research', label: 'Research' },
  { value: 'obsidian-update', label: 'Obsidian wiki update' },
]

const OUTPUT_FORMATS: { value: OutputFormat; label: string }[] = [
  { value: 'pr', label: 'GitHub PR' },
  { value: 'pdf', label: 'PDF report' },
  { value: 'obsidian', label: 'Obsidian note' },
  { value: 'summary', label: 'Text summary' },
]

const TIMEZONES = [
  'Asia/Kolkata', 'America/New_York', 'America/Los_Angeles', 'America/Chicago',
  'Europe/London', 'Europe/Berlin', 'Asia/Tokyo', 'Asia/Singapore', 'UTC',
]

interface ConfigData {
  config: DailyBriefConfig
  configPath: string
  historyPath: string
}

function newProject(): ProjectBriefConfig {
  return {
    id: Math.random().toString(36).slice(2),
    displayName: '',
    repoUrl: '',
    agentPath: '',
    enabled: true,
    taskTypes: ['code-improvement', 'bug-fix'],
    outputFormat: 'pr',
    customInstructions: '',
  }
}

export default function DailyBriefConfig() {
  const [data, setData] = useState<ConfigData | null>(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [triggering, setTriggering] = useState(false)

  // Form state
  const [enabled, setEnabled] = useState(false)
  const [morningTime, setMorningTime] = useState('08:00')
  const [eveningTime, setEveningTime] = useState('20:00')
  const [timezone, setTimezone] = useState('Asia/Kolkata')
  const [agentTowerUrl, setAgentTowerUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [telegramChatId, setTelegramChatId] = useState('')
  const [projects, setProjects] = useState<ProjectBriefConfig[]>([])

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/daily-brief/config')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const d = await res.json() as ConfigData
      setData(d)
      const c = d.config
      setEnabled(c.enabled)
      setMorningTime(c.morningTime)
      setEveningTime(c.eveningTime)
      setTimezone(c.timezone)
      setAgentTowerUrl(c.agentTowerUrl)
      setApiKey(c.apiKey)
      setTelegramChatId(c.telegramChatId)
      setProjects(c.projects)
    } catch (err) {
      setError(String(err))
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function save() {
    setSaving(true)
    setError('')
    setSaved(false)
    try {
      const res = await fetch('/api/daily-brief/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled, morningTime, eveningTime, timezone,
          agentTowerUrl, apiKey, telegramChatId, projects,
        }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setSaved(true)
      await load()
      setTimeout(() => setSaved(false), 2000)
    } catch (err) {
      setError(String(err))
    } finally {
      setSaving(false)
    }
  }

  function rotateApiKey() {
    const bytes = new Uint8Array(32)
    window.crypto.getRandomValues(bytes)
    const newKey = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
    setApiKey(newKey)
  }

  function addProject() {
    setProjects(p => [...p, newProject()])
  }

  function removeProject(id: string) {
    setProjects(p => p.filter(x => x.id !== id))
  }

  function updateProject(id: string, patch: Partial<ProjectBriefConfig>) {
    setProjects(p => p.map(x => x.id === id ? { ...x, ...patch } : x))
  }

  function toggleTaskType(projectId: string, type: TaskType) {
    setProjects(p => p.map(x => {
      if (x.id !== projectId) return x
      const has = x.taskTypes.includes(type)
      return { ...x, taskTypes: has ? x.taskTypes.filter(t => t !== type) : [...x.taskTypes, type] }
    }))
  }

  async function triggerMorningBrief() {
    setTriggering(true)
    try {
      await fetch('/api/daily-brief/trigger', { method: 'POST' })
    } finally {
      setTriggering(false)
    }
  }

  if (!data) return <div className="glass" style={{ borderRadius: 16, padding: 24 }}>Loading…</div>

  return (
    <div className="glass" style={{ borderRadius: 16, padding: 'clamp(16px, 3vw, 24px)', marginBottom: 20 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <div style={{ fontSize: 26 }}>📋</div>
        <div style={{ flex: 1 }}>
          <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>Daily Brief</h2>
          <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--text3)' }}>
            Morning project analysis + Telegram briefs with one-tap approval.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={triggerMorningBrief}
            disabled={triggering}
            className="glass-btn"
            style={{ fontSize: 12, padding: '6px 12px', opacity: triggering ? 0.6 : 1 }}
          >
            {triggering ? 'Triggering…' : '▶ Run now'}
          </button>
        </div>
      </div>

      {/* Schedule */}
      <Section label="Schedule">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto', gap: 12, alignItems: 'end' }}>
          <Field label="Morning brief">
            <input
              className="glass-input" type="time" value={morningTime}
              onChange={e => setMorningTime(e.target.value)}
              style={inputStyle}
            />
          </Field>
          <Field label="Evening summary">
            <input
              className="glass-input" type="time" value={eveningTime}
              onChange={e => setEveningTime(e.target.value)}
              style={inputStyle}
            />
          </Field>
          <Field label="Timezone">
            <select
              className="glass-input" value={timezone}
              onChange={e => setTimezone(e.target.value)}
              style={inputStyle}
            >
              {TIMEZONES.map(tz => <option key={tz} value={tz}>{tz}</option>)}
            </select>
          </Field>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, paddingBottom: 2, cursor: 'pointer' }}>
            <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} />
            <span style={{ fontSize: 13 }}>Enabled</span>
          </label>
        </div>
      </Section>

      {/* Connection */}
      <Section label="Agent connection">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="AgentTower URL" hint="Where the agent posts results back (must be accessible from St3ve)">
            <input
              className="glass-input" value={agentTowerUrl}
              onChange={e => setAgentTowerUrl(e.target.value)}
              placeholder="http://44.214.4.208:3000"
              style={{ ...inputStyle, fontFamily: 'ui-monospace, monospace' }}
            />
          </Field>
          <Field label="Telegram chat ID" hint="Which chat receives the daily brief">
            <input
              className="glass-input" value={telegramChatId}
              onChange={e => setTelegramChatId(e.target.value)}
              placeholder="123456789"
              style={{ ...inputStyle, fontFamily: 'ui-monospace, monospace' }}
            />
          </Field>
        </div>
        <Field label="Agent API key" hint="St3ve uses this to authenticate calls back to AgentTower">
          <div style={{ display: 'flex', gap: 8, marginTop: 2 }}>
            <input
              className="glass-input" value={apiKey} readOnly
              style={{ ...inputStyle, fontFamily: 'ui-monospace, monospace', fontSize: 11, flex: 1 }}
            />
            <button className="glass-btn" onClick={rotateApiKey} style={{ fontSize: 12, padding: '0 12px', minHeight: 36 }}>
              Rotate
            </button>
          </div>
        </Field>
      </Section>

      {/* Projects */}
      <Section label="Projects">
        {projects.length === 0 && (
          <p style={{ fontSize: 12, color: 'var(--text3)', margin: '0 0 12px' }}>No projects configured yet.</p>
        )}
        {projects.map((proj, i) => (
          <ProjectCard
            key={proj.id}
            proj={proj}
            index={i + 1}
            onChange={patch => updateProject(proj.id, patch)}
            onToggleTaskType={type => toggleTaskType(proj.id, type)}
            onRemove={() => removeProject(proj.id)}
          />
        ))}
        <button className="glass-btn" onClick={addProject} style={{ fontSize: 13, padding: '8px 16px', marginTop: 4 }}>
          + Add project
        </button>
      </Section>

      {/* Save */}
      <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 10 }}>
        <button
          onClick={save} disabled={saving} className="glass-btn"
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
        <summary style={{ cursor: 'pointer', fontSize: 13, color: 'var(--text2)' }}>
          How to set up on St3ve (cron + agent)
        </summary>
        <div style={{ marginTop: 10, fontSize: 12, color: 'var(--text2)', lineHeight: 1.7 }}>
          <p style={{ margin: '0 0 6px' }}>1. SSH into St3ve and clone/pull AgentTower:</p>
          <pre style={codeStyle}>{`ssh -i lightsail-openclaw.pem ubuntu@44.214.4.208
cd ~/agenttower && git pull`}</pre>
          <p style={{ margin: '8px 0 6px' }}>2. Copy the API key above into St3ve's environment and run setup:</p>
          <pre style={codeStyle}>{`cd ~/agenttower/scripts/daily-brief
cp .env.example .env
# Edit .env: set AGENTTOWER_URL, AGENTTOWER_API_KEY, BOT_TOKEN, ANTHROPIC_API_KEY
npm install
bash setup-cron.sh`}</pre>
          <p style={{ margin: '8px 0 6px' }}>3. Start the approval bot:</p>
          <pre style={codeStyle}>{`npm run daily-bot`}</pre>
        </div>
      </details>
    </div>
  )
}

function ProjectCard({
  proj, index, onChange, onToggleTaskType, onRemove
}: {
  proj: ProjectBriefConfig
  index: number
  onChange: (p: Partial<ProjectBriefConfig>) => void
  onToggleTaskType: (t: TaskType) => void
  onRemove: () => void
}) {
  return (
    <div style={{
      border: '1px solid var(--border, rgba(255,255,255,0.08))',
      borderRadius: 12, padding: 16, marginBottom: 12,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text3)' }}>#{index}</span>
        <input
          className="glass-input" value={proj.displayName}
          onChange={e => onChange({ displayName: e.target.value })}
          placeholder="Project name"
          style={{ ...inputStyle, flex: 1, fontWeight: 600 }}
        />
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer', flexShrink: 0 }}>
          <input type="checkbox" checked={proj.enabled} onChange={e => onChange({ enabled: e.target.checked })} />
          <span style={{ fontSize: 12 }}>Active</span>
        </label>
        <button
          onClick={onRemove} className="glass-btn"
          style={{ fontSize: 12, padding: '4px 10px', color: 'var(--red, #ef4444)' }}
        >
          Remove
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
        <Field label="GitHub repo URL">
          <input
            className="glass-input" value={proj.repoUrl}
            onChange={e => onChange({ repoUrl: e.target.value })}
            placeholder="https://github.com/user/repo"
            style={{ ...inputStyle, fontFamily: 'ui-monospace, monospace', fontSize: 11 }}
          />
        </Field>
        <Field label="Path on St3ve">
          <input
            className="glass-input" value={proj.agentPath}
            onChange={e => onChange({ agentPath: e.target.value })}
            placeholder="/home/ubuntu/projects/myrepo"
            style={{ ...inputStyle, fontFamily: 'ui-monospace, monospace', fontSize: 11 }}
          />
        </Field>
      </div>

      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Task types</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {TASK_TYPES.map(t => (
            <label key={t.value} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, cursor: 'pointer', fontSize: 12 }}>
              <input
                type="checkbox"
                checked={proj.taskTypes.includes(t.value)}
                onChange={() => onToggleTaskType(t.value)}
              />
              {t.label}
            </label>
          ))}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 10 }}>
        <Field label="Output format">
          <select
            className="glass-input" value={proj.outputFormat}
            onChange={e => onChange({ outputFormat: e.target.value as OutputFormat })}
            style={inputStyle}
          >
            {OUTPUT_FORMATS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
        </Field>
        <Field label="Custom instructions (optional)">
          <input
            className="glass-input" value={proj.customInstructions ?? ''}
            onChange={e => onChange({ customInstructions: e.target.value })}
            placeholder="e.g. Focus on performance issues, avoid touching auth code"
            style={inputStyle}
          />
        </Field>
      </div>
    </div>
  )
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
        {label}
      </div>
      {children}
    </div>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>{label}</div>
      {children}
      {hint && <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 3 }}>{hint}</div>}
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  fontSize: 13, padding: '7px 10px', borderRadius: 8, minHeight: 34, width: '100%', boxSizing: 'border-box',
}

const codeStyle: React.CSSProperties = {
  background: 'rgba(0,0,0,0.25)', padding: '10px 12px', borderRadius: 8,
  fontSize: 11, fontFamily: 'ui-monospace, monospace', overflowX: 'auto', margin: 0,
}
