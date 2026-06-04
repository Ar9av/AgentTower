import fs from 'fs'
import path from 'path'
import os from 'os'

// ── Paths ────────────────────────────────────────────────────────────────────

const MEM_JSONL = path.join(os.homedir(), '.claude', 'agenttower-brain-memory.jsonl')
const MEM_MD    = path.join(os.homedir(), '.claude', 'agenttower-brain-memory.md') // legacy

export type FactType = 'decision' | 'preference' | 'project' | 'blocker' | 'fact'

export interface BrainFact {
  id: string
  ts: number          // epoch ms
  type: FactType
  text: string
  keywords: string[]
}

// ── Stopwords for keyword extraction ──────────────────────────────────────────

const STOP = new Set([
  'the','a','an','and','or','but','is','are','was','were','be','been','being',
  'to','of','in','on','at','for','with','by','from','as','that','this','it','its',
  'i','you','he','she','we','they','my','your','our','their','me','us','them',
  'do','does','did','have','has','had','will','would','should','could','can','may',
  'not','no','yes','so','if','then','than','when','what','which','who','how','why',
  'want','wants','need','make','made','use','using','want','also','just','like',
])

function extractKeywords(text: string): string[] {
  const words = text.toLowerCase().match(/[a-z0-9][a-z0-9_-]{2,}/g) ?? []
  const seen = new Set<string>()
  const out: string[] = []
  for (const w of words) {
    if (STOP.has(w) || seen.has(w)) continue
    seen.add(w)
    out.push(w)
    if (out.length >= 12) break
  }
  return out
}

function genId(): string {
  return `f${Date.now().toString(36)}${Math.floor(performance.now() % 1000).toString(36)}`
}

// ── Read ──────────────────────────────────────────────────────────────────────

export function getAllFacts(): BrainFact[] {
  const facts: BrainFact[] = []

  // 1. Structured JSONL
  try {
    const raw = fs.readFileSync(MEM_JSONL, 'utf-8')
    for (const line of raw.split('\n')) {
      const t = line.trim()
      if (!t) continue
      try {
        const f = JSON.parse(t) as BrainFact
        if (f.text) facts.push(f)
      } catch { /* skip */ }
    }
  } catch { /* no file yet */ }

  // 2. Legacy .md (bullet lines) — back-compat, treated as plain facts
  try {
    const raw = fs.readFileSync(MEM_MD, 'utf-8')
    for (const line of raw.split('\n')) {
      const m = line.match(/^-\s*(?:\[([^\]]+)\]\s*)?(.+)$/)
      if (!m) continue
      const dateStr = m[1]
      const text = m[2].trim()
      if (!text) continue
      const ts = dateStr ? Date.parse(dateStr.replace(' ', 'T')) || 0 : 0
      facts.push({ id: `md${facts.length}`, ts, type: 'fact', text, keywords: extractKeywords(text) })
    }
  } catch { /* no legacy file */ }

  return facts
}

// ── Write ──────────────────────────────────────────────────────────────────────

export function addFact(text: string, type: FactType = 'fact'): BrainFact {
  const fact: BrainFact = {
    id: genId(),
    ts: Date.now(),
    type,
    text: text.trim(),
    keywords: extractKeywords(text),
  }
  fs.mkdirSync(path.dirname(MEM_JSONL), { recursive: true })
  fs.appendFileSync(MEM_JSONL, JSON.stringify(fact) + '\n', 'utf-8')
  return fact
}

export function deleteFact(id: string): boolean {
  try {
    const raw = fs.readFileSync(MEM_JSONL, 'utf-8')
    const lines = raw.split('\n').filter(Boolean)
    const kept = lines.filter(l => {
      try { return (JSON.parse(l) as BrainFact).id !== id } catch { return true }
    })
    if (kept.length === lines.length) return false
    fs.writeFileSync(MEM_JSONL, kept.join('\n') + (kept.length ? '\n' : ''), 'utf-8')
    return true
  } catch { return false }
}

// ── Ranked retrieval ────────────────────────────────────────────────────────────

export function rankFacts(query: string, limit = 8): BrainFact[] {
  const facts = getAllFacts()
  if (facts.length === 0) return []

  const qTerms = new Set(extractKeywords(query))
  const now = Date.now()
  const DAY = 24 * 60 * 60 * 1000

  const scored = facts.map(f => {
    // keyword overlap
    let overlap = 0
    for (const k of f.keywords) if (qTerms.has(k)) overlap++
    // recency: 0..1 over ~30 days
    const ageDays = f.ts ? (now - f.ts) / DAY : 30
    const recency = Math.max(0, 1 - ageDays / 30)
    // type weight: blockers and decisions matter more
    const typeBoost = f.type === 'blocker' ? 1.5 : f.type === 'decision' ? 1.3 : f.type === 'preference' ? 1.2 : 1
    const score = (overlap * 2 + recency) * typeBoost
    return { f, score, overlap }
  })

  // If query has terms, prefer matches; else fall back to recency
  const hasQuery = qTerms.size > 0
  scored.sort((a, b) => {
    if (hasQuery && (a.overlap > 0) !== (b.overlap > 0)) return Number(b.overlap > 0) - Number(a.overlap > 0)
    return b.score - a.score
  })

  return scored.slice(0, limit).map(s => s.f)
}

// ── Format for prompt injection ──────────────────────────────────────────────────

export function formatFactsForContext(facts: BrainFact[]): string {
  if (facts.length === 0) return ''
  const byType: Record<string, BrainFact[]> = {}
  for (const f of facts) (byType[f.type] ??= []).push(f)

  const lines: string[] = []
  const order: FactType[] = ['blocker', 'decision', 'project', 'preference', 'fact']
  for (const t of order) {
    const group = byType[t]
    if (!group?.length) continue
    const label = t === 'fact' ? 'Facts' : t.charAt(0).toUpperCase() + t.slice(1) + 's'
    lines.push(`**${label}:**`)
    for (const f of group) {
      const when = f.ts ? new Date(f.ts).toISOString().slice(0, 10) : ''
      lines.push(`- ${f.text}${when ? ` _(${when})_` : ''}`)
    }
  }
  return lines.join('\n')
}

export function getMemoryPaths() {
  return { jsonl: MEM_JSONL, md: MEM_MD }
}
