#!/usr/bin/env npx ts-node
/**
 * AgentTower — Telegram Bot
 *
 * Controls Claude Code sessions from Telegram.
 * Run: BOT_TOKEN=xxx ALLOWED_CHAT_ID=yyy npx ts-node telegram/bot.ts
 */

import fs from 'fs'
import path from 'path'
import os from 'os'
import { spawn } from 'child_process'
import { getRecentSessions, parseJsonlFile, getClaudeDir, decodeProjectPath, findSessionProjectCwd } from '../lib/claude-fs'
import { scanClaudeSessions, getProcessState } from '../lib/process'

// ── Config ─────────────────────────────────────────────────────────────────

const BOT_TOKEN      = process.env.BOT_TOKEN ?? ''
const ALLOWED_CHAT   = process.env.ALLOWED_CHAT_ID ? Number(process.env.ALLOWED_CHAT_ID) : null
const POLL_INTERVAL  = 1_000   // ms between JSONL polls when streaming
const EDIT_THROTTLE  = 1_500   // ms between Telegram message edits (rate limit safety)
const MAX_MSG_LEN    = 4000    // Telegram message char limit (actual 4096, leave margin)

if (!BOT_TOKEN) {
  console.error('BOT_TOKEN is required')
  process.exit(1)
}

// ── Telegram API helpers ───────────────────────────────────────────────────

const API = `https://api.telegram.org/bot${BOT_TOKEN}`

async function tg(method: string, body: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(`${API}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const json = await res.json() as { ok: boolean; result?: unknown; description?: string }
  if (!json.ok) console.error(`Telegram error [${method}]:`, json.description)
  return json.result
}

async function sendMsg(chatId: number, text: string, extra: Record<string, unknown> = {}): Promise<{ message_id: number } | null> {
  return tg('sendMessage', {
    chat_id: chatId,
    text: text.slice(0, MAX_MSG_LEN),
    parse_mode: 'MarkdownV2',
    ...extra,
  }) as Promise<{ message_id: number } | null>
}

async function editMsg(chatId: number, msgId: number, text: string): Promise<void> {
  await tg('editMessageText', {
    chat_id: chatId,
    message_id: msgId,
    text: text.slice(0, MAX_MSG_LEN),
    parse_mode: 'MarkdownV2',
  })
}

// Escape special MarkdownV2 chars
function md(s: string): string {
  return s.replace(/[_*[\]()~`>#+=|{}.!\\-]/g, '\\$&')
}

// Truncate long text for display
function truncate(s: string, n = 300): string {
  return s.length > n ? s.slice(0, n) + '…' : s
}

// ── Auth guard ─────────────────────────────────────────────────────────────

function allowed(chatId: number): boolean {
  if (!ALLOWED_CHAT) return true // open if not configured
  return chatId === ALLOWED_CHAT
}

// ── Session streaming ──────────────────────────────────────────────────────

interface StreamState {
  sessionId: string
  filepath: string
  chatId: number
  msgId: number          // Telegram message being edited
  messageCount: number   // non-meta messages delivered so far
  lastEdit: number       // timestamp of last edit
  buffer: string         // accumulated text for current assistant message
  done: boolean
}

const activeStreams = new Map<string, StreamState>() // sessionId → state

async function startStreaming(chatId: number, sessionId: string, filepath: string) {
  if (activeStreams.has(sessionId)) return

  const initial = parseJsonlFile(filepath).filter(m => !m.isMeta)
  const placeholder = await sendMsg(chatId, md('⏳ Waiting for Claude\\.\\.\\.'))
  if (!placeholder) return

  const state: StreamState = {
    sessionId, filepath, chatId,
    msgId: placeholder.message_id,
    messageCount: initial.length,
    lastEdit: 0,
    buffer: '',
    done: false,
  }
  activeStreams.set(sessionId, state)

  pollStream(state)
}

async function pollStream(state: StreamState) {
  const MAX_POLLS = 600 // 10 min max
  let polls = 0

  while (!state.done && polls < MAX_POLLS) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL))
    polls++

    const all = parseJsonlFile(state.filepath).filter(m => !m.isMeta)
    const newMsgs = all.slice(state.messageCount)
    if (newMsgs.length === 0) {
      // Check if Claude process is still alive
      const running = scanClaudeSessions(getClaudeDir())
      const proc = running[state.sessionId]
      if (!proc && polls > 5) {
        // Process died — flush and finish
        state.done = true
        break
      }
      continue
    }

    for (const msg of newMsgs) {
      state.messageCount++

      if (msg.type === 'assistant') {
        // Build formatted reply
        let parts: string[] = []
        for (const block of msg.content) {
          if (block.type === 'text' && block.text) {
            parts.push(md(block.text))
          }
          if (block.type === 'tool_use') {
            const inputStr = JSON.stringify(block.tool_input ?? {}, null, 2)
            parts.push(
              `\n⚙ \`${md(block.tool_name ?? '')}\`\n` +
              `\`\`\`\n${md(truncate(inputStr, 200))}\n\`\`\``
            )
          }
          if (block.type === 'tool_result') {
            const resultText = block.tool_result?.map(b => b.text ?? '').join('\n') ?? ''
            if (block.is_error) {
              parts.push(`\n✗ _${md(truncate(resultText, 100))}_`)
            }
            // Skip successful tool results to keep output clean
          }
          if (block.type === 'thinking') {
            parts.push(`\n💭 _${md(truncate(block.thinking ?? '', 150))}_`)
          }
        }

        const text = parts.join('\n').trim()
        if (!text) continue

        // Throttle edits
        const now = Date.now()
        const wait = EDIT_THROTTLE - (now - state.lastEdit)
        if (wait > 0) await new Promise(r => setTimeout(r, wait))

        await editMsg(state.chatId, state.msgId, text)
        state.lastEdit = Date.now()
        state.buffer = text

      } else if (msg.type === 'user' && !msg.isMeta) {
        // User message injected mid-session — acknowledge
        await sendMsg(state.chatId, `📨 ${md(truncate(
          msg.content.find(b => b.type === 'text')?.text ?? '', 100
        ))}`)

        // Start a new message for Claude's next reply
        const next = await sendMsg(state.chatId, md('⏳ Claude is thinking\\.\\.\\.'))
        if (next) state.msgId = next.message_id
        state.lastEdit = 0
      }
    }
  }

  activeStreams.delete(state.sessionId)

  // Final status
  const running = scanClaudeSessions(getClaudeDir())
  const proc = running[state.sessionId]
  const status = proc ? getProcessState(proc.pid) : 'dead'

  await sendMsg(state.chatId,
    status === 'dead'
      ? `✅ *Session complete*\n\nReply to continue, or /sessions to see all sessions\\.`
      : `⏸ *Session paused* \\(PID ${proc?.pid}\\)`
  )
}

