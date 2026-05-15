import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { discoverProjects, listSessions, encodeB64 } from '@/lib/claude-fs'

type Range = 'daily' | 'weekly' | 'monthly'

function bucketKey(mtime: number, range: Range): string {
  const d = new Date(mtime)
  if (range === 'monthly') return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  if (range === 'weekly') {
    // ISO week: get start of week (Monday)
    const day = d.getDay() === 0 ? 6 : d.getDay() - 1
    const mon = new Date(d)
    mon.setDate(d.getDate() - day)
    return mon.toISOString().slice(0, 10)
  }
  return d.toISOString().slice(0, 10)
}

// 60-second server-side cache
declare global {
  // eslint-disable-next-line no-var
  var __clv_analytics_cache__: { ts: number; data: unknown } | undefined
}

export async function GET(req: NextRequest) {
  const authErr = await requireAuth(req)
  if (authErr) return authErr

  const range = (req.nextUrl.searchParams.get('range') ?? 'daily') as Range
  const cacheKey = range

  const cached = global.__clv_analytics_cache__
  if (cached && Date.now() - cached.ts < 60_000 && (cached.data as { range: string }).range === cacheKey) {
    return NextResponse.json(cached.data)
  }

  const projects = discoverProjects()
  const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000

  const timelineMap = new Map<string, { cost: number; sessions: number }>()
  const byProject: { dirName: string; displayName: string; cost: number; sessions: number }[] = []
  const topSessions: { sessionId: string; cost: number; firstPrompt: string; project: string; encodedFilepath: string }[] = []

  let totalCost = 0
  let totalSessions = 0

  for (const proj of projects) {
    if (proj.sessionCount === 0) continue
    const sessions = listSessions(proj.dirName)
    let projCost = 0

    for (const s of sessions) {
      const cost = s.estimatedCostUsd ?? 0
      projCost += cost
      totalCost += cost
      totalSessions++

      if (s.mtime >= cutoff) {
        const key = bucketKey(s.mtime, range)
        const prev = timelineMap.get(key) ?? { cost: 0, sessions: 0 }
        timelineMap.set(key, { cost: prev.cost + cost, sessions: prev.sessions + 1 })
      }

      topSessions.push({
        sessionId: s.sessionId,
        cost,
        firstPrompt: s.firstPrompt,
        project: proj.displayName,
        encodedFilepath: encodeB64(s.filepath),
      })
    }

    byProject.push({
      dirName: proj.dirName,
      displayName: proj.displayName,
      cost: projCost,
      sessions: sessions.length,
    })
  }

  byProject.sort((a, b) => b.cost - a.cost)
  topSessions.sort((a, b) => b.cost - a.cost)

  const timeline = Array.from(timelineMap.entries())
    .map(([date, v]) => ({ date, ...v }))
    .sort((a, b) => a.date.localeCompare(b.date))

  const data = {
    range,
    timeline,
    byProject: byProject.slice(0, 15),
    totals: {
      cost: totalCost,
      sessions: totalSessions,
      projects: projects.length,
    },
    topSessions: topSessions.slice(0, 10),
  }

  global.__clv_analytics_cache__ = { ts: Date.now(), data }
  return NextResponse.json(data)
}
