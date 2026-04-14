import fs from 'fs'
import path from 'path'
import os from 'os'
import {
  RawJSONLLine,
  RawContentBlock,
  ContentBlock,
  ParsedMessage,
  PaginatedSession,
  ProjectInfo,
  SessionInfo,
  SessionMeta,
  SearchResult,
  ClaudeProcess,
} from './types'
import { scanClaudeSessions, getProcessState } from './process'

// ─── Config ────────────────────────────────────────────────────────────────

export function getClaudeDir(): string {
  return path.resolve(process.env.CLAUDE_DIR ?? path.join(os.homedir(), '.claude'))
}

export function getProjectsDir(): string {
  return path.join(getClaudeDir(), 'projects')
}

export function getActiveThreshold(): number {
  return parseInt(process.env.ACTIVE_THRESHOLD_SECS ?? '300', 10)
}

// ─── Path encoding/decoding ────────────────────────────────────────────────

export function decodeProjectPath(dirName: string): string {
  // Claude encodes '/' as '-' and '.' as '--'
  // We need to handle '--' before '-' to avoid double-replacing
  return dirName.replace(/--/g, '\x00').replace(/-/g, '/').replace(/\x00/g, '.')
}

export function encodeB64(s: string): string {
  return Buffer.from(s).toString('base64url')
}

export function decodeB64(s: string): string {
  return Buffer.from(s, 'base64url').toString('utf-8')
}

export function safePath(filepath: string, baseDir: string): string | null {
  const resolved = path.resolve(filepath)
  if (!resolved.startsWith(path.resolve(baseDir) + path.sep) && resolved !== path.resolve(baseDir)) {
    return null
  }
  return resolved
}

// ─── Session cache ─────────────────────────────────────────────────────────
// Bump CACHE_VERSION whenever the parser changes shape — invalidates all stale entries.
const CACHE_VERSION = 2

interface CacheEntry {
  mtime: number
  messages: ParsedMessage[]
}

const globalKey = `__clv_session_cache_v${CACHE_VERSION}__`
declare global {
  // eslint-disable-next-line no-var
  var __clv_session_cache_v2__: Map<string, CacheEntry> | undefined
}

function getCache(): Map<string, CacheEntry> {
  const k = globalKey as '__clv_session_cache_v2__'
  if (!global[k]) global[k] = new Map()
  return global[k]!
}

const MAX_CACHE_SIZE = 500

function evictOldest(cache: Map<string, CacheEntry>) {
  const first = cache.keys().next().value
  if (first) cache.delete(first)
}

// ─── JSONL parser ──────────────────────────────────────────────────────────

function parseContentBlocks(raw: string | RawContentBlock[] | undefined): ContentBlock[] {
  if (!raw) return []
  if (typeof raw === 'string') return [{ type: 'text', text: raw }]
  return raw.map((b, idx): ContentBlock => {
    if (b.type === 'text') return { type: 'text', text: b.text ?? '' }
    if (b.type === 'thinking') return { type: 'thinking', thinking: b.thinking ?? '' }
    if (b.type === 'tool_use') {
      return { type: 'tool_use', tool_name: b.name ?? '', tool_id: b.id, tool_input: b.input ?? {} }
    }
    if (b.type === 'tool_result') {
      const inner = b.content
      const resultBlocks: ContentBlock[] = typeof inner === 'string'
        ? [{ type: 'text', text: inner }]
        : Array.isArray(inner)
          ? (inner as RawContentBlock[]).map(x => ({ type: 'text' as const, text: x.text ?? JSON.stringify(x) }))
          : []
      return { type: 'tool_result', tool_id: b.id, tool_result: resultBlocks, is_error: b.is_error }
    }
    if (b.type === 'image') {
      // Store only a lightweight reference — base64 data is never kept in memory.
      // The /api/image route decodes it on demand from the raw JSONL.
      const src = b as unknown as { source?: { media_type?: string } }
      return {
        type: 'image',
        imageMediaType: src.source?.media_type ?? 'image/png',
        imageBlockIdx: idx,
      }
    }
    return { type: 'text', text: JSON.stringify(b) }
  })
}

// Extract raw base64 image data directly from the JSONL file for a specific message+block.
// Called by the /api/image route — avoids holding base64 in the parse cache.
export function extractImageData(
  filepath: string,
  messageUuid: string,
  blockIdx: number
): { data: string; mediaType: string } | null {
  let raw: string
  try { raw = fs.readFileSync(filepath, 'utf-8') } catch { return null }

  for (const line of raw.split('\n')) {
    const t = line.trim()
    if (!t) continue
    try {
      const obj = JSON.parse(t) as RawJSONLLine
      if (obj.uuid !== messageUuid) continue
      const content = obj.message?.content
      if (!Array.isArray(content)) return null
      const block = content[blockIdx] as unknown as { type: string; source?: { type?: string; media_type?: string; data?: string } }
      if (block?.type !== 'image' || block.source?.type !== 'base64') return null
      return { data: block.source.data ?? '', mediaType: block.source.media_type ?? 'image/png' }
    } catch { continue }
  }
  return null
}

