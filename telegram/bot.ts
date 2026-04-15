#!/usr/bin/env npx ts-node
/**
 * AgentTower — Telegram Bot
 *
 * Controls Claude Code sessions from Telegram.
 * Run: BOT_TOKEN=xxx ALLOWED_CHAT_IDS=yyy,zzz npx ts-node telegram/bot.ts
 */

import fs from 'fs'
import path from 'path'
import os from 'os'
import { spawn, execFile } from 'child_process'
import { promisify } from 'util'
import {
  getRecentSessions,
  parseJsonlFile,
  getClaudeDir,
  decodeProjectPath,
  findSessionProjectCwd,
} from '../lib/claude-fs'
import { scanClaudeSessions, getProcessState } from '../lib/process'
import { resolveTelegramRuntimeConfig } from '../lib/integrations'

const execFileP = promisify(execFile)

// ── Config ─────────────────────────────────────────────────────────────────

const BOT_TOKEN     = process.env.BOT_TOKEN ?? ''
const POLL_INTERVAL = 1_000   // ms between JSONL polls when streaming
const EDIT_THROTTLE = 1_500   // ms between Telegram message edits
const MAX_MSG_LEN   = 3800    // safe under Telegram 4096
const RATE_LIMIT    = { max: 60, windowMs: 60_000 }  // 60 cmds / min / user
const STATE_PATH    = path.join(os.homedir(), '.claude', 'agenttower-bot.json')
const AUDIT_PATH    = path.join(os.homedir(), '.claude', 'agenttower-audit.jsonl')
const UPLOAD_DIR    = path.join(os.tmpdir(), 'agenttower-uploads')
const CONFIG_RELOAD_MS = 5_000

// Runtime config (allowed ids, openai key, projects dir) reloaded every
// CONFIG_RELOAD_MS from ~/.claude/agenttower-integrations.json + env.
let runtime = resolveTelegramRuntimeConfig()
setInterval(() => { runtime = resolveTelegramRuntimeConfig() }, CONFIG_RELOAD_MS)

if (!BOT_TOKEN) {
  console.error('BOT_TOKEN is required')
  process.exit(1)
}

fs.mkdirSync(UPLOAD_DIR, { recursive: true })

// ── Persisted state ────────────────────────────────────────────────────────

interface PersistedState {
  userDefaults: Record<string, { cwd?: string }>   // chatId → prefs
}

function loadState(): PersistedState {
  try { return JSON.parse(fs.readFileSync(STATE_PATH, 'utf-8')) as PersistedState } catch {}
  return { userDefaults: {} }
}
function saveState(s: PersistedState) {
  try { fs.writeFileSync(STATE_PATH, JSON.stringify(s, null, 2)) } catch {}
}
const state = loadState()

function userCwd(chatId: number): string {
  return state.userDefaults[String(chatId)]?.cwd
    ?? runtime.projectsDir
    ?? os.homedir()
}
function setUserCwd(chatId: number, cwd: string) {
  state.userDefaults[String(chatId)] ??= {}
  state.userDefaults[String(chatId)].cwd = cwd
  saveState(state)
}

// ── Audit log ──────────────────────────────────────────────────────────────

function audit(chatId: number, user: string, action: string, detail: Record<string, unknown> = {}) {
  try {
    fs.appendFileSync(
      AUDIT_PATH,
      JSON.stringify({ ts: new Date().toISOString(), chatId, user, action, ...detail }) + '\n'
    )
  } catch {}
}

// ── Rate limiting ──────────────────────────────────────────────────────────

const rateBuckets = new Map<number, number[]>()
function rateLimited(chatId: number): boolean {
  const now = Date.now()
  const bucket = (rateBuckets.get(chatId) ?? []).filter(t => now - t < RATE_LIMIT.windowMs)
  if (bucket.length >= RATE_LIMIT.max) {
    rateBuckets.set(chatId, bucket)
    return true
  }
  bucket.push(now)
  rateBuckets.set(chatId, bucket)
  return false
}

// ── Telegram API helpers ───────────────────────────────────────────────────

const API = `https://api.telegram.org/bot${BOT_TOKEN}`

type TgResp<T = unknown> = { ok: boolean; result?: T; description?: string }

