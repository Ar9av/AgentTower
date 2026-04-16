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
  pinnedStatus?: Record<string, number>             // chatId → message_id
  activeSession?: Record<string, string>            // chatId → sessionId (which session receives replies)
  briefingHour?: number                             // 0-23 UTC (default 9)
  lastBriefingDate?: string                         // YYYY-MM-DD of last sent
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

function getActiveSessionId(chatId: number): string | null {
  return state.activeSession?.[String(chatId)] ?? null
}
function setActiveSessionId(chatId: number, sessionId: string | null) {
  state.activeSession ??= {}
  if (sessionId) {
    state.activeSession[String(chatId)] = sessionId
  } else {
    delete state.activeSession[String(chatId)]
  }
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
  silent = false,
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
      ...(silent ? { disable_notification: true } : {}),
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
      { text: '💬 Resume Chat', callback_data: `continue:${short}` },
      { text: '📜 Last 10', callback_data: `logs10:${short}` },
    ])
    rows.push([
      { text: '📜 Last Instruction', callback_data: `lastuser:${short}` },
      { text: '🔀 Diff', callback_data: `diff:${short}` },
    ])
    return { reply_markup: { inline_keyboard: rows } }
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

// ── Smart completion summary ───────────────────────────────────────────────

function sessionJsonlPath(sessionId: string): string | null {
  const projectsDir = path.join(getClaudeDir(), 'projects')
  try {
    for (const d of fs.readdirSync(projectsDir)) {
      const f = path.join(projectsDir, d, `${sessionId}.jsonl`)
      if (fs.existsSync(f)) return f
    }
  } catch {}
  return null
}

async function buildCompletionSummary(sessionId: string, cwd: string): Promise<string> {
  const lines: string[] = []
  const short = sessionId.slice(0, 8)
  const projectName = path.basename(cwd)

  lines.push(`✅ <b>Session complete</b>`)
  lines.push(`📁 <code>${esc(projectName)}</code>  <code>${esc(short)}</code>`)

  // Duration: use JSONL file create vs mtime
  const fp = sessionJsonlPath(sessionId)
  if (fp) {
    try {
      const stat = fs.statSync(fp)
      const durationMs = stat.mtimeMs - stat.birthtimeMs
      if (durationMs > 0) {
        const mins = Math.round(durationMs / 60_000)
        lines.push(`⏱ ${mins < 1 ? '&lt;1' : mins}m`)
      }
    } catch {}
  }

  // Git diff stat
  try {
    const { stdout } = await execFileP('git', ['diff', '--stat', '--no-color', 'HEAD'], { cwd, timeout: 5000, maxBuffer: 500_000 })
    const statLine = stdout.trim().split('\n').pop()?.trim()
    if (statLine && statLine.includes('changed')) {
      lines.push(`📊 ${esc(statLine)}`)
    }
  } catch {}

  // Claude's last message
  if (fp) {
    try {
      const msgs = parseJsonlFile(fp).filter(m => !m.isMeta && m.type === 'assistant')
      const last = msgs[msgs.length - 1]
      if (last) {
        const textParts = last.content.filter(b => b.type === 'text').map(b => b.text ?? '')
        const text = textParts.join(' ').trim()
        if (text) {
          lines.push('')
          lines.push(`🤖 ${esc(truncate(text, 350))}`)
        }
      }
    } catch {}
  }

  return lines.join('\n')
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
          const fresh = await sendMsg(s.chatId, text, {}, true)
          if (fresh) s.msgId = fresh.message_id
        } else {
          await editMsg(s.chatId, s.msgId, text)
        }
        s.lastEdit = Date.now()
        s.buffer = text

      } else if (msg.type === 'user' && !msg.isMeta) {
        await sendMsg(s.chatId, `📨 ${esc(truncate(
          msg.content.find(b => b.type === 'text')?.text ?? '', 100
        ))}`, {}, true)
        const next = await sendMsg(s.chatId, '⏳ Claude is thinking...', {}, true)
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
    const cwd = findSessionProjectCwd(s.sessionId) ?? ''
    const summary = cwd ? await buildCompletionSummary(s.sessionId, cwd) : `✅ <b>Session complete</b>`
    await sendMsg(s.chatId, summary, sessionKeyboard(s.sessionId, false, false))
    updatePinnedStatuses()
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
    buildCompletionSummary(id, info.cwd).then(summary => {
      notifyChats(summary, sessionKeyboard(id, false, false))
      updatePinnedStatuses()
    })
  }
}, 5_000)

// ── Stale-session watcher ──────────────────────────────────────────────────
// Notifies when a session is running but its JSONL hasn't seen new activity
// in STALE_THRESHOLD_MS. Fires once per stall; resets when activity resumes,
// so the same session can alert again if it gets stuck later.

const STALE_THRESHOLD_MS = 10 * 60 * 1000   // 10 minutes
const STALE_CHECK_MS     = 60 * 1000        // check every minute
const staleNotified = new Map<string, number>()   // sessionId → mtime at time of notify

function sessionJsonlMtime(sessionId: string, cwd: string): number {
  // Locate the session's JSONL under ~/.claude/projects/<encoded-cwd>/<sid>.jsonl
  const projectsDir = path.join(getClaudeDir(), 'projects')
  try {
    for (const d of fs.readdirSync(projectsDir)) {
      const f = path.join(projectsDir, d, `${sessionId}.jsonl`)
      if (fs.existsSync(f)) return fs.statSync(f).mtimeMs
    }
  } catch {}
  return 0
}

