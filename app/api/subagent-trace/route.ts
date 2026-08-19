import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { decodeB64, safePath, getClaudeDir, findSubagentTrace } from '@/lib/claude-fs'

export async function GET(req: NextRequest) {
  const authErr = await requireAuth(req)
  if (authErr) return authErr

  const encoded = req.nextUrl.searchParams.get('f')
  const toolId = req.nextUrl.searchParams.get('toolId')
  if (!encoded || !toolId) return NextResponse.json({ error: 'Missing f or toolId param' }, { status: 400 })

  const filepath = decodeB64(encoded)
  if (!safePath(filepath, getClaudeDir())) {
    return NextResponse.json({ error: 'Invalid path' }, { status: 403 })
  }

  const trace = findSubagentTrace(filepath, toolId)
  return NextResponse.json(trace ?? { agentType: '', description: '', messages: [] })
}
