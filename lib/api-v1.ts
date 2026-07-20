import { findSessionByPrefix, findSessionProjectCwd } from './claude-fs'
import { findCodexSessionFile, findCodexSessionProjectCwd, getCodexSessionId } from './codex-fs'
import { ParsedMessage } from './types'

export interface ResolvedSession {
  mode: 'claude' | 'codex'
  sessionId: string
  filepath: string
  cwd: string | null
}

/** Resolve a session by full id or prefix, checking Claude sessions first, then Codex. */
export function resolveSession(id: string): ResolvedSession | null {
  const claude = findSessionByPrefix(id)
  if (claude) {
    return {
      mode: 'claude',
      sessionId: claude.sessionId,
      filepath: claude.filepath,
      cwd: findSessionProjectCwd(claude.sessionId),
    }
  }

  const codexFile = findCodexSessionFile(id)
  if (codexFile) {
    const sessionId = getCodexSessionId(codexFile)
    return {
      mode: 'codex',
      sessionId,
      filepath: codexFile,
      cwd: findCodexSessionProjectCwd(sessionId),
    }
  }

  return null
}

/** Plain-text content of a message, tool calls stripped, for recap/reply extraction. */
export function messageText(message: ParsedMessage): string {
  return message.content
    .filter(b => b.type === 'text' && b.text)
    .map(b => b.text!.trim())
    .filter(Boolean)
    .join('\n\n')
}

export function lastNonMeta(messages: ParsedMessage[]): ParsedMessage | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (!messages[i].isMeta) return messages[i]
  }
  return null
}
