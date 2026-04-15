import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { requireAuth } from '@/lib/auth'
import { getWorkspaceRoot, upsertProjectMeta } from '@/lib/project-meta'

const execFileP = promisify(execFile)

function sanitizeSegment(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80)
}

function deriveNameFromUrl(url: string): string {
  const m = url.match(/([^\/]+?)(?:\.git)?\/?$/)
  return m ? m[1] : ''
}

function isValidGithubUrl(u: string): boolean {
  if (!/^https?:\/\//.test(u) && !/^git@/.test(u)) return false
  return /github\.com/i.test(u)
}

export async function POST(req: NextRequest) {
  const authErr = await requireAuth(req)
  if (authErr) return authErr

  const body = await req.json().catch(() => ({})) as {
    name?: string
    githubUrl?: string
    displayName?: string
  }

  const url = (body.githubUrl ?? '').trim()
  const rawName = (body.name ?? '').trim() || (url ? deriveNameFromUrl(url) : '')
  const folderName = sanitizeSegment(rawName)
  if (!folderName) {
    return NextResponse.json({ error: 'name or githubUrl required' }, { status: 400 })
  }
  if (url && !isValidGithubUrl(url)) {
    return NextResponse.json({ error: 'githubUrl must be a GitHub URL (https or git@)' }, { status: 400 })
  }

  const root = getWorkspaceRoot()
  fs.mkdirSync(root, { recursive: true })
  const target = path.resolve(root, folderName)
  if (!target.startsWith(path.resolve(root) + path.sep)) {
    return NextResponse.json({ error: 'invalid target path' }, { status: 400 })
  }
  if (fs.existsSync(target)) {
    return NextResponse.json({ error: `already exists: ${target}` }, { status: 409 })
  }

  try {
    if (url) {
      await execFileP('git', ['clone', '--depth', '50', url, target], { timeout: 120_000 })
    } else {
      fs.mkdirSync(target, { recursive: true })
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    try { fs.rmSync(target, { recursive: true, force: true }) } catch {}
    return NextResponse.json({ error: `create failed: ${msg}` }, { status: 500 })
  }

  const displayName = (body.displayName ?? '').trim() || folderName
  upsertProjectMeta(target, {
    displayName,
    githubUrl: url || undefined,
    createdAt: new Date().toISOString(),
  })

  return NextResponse.json({ ok: true, path: target, displayName })
}
