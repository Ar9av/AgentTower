import { spawn, ChildProcessWithoutNullStreams } from 'child_process'
import crypto from 'crypto'
import os from 'os'

// A persistent (non-PTY) shell process per terminal session. Output is
// buffered so a reconnecting SSE stream can catch up, and broadcast live to
// any currently-attached listeners. This is intentionally simple — no PTY,
// no resize, no color/cursor emulation — good enough for running commands
// and reading their output, not for interactive TUIs (vim, htop, etc).

const MAX_SESSIONS = 8
const BUFFER_LIMIT = 200_000 // chars kept for catchup on reconnect
const IDLE_TIMEOUT_MS = 30 * 60_000

interface TerminalSession {
  id: string
  proc: ChildProcessWithoutNullStreams
  buffer: string
  listeners: Set<(chunk: string) => void>
  lastActivity: number
  cwd: string
}

interface TerminalState {
  sessions: Map<string, TerminalSession>
  reaper: NodeJS.Timeout | null
}

const globalKey = '__clv_terminal_state__'
declare global {
  // eslint-disable-next-line no-var
  var __clv_terminal_state__: TerminalState | undefined
}

function getState(): TerminalState {
  if (!global[globalKey]) {
    global[globalKey] = { sessions: new Map(), reaper: null }
  }
  const state = global[globalKey]!
  if (!state.reaper) {
    state.reaper = setInterval(() => {
      const now = Date.now()
      for (const [id, session] of state.sessions) {
        if (session.listeners.size === 0 && now - session.lastActivity > IDLE_TIMEOUT_MS) {
          killSession(id)
        }
      }
    }, 60_000)
    state.reaper.unref?.()
  }
  return state
}

function appendToBuffer(session: TerminalSession, chunk: string) {
  session.buffer += chunk
  if (session.buffer.length > BUFFER_LIMIT) {
    session.buffer = session.buffer.slice(session.buffer.length - BUFFER_LIMIT)
  }
}

export function createSession(cwd?: string): { id: string; cwd: string } {
  const state = getState()

  if (state.sessions.size >= MAX_SESSIONS) {
    throw new Error(`Too many open terminal sessions (max ${MAX_SESSIONS}). Close one first.`)
  }

  const resolvedCwd = cwd && cwd.trim() ? cwd.trim() : os.homedir()
  const shell = process.env.SHELL || '/bin/bash'
  const isZsh = /zsh$/.test(shell)
  // Not a real PTY (stdout/stderr are plain pipes), so isatty() is false —
  // most CLI tools already skip ANSI color in that case. TERM=dumb and a
  // fixed prompt keep the shell itself from emitting escape sequences too.
  // bash uses --noprofile/--norc, zsh uses -f (no rcs) — flags aren't shared.
  const args = isZsh ? ['-f', '-i'] : ['--noprofile', '--norc', '-i']
  const proc = spawn(shell, args, {
    cwd: resolvedCwd,
    env: {
      ...process.env,
      TERM: 'dumb',
      NO_COLOR: '1',
      PS1: '\\u@\\h:\\w$ ',
      PROMPT: '%n@%m:%~$ ',
    },
    stdio: 'pipe',
  })

  const id = crypto.randomBytes(12).toString('hex')
  const session: TerminalSession = {
    id, proc, buffer: '', listeners: new Set(), lastActivity: Date.now(), cwd: resolvedCwd,
  }

  const onData = (data: Buffer) => {
    const chunk = data.toString('utf8')
    appendToBuffer(session, chunk)
    for (const listener of session.listeners) listener(chunk)
  }
  proc.stdout.on('data', onData)
  proc.stderr.on('data', onData)

  proc.on('exit', (code, signal) => {
    const chunk = `\n[process exited${code !== null ? ` with code ${code}` : ''}${signal ? ` (${signal})` : ''}]\n`
    appendToBuffer(session, chunk)
    for (const listener of session.listeners) listener(chunk)
  })

  state.sessions.set(id, session)
  return { id, cwd: resolvedCwd }
}

export function getSession(id: string): TerminalSession | undefined {
  return getState().sessions.get(id)
}

export function listSessions(): { id: string; cwd: string; alive: boolean }[] {
  return [...getState().sessions.values()].map(s => ({
    id: s.id, cwd: s.cwd, alive: s.proc.exitCode === null && !s.proc.killed,
  }))
}

export function writeInput(id: string, data: string): boolean {
  const session = getSession(id)
  if (!session || session.proc.exitCode !== null) return false
  session.lastActivity = Date.now()
  session.proc.stdin.write(data)
  return true
}

export function subscribe(id: string, onChunk: (chunk: string) => void): { catchup: string; unsubscribe: () => void } | null {
  const session = getSession(id)
  if (!session) return null
  session.lastActivity = Date.now()
  session.listeners.add(onChunk)
  return {
    catchup: session.buffer,
    unsubscribe: () => { session.listeners.delete(onChunk); session.lastActivity = Date.now() },
  }
}

export function killSession(id: string): boolean {
  const state = getState()
  const session = state.sessions.get(id)
  if (!session) return false
  try { session.proc.kill('SIGKILL') } catch { /* already dead */ }
  state.sessions.delete(id)
  return true
}