setInterval(() => {
  const running = scanClaudeSessions(getClaudeDir())
  const now = Date.now()
  for (const [id, p] of Object.entries(running)) {
    // Skip sessions we're actively streaming — user can already see activity.
    if (activeStreams.has(id)) { staleNotified.delete(id); continue }
    const mtime = sessionJsonlMtime(id, p.cwd)
    if (!mtime) continue
    const idleMs = now - mtime
    // Reset notification state when activity resumes.
    const lastNotifiedMtime = staleNotified.get(id)
    if (lastNotifiedMtime && mtime > lastNotifiedMtime) staleNotified.delete(id)
    if (idleMs < STALE_THRESHOLD_MS) continue
    if (staleNotified.has(id)) continue   // already warned for this stall
    staleNotified.set(id, mtime)
    const short = id.slice(0, 8)
    const mins = Math.round(idleMs / 60_000)
    notifyChats(
      `⚠️ <b>Session idle</b> for ${mins}m\n<code>${esc(short)}</code>  <i>${esc(path.basename(p.cwd))}</i>\nStill running — may be stuck or waiting on a tool.`,
      sessionKeyboard(id, true, false),
    )
  }
  // Garbage-collect entries for sessions no longer running.
  for (const id of staleNotified.keys()) {
    if (!running[id]) staleNotified.delete(id)
  }
}, STALE_CHECK_MS)

// ── /live auto-updating dashboard ──────────────────────────────────────────

// Track which sessions are being live-streamed per chat so /stoplive can stop them
const liveStreamChats = new Map<number, string>()  // chatId → sessionId being streamed

async function handleLive(chatId: number) {
  const running = scanClaudeSessions(getClaudeDir())
  const entries = Object.entries(running)
  const now = Date.now()

  if (entries.length === 0) {
    await sendMsg(chatId, '📡 <b>Running Sessions</b>\n\n✨ No sessions running right now.')
    return
  }

  await sendMsg(chatId, `📡 <b>Running Sessions</b>  (${entries.length})\n\nTap a button to interact:`)

  for (const [id, p] of entries) {
    const short = id.slice(0, 8)
    const pstate = getProcessState(p.pid)
    const icon = pstate === 'paused' ? '🟡 Paused' : '🟢 Running'
    const mtime = sessionJsonlMtime(id, p.cwd)
    const idle = mtime ? Math.floor((now - mtime) / 60_000) : 0
    const stale = idle >= 10 ? ' ⚠️' : ''
    const idleStr = idle > 0 ? `idle ${idle}m` : 'active now'

    const buttons: Btn[][] = [
      [
        { text: '📡 Go Live', callback_data: `golive:${short}` },
        { text: '💬 Chat', callback_data: `chat:${short}` },
        { text: '📜 Last 5', callback_data: `logs5:${short}` },
      ],
      [
        { text: '⏸ Pause', callback_data: `pause:${short}` },
        { text: '✕ Kill', callback_data: `kill:${short}` },
        { text: '🔀 Diff', callback_data: `diff:${short}` },
      ],
    ]

    await sendMsg(
      chatId,
      `${icon}${stale}\n📁 <b>${esc(path.basename(p.cwd))}</b>  <code>${esc(short)}</code>\n${idleStr}  ·  PID:${p.pid}`,
      { reply_markup: { inline_keyboard: buttons } },
    )
  }
}

async function handleStopLive(chatId: number) {
  const streamingId = liveStreamChats.get(chatId)
  if (!streamingId) {
    await sendMsg(chatId, 'No active live stream to stop.')
    return
  }
  const stream = activeStreams.get(streamingId)
  if (stream) stream.done = true
  liveStreamChats.delete(chatId)
  await sendMsg(chatId, `⏹ Stopped live stream for <code>${esc(streamingId.slice(0, 8))}</code>`)
}

async function handleGoLive(chatId: number, sessionIdPrefix: string) {
  // Stop any existing live stream for this chat
  const prev = liveStreamChats.get(chatId)
  if (prev) {
    const prevStream = activeStreams.get(prev)
    if (prevStream) prevStream.done = true
  }

  const recent = getRecentSessions(50)
  const session = recent.find(s => s.sessionId.startsWith(sessionIdPrefix))
  if (!session) {
    await sendMsg(chatId, `Session not found: <code>${esc(sessionIdPrefix)}</code>`)
    return
  }

  liveStreamChats.set(chatId, session.sessionId)
  await sendMsg(chatId, `📡 <b>Live</b> — <b>${esc(session.projectDisplayName)}</b> <code>${esc(sessionIdPrefix)}</code>\n<i>Use /stoplive to stop streaming.</i>`)
  await startStreaming(chatId, session.sessionId, session.filepath)
  // Clean up when stream ends naturally
  liveStreamChats.delete(chatId)
}

