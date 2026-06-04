import fs from 'fs'
import path from 'path'
import os from 'os'
import { getRecentSessions, getClaudeDir } from './claude-fs'
import { scanClaudeSessions } from './process'
import type { RecentSession } from './claude-fs'
import type { ClaudeProcess } from './types'

// ── Session brief: read JSONL directly for real task content ──────────────────

interface RawBlock { type: string; text?: string; name?: string }
interface RawLine { type: string; message?: { content?: RawBlock[] }; isMeta?: boolean }

function getSessionBrief(filepath: string): { task: string; recentTools: string[] } {
  const result = { task: '(no prompt)', recentTools: [] as string[] }
  try {
    const stat = fs.statSync(filepath)
    if (stat.size === 0) return result

    // Read first 12KB for the initial prompt
    const headSize = Math.min(12288, stat.size)
    const headBuf = Buffer.alloc(headSize)
    const fd1 = fs.openSync(filepath, 'r')
    fs.readSync(fd1, headBuf, 0, headSize, 0)
    fs.closeSync(fd1)

    for (const line of headBuf.toString('utf-8').split('\n')) {
      try {
        const obj = JSON.parse(line.trim()) as RawLine
        if (obj?.isMeta || obj?.type !== 'user') continue
        for (const block of (obj.message?.content ?? [])) {
          if (block.type === 'text' && block.text) {
            const cleaned = block.text.replace(/<[^>]+>[\s\S]*?<\/[^>]+>/g, '').trim()
            if (cleaned && cleaned.length > 2) {
              result.task = truncate(cleaned, 160)
              break
            }
          }
        }
        if (result.task !== '(no prompt)') break
      } catch { /* skip */ }
    }

    // Read last 20KB for recent tool activity
    const tailSize = Math.min(20480, stat.size)
    const tailBuf = Buffer.alloc(tailSize)
    const fd2 = fs.openSync(filepath, 'r')
    fs.readSync(fd2, tailBuf, 0, tailSize, stat.size - tailSize)
    fs.closeSync(fd2)

    const toolsSeen: string[] = []
    for (const line of tailBuf.toString('utf-8').split('\n').reverse()) {
      try {
        const obj = JSON.parse(line.trim()) as RawLine
        if (obj?.type !== 'assistant') continue
        for (const block of (obj.message?.content ?? [])) {
          if (block.type === 'tool_use' && block.name && !toolsSeen.includes(block.name)) {
            toolsSeen.push(block.name)
            if (toolsSeen.length >= 4) break
          }
        }
        if (toolsSeen.length >= 4) break
      } catch { /* skip */ }
    }
    result.recentTools = toolsSeen.reverse()
  } catch { /* ignore */ }
  return result
}
// Minimal inline type — avoids importing the optional orchestrator module
interface RunRecord {
  status: string
  issueNumber?: number
  issueTitle?: string
  attempt?: number
  prUrl?: string
}

// Orchestrator is an optional module — gracefully skip if not deployed
function safeLoadActiveRuns(): RunRecord[] {
  try { return require('./orchestrator-config').loadActiveRuns() } catch { return [] }
}
function safeLoadOrchestratorConfig(): { enabled: boolean; repos: unknown[] } {
  try { return require('./orchestrator-config').loadOrchestratorConfig() } catch { return { enabled: false, repos: [] } }
}

// ── Paths ────────────────────────────────────────────────────────────────────

export function getVaultPath(): string {
  return process.env.OBSIDIAN_VAULT_PATH?.replace('~', os.homedir())
    || path.join(os.homedir(), 'Knowledge')
}

export function getBrainMemoryPath(): string {
  return path.join(os.homedir(), '.claude', 'agenttower-brain-memory.md')
}

function getProjectMemoryDir(): string {
  // Walk up from cwd to find a .claude/projects memory directory
  const home = os.homedir()
  const encoded = encodeProjectPath(process.cwd())
  const candidate = path.join(home, '.claude', 'projects', encoded, 'memory')
  if (fs.existsSync(candidate)) return candidate
  return ''
}

