/**
 * opencode-fs.ts — Read OpenCode chat sessions from its SQLite database.
 *
 * OpenCode (github.com/sst/opencode) stores all sessions, messages, and parts
 * in ~/.local/share/opencode/opencode.db (SQLite, introduced in v1.2.0).
 *
 * This module reads that database and converts the data into AgentTower's
 * internal types (ParsedMessage, SessionInfo, ProjectInfo, RecentSession) so
 * the rest of the app can treat OpenCode sessions uniformly alongside Claude.
 */

import fs from 'fs'
import path from 'path'
import os from 'os'
import { DatabaseSync } from 'node:sqlite'
import { ContentBlock, ParsedMessage, ProjectInfo, SessionInfo } from './types'
import { RecentSession, encodeB64 } from './claude-fs'

// ─── Config ────────────────────────────────────────────────────────────────

export function getOpenCodeDir(): string {
  return path.join(os.homedir(), '.local', 'share', 'opencode')
}

export function getOpenCodeDbPath(): string {
  return path.join(getOpenCodeDir(), 'opencode.db')
}

// ─── Database singleton ────────────────────────────────────────────────────

let _db: DatabaseSync | null = null
let _dbPath: string | null = null

function getDb(): DatabaseSync | null {
  const dbPath = getOpenCodeDbPath()
  if (!fs.existsSync(dbPath)) return null
  try {
    // Re-open if path changed (e.g. OPENCODE_DIR override) or not yet opened
    if (!_db || _dbPath !== dbPath) {
      try { _db?.close() } catch { /* ignore */ }
      _db = new DatabaseSync(dbPath, { readOnly: true })
      _dbPath = dbPath
    }
    return _db
  } catch {
    _db = null
    return null
  }
}

// ─── DB row types ──────────────────────────────────────────────────────────

interface DbSession {
  id: string
  title: string | null
  directory: string | null
  time_created: number
  time_updated: number
  cost: number | null
  tokens_input: number | null
  tokens_output: number | null
  model: string | null
}

interface DbMessage {
  id: string
  session_id: string
  time_created: number
  data: string
}

interface DbPart {
  id: string
  message_id: string
  data: string
  time_created: number
}

// ─── Part → ContentBlock ───────────────────────────────────────────────────

/**
 * Convert a single OpenCode part (parsed from part.data JSON) into one or
 * more AgentTower ContentBlocks. Returns [] for parts we skip (step markers,
 * file attachments, etc.).
 */
function partToBlocks(data: Record<string, unknown>): ContentBlock[] {
  const type = data.type as string | undefined

  if (type === 'text') {
    const text = (data.text as string | undefined) ?? ''
    if (!text.trim()) return []
    return [{ type: 'text', text }]
  }

  if (type === 'reasoning') {
    const thinking = (data.text as string | undefined) ?? ''
    if (!thinking.trim()) return []
    return [{ type: 'thinking', thinking }]
  }

  if (type === 'tool') {
    const toolName = (data.tool as string | undefined) ?? 'unknown'
    const callID   = data.callID as string | undefined
    const state    = data.state as Record<string, unknown> | undefined
    const status   = state?.status as string | undefined
    const input    = (state?.input as Record<string, unknown>) ?? {}

    const useBlock: ContentBlock = {
      type: 'tool_use',
      tool_name: toolName,
      tool_id: callID,
      tool_input: input,
    }

    if (status === 'completed' || status === 'error') {
      const isErr = status === 'error'
      const raw   = isErr ? String(state?.error ?? 'error') : String(state?.output ?? '')
      const resultBlock: ContentBlock = {
        type: 'tool_result',
        tool_id: callID,
        is_error: isErr,
        tool_result: [{ type: 'text', text: raw.slice(0, 20_000) }],
      }
      return [useBlock, resultBlock]
    }

    return [useBlock]
  }

  // Skip structural/metadata part types
  return []
}

// ─── Project discovery ─────────────────────────────────────────────────────

/**
 * Returns one ProjectInfo per unique working directory found in the OpenCode
 * sessions table. Each dirName is prefixed with "opencode:" so the rest of the
 * app can distinguish these from Claude projects.
 */
export function discoverOpenCodeProjects(): ProjectInfo[] {
  const db = getDb()
  if (!db) return []

  try {
    const rows = db.prepare(`
      SELECT directory,
             COUNT(*) AS session_count,
             MAX(time_updated) AS latest_mtime
      FROM   session
      WHERE  directory IS NOT NULL AND directory != ''
      GROUP  BY directory
      ORDER  BY latest_mtime DESC
    `).all() as Array<{ directory: string; session_count: number; latest_mtime: number }>

    return rows.map(row => ({
      dirName:      `opencode:${row.directory}`,
      decodedPath:  row.directory,
      displayName:  path.basename(row.directory) || row.directory,
      sessionCount: row.session_count,
      latestMtime:  row.latest_mtime,
      hasActive:    false,
      source:       'opencode' as const,
    }))
  } catch {
    return []
  }
}

// ─── List sessions for a project ───────────────────────────────────────────

/**
 * Returns SessionInfo[] for all OpenCode sessions whose directory matches.
 * `directory` is the raw filesystem path (no "opencode:" prefix).
 */