async function handleChat(chatId: number, sessionIdPrefix: string) {
  // Stop any live stream first
  const prev = liveStreamChats.get(chatId)
  if (prev) {
    const prevStream = activeStreams.get(prev)
    if (prevStream) prevStream.done = true
    liveStreamChats.delete(chatId)
  }

  const recent = getRecentSessions(50)
  const session = recent.find(s => s.sessionId.startsWith(sessionIdPrefix))
  if (!session) {
    await sendMsg(chatId, `Session not found: <code>${esc(sessionIdPrefix)}</code>`)
    return
  }

  // Show last 5 messages as context
  const msgs = parseJsonlFile(session.filepath).filter(m => !m.isMeta).slice(-5)
  const lines: string[] = [`💬 <b>${esc(session.projectDisplayName)}</b>  <code>${esc(sessionIdPrefix)}</code>\n`]
  for (const m of msgs) {
    const role = m.type === 'user' ? '👤' : '🤖'
    const text = m.content.filter(b => b.type === 'text').map(b => b.text ?? '').join(' ')
    const tools = m.content.filter(b => b.type === 'tool_use').map(b => `⚙${b.tool_name ?? ''}`).join(' ')
    const combined = [text, tools].filter(Boolean).join(' ')
    if (combined) lines.push(`${role} ${esc(truncate(combined, 200))}`)
  }
  lines.push('')
  lines.push(`<i>Type your message below — it will be sent to this session.</i>`)

  // Set as active session
  setActiveSessionId(chatId, session.sessionId)
  updatePinnedStatuses()

  await sendMsg(chatId, lines.join('\n'), {
    reply_markup: { inline_keyboard: [[
      { text: '📡 Go Live', callback_data: `golive:${sessionIdPrefix}` },
      { text: '📜 Last 10', callback_data: `logs10:${sessionIdPrefix}` },
      { text: '⏹ Stop', callback_data: `kill:${sessionIdPrefix}` },
    ]] },
  })
}

// ── Pinned control center ─────────────────────────────────────────────────

function buildStatusText(chatId?: number): string {
  const running = scanClaudeSessions(getClaudeDir())
  const entries = Object.entries(running)
  const now = Date.now()
  const activeId = chatId ? getActiveSessionId(chatId) : null

  if (entries.length === 0) {
    // Show active session context even when nothing is running
    let activeInfo = ''
    if (activeId) {
      const recent = getRecentSessions(50)
      const match = recent.find(r => r.sessionId === activeId)
      if (match) activeInfo = `\n💬 Active: <b>${esc(match.projectDisplayName)}</b> <code>${esc(activeId.slice(0, 8))}</code>\n<i>Plain text resumes this session.</i>`
    }
    if (!activeInfo) activeInfo = `\n💬 No active session.\n<i>Plain text goes to ~/brain.</i>`
    return `🗼 <b>Control Center</b>\n\n✨ No running sessions.${activeInfo}\n\n<i>${new Date().toLocaleTimeString('en', { hour12: false })}</i>`
  }

  const rows: string[] = [`🗼 <b>Control Center</b>  (${entries.length} active)\n`]
  for (const [id, p] of entries) {
    const pstate = getProcessState(p.pid)
    const icon = pstate === 'paused' ? '🟡 Paused' : '🟢 Running'
    const mtime = sessionJsonlMtime(id, p.cwd)
    const idle = mtime ? Math.floor((now - mtime) / 60_000) : 0
    const stale = idle >= 10 ? ' ⚠️' : ''
    const isActive = activeId === id || (!activeId && entries.indexOf([id, p]) === 0)
    const chatIcon = isActive ? '💬' : ''
    rows.push(`${icon}${stale} ${chatIcon}`)
    rows.push(`📁 <b>${esc(path.basename(p.cwd))}</b>  <code>${esc(id.slice(0, 8))}</code>`)
    if (idle > 0) rows.push(`⏱ idle ${idle}m`)
    if (isActive) rows.push(`<i>↑ replies go here</i>`)
    rows.push('')
  }
  rows.push(`<i>Updated ${new Date().toLocaleTimeString('en', { hour12: false })}</i>`)
  return rows.join('\n')
}

function buildStatusKeyboard(): { reply_markup: { inline_keyboard: Btn[][] } } {
  const running = scanClaudeSessions(getClaudeDir())
  const entries = Object.entries(running)
  const rows: Btn[][] = []

  // Switch buttons per running session
  for (const [id, p] of entries) {
    const short = id.slice(0, 8)
    const name = path.basename(p.cwd)
    rows.push([
      { text: `💬 Chat: ${name}`, callback_data: `switch:${short}` },
      { text: `👁 Watch`, callback_data: `watch:${short}` },
      { text: `✕ Kill`, callback_data: `kill:${short}` },
    ])
  }
  rows.push([
    { text: '🔄 Refresh', callback_data: 'quick:status' },
    { text: '📜 Last 10', callback_data: 'last:' },
  ])
  return { reply_markup: { inline_keyboard: rows } }
}

async function handlePinnedStatus(chatId: number) {
  const text = buildStatusText(chatId)
  const kb = buildStatusKeyboard()
  const msg = await sendMsg(chatId, text, kb)
  if (!msg) return

  // Pin the message
  await tg('pinChatMessage', { chat_id: chatId, message_id: msg.message_id, disable_notification: true })

  // Persist
  state.pinnedStatus ??= {}
  state.pinnedStatus[String(chatId)] = msg.message_id
  saveState(state)
}

function updatePinnedStatuses() {
  if (!state.pinnedStatus) return
  for (const [chatIdStr, msgId] of Object.entries(state.pinnedStatus)) {
    const chatId = parseInt(chatIdStr, 10)
    const text = buildStatusText(chatId)
    const kb = buildStatusKeyboard()
    editMsg(chatId, msgId, text, kb).catch(() => {
      delete state.pinnedStatus![chatIdStr]
      saveState(state)
    })
  }
}

// Update pinned statuses every 30s
setInterval(updatePinnedStatuses, 30_000)

// ── Daily morning briefing ────────────────────────────────────────────────

function getBriefingHour(): number {
  return state.briefingHour ?? 9  // default 9 UTC
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10)
}