// ── Command handlers ────────────────────────────────────────────────────────

async function handleStart(chatId: number) {
  await sendMsg(chatId, [
    `🗼 *AgentTower Bot*`,
    ``,
    `Control your Claude Code sessions from Telegram\\.`,
    ``,
    `*Commands:*`,
    `/sessions \\— list recent sessions`,
    `/task \\<prompt\\> \\— start a new Claude session`,
    `/status \\— show running sessions`,
    `/kill \\<id\\> \\— kill a running session`,
    `/pause \\<id\\> \\— pause a session`,
    `/resume \\<id\\> \\— resume a paused session`,
    `/watch \\<id\\> \\— stream output from a session`,
    ``,
    `You can also *reply to any message* to send input to the active session\\.`,
  ].join('\n'))
}

async function handleSessions(chatId: number) {
  const recent = getRecentSessions(10)
  if (recent.length === 0) {
    await sendMsg(chatId, md('No sessions found. Use /task to start one.'))
    return
  }
  const running = scanClaudeSessions(getClaudeDir())

  const lines = recent.map(s => {
    const proc = running[s.sessionId]
    const state = proc ? getProcessState(proc.pid) : 'dead'
    const icon = state === 'running' ? '🟢' : state === 'paused' ? '🟡' : '⚫'
    const age = relTime(s.mtime)
    const prompt = truncate(s.firstPrompt, 60)
    return `${icon} \`${s.sessionId.slice(0, 8)}\` *${md(s.projectDisplayName)}* \\(${md(age)}\\)\n   _${md(prompt)}_`
  })

  await sendMsg(chatId, `*Recent Sessions:*\n\n${lines.join('\n\n')}`)
}

