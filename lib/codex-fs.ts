import fs from 'fs'
import os from 'os'
import path from 'path'
import { loadProjectMeta } from './project-meta'
import type { ContentBlock, PaginatedSession, ParsedMessage, ProjectInfo, SessionInfo } from './types'

interface CodexSessionMeta {
  id?: string
  cwd?: string
  timestamp?: string
}

interface CodexIndexEntry {
  id?: string
  thread_name?: string
  updated_at?: string
}

export function getCodexDir(): string {
  return path.resolve(process.env.CODEX_DIR ?? path.join(os.homedir(), '.codex'))
}

function getCodexSessionsDir(): string {
  return path.join(getCodexDir(), 'sessions')
}

function walkSessionFiles(dir: string, acc: string[]): void {
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      walkSessionFiles(full, acc)
      continue
    }
    if (entry.isFile() && entry.name.endsWith('.jsonl')) acc.push(full)
  }
}

function getAllSessionFiles(): string[] {
  const files: string[] = []
  walkSessionFiles(getCodexSessionsDir(), files)
  return files
}

function readCodexSessionMeta(filepath: string): CodexSessionMeta | null {
  let raw: string
  try {
    raw = fs.readFileSync(filepath, 'utf-8')
  } catch {
    return null
  }

  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const parsed = JSON.parse(trimmed) as { type?: string; payload?: CodexSessionMeta }
      if (parsed.type === 'session_meta' && parsed.payload?.cwd) return parsed.payload
    } catch {
      continue
    }
  }

  return null
}

function loadSessionIndex(): Map<string, CodexIndexEntry> {
  const file = path.join(getCodexDir(), 'session_index.jsonl')
  const map = new Map<string, CodexIndexEntry>()
  let raw: string
  try {
    raw = fs.readFileSync(file, 'utf-8')
  } catch {
    return map
  }

  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const parsed = JSON.parse(trimmed) as CodexIndexEntry
      if (parsed.id) map.set(parsed.id, parsed)
    } catch {
      continue
    }
  }
  return map
}

export function getCodexSessionId(filepath: string): string {
  const meta = readCodexSessionMeta(filepath)
  if (meta?.id) return meta.id
  const base = path.basename(filepath, '.jsonl')
  const tail = base.split('-').pop()
  return tail || base
}

function parseMessageContent(items: Array<{ type?: string; text?: string }> | undefined): ContentBlock[] {
  if (!Array.isArray(items)) return []
  const blocks: ContentBlock[] = []

  for (const item of items) {
    if (item.type === 'input_text' || item.type === 'output_text') {
      blocks.push({ type: 'text', text: item.text ?? '' })
    }
  }

  return blocks
}

function isCodexInternalUserContext(text: string): boolean {
  const trimmed = text.trim()
  return (
    trimmed.startsWith('<environment_context>') ||
    trimmed.startsWith('# AGENTS.md instructions for ') ||
    trimmed.startsWith('<permissions instructions>') ||
    trimmed.startsWith('<app-context>')
  )
}

