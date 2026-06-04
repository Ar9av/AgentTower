import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { searchWiki, readWikiPage, writeWikiPage, getVaultPath } from '@/lib/brain-context'
import fs from 'fs'

export async function GET(req: NextRequest) {
  const authErr = await requireAuth(req)
  if (authErr) return authErr

  const q = req.nextUrl.searchParams.get('q') ?? ''
  const page = req.nextUrl.searchParams.get('page') ?? ''

  if (page) {
    const content = readWikiPage(page)
    if (!content) return NextResponse.json({ error: 'Page not found' }, { status: 404 })
    return NextResponse.json({ path: page, content })
  }

  if (q) {
    const results = searchWiki(q, 8)
    return NextResponse.json({ results, vaultExists: fs.existsSync(getVaultPath()) })
  }

  // List top-level structure
  const vaultPath = getVaultPath()
  if (!fs.existsSync(vaultPath)) {
    return NextResponse.json({ error: 'Vault not found', vaultPath }, { status: 404 })
  }

  try {
    const entries = fs.readdirSync(vaultPath, { withFileTypes: true })
    const dirs = entries.filter(e => e.isDirectory() && !e.name.startsWith('.')).map(e => e.name)
    return NextResponse.json({ vaultPath, dirs })
  } catch {
    return NextResponse.json({ error: 'Cannot read vault' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const authErr = await requireAuth(req)
  if (authErr) return authErr

  const { path: pagePath, title, content } = await req.json().catch(() => ({}))
  if (!pagePath || !content) {
    return NextResponse.json({ error: 'path and content required' }, { status: 400 })
  }

  // Safety: only allow writes within vault
  const vaultPath = getVaultPath()
  if (!fs.existsSync(vaultPath)) {
    return NextResponse.json({ error: 'Vault not found' }, { status: 404 })
  }

  try {
    const fullContent = title
      ? `# ${title}\n\n${content}`
      : content

    writeWikiPage(pagePath, fullContent)
    return NextResponse.json({ ok: true, path: pagePath })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
