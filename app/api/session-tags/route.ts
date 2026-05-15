import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { loadSessionTags, getSessionTags, upsertSessionTags } from '@/lib/session-tags'

export async function GET(req: NextRequest) {
  const authErr = await requireAuth(req)
  if (authErr) return authErr

  const id = req.nextUrl.searchParams.get('id')
  if (!id) {
    return NextResponse.json(loadSessionTags())
  }
  return NextResponse.json(getSessionTags(id))
}

export async function POST(req: NextRequest) {
  const authErr = await requireAuth(req)
  if (authErr) return authErr

  let body: { sessionId?: string; tags?: string[]; favorite?: boolean; note?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }

  const { sessionId, ...patch } = body
  if (!sessionId) return NextResponse.json({ error: 'sessionId required' }, { status: 400 })

  const result = upsertSessionTags(sessionId, patch)
  return NextResponse.json(result)
}
