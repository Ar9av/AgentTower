import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { listSessions, decodeB64 } from '@/lib/claude-fs'

export async function GET(req: NextRequest) {
  const authErr = await requireAuth(req)
  if (authErr) return authErr

  const encoded = req.nextUrl.searchParams.get('p')
  if (!encoded) return NextResponse.json({ error: 'Missing p param' }, { status: 400 })

  const dirName = decodeB64(encoded)
  return NextResponse.json(listSessions(dirName))
}