async function handleStatus(chatId: number) {
  const running = scanClaudeSessions(getClaudeDir())
  const procs = Object.values(running)
  if (procs.length === 0) {
    await sendMsg(chatId, md('No active Claude processes right now.'))
    return
  }
  const lines = procs.map(p => {
    const state = getProcessState(p.pid)
    const icon = state === 'running' ? '🟢' : state === 'paused' ? '🟡' : '⚫'
    return `${icon} \`${p.sessionId.slice(0, 8)}\` PID:${p.pid} \\— _${md(path.basename(p.cwd))}_`
  })
  await sendMsg(chatId, `*Running sessions:*\n\n${lines.join('\n')}`)
}

async function handleTask(chatId: number, prompt: string) {
  if (!prompt.trim()) {
    await sendMsg(chatId, md('Usage: /task <your prompt>'))
    return
  }

  // Default to home dir as project dir
  const projectPath = process.env.PROJECTS_DIR ?? os.homedir()

  await sendMsg(chatId, `🚀 *Starting session\\.\\.\\.*\n\n_${md(truncate(prompt, 100))}_`)

  const proc = spawn('claude', ['--dangerously-skip-permissions', '-p', prompt], {
    cwd: projectPath,
    detached: true,
    stdio: 'ignore',
  })
  proc.unref()

  // Wait for session file to appear
  await new Promise(r => setTimeout(r, 2000))

  // Find the newest session
  const recent = getRecentSessions(3)
  const newest = recent[0]
  if (!newest) {
    await sendMsg(chatId, md('Session started but could not find session file yet. Use /sessions to check.'))
    return
  }

  await startStreaming(chatId, newest.sessionId, newest.filepath)
}

async function handleTaskWithProject(chatId: number, projectPath: string, prompt: string) {
  try {
    const stat = fs.statSync(projectPath)
    if (!stat.isDirectory()) throw new Error()
  } catch {
    await sendMsg(chatId, md(`Invalid project path: ${projectPath}`))
    return
  }

  await sendMsg(chatId, `🚀 *Starting session in \`${md(path.basename(projectPath))}\`\\.\\.\\.*`)

  const proc = spawn('claude', ['--dangerously-skip-permissions', '-p', prompt], {
    cwd: projectPath, detached: true, stdio: 'ignore',
  })
  proc.unref()

  await new Promise(r => setTimeout(r, 2000))
  const recent = getRecentSessions(3)
  const newest = recent.find(s => {
    try { return decodeProjectPath(s.projectDirName) === projectPath } catch { return false }
  }) ?? recent[0]

  if (newest) await startStreaming(chatId, newest.sessionId, newest.filepath)
}

async function handleWatch(chatId: number, sessionIdPrefix: string) {
  const recent = getRecentSessions(20)
  const session = recent.find(s => s.sessionId.startsWith(sessionIdPrefix))
  if (!session) {
    await sendMsg(chatId, md(`No session found matching: ${sessionIdPrefix}`))
    return
  }
  await sendMsg(chatId, `👁 *Watching \`${md(session.sessionId.slice(0, 8))}\`*`)
  await startStreaming(chatId, session.sessionId, session.filepath)
}

async function handleKill(chatId: number, sessionIdPrefix: string) {
  const running = scanClaudeSessions(getClaudeDir())
  const entry = Object.values(running).find(p => p.sessionId.startsWith(sessionIdPrefix))
  if (!entry) {
    await sendMsg(chatId, md(`No running session found matching: ${sessionIdPrefix}`))
    return
  }
  try {
    process.kill(entry.pid, 'SIGTERM')
    await sendMsg(chatId, `✅ Killed session \`${md(entry.sessionId.slice(0, 8))}\` \\(PID ${entry.pid}\\)`)
  } catch {
    await sendMsg(chatId, md('Failed to kill process.'))
  }
}

async function handlePause(chatId: number, sessionIdPrefix: string) {
  const running = scanClaudeSessions(getClaudeDir())
  const entry = Object.values(running).find(p => p.sessionId.startsWith(sessionIdPrefix))
  if (!entry) { await sendMsg(chatId, md('Session not found.')); return }
  try {
    process.kill(entry.pid, 'SIGSTOP')
    await sendMsg(chatId, `⏸ Paused \`${md(entry.sessionId.slice(0, 8))}\``)
  } catch {
    await sendMsg(chatId, md('Failed to pause.'))
  }
}

