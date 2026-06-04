export type TrackerType = 'github'
export type AutonomyMode = 'auto' | 'approval'
export type IssueState = 'todo' | 'in-progress' | 'done' | 'rework' | 'cancelled'
export type RunStatus =
  | 'queued'
  | 'awaiting-approval'
  | 'dispatching'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'pr-open'
  | 'retrying'
  | 'cancelled'

export interface RepoConfig {
  id: string
  enabled: boolean
  tracker: TrackerType
  repo: string               // "owner/repo"
  localPath: string          // absolute path to local clone (worktree base)
  labelPrefix: string        // default "agenttower:"
  autonomy: AutonomyMode
  maxConcurrentAgents: number
  model?: string
  maxTurns?: number
  maxRetries: number
  promptTemplate?: string    // inline template; falls back to built-in default
  useWorkflowFile: boolean   // if true, look for WORKFLOW.md in localPath first
  baseBranch?: string        // default: main
  issueFilter?: string       // extra label filter passed to gh
}

export interface OrchestratorConfig {
  enabled: boolean
  pollIntervalSec: number
  workspaceRoot: string       // default ~/.claude/agenttower-workspaces
  globalMaxConcurrent: number
  apiKey: string
  agentTowerUrl: string
  repos: RepoConfig[]
}

export interface IssueRecord {
  repoId: string
  number: number
  title: string
  body: string
  url: string
  state: IssueState
  labels: string[]
  updatedAt: string
  assignedRunId?: string
}

export interface RunRecord {
  id: string
  repoId: string
  issueNumber: number
  issueTitle: string
  status: RunStatus
  attempt: number
  maxRetries: number
  createdAt: string
  startedAt?: string
  finishedAt?: string
  pid?: number
  sessionId?: string
  workspaceDir?: string
  branch?: string
  prUrl?: string
  prNumber?: number
  error?: string
  nextRetryAt?: string
  lastActivityAt?: string
}

export interface Tracker {
  listIssues(state?: IssueState): Promise<IssueRecord[]>
  getIssue(number: number): Promise<IssueRecord | null>
  moveIssue(number: number, to: IssueState): Promise<void>
  comment(number: number, text: string): Promise<void>
  createPr(opts: { branch: string; title: string; body: string; base?: string }): Promise<{ url: string; number: number }>
  linkPrToIssue(issueNumber: number, prUrl: string): Promise<void>
}
