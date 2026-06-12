import fs from 'fs'
import path from 'path'
import os from 'os'

const SKILLS_JSONL = path.join(os.homedir(), '.claude', 'agenttower-brain-skills.jsonl')

export interface BrainSkill {
  id: string
  ts: number
  name: string
  description: string
  prompt: string        // the reusable prompt template
  tags: string[]
  usageCount: number
  keywords: string[]
}

const STOP = new Set([
  'the','a','an','and','or','but','is','are','was','were','to','of','in','on',
  'at','for','with','by','from','as','that','this','it','do','does','have','has',
  'not','no','so','if','then','use','using','make','made','just','like',
])

function extractKeywords(text: string): string[] {
  const words = text.toLowerCase().match(/[a-z0-9][a-z0-9_-]{2,}/g) ?? []
  const seen = new Set<string>()
  const out: string[] = []
  for (const w of words) {
    if (STOP.has(w) || seen.has(w)) continue
    seen.add(w)
    out.push(w)
    if (out.length >= 14) break
  }
  return out
}

function genId(): string {
  return `sk${Date.now().toString(36)}${Math.floor(performance.now() % 1000).toString(36)}`
}

export function getAllSkills(): BrainSkill[] {
  const skills: BrainSkill[] = []
  try {
    const raw = fs.readFileSync(SKILLS_JSONL, 'utf-8')
    for (const line of raw.split('\n')) {
      const t = line.trim()
      if (!t) continue
      try {
        const s = JSON.parse(t) as BrainSkill
        if (s.name && s.prompt) skills.push(s)
      } catch { /* skip */ }
    }
  } catch { /* no file yet */ }
  return skills
}

export function addSkill(name: string, description: string, prompt: string, tags: string[] = []): BrainSkill {
  const skill: BrainSkill = {
    id: genId(),
    ts: Date.now(),
    name: name.trim(),
    description: description.trim(),
    prompt: prompt.trim(),
    tags,
    usageCount: 0,
    keywords: extractKeywords(`${name} ${description} ${tags.join(' ')}`),
  }
  fs.mkdirSync(path.dirname(SKILLS_JSONL), { recursive: true })
  fs.appendFileSync(SKILLS_JSONL, JSON.stringify(skill) + '\n', 'utf-8')
  return skill
}

export function deleteSkill(id: string): boolean {
  try {
    const raw = fs.readFileSync(SKILLS_JSONL, 'utf-8')
    const lines = raw.split('\n').filter(Boolean)
    const kept = lines.filter(l => {
      try { return (JSON.parse(l) as BrainSkill).id !== id } catch { return true }
    })
    if (kept.length === lines.length) return false
    fs.writeFileSync(SKILLS_JSONL, kept.join('\n') + (kept.length ? '\n' : ''), 'utf-8')
    return true
  } catch { return false }
}

export function incrementSkillUsage(id: string): void {
  try {
    const raw = fs.readFileSync(SKILLS_JSONL, 'utf-8')
    const lines = raw.split('\n').filter(Boolean)
    const updated = lines.map(l => {
      try {
        const s = JSON.parse(l) as BrainSkill
        if (s.id === id) return JSON.stringify({ ...s, usageCount: (s.usageCount ?? 0) + 1 })
        return l
      } catch { return l }
    })
    fs.writeFileSync(SKILLS_JSONL, updated.join('\n') + '\n', 'utf-8')
  } catch { /* ignore */ }
}

export function rankSkills(query: string, limit = 5): BrainSkill[] {
  const skills = getAllSkills()
  if (skills.length === 0) return []

  const qTerms = new Set(extractKeywords(query))
  const now = Date.now()
  const DAY = 24 * 60 * 60 * 1000

  const scored = skills.map(s => {
    let overlap = 0
    for (const k of s.keywords) if (qTerms.has(k)) overlap++
    // also check tags
    for (const tag of s.tags) if (qTerms.has(tag.toLowerCase())) overlap += 2
    const ageDays = s.ts ? (now - s.ts) / DAY : 30
    const recency = Math.max(0, 1 - ageDays / 90)
    const popularity = Math.min(1, (s.usageCount ?? 0) / 10)
    const score = (overlap * 2 + recency + popularity * 0.5)
    return { s, score, overlap }
  })

  const hasQuery = qTerms.size > 0
  scored.sort((a, b) => {
    if (hasQuery && (a.overlap > 0) !== (b.overlap > 0)) return Number(b.overlap > 0) - Number(a.overlap > 0)
    return b.score - a.score
  })

  return scored.slice(0, limit).map(x => x.s)
}

export function formatSkillsForContext(skills: BrainSkill[]): string {
  if (skills.length === 0) return ''
  const lines = ['**Available Skills** (reusable prompt templates):']
  for (const s of skills) {
    const tags = s.tags.length > 0 ? ` [${s.tags.join(', ')}]` : ''
    lines.push(`- **${s.name}**${tags}: ${s.description}`)
    lines.push(`  > ${s.prompt.slice(0, 200)}${s.prompt.length > 200 ? '…' : ''}`)
  }
  return lines.join('\n')
}

export function getSkillsPaths() {
  return { jsonl: SKILLS_JSONL }
}
