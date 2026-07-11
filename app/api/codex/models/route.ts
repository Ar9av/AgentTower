import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { getCodexModelOptions } from '@/lib/codex-models'

export async function GET(req: NextRequest) {
  const authErr = await requireAuth(req)
  if (authErr) return authErr

  return NextResponse.json({ options: getCodexModelOptions() })
}