async function sendBriefing() {
  const recent = getRecentSessions(50)
  const running = scanClaudeSessions(getClaudeDir())
  const now = Date.now()
  const dayMs = 24 * 60 * 60 * 1000

  const completedToday = recent.filter(s => !s.isActive && now - s.mtime < dayMs)
  const activeNow = Object.entries(running)

  const lines: string[] = [`☀️ <b>Daily Briefing</b>\n`]

  // Running sessions
  if (activeNow.length > 0) {
    lines.push(`🟢 <b>${activeNow.length} running</b>`)
    for (const [id, p] of activeNow) {
      const mtime = sessionJsonlMtime(id, p.cwd)
      const idle = mtime ? Math.floor((now - mtime) / 60_000) : 0
      const stale = idle >= 10 ? ' ⚠️ idle' : ''
      lines.push(`  • <b>${esc(path.basename(p.cwd))}</b> <code>${esc(id.slice(0, 8))}</code>${stale}`)
    }
    lines.push('')
  } else {
    lines.push(`✨ No running sessions.\n`)
  }

  // Completed in last 24h
  if (completedToday.length > 0) {
    lines.push(`✅ <b>${completedToday.length} completed</b> in last 24h`)
    for (const s of completedToday.slice(0, 10)) {
      lines.push(`  • ${esc(s.projectDisplayName)} — ${esc(truncate(s.firstPrompt, 60))}`)
    }
    if (completedToday.length > 10) lines.push(`  <i>…and ${completedToday.length - 10} more</i>`)
    lines.push('')
  } else {
    lines.push(`No sessions completed in the last 24h.\n`)
  }

  // Stale warnings
  const staleList = activeNow.filter(([id, p]) => {
    const mtime = sessionJsonlMtime(id, p.cwd)
    return mtime ? (now - mtime >= STALE_THRESHOLD_MS) : false
  })
  if (staleList.length > 0) {
    lines.push(`⚠️ <b>${staleList.length} stale</b> (idle >10m) — may need attention`)
  }

  lines.push(`\n/live — auto-updating dashboard`)
  lines.push(`/sessions — full session list`)

  const text = lines.join('\n')
  notifyChats(text)

  state.lastBriefingDate = todayStr()
  saveState(state)
}

async function handleRecent(chatId: number) {
  const recent = getRecentSessions(5)
  const running = scanClaudeSessions(getClaudeDir())

  if (recent.length === 0) {
    await sendMsg(chatId, '📋 <b>Recent Sessions</b>\n\nNo sessions found. Use /task to start one.')
    return
  }

  await sendMsg(chatId, `📋 <b>Recent Sessions</b>  (last ${recent.length})`)

  for (const s of recent) {
    const short = s.sessionId.slice(0, 8)
    const proc = running[s.sessionId]
    const pstate = proc ? getProcessState(proc.pid) : 'dead'
    const isRunning = pstate === 'running' || pstate === 'paused'
    const isPaused = pstate === 'paused'
    const icon = pstate === 'running' ? '🟢 Running' : pstate === 'paused' ? '🟡 Paused' : '⚫ Done'

    const now = Date.now()
    let idleStr = ''
    if (isRunning) {
      const mtime = sessionJsonlMtime(s.sessionId, proc!.cwd)
      const idle = mtime ? Math.floor((now - mtime) / 60_000) : 0
      idleStr = idle > 0 ? `  ·  idle ${idle}m` : '  ·  active'
    } else {
      idleStr = `  ·  ${relTime(s.mtime)}`
    }

    const buttons: Btn[][] = []
    if (isRunning) {
      buttons.push([
        { text: '📡 Go Live', callback_data: `golive:${short}` },
        { text: '💬 Chat', callback_data: `chat:${short}` },
        { text: '📜 Last 5', callback_data: `logs5:${short}` },
      ])
      buttons.push([
        ...(isPaused
          ? [{ text: '▶ Resume', callback_data: `resume:${short}` }]
          : [{ text: '⏸ Pause', callback_data: `pause:${short}` }]),
        { text: '✕ Kill', callback_data: `kill:${short}` },
        { text: '🔀 Diff', callback_data: `diff:${short}` },
      ])
    } else {
      buttons.push([
        { text: '💬 Resume Chat', callback_data: `continue:${short}` },
        { text: '📜 Last 5', callback_data: `logs5:${short}` },
        { text: '🔀 Diff', callback_data: `diff:${short}` },
      ])
    }

    await sendMsg(
      chatId,
      `${icon}\n📁 <b>${esc(s.projectDisplayName)}</b>  <code>${esc(short)}</code>${idleStr}\n<i>${esc(truncate(s.firstPrompt, 80))}</i>`,
      { reply_markup: { inline_keyboard: buttons } },
    )
  }
}

// Check every minute if it's time to send the briefing
setInterval(() => {
  const now = new Date()
  if (now.getUTCHours() !== getBriefingHour()) return
  if (state.lastBriefingDate === todayStr()) return
  sendBriefing()
}, 60_000)

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
    `/research &lt;topic&gt; — research &amp; deliver a report file`,
    ``,
    `<b>Navigation</b>`,
    `/sessions — list recent sessions (with buttons)`,
    `/recent — last 5 sessions with action buttons`,
    `/live — running sessions with Go Live / Chat / Last 5 buttons`,
    `/stoplive — stop streaming a live session`,
    `/status — pinned control center (auto-updates)`,
    `/idle — running sessions sorted by idle time`,
    `/logs &lt;id&gt; [n] — last n messages from a session`,
    `/diff &lt;id&gt; — git diff in the session's cwd`,
    ``,
    `<b>Control</b>`,
    `/quick — quick-action buttons`,
    `/kill /pause /resume /watch &lt;id&gt;`,
    ``,
    `<b>Settings</b>`,
    `/clear — clear active session (plain text → brain)`,
    `/cd &lt;path&gt; — set default project dir`,
    `/pwd — show your default dir`,
    `/whoami — show your chat id`,
    `/briefing [hour] — set daily briefing time (UTC)`,
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

