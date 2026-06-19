import type { SearchResult } from './types'
import { searchSessions } from './claude-fs'
import { searchCodexSessions } from './codex-fs'

export type ConversationSearchProvider = 'all' | 'claude' | 'codex'

export interface ConversationSearchOptions {
  provider?: ConversationSearchProvider
  project?: string
  regex?: boolean
  limit?: number
}

export function searchAllConversations(
  query: string,
  { provider = 'all', project, regex = false, limit = 200 }: ConversationSearchOptions = {}
): SearchResult[] {
  const results: SearchResult[] = []

  if (provider === 'all' || provider === 'claude') {
    results.push(...searchSessions(query, { projectDirName: project, regex }))
  }
  if (provider === 'all' || provider === 'codex') {
    results.push(...searchCodexSessions(query, { projectPath: project, regex }))
  }

  return results
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, limit)
}