async function handleResume(chatId: number, sessionIdPrefix: string) {
  const running = scanClaudeSessions(getClaudeDir())
  const entry = Object.values(running).find(p => p.sessionId.startsWith(sessionIdPrefix))
  if (!entry) { await sendMsg(chatId, md('Session not found.')); return }
  try {
    process.kill(entry.pid, 'SIGCONT')
    await sendMsg(chatId, `▶ Resumed \`${md(entry.sessionId.slice(0, 8))}\``)
    // Resume streaming if there's an active stream
    if (!activeStreams.has(entry.sessionId)) {
      const recent = getRecentSessions(20)
      const s = recent.find(r => r.sessionId === entry.sessionId)
      if (s) await startStreaming(chatId, s.sessionId, s.filepath)
    }
  } catch {
    await sendMsg(chatId, md('Failed to resume.'))
  }
}

// Handle plain text reply — inject into the most recent active session
async function handleReply(chatId: number, text: string) {
  const running = scanClaudeSessions(getClaudeDir())
  const active = Object.values(running).find(p => getProcessState(p.pid) === 'running')

  if (!active) {
    // No running session — start a new task
    await handleTask(chatId, text)
    return
  }

  await sendMsg(chatId, `📨 _Sending to session \`${md(active.sessionId.slice(0, 8))}\`\\.\\.\\._`)

  const proc = spawn('claude', ['--resume', active.sessionId, '-p', text], {
    detached: true, stdio: 'ignore',
  })
  proc.unref()

  // Resume streaming to this chat
  if (!activeStreams.has(active.sessionId)) {
    const recent = getRecentSessions(20)
    const s = recent.find(r => r.sessionId === active.sessionId)
    if (s) await startStreaming(chatId, active.sessionId, s.filepath)
  }
}

// ── Long polling loop ──────────────────────────────────────────────────────

async function poll() {
  let offset = 0
  console.log('🗼 AgentTower Telegram Bot started')

  while (true) {
    try {
      const updates = await fetch(`${API}/getUpdates?offset=${offset}&timeout=30`).then(r => r.json()) as {
        ok: boolean
        result: Array<{
          update_id: number
          message?: {
            message_id: number
            chat: { id: number; type: string }
            from?: { id: number; first_name: string }
            text?: string
            reply_to_message?: { message_id: number }
          }
        }>
      }

      if (!updates.ok) { await new Promise(r => setTimeout(r, 5000)); continue }

      for (const update of updates.result) {
        offset = update.update_id + 1
        const msg = update.message
        if (!msg?.text) continue

        const chatId = msg.chat.id
        if (!allowed(chatId)) {
          await sendMsg(chatId, md('Unauthorized.'))
          continue
        }

        const text = msg.text.trim()

        // Route commands
        if (text.startsWith('/start'))    { await handleStart(chatId); continue }
        if (text.startsWith('/sessions')) { await handleSessions(chatId); continue }
        if (text.startsWith('/status'))   { await handleStatus(chatId); continue }

        if (text.startsWith('/task ')) {
          const parts = text.slice(6).trim().split('\n')
          const maybePath = parts[0]
          // If first word looks like an absolute path, treat as project dir
          if (maybePath.startsWith('/') && parts.length > 1) {
            await handleTaskWithProject(chatId, maybePath, parts.slice(1).join('\n'))
          } else {
            await handleTask(chatId, text.slice(6).trim())
          }
          continue
        }

        if (text.startsWith('/watch '))  { await handleWatch(chatId, text.slice(7).trim()); continue }
        if (text.startsWith('/kill '))   { await handleKill(chatId, text.slice(6).trim()); continue }
        if (text.startsWith('/pause '))  { await handlePause(chatId, text.slice(7).trim()); continue }
        if (text.startsWith('/resume ')) { await handleResume(chatId, text.slice(8).trim()); continue }

        // Plain text or reply — inject into active session
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

// ── Start ──────────────────────────────────────────────────────────────────

poll()