async function tg<T = unknown>(method: string, body: Record<string, unknown>): Promise<T | null> {
  try {
    const res = await fetch(`${API}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const json = await res.json() as TgResp<T>
    if (!json.ok) console.error(`Telegram error [${method}]:`, json.description)
    return json.result ?? null
  } catch (err) {
    console.error(`Telegram fetch failed [${method}]:`, err)
    return null
  }
}

interface TgMessage { message_id: number; chat: { id: number } }

async function sendMsg(
  chatId: number,
  text: string,
  extra: Record<string, unknown> = {},
): Promise<TgMessage | null> {
  // Split long messages, keep reply_markup only on the last chunk
  const chunks = chunkText(text, MAX_MSG_LEN)
  let last: TgMessage | null = null
  for (let i = 0; i < chunks.length; i++) {
    const isLast = i === chunks.length - 1
    last = await tg<TgMessage>('sendMessage', {
      chat_id: chatId,
      text: chunks[i],
      parse_mode: 'HTML',
      ...(isLast ? extra : {}),
    })
  }
  return last
}

async function editMsg(chatId: number, msgId: number, text: string, extra: Record<string, unknown> = {}): Promise<void> {
  await tg('editMessageText', {
    chat_id: chatId,
    message_id: msgId,
    text: text.slice(0, MAX_MSG_LEN),
    parse_mode: 'HTML',
    ...extra,
  })
}

async function answerCallback(id: string, text?: string): Promise<void> {
  await tg('answerCallbackQuery', { callback_query_id: id, ...(text ? { text } : {}) })
}

async function sendChatAction(chatId: number, action = 'typing') {
  await tg('sendChatAction', { chat_id: chatId, action })
}

async function downloadFile(fileId: string, destDir: string, filename?: string): Promise<string | null> {
  const fileInfo = await tg<{ file_path?: string }>('getFile', { file_id: fileId })
  if (!fileInfo?.file_path) return null
  try {
    const res = await fetch(`https://api.telegram.org/file/bot${BOT_TOKEN}/${fileInfo.file_path}`)
    if (!res.ok) return null
    const buf = Buffer.from(await res.arrayBuffer())
    const name = filename ?? path.basename(fileInfo.file_path)
    const dest = path.join(destDir, `${Date.now()}_${name}`)
    fs.writeFileSync(dest, buf)
    return dest
  } catch (err) {
    console.error('download failed:', err)
    return null
  }
}

// Escape HTML special chars (for plain text in HTML parse mode)
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// Convert Claude markdown to Telegram HTML
function claudeHtml(text: string): string {
  // Escape HTML first, then convert markdown constructs
  let s = esc(text)
  // Fenced code blocks: ```lang\ncode\n``` → <pre>code</pre>
  s = s.replace(/```[^\n]*\n([\s\S]*?)```/g, (_m, code) => `<pre>${code}</pre>`)
  // Inline code: `code` → <code>code</code>
  s = s.replace(/`([^`]+)`/g, (_m, code) => `<code>${code}</code>`)
  // Bold: **text** → <b>text</b>
  s = s.replace(/\*\*([^*]+)\*\*/g, (_m, inner) => `<b>${inner}</b>`)
  // Italic: *text* or _text_ → <i>text</i>
  s = s.replace(/\*([^*]+)\*/g, (_m, inner) => `<i>${inner}</i>`)
  s = s.replace(/_([^_]+)_/g, (_m, inner) => `<i>${inner}</i>`)
  return s
}

function truncate(s: string, n = 300): string {
  return s.length > n ? s.slice(0, n) + '…' : s
}

function chunkText(s: string, size: number): string[] {
  if (s.length <= size) return [s]
  const chunks: string[] = []
  let rest = s
  while (rest.length > size) {
    // Prefer split on newline, then space
    let cut = rest.lastIndexOf('\n', size)
    if (cut < size / 2) cut = rest.lastIndexOf(' ', size)
    if (cut < size / 2) cut = size
    chunks.push(rest.slice(0, cut))
    rest = rest.slice(cut).replace(/^\s+/, '')
  }
  if (rest) chunks.push(rest)
  return chunks
}

// ── Auth guard ─────────────────────────────────────────────────────────────

function allowed(chatId: number): boolean {
  if (runtime.allowedChatIds.size === 0) return true
  return runtime.allowedChatIds.has(chatId)
}

// ── Inline keyboard builders ───────────────────────────────────────────────

interface Btn { text: string; callback_data: string }

function sessionKeyboard(sessionId: string, running: boolean, paused: boolean) {
  const short = sessionId.slice(0, 8)
  const rows: Btn[][] = []
  if (running && !paused) {
    rows.push([
      { text: '⏸ Pause',  callback_data: `pause:${short}` },
      { text: '✕ Kill',   callback_data: `kill:${short}` },
      { text: '👁 Watch', callback_data: `watch:${short}` },
    ])
  } else if (paused) {
    rows.push([
      { text: '▶ Resume', callback_data: `resume:${short}` },
      { text: '✕ Kill',   callback_data: `kill:${short}` },
    ])
  } else {
    rows.push([
      { text: '🔁 Resume chat', callback_data: `continue:${short}` },
      { text: '👁 Replay',      callback_data: `watch:${short}` },
    ])
  }
  rows.push([
    { text: '📜 Logs', callback_data: `logs:${short}` },
    { text: '🔀 Diff', callback_data: `diff:${short}` },
  ])
  return { reply_markup: { inline_keyboard: rows } }
}

// ── Pending attachments ────────────────────────────────────────────────────
// When a user uploads a file without a caption, we stash it and the next
// text message gets the attachment appended as context.

const pendingAttachments = new Map<number, string[]>() // chatId → file paths

function queueAttachment(chatId: number, filepath: string) {
  const list = pendingAttachments.get(chatId) ?? []
  list.push(filepath)
  pendingAttachments.set(chatId, list)
}

function consumeAttachments(chatId: number): string[] {
  const list = pendingAttachments.get(chatId) ?? []
  pendingAttachments.delete(chatId)
  return list
}

function attachmentPreamble(files: string[]): string {
  if (files.length === 0) return ''
  const list = files.map(f => `- ${f}`).join('\n')
  return `Attached files (paths on this machine, you may Read them):\n${list}\n\n`
}

// ── Session streaming ──────────────────────────────────────────────────────

interface StreamState {
  sessionId: string
  filepath: string
  chatId: number
  msgId: number
  messageCount: number
  lastEdit: number
  buffer: string
  done: boolean
  silent: boolean    // don't post completion notice (for logs/replay)
  notifyOnEnd: boolean
}

const activeStreams = new Map<string, StreamState>() // sessionId → state

async function startStreaming(
  chatId: number,
  sessionId: string,
  filepath: string,
  opts: { silent?: boolean; notifyOnEnd?: boolean } = {}
) {
  if (activeStreams.has(sessionId)) return

  const initial = parseJsonlFile(filepath).filter(m => !m.isMeta)
  const placeholder = await sendMsg(chatId, '⏳ Waiting for Claude...')
  if (!placeholder) return

  const s: StreamState = {
    sessionId, filepath, chatId,
    msgId: placeholder.message_id,
    messageCount: initial.length,
    lastEdit: 0,
    buffer: '',
    done: false,
    silent: opts.silent ?? false,
    notifyOnEnd: opts.notifyOnEnd ?? true,
  }
  activeStreams.set(sessionId, s)
  pollStream(s)
}

const IDLE_TIMEOUT_MS = 5 * 60 * 1000  // 5 minutes of no new messages

async function pollStream(s: StreamState) {
  const MAX_POLLS = 3600 // 60 min absolute ceiling
  let polls = 0
  let lastActivityAt = Date.now()

  while (!s.done && polls < MAX_POLLS) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL))
    polls++

    const all = parseJsonlFile(s.filepath).filter(m => !m.isMeta)
    const newMsgs = all.slice(s.messageCount)
    if (newMsgs.length === 0) {
      const idleMs = Date.now() - lastActivityAt
      const running = scanClaudeSessions(getClaudeDir())
      const dead = !running[s.sessionId]
      // Only end after 5 min of no new messages AND process is gone
      if (dead && idleMs >= IDLE_TIMEOUT_MS) { s.done = true; break }
      continue
    }

    lastActivityAt = Date.now()

    for (const msg of newMsgs) {
      s.messageCount++

      if (msg.type === 'assistant') {
        const parts: string[] = []
        for (const block of msg.content) {
          if (block.type === 'text' && block.text) parts.push(claudeHtml(block.text))
          if (block.type === 'tool_use') {
            parts.push(`\n⚙ <code>${esc(block.tool_name ?? '')}</code>`)
          }
          if (block.type === 'tool_result') {
            const resultText = block.tool_result?.map(b => b.text ?? '').join('\n') ?? ''
            if (block.is_error) parts.push(`\n✗ <i>${esc(truncate(resultText, 100))}</i>`)
          }
          if (block.type === 'thinking') {
            parts.push(`\n💭 <i>${esc(truncate(block.thinking ?? '', 150))}</i>`)
          }
        }

        const text = parts.join('\n').trim()
        if (!text) continue

        const now = Date.now()
        const wait = EDIT_THROTTLE - (now - s.lastEdit)
        if (wait > 0) await new Promise(r => setTimeout(r, wait))

        // If the assembled text would blow the edit limit, start a fresh message
        if (text.length > MAX_MSG_LEN) {
          const fresh = await sendMsg(s.chatId, text)
          if (fresh) s.msgId = fresh.message_id
        } else {
          await editMsg(s.chatId, s.msgId, text)
        }
        s.lastEdit = Date.now()
        s.buffer = text

      } else if (msg.type === 'user' && !msg.isMeta) {
        await sendMsg(s.chatId, `📨 ${esc(truncate(
          msg.content.find(b => b.type === 'text')?.text ?? '', 100
        ))}`)
        const next = await sendMsg(s.chatId, '⏳ Claude is thinking...')
        if (next) s.msgId = next.message_id
        s.lastEdit = 0
      }
    }
  }

  activeStreams.delete(s.sessionId)

  if (s.silent) return

  const running = scanClaudeSessions(getClaudeDir())
  const proc = running[s.sessionId]
  const status = proc ? getProcessState(proc.pid) : 'dead'

  if (status === 'dead') {
    await sendMsg(
      s.chatId,
      `✅ <b>Session complete</b>\n\nReply to continue, or /sessions to see all.`,
      sessionKeyboard(s.sessionId, false, false),
    )
  } else {
    await sendMsg(
      s.chatId,
      `⏸ <b>Session paused</b> (PID ${proc?.pid})`,
      sessionKeyboard(s.sessionId, true, true),
    )
  }
}

// ── Lost-session watcher ───────────────────────────────────────────────────
// Detects sessions that finish while no one is streaming, and notifies
// ALLOWED chats (so you get pinged when an overnight task completes).

const seenRunning = new Map<string, { chatId: number; cwd: string }>()

function notifyChats(text: string, extra: Record<string, unknown> = {}) {
  const ids = runtime.allowedChatIds.size > 0 ? [...runtime.allowedChatIds] : []
  for (const id of ids) sendMsg(id, text, extra)
}

setInterval(() => {
  const running = scanClaudeSessions(getClaudeDir())
  // Track new
  for (const [id, p] of Object.entries(running)) {
    if (!seenRunning.has(id)) seenRunning.set(id, { chatId: 0, cwd: p.cwd })
  }
  // Detect finished
  for (const [id, info] of seenRunning) {
    if (running[id]) continue
    seenRunning.delete(id)
    if (activeStreams.has(id)) continue // already reported via stream
    const short = id.slice(0, 8)
    notifyChats(
      `🔔 <b>Session finished</b> <code>${esc(short)}</code>\n<i>${esc(path.basename(info.cwd))}</i>`,
      sessionKeyboard(id, false, false),
    )
  }
}, 5_000)

// ── Command handlers ───────────────────────────────────────────────────────

async function handleStart(chatId: number) {
  await sendMsg(chatId, [
    `🗼 <b>AgentTower Bot</b>`,
    ``,
    `Control Claude Code sessions from Telegram.`,
    ``,
    `<b>Tasks</b>`,
    `/task &lt;prompt&gt; — start a new session (skip permissions)`,
    `/safetask &lt;prompt&gt; — start with default permissions`,
    `/plan &lt;prompt&gt; — start in plan mode (read-only)`,
    ``,
    `<b>Navigation</b>`,
    `/sessions — list recent sessions (with buttons)`,
    `/status — running sessions`,
    `/logs &lt;id&gt; [n] — last n messages from a session`,
    `/diff &lt;id&gt; — git diff in the session's cwd`,
    ``,
    `<b>Control</b>`,
    `/kill /pause /resume /watch &lt;id&gt;`,
    ``,
    `<b>Settings</b>`,
    `/cd &lt;path&gt; — set default project dir`,
    `/pwd — show your default dir`,
    `/whoami — show your chat id`,
    ``,
    `<b>Extras</b>`,
    `Upload a file (doc / photo / voice) — next message uses it as context.`,
    `Voice messages get transcribed if OPENAI_API_KEY is set.`,
    ``,
    `Plain text reply injects into the most recent running session.`,
  ].join('\n'))
}

