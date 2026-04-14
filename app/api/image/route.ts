import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { decodeB64, safePath, getClaudeDir, extractImageData } from '@/lib/claude-fs'

export async function GET(req: NextRequest) {
  const authErr = await requireAuth(req)
  if (authErr) return authErr

  const encoded = req.nextUrl.searchParams.get('f')
  const uuid    = req.nextUrl.searchParams.get('uuid')
  const idxStr  = req.nextUrl.searchParams.get('idx')

  if (!encoded || !uuid || !idxStr) {
    return NextResponse.json({ error: 'f, uuid, and idx required' }, { status: 400 })
  }

  const filepath = decodeB64(encoded)
  if (!safePath(filepath, getClaudeDir())) {
    return NextResponse.json({ error: 'Invalid path' }, { status: 403 })
  }

  const blockIdx = parseInt(idxStr, 10)
  if (isNaN(blockIdx)) return NextResponse.json({ error: 'invalid idx' }, { status: 400 })

  const result = extractImageData(filepath, uuid, blockIdx)
  if (!result) return NextResponse.json({ error: 'Image not found' }, { status: 404 })

  const binary = Buffer.from(result.data, 'base64')

  return new Response(binary, {
    headers: {
      'Content-Type': result.mediaType,
      'Content-Length': String(binary.length),
      // Cache aggressively — image data in a JSONL never changes
      'Cache-Control': 'private, max-age=86400, immutable',
    },
  })
}
