import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { decodeB64, safePath, getClaudeDir, encodeB64 } from '@/lib/claude-fs'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'

export async function POST(req: NextRequest) {
  const authErr = await requireAuth(req)
  if (authErr) return authErr

  const body = await req.json().catch(() => null)
  const { f, uuid } = body ?? {}
  if (!f || !uuid) return NextResponse.json({ error: 'Missing params' }, { status: 400 })

  const filepath = decodeB64(f as string)
  const safe = safePath(filepath, getClaudeDir())
  if (!safe) return NextResponse.json({ error: 'Invalid path' }, { status: 403 })

  let raw: string
  try { raw = fs.readFileSync(safe, 'utf-8') } catch {
    return NextResponse.json({ error: 'File not found' }, { status: 404 })
  }

  // Collect raw lines up to and including the target message uuid
  const forkLines: string[] = []
  let found = false
  for (const line of raw.split('\n')) {
    const t = line.trim()
    if (!t) continue
    forkLines.push(t)
    try {
      if (JSON.parse(t).uuid === uuid) { found = true; break }
    } catch { /* skip unparseable lines */ }
  }

  if (!found) return NextResponse.json({ error: 'Message not found' }, { status: 404 })

  const dir = path.dirname(safe)
  const newSessionId = crypto.randomUUID()
  const newFilepath = path.join(dir, `${newSessionId}.jsonl`)

  try {
    fs.writeFileSync(newFilepath, forkLines.join('\n') + '\n', 'utf-8')
  } catch {
    return NextResponse.json({ error: 'Failed to write fork' }, { status: 500 })
  }

  return NextResponse.json({ encodedFilepath: encodeB64(newFilepath), sessionId: newSessionId })
}