function encodeProjectPath(p: string): string {
  // Matches the server-side encoding: replace / with - (after leading /)
  return p.replace(/\//g, '-').replace(/^-/, '')
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function relTime(ms: number): string {
  const d = Date.now() - ms
  if (d < 60_000) return 'just now'
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m ago`
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h ago`
  return `${Math.floor(d / 86_400_000)}d ago`
}

function truncate(s: string, n: number) {
  return s.length > n ? s.slice(0, n - 1) + '…' : s
}

// ── Section builders ─────────────────────────────────────────────────────────

function buildSessionContext(
  sessions: RecentSession[],
  processes: Record<string, ClaudeProcess>
): string {
  const now = Date.now()
  const active = sessions.filter(s => s.isActive)
  const recent = sessions
    .filter(s => !s.isActive && now - s.mtime < 24 * 60 * 60 * 1000)
    .slice(0, 15)

  const lines: string[] = []

  if (active.length > 0) {
    lines.push(`### 🟢 Running Agents (${active.length})`)
    for (const s of active) {
      const proc = processes[s.sessionId]
      const dur = proc ? Math.floor((now - (proc.startedAt ?? now)) / 60_000) : 0
      const brief = getSessionBrief(s.filepath)
      // Prefer cached firstPrompt, fall back to deep read
      const task = (s.firstPrompt && s.firstPrompt !== '(no prompt)')
        ? s.firstPrompt : brief.task
      const act = s.currentActivity ? ` · **${s.currentActivity}**` : ''
      lines.push(`- **${s.projectDisplayName}** — ${dur}m${act} — pid:${proc?.pid ?? '?'}`)
      lines.push(`  Task: "${truncate(task, 160)}"`)
      if (brief.recentTools.length > 0) lines.push(`  Recent tools: ${brief.recentTools.join(', ')}`)
      if (proc?.cwd) lines.push(`  Path: \`${proc.cwd}\``)
    }
  } else {
    lines.push('### Agents\nNo agents currently running.')
  }

  if (recent.length > 0) {
    lines.push(`\n### ✅ Completed Today (${recent.length})`)
    for (const s of recent) {
      const brief = getSessionBrief(s.filepath)
      const task = (s.firstPrompt && s.firstPrompt !== '(no prompt)')
        ? s.firstPrompt : brief.task
      const tools = brief.recentTools.length > 0 ? ` [${brief.recentTools.slice(0, 3).join(', ')}]` : ''
      lines.push(`- **${s.projectDisplayName}** — "${truncate(task, 120)}"${tools} — ${relTime(s.mtime)}`)
    }
  }

  return lines.join('\n')
}

function buildOrchestratorContext(runs: RunRecord[]): string {
  if (runs.length === 0) return ''
  const lines = ['### 🤖 Orchestrator Active Runs']
  for (const r of runs.slice(0, 8)) {
    lines.push(`- [${r.status.toUpperCase()}] Issue #${r.issueNumber} — ${r.issueTitle ?? '?'} (attempt ${r.attempt})`)
    if (r.prUrl) lines.push(`  PR: ${r.prUrl}`)
  }
  return lines.join('\n')
}

function buildMemoryContext(): string {
  const lines: string[] = []

  // 1. Brain's own persistent memory
  const memPath = getBrainMemoryPath()
  if (fs.existsSync(memPath)) {
    try {
      const content = fs.readFileSync(memPath, 'utf-8').trim()
      if (content) {
        lines.push('### 🧠 Brain Memory')
        lines.push(truncate(content, 2000))
      }
    } catch { /* ignore */ }
  }

  // 2. Project-scoped memory files (Claude auto-memory)
  const memDir = getProjectMemoryDir()
  if (memDir && fs.existsSync(memDir)) {
    try {
      const files = fs.readdirSync(memDir).filter(f => f.endsWith('.md') && f !== 'MEMORY.md')
      const snippets: string[] = []
      for (const file of files.slice(0, 8)) {
        const raw = fs.readFileSync(path.join(memDir, file), 'utf-8')
        // Extract frontmatter description + first 300 chars of body
        const desc = raw.match(/^description:\s*(.+)$/m)?.[1] ?? ''
        const body = raw.replace(/^---[\s\S]+?---\n?/, '').trim().slice(0, 300)
        const label = file.replace('.md', '')
        snippets.push(`**${label}**: ${desc || body}`)
      }
      if (snippets.length > 0) {
        lines.push('\n### 📎 Project Memory')
        lines.push(snippets.join('\n'))
      }
    } catch { /* ignore */ }
  }

  return lines.join('\n')
}

export function searchWiki(query: string, maxResults = 5): WikiResult[] {
  const vaultPath = getVaultPath()
  if (!fs.existsSync(vaultPath)) return []

  const terms = query.toLowerCase().split(/\s+/).filter(t => t.length > 2)
  if (terms.length === 0) return []

  const results: WikiResult[] = []

  function walk(dir: string, depth = 0) {
    if (depth > 4 || results.length >= maxResults * 3) return
    let entries: fs.Dirent[]
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }

    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name.startsWith('_')) continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) { walk(full, depth + 1); continue }
      if (!entry.name.endsWith('.md')) continue

      try {
        const content = fs.readFileSync(full, 'utf-8')
        const lower = content.toLowerCase()
        const score = terms.reduce((acc, t) => {
          const count = (lower.match(new RegExp(t, 'g')) ?? []).length
          return acc + count
        }, 0)
        if (score > 0) {
          const relativePath = path.relative(vaultPath, full)
          const title = entry.name.replace('.md', '')
          // Get the most relevant snippet
          const idx = lower.indexOf(terms[0])
          const snippet = content.slice(Math.max(0, idx - 60), idx + 300).replace(/\n+/g, ' ').trim()
          results.push({ relativePath, title, score, snippet, fullPath: full })
        }
      } catch { /* skip */ }
    }
  }

  walk(vaultPath)
  results.sort((a, b) => b.score - a.score)
  return results.slice(0, maxResults)
}