async function handleSessions(chatId: number) {
  const recent = getRecentSessions(10)
  if (recent.length === 0) {
    await sendMsg(chatId, 'No sessions found. Use /task to start one.')
    return
  }
  const running = scanClaudeSessions(getClaudeDir())

  await sendMsg(chatId, `<b>Recent Sessions</b> (tap a session for controls)`)

  for (const s of recent) {
    const proc = running[s.sessionId]
    const pstate = proc ? getProcessState(proc.pid) : 'dead'
    const icon = pstate === 'running' ? '🟢' : pstate === 'paused' ? '🟡' : '⚫'
    const age = relTime(s.mtime)
    const prompt = truncate(s.firstPrompt, 80)
    const short = s.sessionId.slice(0, 8)

    await sendMsg(
      chatId,
      `${icon} <b>${esc(s.projectDisplayName)}</b> (${esc(age)})\n<i>${esc(prompt)}</i>`,
      sessionKeyboard(s.sessionId, pstate === 'running' || pstate === 'paused', pstate === 'paused'),
    )
  }
}

async function handleStatus(chatId: number) {
  const running = scanClaudeSessions(getClaudeDir())
  const procs = Object.values(running)
  if (procs.length === 0) {
    await sendMsg(chatId, 'No active Claude processes.')
    return
  }
  for (const p of procs) {
    const pstate = getProcessState(p.pid)
    const icon = pstate === 'running' ? '🟢' : pstate === 'paused' ? '🟡' : '⚫'
    await sendMsg(
      chatId,
      `${icon} PID:${p.pid}\n<i>${esc(path.basename(p.cwd))}</i>`,
      sessionKeyboard(p.sessionId, true, pstate === 'paused'),
    )
  }
}

