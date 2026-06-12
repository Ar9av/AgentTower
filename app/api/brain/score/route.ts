import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { parseJsonlFile, decodeB64 } from '@/lib/claude-fs'
import { computeSessionScore, saveSessionScore, loadSessionScore } from '@/lib/session-scoring'

export async function GET(req: NextRequest) {
  const authErr = await requireAuth(req)
  if (authErr) return authErr

  const sessionId = req.nextUrl.searchParams.get('sessionId')
  if (!sessionId) return NextResponse.json({ error: 'sessionId required' }, { status: 400 })

  const score = loadSessionScore(sessionId)
  if (!score) return NextResponse.json({ score: null })
  return NextResponse.json({ score })
}

export async function POST(req: NextRequest) {
  const authErr = await requireAuth(req)
  if (authErr) return authErr

  const { encodedFilepath, sessionId } = await req.json().catch(() => ({}))
  if (!encodedFilepath || !sessionId) {
    return NextResponse.json({ error: 'encodedFilepath and sessionId required' }, { status: 400 })
  }

  const filepath = decodeB64(encodedFilepath)
  const messages = parseJsonlFile(filepath)
  const score = computeSessionScore(sessionId, messages)
  saveSessionScore(score)

  return NextResponse.json({ ok: true, score })
}
