import fs from 'fs'
import path from 'path'
import os from 'os'
import crypto from 'crypto'
import type { OrchestratorConfig, RunRecord, RunStatus } from './orchestrator-types'

const CONFIG_PATH = path.join(os.homedir(), '.claude', 'agenttower-orchestrator.json')
const RUNS_PATH = path.join(os.homedir(), '.claude', 'agenttower-orchestrator-runs.jsonl')

function generateApiKey(): string {
  return crypto.randomBytes(32).toString('hex')
}

const DEFAULT_CONFIG: OrchestratorConfig = {
  enabled: false,
  pollIntervalSec: 60,
  workspaceRoot: path.join(os.homedir(), '.claude', 'agenttower-workspaces'),
  globalMaxConcurrent: 3,
  apiKey: generateApiKey(),
  agentTowerUrl: 'http://localhost:3000',
  repos: [],
}

export function loadOrchestratorConfig(): OrchestratorConfig {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf-8')
    const parsed = JSON.parse(raw) as Partial<OrchestratorConfig>
    return { ...DEFAULT_CONFIG, ...parsed }
  } catch {
    return { ...DEFAULT_CONFIG }
  }
}

export function saveOrchestratorConfig(cfg: OrchestratorConfig): void {
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true })
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), { mode: 0o600 })
}

export function loadRuns(limit = 100): RunRecord[] {
  try {
    const raw = fs.readFileSync(RUNS_PATH, 'utf-8')
    const lines = raw.split('\n').filter(Boolean)
    const tail = lines.slice(-limit)
    const records: RunRecord[] = []
    for (const line of tail) {
      try { records.push(JSON.parse(line) as RunRecord) } catch {}
    }
    return records.reverse()
  } catch {
    return []
  }
}

export function loadRunById(id: string): RunRecord | null {
  try {
    const raw = fs.readFileSync(RUNS_PATH, 'utf-8')
    for (const line of raw.split('\n').filter(Boolean)) {
      try {
        const r = JSON.parse(line) as RunRecord
        if (r.id === id) return r
      } catch {}
    }
  } catch {}
  return null
}

const ACTIVE_STATUSES: RunStatus[] = ['queued', 'awaiting-approval', 'dispatching', 'running', 'retrying']

export function loadActiveRuns(): RunRecord[] {
  try {
    const raw = fs.readFileSync(RUNS_PATH, 'utf-8')
    const records: RunRecord[] = []
    for (const line of raw.split('\n').filter(Boolean)) {
      try {
        const r = JSON.parse(line) as RunRecord
        if (ACTIVE_STATUSES.includes(r.status)) records.push(r)
      } catch {}
    }
    return records
  } catch {
    return []
  }
}

export function saveRunRecord(record: RunRecord): void {
  fs.mkdirSync(path.dirname(RUNS_PATH), { recursive: true })
  try {
    const raw = fs.readFileSync(RUNS_PATH, 'utf-8')
    const lines = raw.split('\n').filter(Boolean)
    const idx = lines.findIndex(l => {
      try { return (JSON.parse(l) as RunRecord).id === record.id } catch { return false }
    })
    if (idx >= 0) {
      lines[idx] = JSON.stringify(record)
      fs.writeFileSync(RUNS_PATH, lines.join('\n') + '\n', { mode: 0o600 })
      return
    }
  } catch {}
  fs.appendFileSync(RUNS_PATH, JSON.stringify(record) + '\n', { mode: 0o600 })
}

export function generateRunId(): string {
  return `run-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`
}

export function validateApiKey(key: string): boolean {
  const cfg = loadOrchestratorConfig()
  if (!cfg.apiKey || !key) return false
  try {
    return crypto.timingSafeEqual(Buffer.from(cfg.apiKey), Buffer.from(key))
  } catch {
    return false
  }
}

export function getConfigPath(): string { return CONFIG_PATH }
export function getRunsPath(): string { return RUNS_PATH }