type TaskMode = 'default' | 'skip' | 'plan'

async function spawnTask(
  chatId: number,
  projectPath: string,
  prompt: string,
  mode: TaskMode,
) {
  try {
    if (!fs.statSync(projectPath).isDirectory()) throw new Error()
  } catch {
    await sendMsg(chatId, `Invalid project path: ${esc(projectPath)}`)
    return
  }

  const modeLabel = mode === 'skip' ? '⚡' : mode === 'plan' ? '📋' : '🔒'
  await sendMsg(chatId, `${modeLabel} <b>Starting</b> in <code>${esc(path.basename(projectPath))}</code>\n<i>${esc(truncate(prompt, 100))}</i>`)
  await sendChatAction(chatId)

  const args = ['-p', prompt]
  if (mode === 'skip') args.unshift('--dangerously-skip-permissions')
  if (mode === 'plan') args.unshift('--permission-mode', 'plan')

  const proc = spawn('claude', args, { cwd: projectPath, detached: true, stdio: 'ignore' })
  proc.unref()

  await new Promise(r => setTimeout(r, 2000))
  const recent = getRecentSessions(5)
  const newest = recent.find(s => {
    try { return decodeProjectPath(s.projectDirName) === projectPath } catch { return false }
  }) ?? recent[0]

  if (!newest) {
    await sendMsg(chatId, 'Session started but session file not found yet. Try /sessions.')
    return
  }
  await startStreaming(chatId, newest.sessionId, newest.filepath)
}

