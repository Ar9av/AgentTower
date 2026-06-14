import { NextResponse } from 'next/server'
import { loadSessionTags } from '@/lib/session-tags'
import { discoverProjects, listSessions, encodeB64, resolveProjectPath } from '@/lib/claude-fs'

export const dynamic = 'force-dynamic'

export async function GET() {
  const tagStore = loadSessionTags()
  const favoriteIds = new Set(
    Object.entries(tagStore.sessions)
      .filter(([, v]) => v.favorite)
      .map(([id]) => id)
  )

  if (favoriteIds.size === 0) return NextResponse.json({ bookmarks: [] })

  const projects = discoverProjects()
  const bookmarks: Array<{
    sessionId: string
    filepath: string
    encodedFilepath: string
    firstPrompt: string
    mtime: number
    messageCount: number
    processState: string
    estimatedCostUsd: number | null
    primaryModel: string | null
    projectDirName: string
    projectDisplayName: string
    projectPath: string
    tags: string[]
  }> = []

  for (const proj of projects) {
    const sessions = listSessions(proj.dirName)
    for (const s of sessions) {
      if (!favoriteIds.has(s.sessionId)) continue
      const entry = tagStore.sessions[s.sessionId]
      bookmarks.push({
        sessionId: s.sessionId,
        filepath: s.filepath,
        encodedFilepath: encodeB64(s.filepath),
        firstPrompt: s.firstPrompt,
        mtime: s.mtime,
        messageCount: s.messageCount,
        processState: s.processState,
        estimatedCostUsd: s.estimatedCostUsd ?? null,
        primaryModel: s.primaryModel ?? null,
        projectDirName: proj.dirName,
        projectDisplayName: proj.displayName,
        projectPath: resolveProjectPath(proj.dirName),
        tags: entry?.tags ?? [],
      })
    }
  }

  bookmarks.sort((a, b) => b.mtime - a.mtime)
  return NextResponse.json({ bookmarks })
}
