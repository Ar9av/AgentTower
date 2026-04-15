import fs from 'fs'
import path from 'path'
import os from 'os'
import { execSync } from 'child_process'
import { getClaudeDir } from './claude-fs'

const CONFIG_PATH = path.join(os.homedir(), '.claude', 'agenttower-integrations.json')
const AUDIT_PATH  = path.join(os.homedir(), '.claude', 'agenttower-audit.jsonl')

export interface TelegramConfig {
  enabled: boolean
  allowedChatIds: number[]
  openaiApiKey?: string      // for voice transcription
  projectsDir?: string       // default cwd for new tasks
}

export interface IntegrationsConfig {
  telegram: TelegramConfig
}

const DEFAULT_CONFIG: IntegrationsConfig = {
  telegram: { enabled: false, allowedChatIds: [] },
}

export function loadIntegrations(): IntegrationsConfig {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf-8')
    const parsed = JSON.parse(raw) as Partial<IntegrationsConfig>
    return {
      telegram: { ...DEFAULT_CONFIG.telegram, ...(parsed.telegram ?? {}) },
    }
  } catch {
    return DEFAULT_CONFIG
  }
}

export function saveIntegrations(cfg: IntegrationsConfig): void {
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true })
  // Don't serialize secrets we didn't receive — merge with existing
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), { mode: 0o600 })
}

export function getConfigPath(): string {
  return CONFIG_PATH
}

// ─── Bot process status ────────────────────────────────────────────────────

export interface BotStatus {
  running: boolean
  pid: number | null
  uptimeSec: number | null
}

export function getTelegramBotStatus(): BotStatus {
  // Scan for a node/ts-node process running telegram/bot.ts
  try {
    const out = execSync('ps -A -o pid=,etimes=,command=', { encoding: 'utf-8' })
    for (const line of out.split('\n')) {
      if (!/telegram\/bot\.ts|telegram-bot/i.test(line)) continue
      // Exclude self / grep / sh wrappers
      if (/grep|getTelegramBotStatus/.test(line)) continue
      const m = line.trim().match(/^(\d+)\s+(\d+)\s+/)
      if (!m) continue
      return { running: true, pid: parseInt(m[1], 10), uptimeSec: parseInt(m[2], 10) }
    }
  } catch {}
  return { running: false, pid: null, uptimeSec: null }
}

// ─── Audit log ─────────────────────────────────────────────────────────────

export interface AuditEntry {
  ts: string
  chatId: number
  user: string
  action: string
  [key: string]: unknown
}

export function readAuditTail(limit = 50): AuditEntry[] {
  try {
    const raw = fs.readFileSync(AUDIT_PATH, 'utf-8')
    const lines = raw.split('\n').filter(Boolean)
    const tail = lines.slice(-limit)
    const entries: AuditEntry[] = []
    for (const line of tail) {
      try { entries.push(JSON.parse(line) as AuditEntry) } catch {}
    }
    return entries.reverse()
  } catch {
    return []
  }
}

export function getAuditPath(): string {
  return AUDIT_PATH
}

// Helper for the bot — merges env vars with config file. Env wins.
export function resolveTelegramRuntimeConfig() {
  const cfg = loadIntegrations().telegram
  const envIds = (process.env.ALLOWED_CHAT_IDS ?? process.env.ALLOWED_CHAT_ID ?? '')
    .split(',').map(s => s.trim()).filter(Boolean).map(Number).filter(n => !Number.isNaN(n))
  const allowedChatIds = envIds.length > 0 ? envIds : cfg.allowedChatIds
  return {
    allowedChatIds: new Set<number>(allowedChatIds),
    openaiApiKey: process.env.OPENAI_API_KEY || cfg.openaiApiKey || '',
    projectsDir: process.env.PROJECTS_DIR || cfg.projectsDir || '',
    claudeDir: getClaudeDir(),
  }
}
