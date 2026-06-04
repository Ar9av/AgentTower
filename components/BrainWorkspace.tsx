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
  const [seed, setSeed] = useState('')
  const [railTab, setRailTab] = useState<'alerts' | 'memory'>('alerts')
  const [chatState, setChatState] = useState<{ count: number; clear: () => void }>({ count: 0, clear: () => {} })

  const loadAlerts = useCallback(() => {
    fetch('/api/brain/watch').then(r => r.ok ? r.json() : { alerts: [] }).then(d => setAlerts(d.alerts ?? [])).catch(() => {})
  }, [])
  const loadFacts = useCallback(() => {
    fetch('/api/brain/memory').then(r => r.ok ? r.json() : { facts: [] }).then(d => setFacts(d.facts ?? [])).catch(() => {})
  }, [])

  useEffect(() => {
    loadAlerts(); loadFacts()
    const id = setInterval(loadAlerts, 30_000)
    return () => clearInterval(id)
  }, [loadAlerts, loadFacts])

  function investigate(a: Alert) {
    setSeed(`Investigate this and tell me what's going on (read the session if needed): ${a.title} — ${a.detail}${a.sessionId ? ` (sessionId ${a.sessionId})` : ''}`)
  }

  async function deleteFact(id: string) {
    await fetch(`/api/brain/memory?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
    loadFacts()
  }

  const Rail = (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {/* Rail tabs */}
      <div style={{ display: 'flex', gap: 4, padding: '10px 12px', borderBottom: '1px solid var(--glass-border)', flexShrink: 0 }}>
        {(['alerts', 'memory'] as const).map(t => (
          <button key={t} onClick={() => setRailTab(t)} style={{
            flex: 1, padding: '6px 10px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer',
            border: '1px solid', textTransform: 'capitalize',
            background: railTab === t ? 'var(--accent-dim)' : 'transparent',
            color: railTab === t ? 'var(--accent)' : 'var(--text3)',
            borderColor: railTab === t ? 'color-mix(in srgb, var(--accent) 28%, transparent)' : 'var(--glass-border)',
          }}>
            {t === 'alerts' ? `Alerts${alerts.length ? ` · ${alerts.length}` : ''}` : `Memory${facts.length ? ` · ${facts.length}` : ''}`}
          </button>
        ))}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '10px 12px' }}>
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
      </div>
    </div>
  )

  return (
    <main className="brain-workspace">
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 18px', borderBottom: '1px solid var(--glass-border)', flexShrink: 0, background: 'var(--bg2)' }}>
        <div style={{ width: 32, height: 32, borderRadius: 10, flexShrink: 0, background: 'color-mix(in srgb, var(--accent) 15%, transparent)', border: '1px solid color-mix(in srgb, var(--accent) 32%, transparent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.01em' }}>Brain</div>
          <div style={{ fontSize: 11, color: 'var(--text3)' }}>Unified orchestrator · reads sessions, wiki & memory · acts on your agents</div>
        </div>
        {chatState.count > 0 && (
          <button onClick={chatState.clear} style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', color: 'var(--text3)', fontSize: 12, cursor: 'pointer', padding: '5px 12px', borderRadius: 8 }}>Clear chat</button>
        )}
      </div>

      {/* Body: chat + rail */}
      <div className="brain-body">
        <div className="brain-chat-col">
          <BrainChat variant="page" seedPrompt={seed} onStateChange={s => setChatState({ count: s.count, clear: s.clear })} />
        </div>
        <aside className="brain-rail">{Rail}</aside>
      </div>
    </main>
  )
}