async function handleIdle(chatId: number) {
  const running = scanClaudeSessions(getClaudeDir())
  const now = Date.now()
  const rows: Array<{ id: string; cwd: string; idleMs: number }> = []
  for (const [id, p] of Object.entries(running)) {
    const mtime = sessionJsonlMtime(id, p.cwd)
    if (!mtime) continue
    rows.push({ id, cwd: p.cwd, idleMs: now - mtime })
  }
  if (rows.length === 0) {
    await sendMsg(chatId, 'No running sessions.')
    return
  }
  rows.sort((a, b) => b.idleMs - a.idleMs)
  for (const r of rows) {
    const mins = Math.floor(r.idleMs / 60_000)
    const secs = Math.floor((r.idleMs % 60_000) / 1000)
    const icon = r.idleMs >= STALE_THRESHOLD_MS ? '⚠️' : '🟢'
    await sendMsg(
      chatId,
      `${icon} <code>${esc(r.id.slice(0, 8))}</code>  idle ${mins}m${secs}s\n<i>${esc(path.basename(r.cwd))}</i>`,
      sessionKeyboard(r.id, true, false),
    )
  }
}

async function handleStatus(chatId: number) {
  await handlePinnedStatus(chatId)
}

async function handleQuick(chatId: number) {
  const running = scanClaudeSessions(getClaudeDir())
  const count = Object.keys(running).length

  const rows: Btn[][] = [
    [
      { text: '📡 Live', callback_data: 'quick:live' },
      { text: '📋 Sessions', callback_data: 'quick:sessions' },
      { text: '🗼 Status', callback_data: 'quick:status' },
    ],
    [
      { text: '⏱ Idle', callback_data: 'quick:idle' },
      { text: '📜 Last 10', callback_data: 'last:' },
      { text: '📁 PWD', callback_data: 'quick:pwd' },
    ],
  ]

  // Add running session controls if any
  if (count > 0) {
    const entries = Object.entries(running).slice(0, 3)
    for (const [id, p] of entries) {
      const short = id.slice(0, 8)
      const name = path.basename(p.cwd)
      rows.push([
        { text: `👁 ${name}`, callback_data: `watch:${short}` },
        { text: `⏸ Pause`, callback_data: `pause:${short}` },
        { text: `✕ Kill`, callback_data: `kill:${short}` },
      ])
    }
  }

  await sendMsg(
    chatId,
    `⚡ <b>Quick Actions</b>${count > 0 ? `\n\n🟢 ${count} running` : '\n\n✨ No running sessions'}`,
    { reply_markup: { inline_keyboard: rows } },
  )
}

async function handleClearSession(chatId: number) {
  const prev = getActiveSessionId(chatId)
  if (!prev) {
    await sendMsg(chatId, '💬 No active session set. Plain text goes to ~/brain.')
    return
  }
  const recent = getRecentSessions(50)
  const match = recent.find(r => r.sessionId === prev)
  const name = match?.projectDisplayName ?? prev.slice(0, 8)
  setActiveSessionId(chatId, null)
  updatePinnedStatuses()
  await sendMsg(chatId, `✅ Cleared active session (<b>${esc(name)}</b>).\nPlain text now goes to ~/brain.`)
}

async function handleBriefingConfig(chatId: number, arg: string) {
  const h = parseInt(arg.trim(), 10)
  if (arg.trim() === '') {
    await sendMsg(chatId, `Daily briefing at <b>${getBriefingHour()}:00 UTC</b>.\nUse <code>/briefing 9</code> to change.`)
    return
  }
  if (isNaN(h) || h < 0 || h > 23) {
    await sendMsg(chatId, 'Hour must be 0–23 (UTC).')
    return
  }
  state.briefingHour = h
  saveState(state)
  await sendMsg(chatId, `✅ Daily briefing set to <b>${h}:00 UTC</b>`)
}

// ── /research — universal research task ────────────────────────────────────

const BRAIN_DIR = process.env.BRAIN_DIR ?? path.join(os.homedir(), 'brain')

const RESEARCH_SYSTEM = `You are a research assistant. Your job is to deeply research the given topic, then produce a single comprehensive Markdown file as your deliverable.

Rules:
1. Use WebSearch and WebFetch to gather information from the web. Be thorough — check multiple sources.
2. Write your findings to a .md file in the current directory. Name it descriptively (e.g. "ai-agent-frameworks.md").
3. Structure with headings, tables, bullet points, and code examples where relevant.
4. Include a "Sources" section at the end with URLs.
5. The file IS the deliverable — make it complete, well-organized, and actionable.
6. Do NOT create multiple files. One comprehensive markdown file.`

