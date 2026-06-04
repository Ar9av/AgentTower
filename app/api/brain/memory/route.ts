import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { readBrainMemory, appendBrainMemory } from '@/lib/brain-context'

export async function GET(req: NextRequest) {
  const authErr = await requireAuth(req)
  if (authErr) return authErr

  const content = readBrainMemory()
  return NextResponse.json({ content })
}

export async function POST(req: NextRequest) {
  const authErr = await requireAuth(req)
  if (authErr) return authErr

  const { fact } = await req.json().catch(() => ({}))
  if (!fact?.trim()) {
    return NextResponse.json({ error: 'fact required' }, { status: 400 })
  }

  appendBrainMemory(fact.trim())
  return NextResponse.json({ ok: true })
}