export function parseCodexJsonlFile(filepath: string): ParsedMessage[] {
  let raw: string
  try {
    raw = fs.readFileSync(filepath, 'utf-8')
  } catch {
    return []
  }

  const sessionId = getCodexSessionId(filepath)
  const messages: ParsedMessage[] = []
  let lineNo = 0

  for (const line of raw.split('\n')) {
    lineNo += 1
    const trimmed = line.trim()
    if (!trimmed) continue

    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(trimmed) as Record<string, unknown>
    } catch {
      continue
    }

    const timestamp = typeof parsed.timestamp === 'string' ? parsed.timestamp : new Date().toISOString()
    const type = parsed.type
    const payload = (parsed.payload && typeof parsed.payload === 'object') ? parsed.payload as Record<string, unknown> : null

    if (type === 'response_item' && payload?.type === 'message') {
      const role = payload.role
      if (role !== 'user' && role !== 'assistant') continue
      const content = parseMessageContent(Array.isArray(payload.content) ? payload.content as Array<{ type?: string; text?: string }> : undefined)
      if (content.length === 0) continue
      const textOnly = content
        .filter(block => block.type === 'text' && block.text)
        .map(block => block.text ?? '')
        .join('\n')
        .trim()
      if (role === 'user' && textOnly && isCodexInternalUserContext(textOnly)) continue
      messages.push({
        uuid: `${sessionId}:line:${lineNo}`,
        parentUuid: null,
        type: role,
        role,
        timestamp,
        isMeta: false,
        isSidechain: false,
        sessionId,
        content,
      })
      continue
    }

    if (type === 'response_item' && payload?.type === 'reasoning') {
      const summaries = Array.isArray(payload.summary) ? payload.summary as Array<{ type?: string; text?: string }> : []
      const thinking = summaries
        .filter(item => item.type === 'summary_text' && item.text)
        .map(item => item.text ?? '')
        .join('\n')
        .trim()
      if (!thinking) continue
      messages.push({
        uuid: `${sessionId}:reasoning:${lineNo}`,
        parentUuid: null,
        type: 'assistant',
        role: 'assistant',
        timestamp,
        isMeta: false,
        isSidechain: false,
        sessionId,
        content: [{ type: 'thinking', thinking }],
      })
      continue
    }

    if (type === 'response_item' && payload?.type === 'custom_tool_call') {
      const callId = typeof payload.call_id === 'string' ? payload.call_id : `${sessionId}:tool:${lineNo}`
      messages.push({
        uuid: `${sessionId}:toolcall:${lineNo}`,
        parentUuid: null,
        type: 'assistant',
        role: 'assistant',
        timestamp,
        isMeta: false,
        isSidechain: false,
        sessionId,
        content: [{
          type: 'tool_use',
          tool_name: typeof payload.name === 'string' ? payload.name : 'tool',
          tool_id: callId,
          tool_input: { raw: typeof payload.input === 'string' ? payload.input : JSON.stringify(payload.input ?? {}) },
        }],
      })
      continue
    }

    if (type === 'response_item' && payload?.type === 'custom_tool_call_output') {
      const callId = typeof payload.call_id === 'string' ? payload.call_id : `${sessionId}:tool:${lineNo}`
      messages.push({
        uuid: `${sessionId}:toolout:${lineNo}`,
        parentUuid: null,
        type: 'user',
        role: 'user',
        timestamp,
        isMeta: false,
        isSidechain: false,
        sessionId,
        content: [{
          type: 'tool_result',
          tool_id: callId,
          tool_result: [{ type: 'text', text: typeof payload.output === 'string' ? payload.output : JSON.stringify(payload.output ?? {}) }],
        }],
      })
      continue
    }
  }

  return messages
}

export function parseCodexJsonlFilePaginated(
  filepath: string,
  limit = 50,
  olderThanUuid?: string,
  aroundUuid?: string
): PaginatedSession {
  const all = parseCodexJsonlFile(filepath).filter(m => !m.isMeta)
  const total = all.length
  const firstMessage = all.find(m => m.type === 'user') ?? null

  if (total === 0) return { firstMessage: null, messages: [], total: 0, hiddenCount: 0, hasMore: false }

  let window: ParsedMessage[]
  let hasMore: boolean

  if (aroundUuid) {
    const targetIdx = all.findIndex(m => m.uuid === aroundUuid)
    if (targetIdx === -1) {
      window = all.slice(-limit)
      hasMore = total > limit
    } else {
      const endIdx = Math.min(total, targetIdx + 20)
      const startIdx = Math.max(0, endIdx - limit)
      window = all.slice(startIdx, endIdx)
      hasMore = startIdx > 0
    }
  } else if (!olderThanUuid) {
    window = all.slice(-limit)
    hasMore = total > limit
  } else {
    const anchorIdx = all.findIndex(m => m.uuid === olderThanUuid)
    if (anchorIdx <= 0) {
      window = []
      hasMore = false
    } else {
      const start = Math.max(0, anchorIdx - limit)
      window = all.slice(start, anchorIdx)
      hasMore = start > 0
    }
  }

  const hiddenCount = Math.max(0, total - window.length - (firstMessage && !window.some(m => m.uuid === firstMessage.uuid) ? 1 : 0))
  return { firstMessage, messages: window, total, hiddenCount, hasMore }
}

