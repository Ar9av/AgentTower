import fs from 'fs'
import path from 'path'
import os from 'os'
import crypto from 'crypto'

const CONFIG_PATH = path.join(os.homedir(), '.claude', 'agenttower-daily-brief.json')
const HISTORY_PATH = path.join(os.homedir(), '.claude', 'agenttower-daily-brief-history.jsonl')

export type TaskType = 'code-improvement' | 'bug-fix' | 'documentation' | 'research' | 'obsidian-update'
export type OutputFormat = 'pr' | 'pdf' | 'obsidian' | 'summary'
export type Effort = 'low' | 'medium' | 'high'
export type TaskStatus = 'pending' | 'approved' | 'rejected' | 'running' | 'completed' | 'failed'
export type BriefStatus = 'pending-approval' | 'executing' | 'completed' | 'skipped'

export interface ProjectBriefConfig {
  id: string
  displayName: string
  repoUrl: string           // e.g. https://github.com/user/repo
  agentPath: string         // path to repo on the agent machine (St3ve)
  enabled: boolean
  taskTypes: TaskType[]
  outputFormat: OutputFormat
  customInstructions?: string
}

export interface DailyBriefConfig {
  enabled: boolean
  morningTime: string       // "HH:MM" in configured timezone
  eveningTime: string       // "HH:MM" in configured timezone
  timezone: string          // IANA e.g. "Asia/Kolkata"
  agentTowerUrl: string     // URL agents use to post results back
  apiKey: string            // bearer token for agent → AgentTower auth
  telegramChatId: string    // which chat receives the daily brief
  projects: ProjectBriefConfig[]
}

export interface TaskResult {
  type: OutputFormat
  prUrl?: string
  prBranch?: string
  prNumber?: number
  pdfPath?: string
  obsidianPath?: string
  summary?: string
  error?: string
}

export interface BriefTask {
  id: string
  projectId: string
  projectName: string
  type: TaskType
  title: string
  description: string
  rationale: string
  effort: Effort
  status: TaskStatus
  approvedAt?: string
  startedAt?: string
  completedAt?: string
  result?: TaskResult
}

export interface BriefRecord {
  id: string
  date: string              // "YYYY-MM-DD"
  type: 'morning' | 'evening'
  createdAt: string         // ISO timestamp
  sentAt?: string
  telegramMessageId?: number
  status: BriefStatus
  tasks: BriefTask[]
}

function generateApiKey(): string {
  return crypto.randomBytes(32).toString('hex')
}

const DEFAULT_CONFIG: DailyBriefConfig = {
  enabled: false,
  morningTime: '08:00',
  eveningTime: '20:00',
  timezone: 'Asia/Kolkata',
  agentTowerUrl: 'http://localhost:3000',
  apiKey: generateApiKey(),
  telegramChatId: '',
  projects: [],
}

export function loadDailyBriefConfig(): DailyBriefConfig {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf-8')
    const parsed = JSON.parse(raw) as Partial<DailyBriefConfig>
    // Preserve existing apiKey — don't regenerate on every load
    return { ...DEFAULT_CONFIG, ...parsed }
  } catch {
    return { ...DEFAULT_CONFIG }
  }
}

export function saveDailyBriefConfig(cfg: DailyBriefConfig): void {
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true })
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), { mode: 0o600 })
}

export function loadBriefHistory(limit = 60): BriefRecord[] {
  try {
    const raw = fs.readFileSync(HISTORY_PATH, 'utf-8')
    const lines = raw.split('\n').filter(Boolean)
    const tail = lines.slice(-limit)
    const records: BriefRecord[] = []
    for (const line of tail) {
      try { records.push(JSON.parse(line) as BriefRecord) } catch {}
    }
    return records.reverse()
  } catch {
    return []
  }
}

export function loadBriefById(id: string): BriefRecord | null {
  try {
    const raw = fs.readFileSync(HISTORY_PATH, 'utf-8')
    for (const line of raw.split('\n').filter(Boolean)) {
      try {
        const r = JSON.parse(line) as BriefRecord
        if (r.id === id) return r
      } catch {}
    }
  } catch {}
  return null
}

export function saveBriefRecord(record: BriefRecord): void {
  fs.mkdirSync(path.dirname(HISTORY_PATH), { recursive: true })
  try {
    const raw = fs.readFileSync(HISTORY_PATH, 'utf-8')
    const lines = raw.split('\n').filter(Boolean)
    const idx = lines.findIndex(l => {
      try { return (JSON.parse(l) as BriefRecord).id === record.id } catch { return false }
    })
    if (idx >= 0) {
      lines[idx] = JSON.stringify(record)
      fs.writeFileSync(HISTORY_PATH, lines.join('\n') + '\n', { mode: 0o600 })
      return
    }
  } catch {}
  fs.appendFileSync(HISTORY_PATH, JSON.stringify(record) + '\n', { mode: 0o600 })
}

export function generateBriefId(): string {
  return `brief-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`
}

export function generateTaskId(): string {
  return `task-${crypto.randomBytes(6).toString('hex')}`
}

export function getConfigPath(): string { return CONFIG_PATH }
export function getHistoryPath(): string { return HISTORY_PATH }

export function validateApiKey(key: string): boolean {
  const cfg = loadDailyBriefConfig()
  if (!cfg.apiKey || !key) return false
  return crypto.timingSafeEqual(Buffer.from(cfg.apiKey), Buffer.from(key))
}
