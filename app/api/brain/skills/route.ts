import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { getAllSkills, addSkill, deleteSkill, incrementSkillUsage } from '@/lib/brain-skills'

export async function GET(req: NextRequest) {
  const authErr = await requireAuth(req)
  if (authErr) return authErr

  const skills = getAllSkills().sort((a, b) => b.ts - a.ts)
  return NextResponse.json({ skills })
}

export async function POST(req: NextRequest) {
  const authErr = await requireAuth(req)
  if (authErr) return authErr

  const body = await req.json().catch(() => ({}))

  // Handle usage increment
  if (body.action === 'use' && body.id) {
    incrementSkillUsage(body.id)
    return NextResponse.json({ ok: true })
  }

  const { name, description, prompt, tags } = body
  if (!name?.trim() || !prompt?.trim()) {
    return NextResponse.json({ error: 'name and prompt required' }, { status: 400 })
  }

  const skill = addSkill(
    name.trim(),
    (description ?? '').trim(),
    prompt.trim(),
    Array.isArray(tags) ? tags.map(String) : [],
  )
  return NextResponse.json({ ok: true, skill })
}

export async function DELETE(req: NextRequest) {
  const authErr = await requireAuth(req)
  if (authErr) return authErr

  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const ok = deleteSkill(id)
  return NextResponse.json({ ok })
}
