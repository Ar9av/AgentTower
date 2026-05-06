#!/usr/bin/env node
/**
 * Evening brief — runs via cron at the configured evening time.
 * Fetches today's brief from AgentTower and sends a Telegram summary.
 */
import { loadConfig, atFetch, tgSend, todayStr } from './lib.mjs'

function formatEveningSummary(records) {
  const today = todayStr()
  const todayRecords = records.filter(r => r.date === today && r.type === 'morning')
  if (todayRecords.length === 0) {
    return `🌙 <b>Evening summary for ${today}</b>\n\nNo morning brief was sent today.`
  }

  const record = todayRecords[0]
  const tasks = record.tasks ?? []

  let msg = `🌙 <b>End of day · ${today}</b>\n\n`

  const completed = tasks.filter(t => t.status === 'completed')
  const failed = tasks.filter(t => t.status === 'failed')
  const running = tasks.filter(t => t.status === 'running')
  const pending = tasks.filter(t => t.status === 'pending')
  const rejected = tasks.filter(t => t.status === 'rejected')

  if (completed.length > 0) {
    msg += `<b>Completed (${completed.length})</b>\n`
    for (const t of completed) {
      const r = t.result
      if (r?.prUrl) {
        msg += `✅ ${t.projectName}: <a href="${r.prUrl}">PR opened</a> — ${t.title}\n`
      } else if (r?.pdfPath) {
        msg += `✅ ${t.projectName}: Report saved — ${t.title}\n`
      } else if (r?.obsidianPath) {
        msg += `✅ ${t.projectName}: Note created — ${t.title}\n`
      } else {
        msg += `✅ ${t.projectName}: ${t.title}\n`
      }
    }
    msg += '\n'
  }

  if (running.length > 0) {
    msg += `<b>Still running (${running.length})</b>\n`
    for (const t of running) msg += `⏳ ${t.projectName}: ${t.title}\n`
    msg += '\n'
  }

  if (failed.length > 0) {
    msg += `<b>Failed (${failed.length})</b>\n`
    for (const t of failed) msg += `✗ ${t.projectName}: ${t.title} — ${t.result?.error ?? 'unknown error'}\n`
    msg += '\n'
  }

  if (pending.length > 0) {
    msg += `<b>Not approved (${pending.length})</b>\n`
    for (const t of pending) msg += `— ${t.title}\n`
    msg += '\n'
  }

  if (completed.length === 0 && running.length === 0 && failed.length === 0) {
    msg += 'Nothing was executed today.\n'
  }

  return msg.trim()
}

async function run() {
  console.log('[evening-brief] Starting...')

  let cfg
  try {
    cfg = await loadConfig()
  } catch (err) {
    console.error('[evening-brief] Failed to load config:', err.message)
    process.exit(1)
  }

  if (!cfg.enabled || !cfg.telegramChatId) {
    console.log('[evening-brief] Disabled or no chat ID, exiting.')
    return
  }

  let records = []
  try {
    const data = await atFetch('/api/daily-brief/history?limit=5')
    records = data.records ?? []
  } catch (err) {
    console.error('[evening-brief] Failed to load history:', err.message)
  }

  const summary = formatEveningSummary(records)
  await tgSend(cfg.telegramChatId, summary)
  console.log('[evening-brief] Evening brief sent.')
}

run().catch(err => {
  console.error('[evening-brief] Fatal:', err)
  process.exit(1)
})
