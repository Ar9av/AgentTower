import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import fs from 'fs'
import os from 'os'
import path from 'path'
import crypto from 'crypto'

const MAX_SIZE = 25 * 1024 * 1024  // 25 MB

function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 80) || 'upload'
}

export async function POST(req: NextRequest) {
  const authErr = await requireAuth(req)
  if (authErr) return authErr

  const { data, name } = await req.json().catch(() => ({}))
  if (!data) {
    return NextResponse.json({ error: 'data required (base64)' }, { status: 400 })
  }

  const buf = Buffer.from(data, 'base64')
  if (buf.length > MAX_SIZE) {
    return NextResponse.json({ error: 'File too large (max 25 MB)' }, { status: 413 })
  }

  const safeName = sanitizeName(name ?? 'upload')
  const rand = crypto.randomBytes(4).toString('hex')
  const filename = `agenttower-${rand}-${safeName}`
  const filepath = path.join(os.tmpdir(), filename)

  try {
    fs.writeFileSync(filepath, buf)
  } catch {
    return NextResponse.json({ error: 'Failed to save file' }, { status: 500 })
  }

  // Clean up after 1 hour
  setTimeout(() => { try { fs.unlinkSync(filepath) } catch { /* already gone */ } }, 60 * 60 * 1000)

  return NextResponse.json({ filepath, filename })
}
