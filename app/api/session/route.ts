import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { parseJsonlFile, decodeB64, safePath, getClaudeDir } from '@/lib/claude-fs'

export async function GET(req: NextRequest) {
  const authErr = await requireAuth(req)
  if (authErr) return authErr

  const encoded = req.nextUrl.searchParams.get('f')
  if (!encoded) return NextResponse.json({ error: 'Missing f param' }, { status: 400 })

  const filepath = decodeB64(encoded)
  if (!safePath(filepath, getClaudeDir())) {
    return NextResponse.json({ error: 'Invalid path' }, { status: 403 })
  }

  return NextResponse.json(parseJsonlFile(filepath))
}
