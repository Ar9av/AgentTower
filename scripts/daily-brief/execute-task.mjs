#!/usr/bin/env node
/**
 * Execute a single approved task.
 * Called by daily-bot.mjs after the user approves tasks.
 *
 * For 'pr' output:  creates a git branch, uses Claude API to make changes, pushes, opens PR
 * For 'research':   generates a Markdown report, saves as PDF if mdpdf available
 * For 'obsidian':   writes a new note to the Obsidian vault
 * For 'summary':    generates a text summary, posts back
 */
import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import { claudeAnalyze, atFetch, patchBrief, tgSend, loadConfig, readFile } from './lib.mjs'

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? ''
const GITHUB_TOKEN = process.env.GITHUB_TOKEN ?? ''
const OBSIDIAN_VAULT_PATH = process.env.OBSIDIAN_VAULT_PATH ?? ''

// ─── PR task: make code changes and open a PR ──────────────────────────────

async function executePrTask(proj, task) {
  const repoPath = proj.agentPath
  const branch = `daily-brief/${task.id.slice(5, 15)}-${slugify(task.title)}`

  // Ensure we're on main/master
  try {
    const defaultBranch = execSync('git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null || echo main', {
      cwd: repoPath, encoding: 'utf-8'
    }).trim().replace('refs/remotes/origin/', '')
    execSync(`git checkout ${defaultBranch} && git pull --ff-only`, { cwd: repoPath, stdio: 'pipe' })
  } catch {}

  // Create branch
  execSync(`git checkout -b "${branch}"`, { cwd: repoPath })

  // Gather context for the code change
  const relevantFiles = gatherRelevantFiles(repoPath, task)
  const changePrompt = buildChangePrompt(proj, task, relevantFiles)

  // Ask Claude to produce file operations
  const Anthropic = (await import('@anthropic-ai/sdk')).default
  const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY })

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 8192,
    system: `You are making targeted code changes to a software project.
Output ONLY a JSON array of file operations. No markdown fences, no explanation.
Format: [{"op":"write","path":"relative/path","content":"..."},{"op":"delete","path":"..."}]
Paths are relative to the repo root. Use forward slashes.`,
    messages: [{ role: 'user', content: changePrompt }],
  })

  const raw = response.content[0].type === 'text' ? response.content[0].text : ''
  const jsonMatch = raw.match(/\[[\s\S]*\]/)
  if (!jsonMatch) throw new Error('Claude did not return file operations')

  const ops = JSON.parse(jsonMatch[0])

  // Apply file operations
  for (const op of ops) {
    const fullPath = path.join(repoPath, op.path)
    if (op.op === 'write') {
      fs.mkdirSync(path.dirname(fullPath), { recursive: true })
      fs.writeFileSync(fullPath, op.content, 'utf-8')
    } else if (op.op === 'delete') {
      try { fs.unlinkSync(fullPath) } catch {}
    }
  }

  // Commit
  execSync('git add -A', { cwd: repoPath })
  const changedFiles = execSync('git diff --cached --name-only', { cwd: repoPath, encoding: 'utf-8' }).trim()
  if (!changedFiles) {
    execSync(`git checkout -`, { cwd: repoPath })
    throw new Error('No files changed')
  }
  execSync(`git commit -m "daily-brief: ${task.title}"`, { cwd: repoPath })

  // Push
  const remote = GITHUB_TOKEN
    ? proj.repoUrl.replace('https://', `https://x-access-token:${GITHUB_TOKEN}@`)
    : 'origin'
  try {
    execSync(`git push "${remote}" "${branch}"`, { cwd: repoPath })
  } catch {
    execSync(`git push origin "${branch}"`, { cwd: repoPath })
  }

  // Create PR
  let prUrl = ''
  try {
    const prResult = execSync(
      `gh pr create --title "${task.title}" --body "${task.description}\\n\\n${task.rationale}" --head "${branch}"`,
      { cwd: repoPath, encoding: 'utf-8', env: { ...process.env, GH_TOKEN: GITHUB_TOKEN || process.env.GH_TOKEN } }
    ).trim()
    prUrl = prResult.split('\n').pop() ?? ''
  } catch (err) {
    console.warn('gh pr create failed:', err.message)
  }

  return { type: 'pr', prUrl, prBranch: branch, summary: `Changed: ${changedFiles.split('\n').join(', ')}` }
}

// ─── Research task: generate a PDF/MD report ──────────────────────────────