async function handleTask(chatId: number, rawPrompt: string, mode: TaskMode) {
  const prompt = rawPrompt.trim()
  if (!prompt) {
    await sendMsg(chatId, 'Usage: /task &lt;prompt&gt;  (optionally starts with /abs/path)')
    return
  }

  // First token may be an absolute path overriding the default cwd
  const parts = prompt.split('\n')
  const first = parts[0].trim()
  let projectPath = userCwd(chatId)
  let promptBody = prompt

  if (first.startsWith('/') && parts.length > 1) {
    projectPath = first
    promptBody = parts.slice(1).join('\n').trim()
  }

  const attachments = consumeAttachments(chatId)
  if (attachments.length > 0) {
    promptBody = attachmentPreamble(attachments) + promptBody
  }

  await spawnTask(chatId, projectPath, promptBody, mode)
}

async function handleWatch(chatId: number, sessionIdPrefix: string) {
  const recent = getRecentSessions(30)
  const session = recent.find(s => s.sessionId.startsWith(sessionIdPrefix))
  if (!session) {
    await sendMsg(chatId, `No session found matching: ${esc(sessionIdPrefix)}`)
    return
  }
  await sendMsg(chatId, `👁 <b>Watching</b> <code>${esc(session.sessionId.slice(0, 8))}</code>`)
  await startStreaming(chatId, session.sessionId, session.filepath)
}

async function handleKill(chatId: number, sessionIdPrefix: string) {
  const running = scanClaudeSessions(getClaudeDir())
  const entry = Object.values(running).find(p => p.sessionId.startsWith(sessionIdPrefix))
  if (!entry) { await sendMsg(chatId, `No running session: ${esc(sessionIdPrefix)}`); return }
  try {
    process.kill(entry.pid, 'SIGTERM')
    await sendMsg(chatId, `✅ Killed <code>${esc(entry.sessionId.slice(0, 8))}</code> (PID ${entry.pid})`)
  } catch {
    await sendMsg(chatId, 'Failed to kill process.')
  }
}

async function handlePause(chatId: number, sessionIdPrefix: string) {
  const running = scanClaudeSessions(getClaudeDir())
  const entry = Object.values(running).find(p => p.sessionId.startsWith(sessionIdPrefix))
  if (!entry) { await sendMsg(chatId, 'Session not found.'); return }
  try {
    process.kill(entry.pid, 'SIGSTOP')
    await sendMsg(chatId, `⏸ Paused <code>${esc(entry.sessionId.slice(0, 8))}</code>`)
  } catch { await sendMsg(chatId, 'Failed to pause.') }
}

async function handleResume(chatId: number, sessionIdPrefix: string) {
  const running = scanClaudeSessions(getClaudeDir())
  const entry = Object.values(running).find(p => p.sessionId.startsWith(sessionIdPrefix))
  if (!entry) { await sendMsg(chatId, 'Session not found.'); return }
  try {
    process.kill(entry.pid, 'SIGCONT')
    await sendMsg(chatId, `▶ Resumed <code>${esc(entry.sessionId.slice(0, 8))}</code>`)
    if (!activeStreams.has(entry.sessionId)) {
      const recent = getRecentSessions(30)
      const s = recent.find(r => r.sessionId === entry.sessionId)
      if (s) await startStreaming(chatId, s.sessionId, s.filepath)
    }
  } catch { await sendMsg(chatId, 'Failed to resume.') }
}

