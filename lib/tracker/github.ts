import { getGitHubToken } from '../integrations'
import type { Tracker, IssueRecord, IssueState, RepoConfig } from '../orchestrator-types'

const GITHUB_API = 'https://api.github.com'

function headers(token: string) {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: token ? `Bearer ${token}` : '',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
  }
}

async function ghFetch(path: string, opts: RequestInit = {}): Promise<Response> {
  const token = getGitHubToken()
  return fetch(`${GITHUB_API}${path}`, {
    ...opts,
    headers: { ...headers(token), ...(opts.headers as Record<string, string> ?? {}) },
    signal: AbortSignal.timeout(20_000),
  })
}

type GhLabel = { name: string }
type GhIssue = {
  number: number
  title: string
  body: string | null
  labels: GhLabel[]
  html_url: string
  updated_at: string
}

function deriveState(labelNames: string[], prefix: string): IssueState {
  for (const label of labelNames) {
    if (label === `${prefix}todo`) return 'todo'
    if (label === `${prefix}in-progress`) return 'in-progress'
    if (label === `${prefix}done`) return 'done'
    if (label === `${prefix}rework`) return 'rework'
    if (label === `${prefix}cancelled`) return 'cancelled'
  }
  return 'todo'
}

function toIssueRecord(i: GhIssue, repoId: string, prefix: string): IssueRecord {
  const labelNames = i.labels.map(l => l.name)
  return {
    repoId,
    number: i.number,
    title: i.title,
    body: i.body ?? '',
    url: i.html_url,
    state: deriveState(labelNames, prefix),
    labels: labelNames,
    updatedAt: i.updated_at,
  }
}

const LABEL_COLORS: Record<string, string> = {
  'todo': 'ededed',
  'in-progress': 'fbca04',
  'done': '0e8a16',
  'rework': 'e4e669',
  'cancelled': 'd93f0b',
}

async function ensureLabel(repo: string, name: string, color: string): Promise<void> {
  await ghFetch(`/repos/${repo}/labels`, {
    method: 'POST',
    body: JSON.stringify({ name, color, description: '' }),
  })
  // 422 = already exists — ignored
}

export class GitHubTracker implements Tracker {
  constructor(private repo: RepoConfig) {}

  async listIssues(state?: IssueState): Promise<IssueRecord[]> {
    const prefix = this.repo.labelPrefix
    const issues: IssueRecord[] = []
    let page = 1

    while (true) {
      const params = new URLSearchParams({ state: 'open', per_page: '100', page: String(page) })
      if (this.repo.issueFilter) params.set('labels', this.repo.issueFilter)
      const res = await ghFetch(`/repos/${this.repo.repo}/issues?${params}`)
      if (!res.ok) break
      const batch: GhIssue[] = await res.json()
      if (batch.length === 0) break
      // Filter out pull requests (GitHub returns PRs in issues endpoint)
      for (const i of batch) {
        if ((i as unknown as { pull_request?: unknown }).pull_request) continue
        issues.push(toIssueRecord(i, this.repo.id, prefix))
      }
      if (batch.length < 100) break
      page++
    }

    return state ? issues.filter(i => i.state === state) : issues
  }

  async getIssue(number: number): Promise<IssueRecord | null> {
    const res = await ghFetch(`/repos/${this.repo.repo}/issues/${number}`)
    if (!res.ok) return null
    const i: GhIssue = await res.json()
    return toIssueRecord(i, this.repo.id, this.repo.labelPrefix)
  }

  async moveIssue(number: number, to: IssueState): Promise<void> {
    const prefix = this.repo.labelPrefix
    const allStates: IssueState[] = ['todo', 'in-progress', 'done', 'rework', 'cancelled']

    // Ensure target label exists
    await ensureLabel(this.repo.repo, `${prefix}${to}`, LABEL_COLORS[to] ?? 'ededed')

    // Get current labels on the issue
    const res = await ghFetch(`/repos/${this.repo.repo}/issues/${number}`)
    if (!res.ok) return
    const issue: GhIssue = await res.json()
    const currentLabels = issue.labels.map(l => l.name)

    // Remove all orchestrator labels, add the new one
    const filtered = currentLabels.filter(n => !allStates.some(s => n === `${prefix}${s}`))
    const newLabels = [...filtered, `${prefix}${to}`]

    await ghFetch(`/repos/${this.repo.repo}/issues/${number}`, {
      method: 'PATCH',
      body: JSON.stringify({ labels: newLabels }),
    })
  }

  async comment(number: number, text: string): Promise<void> {
    await ghFetch(`/repos/${this.repo.repo}/issues/${number}/comments`, {
      method: 'POST',
      body: JSON.stringify({ body: text }),
    })
  }

  async createPr(opts: { branch: string; title: string; body: string; base?: string }): Promise<{ url: string; number: number }> {
    const base = opts.base ?? this.repo.baseBranch ?? 'main'
    const res = await ghFetch(`/repos/${this.repo.repo}/pulls`, {
      method: 'POST',
      body: JSON.stringify({
        title: opts.title,
        body: opts.body,
        head: opts.branch,
        base,
      }),
    })
    if (!res.ok) {
      const err = await res.text()
      throw new Error(`createPr HTTP ${res.status}: ${err}`)
    }
    const pr = await res.json() as { html_url: string; number: number }
    return { url: pr.html_url, number: pr.number }
  }

  async linkPrToIssue(issueNumber: number, prUrl: string): Promise<void> {
    await this.comment(issueNumber, `Linked PR: ${prUrl}`)
  }
}

export function createTracker(repo: RepoConfig): Tracker {
  if (repo.tracker === 'github') return new GitHubTracker(repo)
  throw new Error(`Unknown tracker type: ${repo.tracker}`)
}