export interface WikiResult {
  relativePath: string
  title: string
  score: number
  snippet: string
  fullPath: string
}

function buildWikiContext(userMessage?: string): string {
  const vaultPath = getVaultPath()
  if (!fs.existsSync(vaultPath)) return ''

  const lines: string[] = ['### 📖 Wiki Context']

  // Always load key agenttower wiki pages
  const keyPages = [
    'projects/agenttower/agenttower.md',
    'projects/agenttower/concepts/orchestrator.md',
  ]
  for (const rel of keyPages) {
    const full = path.join(vaultPath, rel)
    if (fs.existsSync(full)) {
      try {
        const content = fs.readFileSync(full, 'utf-8').trim()
        const frontmatterStripped = content.replace(/^---[\s\S]+?---\n?/, '').trim()
        lines.push(`\n**${rel}:**\n${truncate(frontmatterStripped, 600)}`)
      } catch { /* ignore */ }
    }
  }

  // If user message provided, also search for relevant pages
  if (userMessage && userMessage.length > 5) {
    const hits = searchWiki(userMessage, 3)
    const alreadyLoaded = new Set(keyPages)
    for (const hit of hits) {
      if (!alreadyLoaded.has(hit.relativePath)) {
        lines.push(`\n**${hit.relativePath}** (relevant):\n${truncate(hit.snippet, 400)}`)
      }
    }
  }

  return lines.length > 1 ? lines.join('\n') : ''
}

// ── Main export ───────────────────────────────────────────────────────────────

export interface BrainContext {
  text: string
  runningCount: number
  completedTodayCount: number
  hasWiki: boolean
  hasMemory: boolean
  hasOrchestrator: boolean
}

export function assembleBrainContext(userMessage?: string): BrainContext {
  const claudeDir = getClaudeDir()
  const sessions = getRecentSessions(30)
  const processes = scanClaudeSessions(claudeDir)
  const activeRuns = safeLoadActiveRuns()
  const orchestratorConfig = safeLoadOrchestratorConfig()

  const now = Date.now()
  const runningCount = sessions.filter(s => s.isActive).length
  const completedTodayCount = sessions.filter(
    s => !s.isActive && now - s.mtime < 24 * 60 * 60 * 1000
  ).length

  const sessionSection = buildSessionContext(sessions, processes)
  const orchestratorSection = buildOrchestratorContext(activeRuns)
  const memorySection = buildMemoryContext()
  const wikiSection = buildWikiContext(userMessage)

  const hasWiki = fs.existsSync(getVaultPath())
  const hasMemory = fs.existsSync(getBrainMemoryPath())
  const hasOrchestrator = orchestratorConfig.enabled && orchestratorConfig.repos.length > 0

  const parts = [
    `## Live System State — ${new Date().toLocaleString()}`,
    sessionSection,
    orchestratorSection,
    memorySection,
    wikiSection,
  ].filter(Boolean)

  // List known project paths for action suggestions
  const projectPaths = sessions
    .filter(s => s.isActive && processes[s.sessionId]?.cwd)
    .map(s => ({ name: s.projectDisplayName, path: processes[s.sessionId].cwd }))

  if (projectPaths.length > 0) {
    parts.push('\n### Known Project Paths (for start_session actions)')
    for (const p of projectPaths) {
      parts.push(`- ${p.name}: \`${p.path}\``)
    }
  }

  return {
    text: parts.join('\n\n'),
    runningCount,
    completedTodayCount,
    hasWiki,
    hasMemory,
    hasOrchestrator,
  }
}

// ── Memory write ─────────────────────────────────────────────────────────────

export function appendBrainMemory(fact: string): void {
  const memPath = getBrainMemoryPath()
  const timestamp = new Date().toISOString().slice(0, 16).replace('T', ' ')
  const entry = `\n- [${timestamp}] ${fact.trim()}`
  fs.appendFileSync(memPath, entry, 'utf-8')
}

export function readBrainMemory(): string {
  const memPath = getBrainMemoryPath()
  try { return fs.readFileSync(memPath, 'utf-8') } catch { return '' }
}

// ── Wiki write ────────────────────────────────────────────────────────────────

export function writeWikiPage(relativePath: string, content: string): void {
  const vaultPath = getVaultPath()
  const full = path.join(vaultPath, relativePath)
  fs.mkdirSync(path.dirname(full), { recursive: true })
  fs.writeFileSync(full, content, 'utf-8')
}

export function readWikiPage(relativePath: string): string | null {
  const vaultPath = getVaultPath()
  const full = path.join(vaultPath, relativePath)
  try { return fs.readFileSync(full, 'utf-8') } catch { return null }
}
