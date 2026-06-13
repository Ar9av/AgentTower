'use client'
import { useEffect, useRef, useState } from 'react'

export interface Skill {
  name: string
  description: string
}

interface Props {
  query: string
  onSelect: (name: string) => void
  onDismiss: () => void
}

export function SkillButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Insert skill (or type /)"
      style={{
        background: 'none', border: 'none', cursor: 'pointer',
        color: 'var(--text3)', padding: '4px 6px', borderRadius: 7,
        fontSize: 16, lineHeight: 1, flexShrink: 0, display: 'flex',
        alignItems: 'center', transition: 'color 0.12s',
      }}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'var(--accent)' }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'var(--text3)' }}
    >
      ⚡
    </button>
  )
}

let cachedSkills: Skill[] | null = null

export function useSkills() {
  const [skills, setSkills] = useState<Skill[]>(cachedSkills ?? [])
  useEffect(() => {
    if (cachedSkills) return
    fetch('/api/skills')
      .then(r => r.json())
      .then(d => { cachedSkills = d.skills ?? []; setSkills(cachedSkills!) })
      .catch(() => {})
  }, [])
  return skills
}

export default function SkillPicker({ query, onSelect, onDismiss }: Props) {
  const skills = useSkills()
  const [activeIdx, setActiveIdx] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  const filtered = query
    ? skills.filter(s => s.name.includes(query) || s.description.toLowerCase().includes(query.toLowerCase()))
    : skills

  useEffect(() => { setActiveIdx(0) }, [query])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!filtered.length) return
      if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx(i => Math.min(i + 1, filtered.length - 1)) }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIdx(i => Math.max(i - 1, 0)) }
      else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); onSelect(filtered[activeIdx].name) }
      else if (e.key === 'Escape') { e.preventDefault(); onDismiss() }
      else if (e.key === 'Tab') { e.preventDefault(); onSelect(filtered[activeIdx].name) }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [filtered, activeIdx, onSelect, onDismiss])

  useEffect(() => {
    const el = listRef.current?.children[activeIdx] as HTMLElement | undefined
    el?.scrollIntoView({ block: 'nearest' })
  }, [activeIdx])

  if (!filtered.length) return null

  return (
    <div style={{
      position: 'absolute', bottom: '100%', left: 0, right: 0, marginBottom: 4,
      background: 'var(--bg2)', border: '1px solid var(--glass-border-hi)',
      borderRadius: 10, boxShadow: '0 8px 32px rgba(0,0,0,0.35)',
      maxHeight: 220, overflowY: 'auto', zIndex: 100,
    }}>
      <div style={{ padding: '6px 10px 4px', fontSize: 10, color: 'var(--text3)', letterSpacing: '0.06em', textTransform: 'uppercase', borderBottom: '1px solid var(--glass-border)' }}>
        Skills · {filtered.length} match{filtered.length !== 1 ? 'es' : ''} · ↑↓ navigate · Enter to select
      </div>
      <div ref={listRef}>
        {filtered.map((s, i) => (
          <button
            key={s.name}
            type="button"
            onMouseEnter={() => setActiveIdx(i)}
            onClick={() => onSelect(s.name)}
            style={{
              display: 'block', width: '100%', textAlign: 'left',
              padding: '7px 12px', border: 'none', cursor: 'pointer',
              background: i === activeIdx ? 'var(--bg3)' : 'transparent',
              color: 'var(--text)', transition: 'background 0.08s',
            }}
          >
            <span style={{ fontSize: 13, fontWeight: 600, fontFamily: 'ui-monospace, monospace', color: i === activeIdx ? 'var(--accent)' : 'var(--text)' }}>
              /{s.name}
            </span>
            {s.description && (
              <span style={{ fontSize: 11, color: 'var(--text3)', marginLeft: 8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'inline-block', maxWidth: 380, verticalAlign: 'middle' }}>
                {s.description}
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  )
}