export function parseJsonlFile(filepath: string): ParsedMessage[] {
  const cache = getCache()
  let mtime: number
  try {
    mtime = Math.floor(fs.statSync(filepath).mtimeMs)
  } catch {
    return []
  }

  const cached = cache.get(filepath)
  if (cached && cached.mtime === mtime) return cached.messages

  const messages: ParsedMessage[] = []
  let raw: string
  try {
    raw = fs.readFileSync(filepath, 'utf-8')
  } catch {
    return []
  }

  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    let obj: RawJSONLLine
    try {
      obj = JSON.parse(trimmed)
    } catch {
      continue
    }

    if (obj.type !== 'user' && obj.type !== 'assistant') continue
    if (!obj.message || !obj.uuid || !obj.timestamp) continue

    const content = parseContentBlocks(obj.message.content as string | RawContentBlock[])

    messages.push({
      uuid: obj.uuid,
      parentUuid: obj.parentUuid ?? null,
      type: obj.type as 'user' | 'assistant',
      role: obj.message.role as 'user' | 'assistant',
      timestamp: obj.timestamp,
      isMeta: obj.isMeta ?? false,
      isSidechain: obj.isSidechain ?? false,
      sessionId: obj.sessionId ?? '',
      content,
      model: obj.message.model,
      usage: obj.message.usage,
      gitBranch: obj.gitBranch,
      cwd: obj.cwd,
    })
  }

  if (cache.size >= MAX_CACHE_SIZE) evictOldest(cache)
  cache.set(filepath, { mtime, messages })
  return messages
}

export function parseJsonlFilePaginated(
  filepath: string,
  limit = 50,
  olderThanUuid?: string               // load the next page older than this uuid
): PaginatedSession {
  const all = parseJsonlFile(filepath).filter(m => !m.isMeta)
  const total = all.length

  // First non-meta user message with real text
  const firstMessage = all.find(m =>
    m.type === 'user' &&
    m.content.some(b => b.type === 'text' && b.text && !b.text.startsWith('<'))
  ) ?? null

  if (total === 0) return { firstMessage: null, messages: [], total: 0, hiddenCount: 0, hasMore: false }

  let window: ParsedMessage[]
  let hasMore: boolean

  if (!olderThanUuid) {
    // Initial load: last `limit` messages
    window = all.slice(-limit)
    hasMore = total > limit
  } else {
    // Paginate: find the index of the anchor and go backwards
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

  // Don't duplicate the firstMessage inside the window if it's already there
  const hiddenCount = Math.max(
    0,
    all.indexOf(window[0] ?? firstMessage!) -
    (firstMessage ? all.indexOf(firstMessage) + 1 : 0)
  )

  return { firstMessage, messages: window, total, hiddenCount, hasMore }
}

export function extractFirstPrompt(messages: ParsedMessage[]): string {
  for (const m of messages) {
    if (m.isMeta || m.type !== 'user') continue
    for (const block of m.content) {
      if (block.type === 'text' && block.text) {
        const text = block.text.replace(/<[^>]+>/g, '').trim()
        if (text) return text.slice(0, 120)
      }
    }
  }
  return '(no prompt)'
}

export function getSessionId(filepath: string): string {
  return path.basename(filepath, '.jsonl')
}

// ─── Session metadata ──────────────────────────────────────────────────────

export function loadSessionMeta(sessionId: string): SessionMeta | null {
  const metaPath = path.join(getClaudeDir(), 'usage-data', 'session-meta', `${sessionId}.json`)
  try {
    return JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as SessionMeta
  } catch {
    return null
  }
}

// ─── Project discovery ─────────────────────────────────────────────────────

export function discoverProjects(): ProjectInfo[] {
  const projectsDir = getProjectsDir()
  const running = scanClaudeSessions(getClaudeDir())
  const runningCwds = new Set(Object.values(running).map(p => p.cwd))
  const activeThreshold = getActiveThreshold()
  const now = Date.now()

  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(projectsDir, { withFileTypes: true })
  } catch {
    return []
  }

  const projects: ProjectInfo[] = []

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const dirPath = path.join(projectsDir, entry.name)
    let jsonlFiles: string[]
    try {
      jsonlFiles = fs.readdirSync(dirPath).filter(f => f.endsWith('.jsonl'))
    } catch {
      continue
    }
    if (jsonlFiles.length === 0) continue

    const mtimes = jsonlFiles.map(f => {
      try { return fs.statSync(path.join(dirPath, f)).mtimeMs } catch { return 0 }
    })
    const latestMtime = Math.max(...mtimes)
    const decodedPath = decodeProjectPath(entry.name)

    const hasActive =
      runningCwds.has(decodedPath) ||
      (now - latestMtime < activeThreshold * 1000)

    const displayName = path.basename(decodedPath) || decodedPath

    projects.push({
      dirName: entry.name,
      decodedPath,
      displayName,
      sessionCount: jsonlFiles.length,
      latestMtime,
      hasActive,
    })
  }

  projects.sort((a, b) => {
    if (a.hasActive !== b.hasActive) return a.hasActive ? -1 : 1
    return b.latestMtime - a.latestMtime
  })

  return projects
}

