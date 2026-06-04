'use client'
import { useState } from 'react'
import OrchestratorConfig from './OrchestratorConfig'
import OrchestratorBoard from './OrchestratorBoard'

type Tab = 'board' | 'config'

export default function OrchestratorView() {
  const [tab, setTab] = useState<Tab>('board')

  const tabStyle = (active: boolean) => ({
    padding: '6px 16px',
    borderRadius: 8,
    border: 'none',
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: 500,
    background: active ? 'var(--accent)' : 'transparent',
    color: active ? '#fff' : 'var(--text2)',
    transition: 'all 0.15s',
  })

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Orchestrator</h1>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text2)' }}>
            Autonomous coding agents driven by GitHub Issues
          </p>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 4, background: 'var(--surface2)', borderRadius: 10, padding: 3 }}>
          <button style={tabStyle(tab === 'board')} onClick={() => setTab('board')}>Board</button>
          <button style={tabStyle(tab === 'config')} onClick={() => setTab('config')}>Config</button>
        </div>
      </div>

      {tab === 'board' && <OrchestratorBoard />}
      {tab === 'config' && <OrchestratorConfig />}
    </div>
  )
}