async function handleResearch(chatId: number, rawPrompt: string) {
  const topic = rawPrompt.trim()
  if (!topic) {
    await sendMsg(chatId, 'Usage: /research &lt;topic&gt;\n\nExample: <code>/research AI agentic frameworks comparison 2025</code>')
    return
  }

  fs.mkdirSync(BRAIN_DIR, { recursive: true })

  const prompt = `${RESEARCH_SYSTEM}\n\n---\n\nResearch topic: ${topic}`

  await sendMsg(chatId, `🔬 <b>Research</b> starting in <code>~/brain</code>\n<i>${esc(truncate(topic, 120))}</i>`)
  await sendChatAction(chatId)

  const proc = spawn('claude', ['--dangerously-skip-permissions', '-p', prompt], {
    cwd: BRAIN_DIR, detached: true, stdio: 'ignore',
  })
  proc.unref()

  await new Promise(r => setTimeout(r, 2000))
  const recent = getRecentSessions(5)
  const newest = recent.find(s => {
    try { return decodeProjectPath(s.projectDirName).endsWith('/brain') } catch { return false }
  }) ?? recent[0]

  if (!newest) {
    await sendMsg(chatId, 'Session started but file not found yet. Try /sessions.')
    return
  }

  setActiveSessionId(chatId, newest.sessionId)
  updatePinnedStatuses()

  // Start streaming, and when it ends, deliver the file
  await startStreaming(chatId, newest.sessionId, newest.filepath)

  // Watch for completion in background — deliver file when done
  watchForDeliverable(chatId, newest.sessionId, BRAIN_DIR)
}

