import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import fs from 'fs'
import os from 'os'
import path from 'path'
import crypto from 'crypto'

// Max 10 MB
const MAX_SIZE = 10 * 1024 * 1024

export async function POST(req: NextRequest) {
  const authErr = await requireAuth(req)
  if (authErr) return authErr

  const { data, mediaType } = await req.json().catch(() => ({}))
  if (!data || !mediaType) {
    return NextResponse.json({ error: 'data and mediaType required' }, { status: 400 })
  }

  const buf = Buffer.from(data, 'base64')
  if (buf.length > MAX_SIZE) {
    return NextResponse.json({ error: 'Image too large (max 10 MB)' }, { status: 413 })
  }

  const ext = mediaType.split('/')[1]?.replace('jpeg', 'jpg') ?? 'png'
  const filename = `agenttower-${crypto.randomBytes(6).toString('hex')}.${ext}`
  const filepath = path.join(os.tmpdir(), filename)

  try {
    fs.writeFileSync(filepath, buf)
  } catch {
    return NextResponse.json({ error: 'Failed to save image' }, { status: 500 })
  }

  // Schedule cleanup after 10 minutes
  setTimeout(() => { try { fs.unlinkSync(filepath) } catch { /* already gone */ } }, 10 * 60 * 1000)

  return NextResponse.json({ filepath, filename })
}
