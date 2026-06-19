'use client'
import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import BrainChat from './BrainChat'

interface Alert {
  id: string
  level: 'error' | 'warn' | 'info'
  title: string
  detail: string
  sessionId?: string
  encodedFilepath?: string
  ts: number
}

interface Fact {
  id: string
  ts: number
  type: string
  text: string
}

interface Skill {
  id: string
  ts: number
  name: string
  description: string
  prompt: string
  tags: string[]
  usageCount: number
}

interface Agent {
  id: string
  provider: 'claude' | 'codex'
  project: string
  task: string
  activity: string | null
  active: boolean
  updatedAt: number
  href: string
}

const LEVEL_COLOR: Record<string, string> = {
  error: 'var(--red)', warn: 'var(--yellow)', info: 'var(--accent)',
}
const TYPE_COLOR: Record<string, string> = {
  blocker: 'var(--red)', decision: 'var(--accent)', preference: 'var(--purple)',
  project: 'var(--green)', fact: 'var(--text3)',
}

export default function BrainWorkspace() {
  const router = useRouter()
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [facts, setFacts] = useState<Fact[]>([])
  const [skills, setSkills] = useState<Skill[]>([])
  const [agents, setAgents] = useState<Agent[]>([])
  const [seed, setSeed] = useState('')
  const [railTab, setRailTab] = useState<'agents' | 'alerts' | 'memory' | 'skills'>('agents')
  const [railOpen, setRailOpen] = useState(false)
  const [chatState, setChatState] = useState<{ count: number; clear: () => void }>({ count: 0, clear: () => {} })
  const [newSkill, setNewSkill] = useState<{ name: string; description: string; prompt: string; tags: string } | null>(null)

  const loadAlerts = useCallback(() => {
    fetch('/api/brain/watch').then(r => r.ok ? r.json() : { alerts: [] }).then(d => setAlerts(d.alerts ?? [])).catch(() => {})
  }, [])
  const loadFacts = useCallback(() => {
    fetch('/api/brain/memory').then(r => r.ok ? r.json() : { facts: [] }).then(d => setFacts(d.facts ?? [])).catch(() => {})
  }, [])
  const loadSkills = useCallback(() => {
    fetch('/api/brain/skills').then(r => r.ok ? r.json() : { skills: [] }).then(d => setSkills(d.skills ?? [])).catch(() => {})
  }, [])
  const loadAgents = useCallback(() => {
    fetch('/api/brain/agents').then(r => {
      if (r.status === 401) { window.location.assign('/login'); return { agents: [] } }
      return r.ok ? r.json() : { agents: [] }
    }).then(d => setAgents(d.agents ?? [])).catch(() => {})
  }, [])

  useEffect(() => {
    loadAlerts(); loadFacts(); loadSkills(); loadAgents()
    const alertTimer = setInterval(loadAlerts, 30_000)
    const agentTimer = setInterval(loadAgents, 5_000)
    return () => { clearInterval(alertTimer); clearInterval(agentTimer) }
  }, [loadAlerts, loadFacts, loadSkills, loadAgents])

  function investigate(a: Alert) {
    setSeed(`Investigate this and tell me what's going on (read the session if needed): ${a.title} — ${a.detail}${a.sessionId ? ` (sessionId ${a.sessionId})` : ''}`)
  }

  async function deleteFact(id: string) {
    await fetch(`/api/brain/memory?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
    loadFacts()
  }

  async function deleteSkill(id: string) {
    await fetch(`/api/brain/skills?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
    loadSkills()
  }

  async function applySkill(skill: Skill) {
    await fetch('/api/brain/skills', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'use', id: skill.id }),
    })
    setSeed(skill.prompt)
    loadSkills()
  }

  async function saveNewSkill() {
    if (!newSkill?.name.trim() || !newSkill?.prompt.trim()) return
    await fetch('/api/brain/skills', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: newSkill.name,
        description: newSkill.description,
        prompt: newSkill.prompt,
        tags: newSkill.tags.split(',').map(t => t.trim()).filter(Boolean),
      }),
    })
    setNewSkill(null)
    loadSkills()
  }

  const Rail = (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {/* Rail tabs */}
      <div style={{ display: 'flex', gap: 4, padding: '10px 12px', borderBottom: '1px solid var(--glass-border)', flexShrink: 0 }}>
        {(['agents', 'alerts', 'memory', 'skills'] as const).map(t => (
          <button key={t} onClick={() => setRailTab(t)} style={{
            flex: 1, padding: '6px 6px', borderRadius: 8, fontSize: 11, fontWeight: 600, cursor: 'pointer',
            border: '1px solid', textTransform: 'capitalize',
            background: railTab === t ? 'var(--accent-dim)' : 'transparent',
            color: railTab === t ? 'var(--accent)' : 'var(--text3)',
            borderColor: railTab === t ? 'color-mix(in srgb, var(--accent) 28%, transparent)' : 'var(--glass-border)',
          }}>
            {t === 'agents' ? `Agents${agents.filter(a => a.active).length ? ` · ${agents.filter(a => a.active).length}` : ''}` : t === 'alerts' ? `Alerts${alerts.length ? ` · ${alerts.length}` : ''}` : t === 'memory' ? `Memory${facts.length ? ` · ${facts.length}` : ''}` : `Skills${skills.length ? ` · ${skills.length}` : ''}`}
          </button>
        ))}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '10px 12px' }}>
        {railTab === 'agents' && (
          <>
            <div style={{ fontSize: 10, color: 'var(--text3)', margin: '0 2px 9px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Live · refreshes every 5 seconds</div>
            {agents.length === 0 && (
              <div style={{ padding: '28px 10px', textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>No agent sessions found</div>
            )}
            {agents.slice(0, 20).map(agent => (
              <button key={`${agent.provider}-${agent.id}`} onClick={() => router.push(agent.href)} style={{
                display: 'block', width: '100%', textAlign: 'left', padding: '10px 12px', marginBottom: 8, borderRadius: 10, cursor: 'pointer',
                background: 'var(--bg3)', border: '1px solid var(--glass-border)', color: 'var(--text)',
                borderLeft: `3px solid ${agent.active ? 'var(--green)' : 'var(--glass-border-hi)'}`,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: agent.active ? 'var(--green)' : 'var(--text3)', boxShadow: agent.active ? '0 0 8px var(--green)' : 'none' }} />
                  <span style={{ fontSize: 12, fontWeight: 700, flex: 1 }}>{agent.project}</span>
                  <span style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.05em', color: agent.provider === 'claude' ? 'var(--accent)' : 'var(--purple)' }}>{agent.provider}</span>
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--text2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{agent.task || 'No task description'}</div>
                <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 4 }}>{agent.active ? agent.activity || 'working' : `updated ${new Date(agent.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}</div>
              </button>
            ))}
          </>
        )}

        {railTab === 'alerts' && (
          <>
            {alerts.length === 0 && (
              <div style={{ padding: '28px 10px', textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>
                <div style={{ fontSize: 22, marginBottom: 8 }}>✓</div>
                Nothing needs attention
              </div>
            )}
            {alerts.map(a => (
              <div key={a.id} style={{
                padding: '10px 12px', marginBottom: 8, borderRadius: 10,
                background: 'var(--bg3)', border: '1px solid var(--glass-border)',
                borderLeft: `3px solid ${LEVEL_COLOR[a.level]}`,
              }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 2 }}>{a.title}</div>
                <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 8 }}>{a.detail}</div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={() => investigate(a)} style={{
                    fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 7, cursor: 'pointer',
                    background: 'var(--accent-dim)', color: 'var(--accent)',
                    border: '1px solid color-mix(in srgb, var(--accent) 25%, transparent)',
                  }}>🔍 Investigate</button>
                  {a.encodedFilepath && (
                    <button onClick={() => router.push(`/session?f=${a.encodedFilepath}`)} style={{
                      fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 7, cursor: 'pointer',
                      background: 'var(--glass-bg)', color: 'var(--text2)', border: '1px solid var(--glass-border)',
                    }}>Open ↗</button>
                  )}
                </div>
              </div>
            ))}
          </>
        )}

        {railTab === 'memory' && (
          <>
            {facts.length === 0 && (
              <div style={{ padding: '28px 10px', textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>
                No memories yet. The Brain saves facts as you work.
              </div>
            )}
            {facts.map(f => (
              <div key={f.id} style={{
                padding: '9px 12px', marginBottom: 7, borderRadius: 10,
                background: 'var(--bg3)', border: '1px solid var(--glass-border)',
                display: 'flex', gap: 8, alignItems: 'flex-start',
              }}>
                <span style={{
                  fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em',
                  padding: '2px 6px', borderRadius: 5, flexShrink: 0, marginTop: 1,
                  color: TYPE_COLOR[f.type] ?? 'var(--text3)',
                  background: `color-mix(in srgb, ${TYPE_COLOR[f.type] ?? 'var(--text3)'} 12%, transparent)`,
                }}>{f.type}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, color: 'var(--text)', lineHeight: 1.5 }}>{f.text}</div>
                  {f.ts > 0 && <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 2 }}>{new Date(f.ts).toLocaleDateString()}</div>}
                </div>
                <button onClick={() => deleteFact(f.id)} title="Forget" style={{
                  background: 'none', border: 'none', color: 'var(--text3)', cursor: 'pointer', fontSize: 13, padding: '0 2px', flexShrink: 0,
                }}>✕</button>
              </div>
            ))}
          </>
        )}

        {railTab === 'skills' && (
          <>
            <button onClick={() => setNewSkill({ name: '', description: '', prompt: '', tags: '' })} style={{
              width: '100%', marginBottom: 10, padding: '7px 12px', borderRadius: 9, fontSize: 12, fontWeight: 600,
              cursor: 'pointer', background: 'var(--accent-dim)', color: 'var(--accent)',
              border: '1px solid color-mix(in srgb, var(--accent) 28%, transparent)',
            }}>+ New Skill</button>

            {newSkill && (
              <div style={{ marginBottom: 10, padding: '12px', borderRadius: 10, background: 'var(--bg3)', border: '1px solid var(--glass-border)' }}>
                <input value={newSkill.name} onChange={e => setNewSkill({ ...newSkill, name: e.target.value })} placeholder="Skill name" style={{ width: '100%', marginBottom: 6, padding: '6px 8px', borderRadius: 7, background: 'var(--bg2)', border: '1px solid var(--glass-border)', color: 'var(--text)', fontSize: 12, boxSizing: 'border-box' }} />
                <input value={newSkill.description} onChange={e => setNewSkill({ ...newSkill, description: e.target.value })} placeholder="Short description" style={{ width: '100%', marginBottom: 6, padding: '6px 8px', borderRadius: 7, background: 'var(--bg2)', border: '1px solid var(--glass-border)', color: 'var(--text)', fontSize: 12, boxSizing: 'border-box' }} />
                <textarea value={newSkill.prompt} onChange={e => setNewSkill({ ...newSkill, prompt: e.target.value })} placeholder="Prompt template…" rows={3} style={{ width: '100%', marginBottom: 6, padding: '6px 8px', borderRadius: 7, background: 'var(--bg2)', border: '1px solid var(--glass-border)', color: 'var(--text)', fontSize: 12, resize: 'vertical', boxSizing: 'border-box' }} />
                <input value={newSkill.tags} onChange={e => setNewSkill({ ...newSkill, tags: e.target.value })} placeholder="Tags (comma separated)" style={{ width: '100%', marginBottom: 8, padding: '6px 8px', borderRadius: 7, background: 'var(--bg2)', border: '1px solid var(--glass-border)', color: 'var(--text)', fontSize: 12, boxSizing: 'border-box' }} />
                <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={saveNewSkill} style={{ flex: 1, padding: '6px', borderRadius: 7, fontSize: 11, fontWeight: 600, cursor: 'pointer', background: 'var(--accent)', color: '#fff', border: 'none' }}>Save</button>
                  <button onClick={() => setNewSkill(null)} style={{ flex: 1, padding: '6px', borderRadius: 7, fontSize: 11, cursor: 'pointer', background: 'var(--glass-bg)', color: 'var(--text3)', border: '1px solid var(--glass-border)' }}>Cancel</button>
                </div>
              </div>
            )}

            {skills.length === 0 && !newSkill && (
              <div style={{ padding: '28px 10px', textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>
                No skills yet. Add reusable prompt templates here — Brain will inject relevant ones automatically.
              </div>
            )}

            {skills.map(s => (
              <div key={s.id} style={{
                padding: '10px 12px', marginBottom: 8, borderRadius: 10,
                background: 'var(--bg3)', border: '1px solid var(--glass-border)',
              }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, marginBottom: 4 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text)' }}>{s.name}</div>
                    {s.description && <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 1 }}>{s.description}</div>}
                  </div>
                  <button onClick={() => deleteSkill(s.id)} title="Delete" style={{ background: 'none', border: 'none', color: 'var(--text3)', cursor: 'pointer', fontSize: 13, padding: '0 2px', flexShrink: 0 }}>✕</button>
                </div>
                <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 6, fontFamily: 'monospace', background: 'var(--bg2)', padding: '4px 7px', borderRadius: 6, maxHeight: 56, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {s.prompt.slice(0, 120)}{s.prompt.length > 120 ? '…' : ''}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {s.tags.map(tag => (
                    <span key={tag} style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 4, background: 'var(--accent-dim)', color: 'var(--accent)' }}>{tag}</span>
                  ))}
                  <span style={{ flex: 1 }} />
                  {s.usageCount > 0 && <span style={{ fontSize: 10, color: 'var(--text3)' }}>used {s.usageCount}×</span>}
                  <button onClick={() => applySkill(s)} style={{
                    fontSize: 10, fontWeight: 600, padding: '3px 8px', borderRadius: 6, cursor: 'pointer',
                    background: 'var(--accent-dim)', color: 'var(--accent)',
                    border: '1px solid color-mix(in srgb, var(--accent) 25%, transparent)',
                  }}>Use</button>
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  )

  return (
    <main className="brain-workspace">
      {/* Header */}
      <div className="brain-header" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 18px', borderBottom: '1px solid var(--glass-border)', flexShrink: 0, background: 'var(--bg2)' }}>
        <div style={{ width: 32, height: 32, borderRadius: 10, flexShrink: 0, background: 'color-mix(in srgb, var(--accent) 15%, transparent)', border: '1px solid color-mix(in srgb, var(--accent) 32%, transparent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.01em' }}>Brain</div>
          <div className="brain-subtitle" style={{ fontSize: 11, color: 'var(--text3)' }}>Unified orchestrator · reads sessions, wiki & memory · acts on your agents</div>
        </div>
        <button className="brain-mobile-monitor" onClick={() => setRailOpen(true)} aria-label="Open agent monitor">
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: agents.some(a => a.active) ? 'var(--green)' : 'var(--text3)' }} />
          Monitor
        </button>
        {chatState.count > 0 && (
          <button className="brain-clear-chat" onClick={chatState.clear} style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', color: 'var(--text3)', fontSize: 12, cursor: 'pointer', padding: '5px 12px', borderRadius: 8 }}>Clear chat</button>
        )}
      </div>

      {/* Body: chat + rail */}
      <div className="brain-body">
        <div className="brain-chat-col">
          <BrainChat variant="page" seedPrompt={seed} onStateChange={s => setChatState({ count: s.count, clear: s.clear })} />
        </div>
        {railOpen && <button className="brain-rail-backdrop" onClick={() => setRailOpen(false)} aria-label="Close agent monitor" />}
        <aside className={`brain-rail${railOpen ? ' brain-rail-open' : ''}`}>
          <div className="brain-rail-mobile-head">
            <strong>Agent monitor</strong>
            <button onClick={() => setRailOpen(false)} aria-label="Close agent monitor">✕</button>
          </div>
          {Rail}
        </aside>
      </div>
    </main>
  )
}
