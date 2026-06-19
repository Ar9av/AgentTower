import fs from 'fs'
import path from 'path'
import os from 'os'
import { discoverProjects, getRecentSessions, getClaudeDir } from './claude-fs'
import { discoverCodexProjects, getRecentCodexSessions } from './codex-fs'
import { scanClaudeSessions } from './process'
import type { RecentSession } from './claude-fs'
import type { ClaudeProcess } from './types'
import { rankFacts, formatFactsForContext, getAllFacts } from './brain-memory'
import { rankSkills, formatSkillsForContext } from './brain-skills'
import { loadActiveRuns, loadOrchestratorConfig } from './orchestrator-config'

// ── Session brief: read JSONL for ai-title, away_summary (recap), tools ──────

interface RawBlock { type: string; text?: string; name?: string }
interface RawLine {
  type: string
  subtype?: string
  content?: string
  aiTitle?: string
  lastPrompt?: string
  message?: { content?: RawBlock[] }
  isMeta?: boolean
}

interface SessionBrief {
  title: string       // ai-title (Claude's own concise title)
  task: string        // first user message
  summary: string     // most recent away_summary (the recap!)
  lastPrompt: string  // last user instruction
  recentTools: string[]
}

function getSessionBrief(filepath: string): SessionBrief {
  const result: SessionBrief = { title: '', task: '', summary: '', lastPrompt: '', recentTools: [] }
  try {
    const stat = fs.statSync(filepath)
    if (stat.size === 0) return result

    // ── Head (first 12KB): first user message ────────────────────────────────
    const headSize = Math.min(12288, stat.size)
    const headBuf = Buffer.alloc(headSize)
    const fd1 = fs.openSync(filepath, 'r')
    fs.readSync(fd1, headBuf, 0, headSize, 0)
    fs.closeSync(fd1)

    for (const line of headBuf.toString('utf-8').split('\n')) {
      try {
        const obj = JSON.parse(line.trim()) as RawLine
        if (obj?.type === 'user' && !obj.isMeta) {
          for (const block of (obj.message?.content ?? [])) {
            if (block.type === 'text' && block.text) {
              const cleaned = block.text.replace(/<[^>]+>[\s\S]*?<\/[^>]+>/g, '').trim()
              if (cleaned.length > 2) { result.task = truncate(cleaned, 180); break }
            }
          }
        }
        if (result.task) break
      } catch { /* skip */ }
    }

    // ── Tail (last 40KB): ai-title, away_summary, last-prompt, tools ─────────
    const tailSize = Math.min(40960, stat.size)
    const tailBuf = Buffer.alloc(tailSize)
    const fd2 = fs.openSync(filepath, 'r')
    fs.readSync(fd2, tailBuf, 0, tailSize, stat.size - tailSize)
    fs.closeSync(fd2)

    const tailLines = tailBuf.toString('utf-8').split('\n').filter(Boolean)
    const toolsSeen: string[] = []

    for (let i = tailLines.length - 1; i >= 0; i--) {
      try {
        const obj = JSON.parse(tailLines[i]) as RawLine

        // ai-title: Claude's own session title
        if (obj.type === 'ai-title' && obj.aiTitle && !result.title) {
          result.title = obj.aiTitle
        }

        // away_summary: the recap text (most recent wins — scanning in reverse)
        if (obj.type === 'system' && obj.subtype === 'away_summary' && obj.content && !result.summary) {
          result.summary = truncate(String(obj.content), 300)
        }

        // last-prompt: last user instruction
        if (obj.type === 'last-prompt' && obj.lastPrompt && !result.lastPrompt) {
          result.lastPrompt = truncate(String(obj.lastPrompt), 180)
        }

        // tool calls from assistant messages
        if (obj.type === 'assistant' && toolsSeen.length < 5) {
          for (const block of (obj.message?.content ?? [])) {
            if (block.type === 'tool_use' && block.name && !toolsSeen.includes(block.name)) {
              toolsSeen.push(block.name)
            }
          }
        }
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

function safeLoadActiveRuns(): RunRecord[] {
  try { return loadActiveRuns() } catch { return [] }
}
function safeLoadOrchestratorConfig(): { enabled: boolean; repos: unknown[] } {
  try { return loadOrchestratorConfig() } catch { return { enabled: false, repos: [] } }
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
      const title = brief.title || (s.firstPrompt !== '(no prompt)' ? s.firstPrompt : brief.task) || s.projectDisplayName
      const act = s.currentActivity ? ` · *${s.currentActivity}*` : ''
      lines.push(`- **${s.projectDisplayName}** — ${dur}m${act} — pid:${proc?.pid ?? '?'}`)
      lines.push(`  sessionId: ${s.sessionId}`)
      lines.push(`  Title: "${truncate(title, 160)}"`)
      if (brief.summary) lines.push(`  Recap: "${truncate(brief.summary, 250)}"`)
      else if (brief.lastPrompt) lines.push(`  Last instruction: "${brief.lastPrompt}"`)
      if (brief.recentTools.length > 0) lines.push(`  Tools: ${brief.recentTools.join(', ')}`)
      if (proc?.cwd) lines.push(`  Path: \`${proc.cwd}\``)
    }
  } else {
    lines.push('### Agents\nNo agents currently running.')
  }

  if (recent.length > 0) {
    lines.push(`\n### ✅ Completed Today (${recent.length})`)
    for (const s of recent) {
      const brief = getSessionBrief(s.filepath)
      const title = brief.title || (s.firstPrompt !== '(no prompt)' ? s.firstPrompt : brief.task) || s.projectDisplayName
      const summary = brief.summary || (brief.lastPrompt ? `Last: ${brief.lastPrompt}` : '')
      const tools = brief.recentTools.length > 0 ? ` [${brief.recentTools.slice(0, 3).join(', ')}]` : ''
      lines.push(`- **${s.projectDisplayName}** — "${truncate(title, 100)}"${tools} — ${relTime(s.mtime)}`)
      if (summary) lines.push(`  ${truncate(summary, 200)}`)
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

function buildCodexContext(): { text: string; runningCount: number; completedTodayCount: number } {
  const now = Date.now()
  const sessions = getRecentCodexSessions(30)
  const active = sessions.filter(session => session.isActive)
  const recent = sessions.filter(session => !session.isActive && now - session.mtime < 24 * 60 * 60 * 1000).slice(0, 10)
  if (!active.length && !recent.length) return { text: '', runningCount: 0, completedTodayCount: 0 }

  const lines: string[] = []
  if (active.length) {
    lines.push(`### 🟢 Running Codex Agents (${active.length})`)
    for (const session of active) {
      lines.push(`- **${session.projectDisplayName}** · working`)
      lines.push(`  sessionId: ${session.sessionId}`)
      lines.push(`  Task: "${truncate(session.firstPrompt, 180)}"`)
      lines.push(`  Path: \`${session.projectPath}\``)
    }
  }
  if (recent.length) {
    lines.push(`\n### ✅ Recent Codex Sessions (${recent.length})`)
    for (const session of recent) {
      lines.push(`- **${session.projectDisplayName}** — "${truncate(session.firstPrompt, 120)}" — ${relTime(session.mtime)}`)
    }
  }
  return { text: lines.join('\n'), runningCount: active.length, completedTodayCount: recent.length }
}

function buildMemoryContext(userMessage?: string): string {
  const lines: string[] = []

  // 1. Brain's own persistent memory — ranked by relevance to the query
  const facts = rankFacts(userMessage ?? '', 10)
  if (facts.length > 0) {
    lines.push('### 🧠 Brain Memory (most relevant)')
    lines.push(formatFactsForContext(facts))
  }

  // 2. Skill library — relevant reusable prompt templates
  const skills = rankSkills(userMessage ?? '', 4)
  if (skills.length > 0) {
    lines.push('\n### ⚡ Skill Library (relevant templates)')
    lines.push(formatSkillsForContext(skills))
  }

  // 3. Project-scoped memory files (Claude auto-memory)
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
  const claudeRunningCount = sessions.filter(s => s.isActive).length
  const claudeCompletedTodayCount = sessions.filter(
    s => !s.isActive && now - s.mtime < 24 * 60 * 60 * 1000
  ).length
  const codexContext = buildCodexContext()
  const runningCount = claudeRunningCount + codexContext.runningCount
  const completedTodayCount = claudeCompletedTodayCount + codexContext.completedTodayCount

  const sessionSection = buildSessionContext(sessions, processes)
  const orchestratorSection = buildOrchestratorContext(activeRuns)
  const memorySection = buildMemoryContext(userMessage)
  const wikiSection = buildWikiContext(userMessage)

  const hasWiki = fs.existsSync(getVaultPath())
  const hasMemory = getAllFacts().length > 0
  const hasOrchestrator = orchestratorConfig.enabled && orchestratorConfig.repos.length > 0

  const parts = [
    `## Live System State — ${new Date().toLocaleString()}`,
    sessionSection,
    codexContext.text,
    orchestratorSection,
    memorySection,
    wikiSection,
  ].filter(Boolean)

  // List known project paths for action suggestions
  const projectPaths = [
    ...discoverProjects().map(project => ({ name: project.displayName, path: project.decodedPath, provider: 'claude' })),
    ...discoverCodexProjects().map(project => ({ name: project.displayName, path: project.decodedPath, provider: 'codex' })),
  ].filter((project, index, all) => all.findIndex(item => item.path === project.path && item.provider === project.provider) === index)

  if (projectPaths.length > 0) {
    parts.push('\n### Known Project Paths (for start_session actions)')
    for (const p of projectPaths) {
      parts.push(`- ${p.name} (${p.provider}): \`${p.path}\``)
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

// ── Proactive alerts (cheap heuristics, no Claude call) ──────────────────────

export interface BrainAlert {
  id: string
  level: 'error' | 'warn' | 'info'
  title: string
  detail: string
  sessionId?: string
  encodedFilepath?: string
  ts: number
}

function scanForError(filepath: string): boolean {
  try {
    const stat = fs.statSync(filepath)
    const size = Math.min(8192, stat.size)
    const buf = Buffer.alloc(size)
    const fd = fs.openSync(filepath, 'r')
    fs.readSync(fd, buf, 0, size, stat.size - size)
    fs.closeSync(fd)
    const text = buf.toString('utf-8').toLowerCase()
    return /\b(error|failed|exception|traceback|cannot find|enoent|fatal)\b/.test(text)
  } catch { return false }
}

export function computeBrainAlerts(): BrainAlert[] {
  const claudeDir = getClaudeDir()
  const sessions = getRecentSessions(30)
  const processes = scanClaudeSessions(claudeDir)
  const now = Date.now()
  const alerts: BrainAlert[] = []

  const STALL_MS = 25 * 60 * 1000
  const LONG_MS = 3 * 60 * 60 * 1000
  const RECENT_DONE_MS = 30 * 60 * 1000

  for (const s of sessions) {
    const proc = processes[s.sessionId]

    if (s.isActive) {
      const idle = now - s.mtime
      const dur = proc ? now - (proc.startedAt ?? now) : 0

      if (idle > STALL_MS) {
        alerts.push({
          id: `stall-${s.sessionId}`, level: 'warn',
          title: `${s.projectDisplayName} may be stalled`,
          detail: `No activity for ${Math.floor(idle / 60000)} min`,
          sessionId: s.sessionId, encodedFilepath: s.encodedFilepath, ts: s.mtime,
        })
      } else if (dur > LONG_MS) {
        alerts.push({
          id: `long-${s.sessionId}`, level: 'info',
          title: `${s.projectDisplayName} running ${Math.floor(dur / 3600000)}h+`,
          detail: 'Long-running session — check if it needs input',
          sessionId: s.sessionId, encodedFilepath: s.encodedFilepath, ts: s.mtime,
        })
      }
    } else if (now - s.mtime < RECENT_DONE_MS) {
      const hadError = scanForError(s.filepath)
      alerts.push({
        id: `done-${s.sessionId}`,
        level: hadError ? 'error' : 'info',
        title: hadError
          ? `${s.projectDisplayName} finished with errors`
          : `${s.projectDisplayName} finished`,
        detail: hadError ? 'Error keywords found near the end of the session' : `Completed ${relTime(s.mtime)}`,
        sessionId: s.sessionId, encodedFilepath: s.encodedFilepath, ts: s.mtime,
      })
    }
  }

  alerts.sort((a, b) => {
    const order = { error: 0, warn: 1, info: 2 }
    return order[a.level] - order[b.level] || b.ts - a.ts
  })
  return alerts
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
