#!/usr/bin/env node
/**
 * Daily brief Telegram bot — runs persistently on St3ve.
 * Polls Telegram for messages and handles:
 *   - Numbers/ranges (e.g. "1,3,5" or "1-3"): approve specific tasks
 *   - "all": approve all pending tasks
 *   - "skip": skip today's brief
 *   - "status": show today's task statuses
 *   - "brief": trigger a morning brief now
 *
 * Start with: node daily-bot.mjs
 * Or via pm2: pm2 start daily-bot.mjs --name daily-brief-bot
 */
import { spawn } from 'child_process'
import path from 'path'
import { fileURLToPath } from 'url'
import { loadConfig, atFetch, patchBrief, tgSend, tgGetUpdates, todayStr } from './lib.mjs'
import { executeTask } from './execute-task.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

let lastUpdateId = 0
let cfg = null

async function refreshConfig() {
  try { cfg = await loadConfig() } catch (err) {
    console.error('[daily-bot] Config refresh failed:', err.message)
  }
}

async function getTodayBrief() {
  try {
    const data = await atFetch('/api/daily-brief/history?limit=10')
    const today = todayStr()
    return (data.records ?? []).find(r => r.date === today && r.type === 'morning') ?? null
  } catch { return null }
}

function parseTaskNumbers(text, tasks) {
  const pending = tasks.filter(t => t.status === 'pending')
  if (!pending.length) return []

  const t = text.trim().toLowerCase()
  if (t === 'all') return pending.map(t => t.id)
  if (t === 'skip') return []

  const ids = new Set()
  const parts = t.split(/[,\s]+/)
  for (const part of parts) {
    const rangeMatch = part.match(/^(\d+)-(\d+)$/)
    if (rangeMatch) {
      for (let n = parseInt(rangeMatch[1]); n <= parseInt(rangeMatch[2]); n++) {
        const task = tasks[n - 1]
        if (task?.status === 'pending') ids.add(task.id)
      }
    } else {
      const n = parseInt(part)
      if (!isNaN(n) && n >= 1 && n <= tasks.length) {
        const task = tasks[n - 1]
        if (task?.status === 'pending') ids.add(task.id)
      }
    }
  }
  return [...ids]
}

async function handleMessage(msg) {
  const chatId = msg.chat?.id
  if (!chatId) return

  // Only respond to allowed chats
  await refreshConfig()
  if (!cfg) return
  const allowedId = parseInt(cfg.telegramChatId)
  if (allowedId && chatId !== allowedId) return

  const text = (msg.text ?? '').trim()
  if (!text) return

  const lower = text.toLowerCase()

  // Status command
  if (lower === 'status' || lower === '/status') {
    const brief = await getTodayBrief()
    if (!brief) {
      await tgSend(chatId, `📋 No brief for today yet.`)
      return
    }
    let reply = `📋 <b>Today's brief (${brief.date})</b>\nStatus: ${brief.status}\n\n`
    for (let i = 0; i < brief.tasks.length; i++) {
      const t = brief.tasks[i]
      const icons = { pending: '⏸', approved: '✓', running: '⏳', completed: '✅', failed: '✗', rejected: '—' }
      reply += `${i + 1}. ${icons[t.status] ?? '?'} ${t.title}\n`
    }
    await tgSend(chatId, reply)
    return
  }

  // Manual trigger
  if (lower === 'brief' || lower === '/brief') {
    await tgSend(chatId, '⏳ Running morning brief analysis...')
    const child = spawn('node', [path.join(__dirname, 'morning-brief.mjs')], {
      detached: true, stdio: 'ignore',
      env: { ...process.env },
    })
    child.unref()
    return
  }

  // Task approval / skip
  const brief = await getTodayBrief()
  if (!brief || brief.status === 'skipped') return

  if (lower === 'skip') {
    await patchBrief(brief.id, { action: 'skip' })
    await tgSend(chatId, `⏩ Skipped today's brief.`)
    return
  }

  // Check if message looks like task numbers
  const looksLikeNumbers = /^(all|(\d[\d,\s\-]*))$/.test(lower)
  if (!looksLikeNumbers) return

  const taskIds = parseTaskNumbers(text, brief.tasks)
  if (taskIds.length === 0) {
    await tgSend(chatId, '❓ No matching pending tasks.')
    return
  }

  // Approve in AgentTower
  await patchBrief(brief.id, { action: 'approve', taskIds })
  const approvedTasks = brief.tasks.filter(t => taskIds.includes(t.id))
  await tgSend(chatId, `✓ Approved ${approvedTasks.length} task(s). Starting execution...`)

  // Execute each approved task
  for (const task of approvedTasks) {
    // Re-fetch brief to get latest state
    const latestBrief = await getTodayBrief()
    if (!latestBrief) continue
    const latestTask = latestBrief.tasks.find(t => t.id === task.id)
    if (!latestTask || latestTask.status !== 'approved') continue

    await tgSend(chatId, `⏳ Executing: <b>${task.title}</b> (${task.projectName})`)
    const result = await executeTask(brief.id, task, cfg)

    if (result.ok) {
      const r = result.result
      let msg = `✅ <b>${task.title}</b>\n`
      if (r.prUrl) msg += `PR: <a href="${r.prUrl}">${r.prUrl}</a>`
      else if (r.pdfPath) msg += `Report: ${r.pdfPath}`
      else if (r.obsidianPath) msg += `Note: ${r.obsidianPath}`
      else if (r.summary) msg += r.summary.slice(0, 300)
      await tgSend(chatId, msg)
    } else {
      await tgSend(chatId, `✗ <b>${task.title}</b> failed: ${result.error}`)
    }
  }
}

async function poll() {
  while (true) {
    try {
      const data = await tgGetUpdates(lastUpdateId + 1)
      const updates = data.result ?? []
      for (const update of updates) {
        lastUpdateId = update.update_id
        if (update.message) {
          handleMessage(update.message).catch(err =>
            console.error('[daily-bot] Handler error:', err.message)
          )
        }
      }
    } catch (err) {
      console.error('[daily-bot] Poll error:', err.message)
      await new Promise(r => setTimeout(r, 5000))
    }
  }
}

console.log('[daily-bot] Starting daily brief bot...')
await refreshConfig()
if (!cfg?.enabled) {
  console.log('[daily-bot] Daily brief is disabled. Set enabled=true in AgentTower > Daily Brief.')
}
poll()