function extractFirstPrompt(messages: ParsedMessage[]): string {
  for (const msg of messages) {
    if (msg.type !== 'user') continue
    const text = msg.content.filter(b => b.type === 'text').map(b => b.text ?? '').join('\n').trim()
    if (text) return text.slice(0, 240)
  }
  return ''
}

function extractLastSummary(messages: ParsedMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg.type !== 'assistant') continue
    const text = msg.content
      .filter(b => b.type === 'text')
      .map(b => b.text ?? '')
      .join('\n')
      .trim()
    if (text) return text.slice(0, 160)
  }
  return null
}

export function discoverCodexProjects(): ProjectInfo[] {
  const meta = loadProjectMeta().projects
  const byPath = new Map<string, ProjectInfo>()

  for (const file of getAllSessionFiles()) {
    const session = readCodexSessionMeta(file)
    const cwd = session?.cwd
    if (!cwd) continue

    let mtime = 0
    try { mtime = fs.statSync(file).mtimeMs } catch {}

    const current = byPath.get(cwd)
    const displayName = meta[cwd]?.displayName || path.basename(cwd) || cwd
    if (current) {
      current.sessionCount += 1
      if (mtime > current.latestMtime) current.latestMtime = mtime
      continue
    }

    byPath.set(cwd, {
      source: 'codex',
      dirName: cwd,
      decodedPath: cwd,
      displayName,
      sessionCount: 1,
      latestMtime: mtime,
      hasActive: false,
    })
  }

  return Array.from(byPath.values()).sort((a, b) => b.latestMtime - a.latestMtime)
}

export function listCodexSessions(projectPath: string): SessionInfo[] {
  const sessionIndex = loadSessionIndex()
  const sessions: SessionInfo[] = []

  for (const file of getAllSessionFiles()) {
    const meta = readCodexSessionMeta(file)
    if (!meta?.cwd || meta.cwd !== projectPath) continue

    let stat: fs.Stats
    try {
      stat = fs.statSync(file)
    } catch {
      continue
    }

    const sessionId = meta.id || getCodexSessionId(file)
    const messages = parseCodexJsonlFile(file)
    const indexMeta = sessionIndex.get(sessionId)
    const firstPrompt = indexMeta?.thread_name || extractFirstPrompt(messages)
    const messageCount = messages.filter(m => !m.isMeta).length
    const isActive = Date.now() - stat.mtimeMs < 30_000

    sessions.push({
      sessionId,
      filepath: file,
      projectDirName: projectPath,
      mtime: stat.mtimeMs,
      sizeBytes: stat.size,
      firstPrompt,
      lastSummary: extractLastSummary(messages),
      messageCount,
      pid: null,
      processState: 'dead',
      isActive,
      meta: null,
      primaryModel: null,
    })
  }

  sessions.sort((a, b) => b.mtime - a.mtime)
  return sessions
}

export function findCodexSessionProjectCwd(sessionId: string): string | null {
  for (const file of getAllSessionFiles()) {
    const meta = readCodexSessionMeta(file)
    if (meta?.id === sessionId) return meta.cwd ?? null
  }
  return null
}

export function findCodexSessionFile(sessionId: string): string | null {
  for (const file of getAllSessionFiles()) {
    const meta = readCodexSessionMeta(file)
    if (meta?.id === sessionId) return file
  }
  return null
}