async function handleLogs(chatId: number, prefix: string, nStr: string) {
  const n = Math.min(Math.max(parseInt(nStr, 10) || 5, 1), 20)
  const recent = getRecentSessions(30)
  const s = recent.find(x => x.sessionId.startsWith(prefix))
  if (!s) { await sendMsg(chatId, `No session: ${esc(prefix)}`); return }

  const msgs = parseJsonlFile(s.filepath).filter(m => !m.isMeta).slice(-n)
  if (msgs.length === 0) { await sendMsg(chatId, 'No messages.'); return }

  const lines: string[] = [`<b>Last ${msgs.length} messages</b>`, '']
  for (const m of msgs) {
    const role = m.type === 'user' ? '👤' : '🤖'

    // Build block list, collapsing consecutive tool_use with the same name
    const blocks: string[] = []
    let toolRun: { name: string; count: number } | null = null
    for (const b of m.content) {
      if (b.type === 'tool_use') {
        const name = b.tool_name ?? 'Tool'
        if (toolRun && toolRun.name === name) {
          toolRun.count++
        } else {
          if (toolRun) blocks.push(toolRun.count > 1 ? `⚙ ${toolRun.name} ×${toolRun.count}` : `⚙ ${toolRun.name}`)
          toolRun = { name, count: 1 }
        }
      } else {
        if (toolRun) {
          blocks.push(toolRun.count > 1 ? `⚙ ${toolRun.name} ×${toolRun.count}` : `⚙ ${toolRun.name}`)
          toolRun = null
        }
        if (b.type === 'text' && b.text) blocks.push(b.text)
        if (b.type === 'thinking') blocks.push(`💭 ${truncate(b.thinking ?? '', 80)}`)
        if (b.type === 'tool_result' && b.is_error) blocks.push(`✗ error`)
      }
    }
    if (toolRun) blocks.push(toolRun.count > 1 ? `⚙ ${toolRun.name} ×${toolRun.count}` : `⚙ ${toolRun.name}`)

    const text = blocks.filter(Boolean).join(' ')
    lines.push(`${role} ${esc(truncate(text, 400))}`)
  }
  await sendMsg(chatId, lines.join('\n'))
}

async function handleDiff(chatId: number, prefix: string) {
  const recent = getRecentSessions(30)
  const s = recent.find(x => x.sessionId.startsWith(prefix))
  if (!s) { await sendMsg(chatId, `No session: ${esc(prefix)}`); return }

  const cwd = findSessionProjectCwd(s.sessionId)
  if (!cwd) { await sendMsg(chatId, 'Could not resolve session cwd.'); return }

  try {
    const { stdout } = await execFileP('git', ['diff', '--stat', 'HEAD'], { cwd, maxBuffer: 2_000_000 })
    const { stdout: full } = await execFileP('git', ['diff', 'HEAD'], { cwd, maxBuffer: 10_000_000 })
    const summary = stdout.trim() || '(no changes)'
    await sendMsg(chatId, `<b>Diff for</b> <code>${esc(s.sessionId.slice(0, 8))}</code>\n<pre>${esc(summary)}</pre>`)
    if (full.trim()) {
      // Send as file to avoid escaping hell
      await sendAsFile(chatId, full, `${s.sessionId.slice(0, 8)}.diff`)
    }
  } catch (err) {
    const msg = (err as Error).message
    await sendMsg(chatId, `✗ ${esc(truncate(msg, 300))}`)
  }
}

async function sendAsFile(chatId: number, content: string, filename: string) {
  const tmp = path.join(UPLOAD_DIR, `${Date.now()}_${filename}`)
  fs.writeFileSync(tmp, content)
  try {
    const form = new FormData()
    form.append('chat_id', String(chatId))
    form.append('document', new Blob([fs.readFileSync(tmp)]), filename)
    await fetch(`${API}/sendDocument`, { method: 'POST', body: form })
  } catch (err) {
    console.error('sendDocument failed:', err)
  } finally {
    try { fs.unlinkSync(tmp) } catch {}
  }
}

async function handleCd(chatId: number, arg: string) {
  const p = arg.trim()
  if (!p) { await sendMsg(chatId, `Current: <code>${esc(userCwd(chatId))}</code>`); return }
  try {
    if (!fs.statSync(p).isDirectory()) throw new Error()
  } catch {
    await sendMsg(chatId, `Not a directory: ${esc(p)}`)
    return
  }
  setUserCwd(chatId, p)
  await sendMsg(chatId, `✅ Default dir set to <code>${esc(p)}</code>`)
}

async function handlePwd(chatId: number) {
  await sendMsg(chatId, `📁 <code>${esc(userCwd(chatId))}</code>`)
}

async function handleWhoami(chatId: number) {
  await sendMsg(chatId, `Your chat id: <code>${chatId}</code>`)
}

// Plain text reply — inject into active session
async function handleReply(chatId: number, text: string) {
  const running = scanClaudeSessions(getClaudeDir())
  const active = Object.values(running).find(p => getProcessState(p.pid) === 'running')

  const attachments = consumeAttachments(chatId)
  const body = attachmentPreamble(attachments) + text

  if (!active) {
    await handleTask(chatId, body, 'skip')
    return
  }

  await sendMsg(chatId, `📨 <i>Sending to session <code>${esc(active.sessionId.slice(0, 8))}</code>...</i>`)

  const proc = spawn('claude', ['--resume', active.sessionId, '-p', body], {
    cwd: active.cwd, detached: true, stdio: 'ignore',
  })
  proc.unref()

  if (!activeStreams.has(active.sessionId)) {
    const recent = getRecentSessions(20)
    const s = recent.find(r => r.sessionId === active.sessionId)
    if (s) await startStreaming(chatId, active.sessionId, s.filepath)
  }
}

