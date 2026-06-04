import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { getAllFacts, addFact, deleteFact, type FactType } from '@/lib/brain-memory'

const VALID_TYPES: FactType[] = ['decision', 'preference', 'project', 'blocker', 'fact']

export async function GET(req: NextRequest) {
  const authErr = await requireAuth(req)
  if (authErr) return authErr

  const facts = getAllFacts().sort((a, b) => b.ts - a.ts)
  return NextResponse.json({ facts })
}

export async function POST(req: NextRequest) {
  const authErr = await requireAuth(req)
  if (authErr) return authErr

  const { fact, type } = await req.json().catch(() => ({}))
  if (!fact?.trim()) {
    return NextResponse.json({ error: 'fact required' }, { status: 400 })
  }
  const t: FactType = VALID_TYPES.includes(type) ? type : 'fact'
  const saved = addFact(fact.trim(), t)
  return NextResponse.json({ ok: true, fact: saved })
}

export async function DELETE(req: NextRequest) {
  const authErr = await requireAuth(req)
  if (authErr) return authErr

  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const ok = deleteFact(id)
  return NextResponse.json({ ok })
}
