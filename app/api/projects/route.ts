import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { discoverProjects } from '@/lib/claude-fs'

export async function GET(req: NextRequest) {
  const authErr = await requireAuth(req)
  if (authErr) return authErr
  return NextResponse.json(discoverProjects())
}