export function listOpenCodeSessions(directory: string): SessionInfo[] {
  const db = getDb()
  if (!db) return []

  try {
    const rows = db.prepare(`
      SELECT id, title, directory, time_created, time_updated,
             cost, tokens_input, tokens_output
      FROM   session
      WHERE  directory = ?
      ORDER  BY time_updated DESC
    `).all(directory) as DbSession[]

    return rows.map(row => ({
      sessionId:       row.id,
      filepath:        `opencode:${row.id}`,
      projectDirName:  `opencode:${row.directory ?? ''}`,
      mtime:           row.time_updated,
      sizeBytes:       0,
      firstPrompt:     row.title ?? '(no title)',
      messageCount:    0,
      pid:             null,
      processState:    'dead'  as const,
      isActive:        false,
      meta:            null,
      estimatedCostUsd: row.cost ?? undefined,
      currentActivity: null,
      source:          'opencode' as const,
    }))
  } catch {
    return []
  }
}

// ─── Recent sessions (cross-project) ──────────────────────────────────────

/**
 * Returns the `limit` most recently updated OpenCode sessions, converted to the
 * RecentSession shape used by the sidebar and tower view.
 */
export function getOpenCodeRecentSessions(limit = 20): RecentSession[] {
  const db = getDb()
  if (!db) return []

  try {
    const rows = db.prepare(`
      SELECT id, title, directory, time_created, time_updated, cost
      FROM   session
      ORDER  BY time_updated DESC
      LIMIT  ?
    `).all(limit) as DbSession[]

    return rows.map(row => {
      const syntheticPath = `opencode:${row.id}`
      return {
        sessionId:          row.id,
        filepath:           syntheticPath,
        encodedFilepath:    encodeB64(syntheticPath),
        projectDirName:     `opencode:${row.directory ?? ''}`,
        projectDisplayName: row.directory
          ? (path.basename(row.directory) || row.directory)
          : 'OpenCode',
        firstPrompt:        row.title ?? '(no title)',
        mtime:              row.time_updated,
        isActive:           false,
        currentActivity:    null,
        parentSessionId:    null,
        source:             'opencode' as const,
      }
    })
  } catch {
    return []
  }
}

// ─── Parse a single session into messages ─────────────────────────────────

/**
 * Returns all ParsedMessages for the given OpenCode session ID.
 * Messages are ordered chronologically; each assistant message has its parts
 * (text, tool calls, reasoning) expanded into ContentBlocks.
 */
export function parseOpenCodeSession(sessionId: string): ParsedMessage[] {
  const db = getDb()
  if (!db) return []

  try {
    const messages = db.prepare(`
      SELECT id, session_id, time_created, data
      FROM   message
      WHERE  session_id = ?
      ORDER  BY time_created ASC
    `).all(sessionId) as DbMessage[]

    const result: ParsedMessage[] = []
    let prevId: string | null = null

    for (const msg of messages) {
      let msgData: Record<string, unknown>
      try { msgData = JSON.parse(msg.data) } catch { continue }

      const role = (msgData.role as string | undefined) ?? 'assistant'
      if (role !== 'user' && role !== 'assistant') continue

      // Fetch parts for this message
      const parts = db.prepare(`
        SELECT id, message_id, data, time_created
        FROM   part
        WHERE  message_id = ?
        ORDER  BY time_created ASC
      `).all(msg.id) as DbPart[]

      const contentBlocks: ContentBlock[] = []
      for (const part of parts) {
        let partData: Record<string, unknown>
        try { partData = JSON.parse(part.data) } catch { continue }
        contentBlocks.push(...partToBlocks(partData))
      }

      // Skip empty messages (e.g. system or metadata messages with no content)
      if (contentBlocks.length === 0) continue

      result.push({
        uuid:        msg.id,
        parentUuid:  prevId,
        type:        role === 'user' ? 'user' : 'assistant',
        role:        role === 'user' ? 'user' : 'assistant',
        timestamp:   new Date(msg.time_created).toISOString(),
        isMeta:      false,
        isSidechain: false,
        sessionId,
        content:     contentBlocks,
      })
      prevId = msg.id
    }

    return result
  } catch {
    return []
  }
}

// ─── Session metadata ──────────────────────────────────────────────────────

export interface OpenCodeSessionMeta {
  title:       string | null
  directory:   string | null
  timeCreated: number
  timeUpdated: number
  cost:        number | null
  model:       unknown | null
}

export function getOpenCodeSessionMeta(sessionId: string): OpenCodeSessionMeta | null {
  const db = getDb()
  if (!db) return null

  try {
    const row = db.prepare(`
      SELECT id, title, directory, time_created, time_updated, cost, model
      FROM   session
      WHERE  id = ?
    `).get(sessionId) as (DbSession & { model: string | null }) | undefined

    if (!row) return null

    let model: unknown = null
    try { if (row.model) model = JSON.parse(row.model) } catch { /* ignore */ }

    return {
      title:       row.title,
      directory:   row.directory,
      timeCreated: row.time_created,
      timeUpdated: row.time_updated,
      cost:        row.cost,
      model,
    }
  } catch {
    return null
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────

/** True if the given encoded-filepath (f param) refers to an OpenCode session */
export function isOpenCodePath(filepath: string): boolean {
  return filepath.startsWith('opencode:')
}

/** Extract session ID from an "opencode:<sessionId>" path */
export function openCodeSessionId(filepath: string): string {
  return filepath.slice('opencode:'.length)
}

/** Extract directory from an "opencode:<dir>" project dirName */
export function openCodeDirectory(dirName: string): string {
  return dirName.slice('opencode:'.length)
}
