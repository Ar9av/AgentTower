import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'
import { ClaudeProcess } from './types'

// ─── Scan ~/.claude/sessions/<pid>.json files ──────────────────────────────

export function scanClaudeSessions(claudeDir: string): Record<string, ClaudeProcess> {
  const sessionsDir = path.join(claudeDir, 'sessions')
  const result: Record<string, ClaudeProcess> = {}

  let files: string[]
  try {
    files = fs.readdirSync(sessionsDir).filter(f => f.endsWith('.json'))
  } catch {
    return result
  }

  for (const file of files) {
    const pid = parseInt(path.basename(file, '.json'), 10)
    if (isNaN(pid)) continue
    try {
      const data = JSON.parse(fs.readFileSync(path.join(sessionsDir, file), 'utf-8'))
      const sessionId = data.sessionId as string
      if (sessionId && isProcessAlive(pid)) {
        result[sessionId] = {
          pid,
          sessionId,
          cwd: data.cwd ?? '',
          startedAt: data.startedAt ?? 0,
          kind: data.kind ?? 'interactive',
        }
      }
    } catch {
      continue
    }
  }

  return result
}

// ─── Process state ─────────────────────────────────────────────────────────

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

export function getProcessState(pid: number): 'running' | 'paused' | 'dead' | 'unknown' {
  try {
    const stat = execSync(`ps -o stat= -p ${pid}`, { encoding: 'utf-8', timeout: 2000 }).trim()
    if (!stat) return 'dead'
    if (stat.startsWith('T')) return 'paused'
    return 'running'
  } catch {
    return 'dead'
  }
}

// ─── Validate before signaling ─────────────────────────────────────────────

function isClaudeProcess(pid: number): boolean {
  try {
    const comm = execSync(`ps -o comm= -p ${pid}`, { encoding: 'utf-8', timeout: 2000 }).trim()
    return comm === 'claude' || comm.endsWith('/claude') || comm.includes('node')
  } catch {
    return false
  }
}

function isOwnedByCurrentUser(pid: number): boolean {
  try {
    // On macOS/Linux, check uid of process matches current user
    const uid = execSync(`ps -o uid= -p ${pid}`, { encoding: 'utf-8', timeout: 2000 }).trim()
    return parseInt(uid, 10) === process.getuid!()
  } catch {
    return false
  }
}

export type SignalResult = { ok: true } | { ok: false; error: string; status: number }

export function sendSignal(pid: number, sig: NodeJS.Signals): SignalResult {
  if (!isProcessAlive(pid)) return { ok: false, error: 'Process not found', status: 404 }
  if (!isOwnedByCurrentUser(pid)) return { ok: false, error: 'Permission denied', status: 403 }
  if (!isClaudeProcess(pid)) return { ok: false, error: 'Not a Claude process', status: 403 }

  try {
    process.kill(pid, sig)
    return { ok: true }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, error: msg, status: 500 }
  }
}
