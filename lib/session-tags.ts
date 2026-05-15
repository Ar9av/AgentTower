import fs from 'fs'
import path from 'path'
import os from 'os'

const TAGS_PATH = path.join(os.homedir(), '.claude', 'agenttower-session-tags.json')

export interface SessionTagEntry {
  tags: string[]
  favorite: boolean
  note?: string
  updatedAt: string
}

interface SessionTagStore {
  sessions: Record<string, SessionTagEntry>
}

const EMPTY: SessionTagStore = { sessions: {} }

export function loadSessionTags(): SessionTagStore {
  try {
    const raw = fs.readFileSync(TAGS_PATH, 'utf-8')
    const parsed = JSON.parse(raw) as Partial<SessionTagStore>
    return { sessions: parsed.sessions ?? {} }
  } catch {
    return { ...EMPTY, sessions: {} }
  }
}

export function saveSessionTags(store: SessionTagStore): void {
  fs.mkdirSync(path.dirname(TAGS_PATH), { recursive: true })
  fs.writeFileSync(TAGS_PATH, JSON.stringify(store, null, 2), { mode: 0o600 })
}

export function getSessionTags(sessionId: string): SessionTagEntry {
  const store = loadSessionTags()
  return store.sessions[sessionId] ?? { tags: [], favorite: false, updatedAt: new Date().toISOString() }
}

export function upsertSessionTags(sessionId: string, patch: Partial<SessionTagEntry>): SessionTagEntry {
  const store = loadSessionTags()
  const prev = store.sessions[sessionId] ?? { tags: [], favorite: false }
  const next: SessionTagEntry = { ...prev, ...patch, updatedAt: new Date().toISOString() }
  store.sessions[sessionId] = next
  saveSessionTags(store)
  return next
}
