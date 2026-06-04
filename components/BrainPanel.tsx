'use client'
import { useState } from 'react'
import Link from 'next/link'
import BrainChat from './BrainChat'

interface Props { onClose: () => void }

export default function BrainPanel({ onClose }: Props) {
  const [fullscreen, setFullscreen] = useState(false)
  const [chatState, setChatState] = useState<{ count: number; clear: () => void }>({ count: 0, clear: () => {} })

  return (
    <>
      <div onClick={onClose} style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
        backdropFilter: 'blur(6px)', zIndex: 450,
      }} />

      <aside style={{
        position: 'fixed', top: 0, right: 0, bottom: 0,
        left: fullscreen ? 0 : 'auto',
        width: fullscreen ? '100%' : 'min(580px, 97vw)',
        zIndex: 451, display: 'flex', flexDirection: 'column',
        background: 'var(--bg)',
        borderLeft: fullscreen ? 'none' : '1px solid var(--glass-border)',
        boxShadow: fullscreen ? 'none' : '-10px 0 60px rgba(0,0,0,0.65)',
        animation: 'slideInRight 0.22s cubic-bezier(0.4,0,0.2,1)',
        transition: 'left 0.2s ease, width 0.2s ease',
      }} onKeyDown={e => { if (e.key === 'Escape') onClose() }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', borderBottom: '1px solid var(--glass-border)', flexShrink: 0, background: 'var(--bg2)' }}>
          <div style={{ width: 32, height: 32, borderRadius: 10, flexShrink: 0, background: 'color-mix(in srgb, var(--accent) 15%, transparent)', border: '1px solid color-mix(in srgb, var(--accent) 32%, transparent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.01em' }}>AgentTower Brain</div>
            <div style={{ fontSize: 11, color: 'var(--text3)' }}>Unified orchestrator · always-on memory</div>
          </div>
          <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
            <Link href="/brain" onClick={onClose} title="Open full Brain workspace" style={{
              background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', color: 'var(--text2)',
              cursor: 'pointer', padding: '5px 10px', borderRadius: 8, fontSize: 12, fontWeight: 600, textDecoration: 'none',
            }}>Full ↗</Link>
            {chatState.count > 0 && (
              <button onClick={chatState.clear} title="Clear history" style={{ background: 'none', border: 'none', color: 'var(--text3)', fontSize: 12, cursor: 'pointer', padding: '4px 8px', borderRadius: 6 }}>Clear</button>
            )}
            <button onClick={() => setFullscreen(v => !v)} title={fullscreen ? 'Exit fullscreen' : 'Expand'} style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', color: 'var(--text2)', cursor: 'pointer', padding: '5px 8px', borderRadius: 8, lineHeight: 1, display: 'flex', alignItems: 'center' }}>
              {fullscreen ? (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="10" y1="14" x2="3" y2="21"/><line x1="21" y1="3" x2="14" y2="10"/></svg>
              ) : (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>
              )}
            </button>
            <button onClick={onClose} style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', color: 'var(--text2)', fontSize: 14, cursor: 'pointer', padding: '5px 9px', borderRadius: 8, lineHeight: 1, display: 'flex', alignItems: 'center' }}>✕</button>
          </div>
        </div>

        <BrainChat variant="panel" onStateChange={s => setChatState({ count: s.count, clear: s.clear })} />
      </aside>

      <style>{`
        @keyframes slideInRight { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
        @keyframes dot-bounce { 0%,80%,100% { transform: translateY(0); opacity:.4; } 40% { transform: translateY(-4px); opacity:1; } }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </>
  )
}
