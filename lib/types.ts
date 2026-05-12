// ─── JSONL message shapes ──────────────────────────────────────────────────

export interface ContentBlock {
  type: 'text' | 'tool_use' | 'tool_result' | 'thinking' | 'image'
  text?: string
  tool_name?: string
  tool_input?: Record<string, unknown>
  tool_id?: string
  tool_result?: ContentBlock[]
  thinking?: string
  is_error?: boolean
  // image — reference only (base64 never stored in memory)
  imageMediaType?: string   // e.g. "image/png"
  imageBlockIdx?: number    // position in the raw content array
}

export interface ParsedMessage {
  uuid: string
  parentUuid: string | null
  type: 'user' | 'assistant'
  role: 'user' | 'assistant'
  timestamp: string
  isMeta: boolean
  isSidechain: boolean
  sessionId: string
  content: ContentBlock[]
  model?: string
  usage?: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number }
  gitBranch?: string
  cwd?: string
}

// Raw JSONL line shapes
export interface RawJSONLLine {
  type: string
  uuid?: string
  parentUuid?: string | null
  isMeta?: boolean
  isSidechain?: boolean
  sessionId?: string
  timestamp?: string
  message?: {
    role: string
    content: string | RawContentBlock[]
    model?: string
    usage?: ParsedMessage['usage']
  }
  cwd?: string
  gitBranch?: string
}

export interface RawContentBlock {
  type: string
  text?: string
  name?: string
  id?: string
  input?: Record<string, unknown>
  content?: string | RawContentBlock[]
  thinking?: string
  is_error?: boolean
}

// ─── Project / session info ────────────────────────────────────────────────

export interface ProjectInfo {
  dirName: string          // raw dir name e.g. "-Users-ar9av-Documents-projects-foo"
  decodedPath: string      // /Users/ar9av/Documents/projects/foo
  displayName: string      // basename or full path
  sessionCount: number
  latestMtime: number      // ms timestamp
  hasActive: boolean
}

export interface SessionMeta {
  session_id: string
  project_path?: string
  start_time?: string
  duration_minutes?: number
  user_message_count?: number
  assistant_message_count?: number
  input_tokens?: number
  output_tokens?: number
  first_prompt?: string
  tool_counts?: Record<string, number>
}

export interface SessionInfo {
  sessionId: string
  filepath: string
  projectDirName: string
  mtime: number
  sizeBytes: number
  firstPrompt: string
  messageCount: number
  pid: number | null
  processState: 'running' | 'paused' | 'dead' | 'unknown'
  isActive: boolean
  meta: SessionMeta | null
  gitBranch?: string
  estimatedCostUsd?: number
  currentActivity?: string | null
}

// ─── Paginated session response ────────────────────────────────────────────

export interface PaginatedSession {
  firstMessage: ParsedMessage | null
  messages: ParsedMessage[]
  total: number
  hiddenCount: number
  hasMore: boolean
}

// ─── Process tracking ──────────────────────────────────────────────────────

export interface ClaudeProcess {
  pid: number
  sessionId: string
  cwd: string
  startedAt: number
  kind: string
}

// ─── Search results ────────────────────────────────────────────────────────

export interface SearchResult {
  filepath: string
  sessionId: string
  projectDirName: string
  decodedProjectPath: string
  lineNo: number
  context: string
  timestamp: string
  mtime: number
  msgUuid: string
}

// ─── Antigravity integration ───────────────────────────────────────────────

export interface AntigravityAgent {
  id: string
  name: string
  status: 'running' | 'idle' | 'completed' | 'error'
  model?: string
  task?: string
  startedAt: string
  updatedAt: string
  workspaceId?: string
}

// ─── API response shapes ───────────────────────────────────────────────────

export interface ApiError {
  error: string
  retryAfter?: number
}