// ── File uploads ───────────────────────────────────────────────────────────

async function handleIncomingFile(
  chatId: number,
  fileId: string,
  filename: string,
  isVoice: boolean,
  caption?: string,
) {
  await sendChatAction(chatId, 'typing')
  const dest = await downloadFile(fileId, UPLOAD_DIR, filename)
  if (!dest) {
    await sendMsg(chatId, 'Failed to download file.')
    return
  }

  if (isVoice) {
    const transcript = await transcribeVoice(dest)
    if (transcript) {
      await sendMsg(chatId, `🎙 <i>${esc(truncate(transcript, 300))}</i>`)
      await handleReply(chatId, transcript)
      return
    }
    await sendMsg(chatId, 'Voice received but transcription unavailable (set OPENAI_API_KEY).')
    queueAttachment(chatId, dest)
    return
  }

  if (caption?.trim()) {
    const attachments = [dest, ...consumeAttachments(chatId)]
    pendingAttachments.set(chatId, attachments)
    await handleReply(chatId, caption.trim())
    return
  }

  queueAttachment(chatId, dest)
  await sendMsg(
    chatId,
    `📎 Attached <code>${esc(path.basename(dest))}</code>\nYour next message will include it as context.`,
  )
}

async function transcribeVoice(filepath: string): Promise<string | null> {
  const key = runtime.openaiApiKey
  if (!key) return null
  try {
    const form = new FormData()
    form.append('file', new Blob([fs.readFileSync(filepath)]), path.basename(filepath))
    form.append('model', 'whisper-1')
    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}` },
      body: form,
    })
    if (!res.ok) return null
    const json = await res.json() as { text?: string }
    return json.text ?? null
  } catch (err) {
    console.error('whisper failed:', err)
    return null
  }
}

// ── Callback query handling ────────────────────────────────────────────────

async function handleCallback(chatId: number, queryId: string, data: string, user: string) {
  const [action, id] = data.split(':')
  audit(chatId, user, `cb:${action}`, { sessionIdPrefix: id })

  switch (action) {
    case 'kill':   await answerCallback(queryId, 'Killing...'); await handleKill(chatId, id);   break
    case 'pause':  await answerCallback(queryId, 'Pausing...'); await handlePause(chatId, id);  break
    case 'resume': await answerCallback(queryId, 'Resuming...'); await handleResume(chatId, id); break
    case 'watch':  await answerCallback(queryId, 'Watching...'); await handleWatch(chatId, id);  break
    case 'logs':   await answerCallback(queryId);               await handleLogs(chatId, id, '5'); break
    case 'diff':   await answerCallback(queryId, 'Running git diff...'); await handleDiff(chatId, id); break
    case 'continue': {
      await answerCallback(queryId, 'Continuing...')
      const recent = getRecentSessions(30).find(r => r.sessionId.startsWith(id))
      if (!recent) { await sendMsg(chatId, `No session: ${esc(id)}`); return }
      const cwd = findSessionProjectCwd(recent.sessionId) ?? userCwd(chatId)
      await sendMsg(chatId, `🔁 <b>Reply</b> below to continue <code>${esc(id)}</code> in <code>${esc(path.basename(cwd))}</code>`)
      // Spawn a watcher; user's next plain message will be injected by handleReply
      await startStreaming(chatId, recent.sessionId, recent.filepath, { silent: true })
      break
    }
    default:
      await answerCallback(queryId, 'Unknown action')
  }
}

// ── Long polling loop ──────────────────────────────────────────────────────

interface TgUpdate {
  update_id: number
  message?: {
    message_id: number
    chat: { id: number; type: string }
    from?: { id: number; first_name?: string; username?: string }
    text?: string
    caption?: string
    reply_to_message?: { message_id: number }
    document?: { file_id: string; file_name?: string }
    photo?: Array<{ file_id: string; width: number; height: number }>
    voice?: { file_id: string; duration: number }
    audio?: { file_id: string; file_name?: string }
  }
  callback_query?: {
    id: string
    from: { id: number; first_name?: string; username?: string }
    message?: { chat: { id: number }; message_id: number }
    data?: string
  }
}

async function poll() {
  let offset = 0
  console.log('🗼 AgentTower Telegram Bot started')
  if (runtime.allowedChatIds.size > 0) console.log(`   Authorized: ${[...runtime.allowedChatIds].join(', ')}`)
  else console.log('   ⚠️  No allowed chat ids set — open to all')
  if (runtime.openaiApiKey) console.log('   Voice transcription: enabled')
  console.log(`   Config: ~/.claude/agenttower-integrations.json (live-reloads every ${CONFIG_RELOAD_MS / 1000}s)`)

  while (true) {
    try {
      const res = await fetch(`${API}/getUpdates?offset=${offset}&timeout=30&allowed_updates=${encodeURIComponent(JSON.stringify(['message', 'callback_query']))}`)
      const json = await res.json() as { ok: boolean; result: TgUpdate[] }
      if (!json.ok) { await new Promise(r => setTimeout(r, 5000)); continue }

      for (const update of json.result) {
        offset = update.update_id + 1

        // ── Callback queries
        if (update.callback_query) {
          const q = update.callback_query
          const chatId = q.message?.chat.id ?? q.from.id
          const uname = q.from.username ?? q.from.first_name ?? String(q.from.id)
          if (!allowed(chatId)) { await answerCallback(q.id, 'Unauthorized'); continue }
          if (rateLimited(chatId)) { await answerCallback(q.id, 'Rate limited'); continue }
          if (q.data) await handleCallback(chatId, q.id, q.data, uname)
          continue
        }

        // ── Messages
        const msg = update.message
        if (!msg) continue
        const chatId = msg.chat.id
        const uname = msg.from?.username ?? msg.from?.first_name ?? String(msg.from?.id ?? 0)

        if (!allowed(chatId)) {
          audit(chatId, uname, 'denied', {})
          await sendMsg(chatId, `Unauthorized. Your chat id: <code>${chatId}</code>`)
          continue
        }
        if (rateLimited(chatId)) {
          await sendMsg(chatId, '⏱ Rate limit reached. Slow down.')
          continue
        }

        // ── File / voice / photo
        if (msg.voice) {
          audit(chatId, uname, 'voice', { duration: msg.voice.duration })
          await handleIncomingFile(chatId, msg.voice.file_id, 'voice.ogg', true, msg.caption)
          continue
        }
        if (msg.document) {
          audit(chatId, uname, 'document', { name: msg.document.file_name })
          await handleIncomingFile(chatId, msg.document.file_id, msg.document.file_name ?? 'file', false, msg.caption)
          continue
        }
        if (msg.photo && msg.photo.length > 0) {
          // Biggest photo
          const biggest = msg.photo.reduce((a, b) => a.width * a.height > b.width * b.height ? a : b)
          audit(chatId, uname, 'photo', {})
          await handleIncomingFile(chatId, biggest.file_id, 'photo.jpg', false, msg.caption)
          continue
        }
        if (msg.audio) {
          audit(chatId, uname, 'audio', {})
          await handleIncomingFile(chatId, msg.audio.file_id, msg.audio.file_name ?? 'audio', false, msg.caption)
          continue
        }

        // ── Text commands
        const text = msg.text?.trim() ?? ''
        if (!text) continue

        audit(chatId, uname, 'msg', { text: text.slice(0, 200) })

        const matchCmd = (cmd: string) => text === cmd || text.startsWith(cmd + ' ')
        const args = (cmd: string) => text.slice(cmd.length).trim()

        if (matchCmd('/start') || matchCmd('/help')) { await handleStart(chatId); continue }
        if (matchCmd('/sessions'))                   { await handleSessions(chatId); continue }
        if (matchCmd('/status'))                     { await handleStatus(chatId); continue }
        if (matchCmd('/whoami'))                     { await handleWhoami(chatId); continue }
        if (matchCmd('/pwd'))                        { await handlePwd(chatId); continue }
        if (matchCmd('/cd'))                         { await handleCd(chatId, args('/cd')); continue }

        if (matchCmd('/task'))      { await handleTask(chatId, args('/task'), 'skip'); continue }
        if (matchCmd('/safetask'))  { await handleTask(chatId, args('/safetask'), 'default'); continue }
        if (matchCmd('/plan'))      { await handleTask(chatId, args('/plan'), 'plan'); continue }

        if (matchCmd('/watch'))  { await handleWatch(chatId, args('/watch')); continue }
        if (matchCmd('/kill'))   { await handleKill(chatId, args('/kill')); continue }
        if (matchCmd('/pause'))  { await handlePause(chatId, args('/pause')); continue }
        if (matchCmd('/resume')) { await handleResume(chatId, args('/resume')); continue }

        if (matchCmd('/logs')) {
          const [id, n = '5'] = args('/logs').split(/\s+/)
          await handleLogs(chatId, id, n)
          continue
        }
        if (matchCmd('/diff')) { await handleDiff(chatId, args('/diff')); continue }

        // Plain text — inject into active session
        await handleReply(chatId, text)
      }
    } catch (err) {
      console.error('Poll error:', err)
      await new Promise(r => setTimeout(r, 3000))
    }
  }
}

// ── Utils ──────────────────────────────────────────────────────────────────

function relTime(ms: number): string {
  const d = Date.now() - ms
  if (d < 60_000) return 'just now'
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m ago`
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h ago`
  return `${Math.floor(d / 86_400_000)}d ago`
}

// Graceful shutdown
process.on('SIGINT', () => { console.log('\nShutting down.'); process.exit(0) })
process.on('SIGTERM', () => process.exit(0))

// ── Start ──────────────────────────────────────────────────────────────────

poll()