// ─── Session listing ────────────────────────────────────────────────────────

export function listSessions(projectDirName: string): SessionInfo[] {
  const projectsDir = getProjectsDir()
  const dirPath = path.join(projectsDir, projectDirName)
  const running = scanClaudeSessions(getClaudeDir())
  const activeThreshold = getActiveThreshold()
  const now = Date.now()

  let files: string[]
  try {
    files = fs.readdirSync(dirPath).filter(f => f.endsWith('.jsonl'))
  } catch {
    return []
  }

  const sessions: SessionInfo[] = []

  for (const file of files) {
    const filepath = path.join(dirPath, file)
    const sessionId = path.basename(file, '.jsonl')
    let stat: fs.Stats
    try {
      stat = fs.statSync(filepath)
    } catch {
      continue
    }

    const messages = parseJsonlFile(filepath)
    const firstPrompt = extractFirstPrompt(messages)
    const messageCount = messages.filter(m => !m.isMeta).length

    const proc = running[sessionId]
    let pid: number | null = null
    let processState: SessionInfo['processState'] = 'unknown'

    if (proc) {
      pid = proc.pid
      processState = getProcessState(proc.pid)
    }

    const isActive = now - stat.mtimeMs < activeThreshold * 1000

    sessions.push({
      sessionId,
      filepath,
      projectDirName,
      mtime: stat.mtimeMs,
      sizeBytes: stat.size,
      firstPrompt,
      messageCount,
      pid,
      processState,
      isActive,
      meta: loadSessionMeta(sessionId),
    })
  }

  sessions.sort((a, b) => b.mtime - a.mtime)
  return sessions
}

// ─── Search ────────────────────────────────────────────────────────────────

export function searchSessions(query: string): SearchResult[] {
  const projectsDir = getProjectsDir()
  const claudeDir = getClaudeDir()
  const results: SearchResult[] = []
  const lowerQuery = query.toLowerCase()

  let projectDirs: string[]
  try {
    projectDirs = fs.readdirSync(projectsDir)
  } catch {
    return []
  }

  for (const dirName of projectDirs) {
    const dirPath = path.join(projectsDir, dirName)
    let files: string[]
    try {
      const stat = fs.statSync(dirPath)
      if (!stat.isDirectory()) continue
      files = fs.readdirSync(dirPath).filter(f => f.endsWith('.jsonl'))
    } catch {
      continue
    }

    for (const file of files) {
      const filepath = path.join(dirPath, file)
      const sessionId = path.basename(file, '.jsonl')
      let content: string
      let mtime: number
      try {
        content = fs.readFileSync(filepath, 'utf-8')
        mtime = fs.statSync(filepath).mtimeMs
      } catch {
        continue
      }

      const lines = content.split('\n')
      let sessionHits = 0

      for (let i = 0; i < lines.length; i++) {
        if (sessionHits >= 5) break
        const line = lines[i]
        if (!line.toLowerCase().includes(lowerQuery)) continue

        // Try to extract a human-readable snippet
        let context = line
        try {
          const obj = JSON.parse(line)
          if (obj.message?.content) {
            const c = obj.message.content
            context = typeof c === 'string' ? c : JSON.stringify(c)
          }
        } catch {
          // keep raw line
        }

        // Trim context
        const idx = context.toLowerCase().indexOf(lowerQuery)
        const start = Math.max(0, idx - 60)
        const end = Math.min(context.length, idx + query.length + 60)
        context = (start > 0 ? '…' : '') + context.slice(start, end) + (end < context.length ? '…' : '')

        results.push({
          filepath,
          sessionId,
          projectDirName: dirName,
          decodedProjectPath: decodeProjectPath(dirName),
          lineNo: i + 1,
          context,
          timestamp: new Date(mtime).toISOString(),
          mtime,
        })
        sessionHits++
      }

      if (results.length >= 200) break
    }
    if (results.length >= 200) break
  }

  results.sort((a, b) => b.mtime - a.mtime)
  return results
}

// ─── SSE tail helpers ──────────────────────────────────────────────────────

export interface TailState {
  offset: number
  messageCount: number
}

export function readNewLines(filepath: string, state: TailState): { lines: string[]; newOffset: number } {
  let buf: Buffer
  try {
    const fd = fs.openSync(filepath, 'r')
    const stat = fs.fstatSync(fd)
    const toRead = stat.size - state.offset
    if (toRead <= 0) {
      fs.closeSync(fd)
      return { lines: [], newOffset: state.offset }
    }
    buf = Buffer.alloc(toRead)
    fs.readSync(fd, buf, 0, toRead, state.offset)
    fs.closeSync(fd)
  } catch {
    return { lines: [], newOffset: state.offset }
  }

  const text = buf.toString('utf-8')
  const lines = text.split('\n').filter(l => l.trim())
  const newOffset = state.offset + buf.length
  return { lines, newOffset }
}