function watchForDeliverable(chatId: number, sessionId: string, dir: string) {
  const startTime = Date.now()
  const seen = new Set<string>()
  // Snapshot existing .md files
  try {
    for (const f of fs.readdirSync(dir)) {
      if (f.endsWith('.md')) seen.add(f)
    }
  } catch {}

  const timer = setInterval(async () => {
    // Stop after 60 min
    if (Date.now() - startTime > 60 * 60 * 1000) { clearInterval(timer); return }

    // Check if session is still running
    const running = scanClaudeSessions(getClaudeDir())
    if (running[sessionId]) return  // still going

    clearInterval(timer)

    // Find new .md files
    let newFiles: string[] = []
    try {
      newFiles = fs.readdirSync(dir)
        .filter(f => f.endsWith('.md') && !seen.has(f))
        .map(f => path.join(dir, f))
    } catch {}

    // Also check for recently modified existing .md files (updated, not new)
    if (newFiles.length === 0) {
      try {
        const cutoff = startTime - 5000  // files modified after task started
        newFiles = fs.readdirSync(dir)
          .filter(f => f.endsWith('.md'))
          .map(f => path.join(dir, f))
          .filter(f => { try { return fs.statSync(f).mtimeMs > cutoff } catch { return false } })
      } catch {}
    }

    if (newFiles.length === 0) {
      await sendMsg(chatId, '📝 Research done but no .md file was created. Check /logs for what happened.')
      return
    }

    // Send each file
    for (const filepath of newFiles) {
      const filename = path.basename(filepath)
      await sendMsg(chatId, `📄 <b>${esc(filename)}</b>`, {}, true)

      // Send as markdown document
      await sendAsFile(chatId, fs.readFileSync(filepath, 'utf-8'), filename)

      // Try PDF conversion via pandoc
      const pdfPath = filepath.replace(/\.md$/, '.pdf')
      try {
        await execFileP('pandoc', [filepath, '-o', pdfPath, '--pdf-engine=wkhtmltopdf', '-V', 'geometry:margin=1in'], { timeout: 30000 })
        if (fs.existsSync(pdfPath)) {
          await sendBinaryFile(chatId, pdfPath, path.basename(pdfPath))
          try { fs.unlinkSync(pdfPath) } catch {}
        }
      } catch {
        // PDF conversion optional — skip if it fails
      }
    }

    await sendMsg(chatId, `✅ Research delivered. Reply with instructions to follow up.`, sessionKeyboard(sessionId, false, false))
  }, 5000)
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
  setActiveSessionId(chatId, newest.sessionId)
  updatePinnedStatuses()
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
  // If no prefix, use the most recent session
  const s = prefix ? recent.find(x => x.sessionId.startsWith(prefix)) : recent[0]
  if (!s) { await sendMsg(chatId, prefix ? `No session: ${esc(prefix)}` : 'No sessions found.'); return }

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

  const short = s.sessionId.slice(0, 8)
  lines.push('')
  lines.push(`<i>${esc(s.projectDisplayName)} · ${esc(short)}</i>`)

  const buttons: Btn[][] = [[
    { text: '📜 Last 5', callback_data: `logs5:${short}` },
    { text: '📜 Last 10', callback_data: `logs10:${short}` },
    { text: '📜 Last 20', callback_data: `logs20:${short}` },
  ], [
    { text: '🔀 Diff', callback_data: `diff:${short}` },
    { text: '👁 Watch', callback_data: `watch:${short}` },
  ]]

  await sendMsg(chatId, lines.join('\n'), { reply_markup: { inline_keyboard: buttons } })
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

async function sendBinaryFile(chatId: number, filepath: string, filename: string) {
  try {
    const form = new FormData()
    form.append('chat_id', String(chatId))
    form.append('document', new Blob([fs.readFileSync(filepath)]), filename)
    await fetch(`${API}/sendDocument`, { method: 'POST', body: form })
  } catch (err) {
    console.error('sendBinaryFile failed:', err)
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
  const allRunning = Object.values(running).filter(p => getProcessState(p.pid) === 'running')

  const attachments = consumeAttachments(chatId)
  const body = attachmentPreamble(attachments) + text

  // Prefer the user's selected active session
  const preferred = getActiveSessionId(chatId)

  // 1. If active session is running → send to it
  const activeRunning = preferred ? allRunning.find(p => p.sessionId === preferred) : null
  if (activeRunning) {
    await sendMsg(chatId, `📨 <i>Sending to <b>${esc(path.basename(activeRunning.cwd))}</b> <code>${esc(activeRunning.sessionId.slice(0, 8))}</code></i>`, {}, true)
    const proc = spawn('claude', ['--resume', activeRunning.sessionId, '-p', body], {
      cwd: activeRunning.cwd, detached: true, stdio: 'ignore',
    })
    proc.unref()
    if (!activeStreams.has(activeRunning.sessionId)) {
      const recent = getRecentSessions(20)
      const s = recent.find(r => r.sessionId === activeRunning.sessionId)
      if (s) await startStreaming(chatId, activeRunning.sessionId, s.filepath)
    }
    return
  }

  // 2. If active session is set but not running → resume it
  if (preferred) {
    const recent = getRecentSessions(50)
    const match = recent.find(r => r.sessionId === preferred)
    if (match) {
      const cwd = findSessionProjectCwd(match.sessionId) ?? userCwd(chatId)
      await sendMsg(chatId, `📨 <i>Resuming <b>${esc(path.basename(cwd))}</b> <code>${esc(preferred.slice(0, 8))}</code></i>`, {}, true)
      const proc = spawn('claude', ['--resume', preferred, '-p', body], {
        cwd, detached: true, stdio: 'ignore',
      })
      proc.unref()
      if (!activeStreams.has(preferred)) {
        await new Promise(r => setTimeout(r, 1500))
        const fresh = getRecentSessions(10)
        const s = fresh.find(r => r.sessionId === preferred) ?? fresh[0]
        if (s) await startStreaming(chatId, s.sessionId, s.filepath)
      }
      return
    }
  }

  // 3. If any session is running but none selected → pick the first
  if (allRunning.length > 0) {
    const active = allRunning[0]
    setActiveSessionId(chatId, active.sessionId)
    await sendMsg(chatId, `📨 <i>Sending to <b>${esc(path.basename(active.cwd))}</b> <code>${esc(active.sessionId.slice(0, 8))}</code></i>`, {}, true)
    const proc = spawn('claude', ['--resume', active.sessionId, '-p', body], {
      cwd: active.cwd, detached: true, stdio: 'ignore',
    })
    proc.unref()
    if (!activeStreams.has(active.sessionId)) {
      const recent = getRecentSessions(20)
      const s = recent.find(r => r.sessionId === active.sessionId)
      if (s) await startStreaming(chatId, active.sessionId, s.filepath)
    }
    return
  }

  // 4. Nothing running, no active session → send to ~/brain
  fs.mkdirSync(BRAIN_DIR, { recursive: true })
  await sendMsg(chatId, `🧠 <i>No active session — sending to <b>brain</b></i>`, {}, true)
  await spawnTask(chatId, BRAIN_DIR, body, 'skip')
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
  // Split on first ':' only — actions like 'quick:live' need full prefix as action
  const colonIdx = data.indexOf(':')
  const action = colonIdx >= 0 ? data.slice(0, colonIdx) : data
  const id = colonIdx >= 0 ? data.slice(colonIdx + 1) : ''
  audit(chatId, user, `cb:${action}`, { sessionIdPrefix: id })

  // Quick-action shortcuts (id = sub-action)
  if (action === 'quick') {
    await answerCallback(queryId)
    switch (id) {
      case 'live':     await handleLive(chatId); break
      case 'sessions': await handleSessions(chatId); break
      case 'status':   await handleStatus(chatId); break
      case 'idle':     await handleIdle(chatId); break
      case 'pwd':      await handlePwd(chatId); break
    }
    return
  }

  switch (action) {
    case 'kill':   await answerCallback(queryId, 'Killing...'); await handleKill(chatId, id);   break
    case 'pause':  await answerCallback(queryId, 'Pausing...'); await handlePause(chatId, id);  break
    case 'resume': await answerCallback(queryId, 'Resuming...'); await handleResume(chatId, id); break
    case 'watch':  await answerCallback(queryId, 'Watching...'); await handleWatch(chatId, id);  break
    case 'golive': await answerCallback(queryId, 'Going live...'); await handleGoLive(chatId, id); break
    case 'chat':   await answerCallback(queryId, 'Loading...');    await handleChat(chatId, id);   break
    case 'logs':   await answerCallback(queryId);               await handleLogs(chatId, id, '5'); break
    case 'logs5':  await answerCallback(queryId);               await handleLogs(chatId, id, '5'); break
    case 'logs10': await answerCallback(queryId);               await handleLogs(chatId, id, '10'); break
    case 'logs20': await answerCallback(queryId);               await handleLogs(chatId, id, '20'); break
    case 'last':   await answerCallback(queryId);               await handleLogs(chatId, '', '10'); break
    case 'lastuser': {
      await answerCallback(queryId)
      const recent = getRecentSessions(50)
      const match = recent.find(r => r.sessionId.startsWith(id))
      if (!match) { await sendMsg(chatId, `Session not found: <code>${esc(id)}</code>`); break }
      const msgs = parseJsonlFile(match.filepath).filter(m => !m.isMeta && m.type === 'user')
      const last = msgs[msgs.length - 1]
      if (!last) { await sendMsg(chatId, 'No user messages found.'); break }
      const text = last.content.filter(b => b.type === 'text').map(b => b.text ?? '').join(' ')
      await sendMsg(chatId, `👤 <b>Last instruction</b> (<code>${esc(id)}</code>)\n\n${esc(truncate(text, 800))}`)
      break
    }
    case 'switch': {
      const recent = getRecentSessions(50)
      const match = recent.find(r => r.sessionId.startsWith(id))
      if (!match) { await answerCallback(queryId, 'Session not found'); break }
      const procs = scanClaudeSessions(getClaudeDir())
      if (!procs[match.sessionId]) { await answerCallback(queryId, 'Session not running'); break }
      setActiveSessionId(chatId, match.sessionId)
      await answerCallback(queryId, `Switched to ${path.basename(findSessionProjectCwd(match.sessionId) ?? '')}`)
      updatePinnedStatuses()
      break
    }
    case 'diff':   await answerCallback(queryId, 'Running git diff...'); await handleDiff(chatId, id); break
    case 'continue': {
      await answerCallback(queryId, 'Loading…')
      const recent = getRecentSessions(50).find(r => r.sessionId.startsWith(id))
      if (!recent) { await sendMsg(chatId, `Session not found: <code>${esc(id)}</code>.\nTry /sessions to see available sessions.`); break }
      const cwd = findSessionProjectCwd(recent.sessionId) ?? userCwd(chatId)

      // Show last 5 messages as context
      const msgs = parseJsonlFile(recent.filepath).filter(m => !m.isMeta).slice(-5)
      const lines: string[] = [`💬 <b>${esc(path.basename(cwd))}</b>  <code>${esc(id)}</code>\n`]
      for (const m of msgs) {
        const role = m.type === 'user' ? '👤' : '🤖'
        const text = m.content.filter(b => b.type === 'text').map(b => b.text ?? '').join(' ')
        const tools = m.content.filter(b => b.type === 'tool_use').map(b => `⚙${b.tool_name ?? ''}`).join(' ')
        const combined = [text, tools].filter(Boolean).join(' ')
        if (combined) lines.push(`${role} ${esc(truncate(combined, 200))}`)
      }
      lines.push('')
      lines.push(`<i>Reply below to continue this session.</i>`)

      // Set this as the active session so handleReply targets it
      setActiveSessionId(chatId, recent.sessionId)
      updatePinnedStatuses()

      await sendMsg(chatId, lines.join('\n'), sessionKeyboard(recent.sessionId, false, false))
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

        // Strip @botname suffix from commands (Telegram appends it when tapped from menu)
        const cleanText = text.replace(/^(\/\w+)@\w+/, '$1')
        const matchCmd = (cmd: string) => cleanText === cmd || cleanText.startsWith(cmd + ' ')
        const args = (cmd: string) => cleanText.slice(cmd.length).trim()

        if (matchCmd('/start') || matchCmd('/help')) { await handleStart(chatId); continue }
        if (matchCmd('/sessions'))                   { await handleSessions(chatId); continue }
        if (matchCmd('/status'))                     { await handleStatus(chatId); continue }
        if (matchCmd('/idle'))                       { await handleIdle(chatId); continue }
        if (matchCmd('/recent'))                     { await handleRecent(chatId); continue }
        if (matchCmd('/live'))                       { await handleLive(chatId); continue }
        if (matchCmd('/stoplive'))                   { await handleStopLive(chatId); continue }
        if (matchCmd('/clear'))                      { await handleClearSession(chatId); continue }
        if (matchCmd('/quick') || matchCmd('/q'))    { await handleQuick(chatId); continue }
        if (matchCmd('/briefing'))                   { await handleBriefingConfig(chatId, args('/briefing')); continue }
        if (matchCmd('/whoami'))                     { await handleWhoami(chatId); continue }
        if (matchCmd('/pwd'))                        { await handlePwd(chatId); continue }
        if (matchCmd('/cd'))                         { await handleCd(chatId, args('/cd')); continue }

        if (matchCmd('/task'))      { await handleTask(chatId, args('/task'), 'skip'); continue }
        if (matchCmd('/safetask'))  { await handleTask(chatId, args('/safetask'), 'default'); continue }
        if (matchCmd('/plan'))      { await handleTask(chatId, args('/plan'), 'plan'); continue }
        if (matchCmd('/research'))  { await handleResearch(chatId, args('/research')); continue }

        if (matchCmd('/watch'))  { await handleWatch(chatId, args('/watch')); continue }
        if (matchCmd('/kill'))   { await handleKill(chatId, args('/kill')); continue }
        if (matchCmd('/pause'))  { await handlePause(chatId, args('/pause')); continue }
        if (matchCmd('/resume')) { await handleResume(chatId, args('/resume')); continue }

        if (matchCmd('/logs')) {
          const parts = args('/logs').split(/\s+/).filter(Boolean)
          const id = parts[0] ?? ''
          const n = parts[1] ?? (id ? '5' : '10')
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

// ── Register bot commands on startup ───────────────────────────────────────

async function registerCommands() {
  await tg('setMyCommands', {
    commands: [
      { command: 'task',      description: 'Start a new Claude session' },
      { command: 'safetask',  description: 'Start with default permissions' },
      { command: 'plan',      description: 'Start in plan/read-only mode' },
      { command: 'research',  description: 'Research a topic → get a report file' },
      { command: 'recent',    description: 'Last 5 sessions with action buttons' },
      { command: 'live',      description: 'Running sessions — Go Live / Chat / Last 5' },
      { command: 'stoplive',  description: 'Stop streaming a live session' },
      { command: 'sessions',  description: 'List recent sessions' },
      { command: 'status',    description: 'Pinned control center' },
      { command: 'idle',      description: 'Sessions sorted by idle time' },
      { command: 'clear',     description: 'Clear active session (→ brain)' },
      { command: 'briefing',  description: 'Configure daily briefing' },
      { command: 'cd',        description: 'Set default project directory' },
      { command: 'pwd',       description: 'Show current default directory' },
      { command: 'help',      description: 'Show all commands' },
    ],
  })
  console.log('   Commands registered with Telegram')
}

// ── Start ──────────────────────────────────────────────────────────────────

registerCommands()
poll()
