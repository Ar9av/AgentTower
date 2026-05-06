#!/usr/bin/env node
/**
 * Morning brief — runs via cron at the configured morning time.
 * 1. Analyzes each enabled project using Claude
 * 2. Creates a brief record in AgentTower
 * 3. Sends a Telegram message listing suggested tasks
 *
 * The daily-bot.mjs process handles incoming approval replies.
 */
import { loadConfig, createBrief, patchBrief, claudeAnalyze, tgSend, getRepoContext, randomHex, todayStr } from './lib.mjs'

const SYSTEM_PROMPT = `You are a senior software engineer reviewing a project to identify high-value improvements.
Suggest 2-4 specific, actionable improvements for the project based on the context provided.

Respond with a JSON array only (no markdown, no explanation outside the array):
[
  {
    "title": "Short title (max 60 chars)",
    "description": "One sentence description of the change",
    "rationale": "Why this matters now (one sentence)",
    "effort": "low|medium|high",
    "type": "code-improvement|bug-fix|documentation|research|obsidian-update"
  }
]

Rules:
- Only suggest types that are in the allowedTypes list
- Prefer concrete changes over vague suggestions
- low effort = < 30 min, medium = 1-2 hours, high = half day+
- For obsidian-update: suggest specific knowledge gaps to fill
- For research: name the specific topic to research`

async function analyzeProject(proj) {
  let context
  try {
    context = getRepoContext(proj)
  } catch (err) {
    console.warn(`Skipping ${proj.displayName}: ${err.message}`)
    return []
  }

  const userMsg = `
Project: ${proj.displayName}
Repo URL: ${proj.repoUrl}
Allowed task types: ${proj.taskTypes.join(', ')}
${proj.customInstructions ? `Custom instructions: ${proj.customInstructions}` : ''}

Recent commits:
${context.commits || '(no commits found)'}

TODOs/FIXMEs in code:
${context.todos || '(none found)'}

README excerpt:
${context.readme?.slice(0, 800) || '(no readme)'}

package.json excerpt:
${context.pkg?.slice(0, 400) || '(no package.json)'}
`.trim()

  try {
    const raw = await claudeAnalyze(SYSTEM_PROMPT, userMsg)
    const jsonMatch = raw.match(/\[[\s\S]*\]/)
    if (!jsonMatch) throw new Error('No JSON array in response')
    const suggestions = JSON.parse(jsonMatch[0])
    return suggestions
      .filter(s => s.title && s.description)
      .filter(s => proj.taskTypes.includes(s.type))
      .slice(0, 4)
  } catch (err) {
    console.error(`Analysis failed for ${proj.displayName}:`, err.message)
    return []
  }
}

function formatTelegramMessage(date, tasksWithProjects) {
  let msg = `🌅 <b>Good morning! Daily brief for ${date}</b>\n\n`

  let idx = 1
  for (const { proj, tasks } of tasksWithProjects) {
    if (tasks.length === 0) continue
    msg += `📦 <b>${proj.displayName}</b> (${tasks.length} suggestion${tasks.length > 1 ? 's' : ''})\n`
    for (const task of tasks) {
      const effort = { low: '🟢', medium: '🟡', high: '🔴' }[task.effort] ?? '⚪'
      msg += `${idx}. ${effort} <b>${task.title}</b>\n`
      msg += `   <i>${task.description}</i>\n`
      idx++
    }
    msg += '\n'
  }

  const total = tasksWithProjects.reduce((n, { tasks }) => n + tasks.length, 0)
  if (total === 0) {
    msg += 'No suggestions today — all projects look healthy!\n'
    return msg
  }

  msg += `Reply with task numbers to approve (e.g. <code>1,3</code>) or <code>all</code> to approve everything.\n`
  msg += `Reply <code>skip</code> to skip today.`
  return msg
}

async function run() {
  console.log('[morning-brief] Starting...')

  let cfg
  try {
    cfg = await loadConfig()
  } catch (err) {
    console.error('[morning-brief] Failed to load config:', err.message)
    process.exit(1)
  }

  if (!cfg.enabled) {
    console.log('[morning-brief] Daily brief is disabled, exiting.')
    return
  }

  const enabledProjects = cfg.projects.filter(p => p.enabled)
  if (enabledProjects.length === 0) {
    console.log('[morning-brief] No enabled projects.')
    return
  }

  const date = todayStr()
  const briefId = `brief-${Date.now()}-${randomHex(4)}`

  // Analyze all projects
  console.log(`[morning-brief] Analyzing ${enabledProjects.length} projects...`)
  const tasksWithProjects = []
  const allTasks = []

  for (const proj of enabledProjects) {
    console.log(`  → ${proj.displayName}`)
    const suggestions = await analyzeProject(proj)
    const tasks = suggestions.map(s => ({
      id: `task-${randomHex(6)}`,
      projectId: proj.id,
      projectName: proj.displayName,
      type: s.type,
      title: s.title,
      description: s.description,
      rationale: s.rationale ?? '',
      effort: s.effort ?? 'medium',
      status: 'pending',
    }))
    tasksWithProjects.push({ proj, tasks })
    allTasks.push(...tasks)
  }

  // Create brief record in AgentTower
  const brief = {
    id: briefId,
    date,
    type: 'morning',
    createdAt: new Date().toISOString(),
    status: 'pending-approval',
    tasks: allTasks,
  }

  try {
    await createBrief(brief)
    console.log(`[morning-brief] Brief ${briefId} created with ${allTasks.length} tasks`)
  } catch (err) {
    console.error('[morning-brief] Failed to save brief:', err.message)
  }

  // Send Telegram message
  const chatId = cfg.telegramChatId
  if (!chatId) {
    console.log('[morning-brief] No telegramChatId configured, skipping Telegram send.')
    return
  }

  const msgText = formatTelegramMessage(date, tasksWithProjects)
  try {
    const sent = await tgSend(chatId, msgText)
    const msgId = sent.result?.message_id
    if (msgId) {
      await patchBrief(briefId, {
        action: 'mark-sent',
        sentAt: new Date().toISOString(),
        telegramMessageId: msgId,
      })
    }
    console.log('[morning-brief] Telegram message sent.')
  } catch (err) {
    console.error('[morning-brief] Telegram send failed:', err.message)
  }
}

run().catch(err => {
  console.error('[morning-brief] Fatal:', err)
  process.exit(1)
})
