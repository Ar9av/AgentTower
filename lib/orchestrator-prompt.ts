import fs from 'fs'
import path from 'path'
import type { RepoConfig, IssueRecord, RunRecord } from './orchestrator-types'

// Minimal template renderer — no dependencies.
// Supports: {{ dotted.path }}, {% if [not] X %}…{% endif %}
// No nesting or loops. Missing vars become empty string.

function resolvePath(ctx: Record<string, unknown>, dotPath: string): unknown {
  return dotPath.split('.').reduce<unknown>((acc, key) => {
    if (acc && typeof acc === 'object') return (acc as Record<string, unknown>)[key]
    return undefined
  }, ctx)
}

export function renderTemplate(tpl: string, ctx: Record<string, unknown>): string {
  // Pass 1: conditionals  {% if [not] X %}…{% endif %}
  let result = tpl.replace(
    /{%\s*if\s+(not\s+)?([\w.]+)\s*%}([\s\S]*?){%\s*endif\s*%}/g,
    (_match, not, varPath, body) => {
      const value = resolvePath(ctx, varPath)
      const truthy = Boolean(value)
      const keep = not ? !truthy : truthy
      return keep ? body : ''
    },
  )
  // Pass 2: variable substitution  {{ dotted.path }}
  result = result.replace(/{{\s*([\w.]+)\s*}}/g, (_match, varPath) => {
    const value = resolvePath(ctx, varPath)
    return value == null ? '' : String(value)
  })
  return result
}

const DEFAULT_TEMPLATE = `You are working autonomously on GitHub Issue #{{ issue.number }} in {{ repo }}.

Issue: {{ issue.title }}
URL: {{ issue.url }}
Branch: {{ branch }}

Description:
{{ issue.body }}

{% if attempt %}
--- Retry context ---
This is attempt #{{ attempt }}. The previous attempt did not produce a PR.
Resume from the current workspace state — do not start from scratch.
{% endif %}

Instructions:
1. This is an unattended session. Never ask a human for follow-up actions.
2. Only stop early for a genuine blocker (missing required credentials/secrets).
3. When done, make sure all changes are committed and pushed to branch {{ branch }}.
4. Open a pull request against the default branch. The PR body must include "Closes #{{ issue.number }}".
5. Final message: report completed actions and any blockers only.
`

export function buildAgentPrompt(repo: RepoConfig, issue: IssueRecord, run: RunRecord): string {
  let tpl = DEFAULT_TEMPLATE

  if (repo.useWorkflowFile) {
    const wfPath = path.join(repo.localPath, 'WORKFLOW.md')
    if (fs.existsSync(wfPath)) {
      const raw = fs.readFileSync(wfPath, 'utf-8')
      // If WORKFLOW.md has YAML frontmatter, strip it (everything above second ---)
      const stripped = raw.replace(/^---[\s\S]*?---\n/, '')
      tpl = stripped
    }
  }

  if (!repo.useWorkflowFile && repo.promptTemplate) {
    tpl = repo.promptTemplate
  }

  const ctx: Record<string, unknown> = {
    issue: {
      number: issue.number,
      title: issue.title,
      body: issue.body,
      url: issue.url,
    },
    repo: repo.repo,
    branch: run.branch ?? `agenttower/issue-${issue.number}`,
    attempt: run.attempt > 1 ? run.attempt : 0,
  }

  return renderTemplate(tpl, ctx)
}
