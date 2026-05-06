/**
 * Shared utilities for daily-brief agent scripts.
 */
import { execSync, spawnSync } from 'child_process'
import fs from 'fs'
import path from 'path'

export const AGENTTOWER_URL = process.env.AGENTTOWER_URL ?? 'http://localhost:3000'
export const AGENTTOWER_API_KEY = process.env.AGENTTOWER_API_KEY ?? ''
export const BOT_TOKEN = process.env.BOT_TOKEN ?? ''
export const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? ''

// ─── AgentTower API ────────────────────────────────────────────────────────

export async function atFetch(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${AGENTTOWER_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${AGENTTOWER_API_KEY}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) throw new Error(`AgentTower API ${method} ${path}: HTTP ${res.status}`)
  return res.json()
}

export async function loadConfig() {
  const data = await atFetch('/api/daily-brief/config')
  return data.config
}

export async function createBrief(brief) {
  return atFetch('/api/daily-brief/brief', { method: 'POST', body: brief })
}

export async function patchBrief(id, body) {
  return atFetch(`/api/daily-brief/brief/${id}`, { method: 'PATCH', body })
}

// ─── Telegram ─────────────────────────────────────────────────────────────

export async function tgSend(chatId, text, extra = {}) {
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', ...extra }),
  })
  return res.json()
}

export async function tgGetUpdates(offset = 0) {
  const res = await fetch(
    `https://api.telegram.org/bot${BOT_TOKEN}/getUpdates?offset=${offset}&timeout=30`
  )
  return res.json()
}

// ─── Anthropic ────────────────────────────────────────────────────────────

export async function claudeAnalyze(systemPrompt, userContent) {
  const Anthropic = (await import('@anthropic-ai/sdk')).default
  const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY })
  const msg = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    system: systemPrompt,
    messages: [{ role: 'user', content: userContent }],
  })
  return msg.content[0].type === 'text' ? msg.content[0].text : ''
}

// ─── Git helpers ──────────────────────────────────────────────────────────

export function gitPull(repoPath) {
  try {
    execSync('git pull --ff-only', { cwd: repoPath, stdio: 'pipe' })
  } catch (e) {
    console.warn(`git pull failed at ${repoPath}:`, e.message)
  }
}

export function getRecentCommits(repoPath, n = 8) {
  try {
    return execSync(`git log --oneline -${n}`, { cwd: repoPath, encoding: 'utf-8' }).trim()
  } catch {
    return ''
  }
}

export function findTodos(repoPath, limit = 20) {
  try {
    return execSync(
      `grep -r --include="*.ts" --include="*.tsx" --include="*.js" --include="*.py" -n "TODO\\|FIXME\\|HACK\\|XXX" . 2>/dev/null | head -${limit}`,
      { cwd: repoPath, encoding: 'utf-8' }
    ).trim()
  } catch {
    return ''
  }
}

export function readFile(filePath) {
  try { return fs.readFileSync(filePath, 'utf-8').slice(0, 2000) } catch { return '' }
}

export function getRepoContext(proj) {
  const repoPath = proj.agentPath
  if (!fs.existsSync(repoPath)) {
    throw new Error(`Repo path not found: ${repoPath}`)
  }
  gitPull(repoPath)

  const commits = getRecentCommits(repoPath)
  const todos = findTodos(repoPath)
  const readme = readFile(path.join(repoPath, 'README.md')) || readFile(path.join(repoPath, 'readme.md'))
  const pkg = readFile(path.join(repoPath, 'package.json'))

  return { commits, todos, readme, pkg }
}

// ─── Task ID generator ────────────────────────────────────────────────────

export function randomHex(n = 6) {
  return Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join('')
}

// ─── Date helpers ─────────────────────────────────────────────────────────

export function todayStr() {
  return new Date().toISOString().slice(0, 10)
}