async function executeResearchTask(proj, task) {
  const reportContent = await claudeAnalyze(
    `You are a research analyst. Write a comprehensive, well-structured report on the given topic.
Use Markdown formatting. Include: executive summary, key findings, recommendations, references (if known).
Be specific and actionable. Aim for 600-1200 words.`,
    `Project: ${proj.displayName}\nTask: ${task.title}\n\n${task.description}\n\n${task.rationale}`
  )

  const date = new Date().toISOString().slice(0, 10)
  const filename = `${date}-${slugify(task.title)}`
  const outDir = path.join(proj.agentPath || '/tmp', 'daily-brief-reports')
  fs.mkdirSync(outDir, { recursive: true })
  const mdPath = path.join(outDir, `${filename}.md`)
  fs.writeFileSync(mdPath, reportContent, 'utf-8')

  // Try to convert to PDF
  let pdfPath = ''
  try {
    execSync(`which mdpdf`, { stdio: 'pipe' })
    const pdfOut = path.join(outDir, `${filename}.pdf`)
    execSync(`mdpdf "${mdPath}" "${pdfOut}"`, { stdio: 'pipe' })
    pdfPath = pdfOut
  } catch {}

  const summary = reportContent.split('\n').slice(0, 5).join(' ').slice(0, 200) + '…'
  return { type: 'pdf', pdfPath: pdfPath || mdPath, summary }
}

// ─── Obsidian task: write a new note ──────────────────────────────────────

async function executeObsidianTask(proj, task) {
  const vaultPath = OBSIDIAN_VAULT_PATH || proj.agentPath
  if (!vaultPath) throw new Error('OBSIDIAN_VAULT_PATH not configured')

  const noteContent = await claudeAnalyze(
    `You are writing a knowledge note for an Obsidian vault.
Format as clean Markdown. Use [[wikilinks]] for related concepts. Include:
- A YAML frontmatter block with tags
- Clear headings
- Concise, well-organized content
- A "Related" section at the bottom`,
    `Project: ${proj.displayName}\nNote topic: ${task.title}\n\n${task.description}\n\n${task.rationale}`
  )

  const filename = `${slugify(task.title)}.md`
  const notePath = path.join(vaultPath, filename)
  fs.writeFileSync(notePath, noteContent, 'utf-8')
  return { type: 'obsidian', obsidianPath: notePath, summary: `Note created: ${filename}` }
}

// ─── Summary task ─────────────────────────────────────────────────────────

async function executeSummaryTask(proj, task) {
  const context = readFile(path.join(proj.agentPath, 'README.md'))
  const summary = await claudeAnalyze(
    'Provide a clear, concise summary based on the task description. Be direct and actionable.',
    `Project: ${proj.displayName}\nTask: ${task.title}\n${task.description}\n\nContext: ${context}`
  )
  return { type: 'summary', summary: summary.slice(0, 1000) }
}

// ─── Entry point ──────────────────────────────────────────────────────────

export async function executeTask(briefId, task, cfg) {
  const proj = cfg.projects.find(p => p.id === task.projectId)
  if (!proj) throw new Error(`Project ${task.projectId} not found in config`)

  // Mark as running
  await patchBrief(briefId, { action: 'task-started', taskId: task.id })

  let result
  try {
    if (task.type === 'research') {
      result = await executeResearchTask(proj, task)
    } else if (task.type === 'obsidian-update') {
      result = await executeObsidianTask(proj, task)
    } else if (task.type === 'documentation' || task.type === 'summary') {
      result = await executeSummaryTask(proj, task)
    } else {
      // code-improvement, bug-fix → PR
      result = await executePrTask(proj, task)
    }

    await patchBrief(briefId, { action: 'task-result', taskId: task.id, result, status: 'completed' })
    return { ok: true, result }
  } catch (err) {
    const errResult = { type: proj.outputFormat, error: err.message }
    await patchBrief(briefId, { action: 'task-result', taskId: task.id, result: errResult, status: 'failed' })
    return { ok: false, error: err.message }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)
}

function gatherRelevantFiles(repoPath, task) {
  const files = {}
  const extensions = ['.ts', '.tsx', '.js', '.py', '.go', '.rs']
  try {
    const allFiles = execSync(
      `find . -type f \\( ${extensions.map(e => `-name "*${e}"`).join(' -o ')} \\) -not -path "*/node_modules/*" -not -path "*/.git/*" -not -path "*/dist/*"`,
      { cwd: repoPath, encoding: 'utf-8' }
    ).trim().split('\n').filter(Boolean)

    // Score files by relevance to task title keywords
    const keywords = task.title.toLowerCase().split(/\s+/)
    const scored = allFiles.map(f => {
      const name = path.basename(f).toLowerCase()
      const score = keywords.filter(k => name.includes(k)).length
      return { f, score }
    }).sort((a, b) => b.score - a.score)

    for (const { f } of scored.slice(0, 6)) {
      try {
        files[f.replace(/^\.\//, '')] = fs.readFileSync(path.join(repoPath, f), 'utf-8').slice(0, 3000)
      } catch {}
    }
  } catch {}
  return files
}

function buildChangePrompt(proj, task, files) {
  const fileSection = Object.entries(files)
    .map(([p, c]) => `// ${p}\n${c}`)
    .join('\n\n---\n\n')

  return `Make the following improvement to the ${proj.displayName} project:

Title: ${task.title}
Description: ${task.description}
Rationale: ${task.rationale}

Relevant files (may be partial):
${fileSection || '(no relevant files found — use your best judgment)'}

Output file operations to implement this change. Be minimal and focused — only touch files that need changing.`
}
