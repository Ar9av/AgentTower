import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { getOpenAIKey } from '@/lib/integrations'
import { getVaultPath, writeWikiPage } from '@/lib/brain-context'
import fs from 'fs'
import path from 'path'

const MAX_SIZE = 25 * 1024 * 1024 // OpenAI Whisper hard limit

// Records a voice note: transcribe via Whisper, write the transcript as a
// markdown file into the vault's _raw/ staging folder (feeds wiki-ingest).
export async function POST(req: NextRequest) {
  const authErr = await requireAuth(req)
  if (authErr) return authErr

  const vaultPath = getVaultPath()
  if (!fs.existsSync(vaultPath)) {
    return NextResponse.json({ error: 'Vault not found', vaultPath }, { status: 404 })
  }

  const key = getOpenAIKey()
  if (!key) {
    return NextResponse.json(
      { error: 'No OpenAI API key. Set OPENAI_API_KEY or add one under Integrations → Telegram.' },
      { status: 400 },
    )
  }

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return NextResponse.json({ error: 'Expected multipart/form-data with an "audio" field' }, { status: 400 })
  }

  const audio = form.get('audio')
  if (!(audio instanceof Blob) || audio.size === 0) {
    return NextResponse.json({ error: 'audio file required' }, { status: 400 })
  }
  if (audio.size > MAX_SIZE) {
    return NextResponse.json({ error: 'Recording too large (max 25 MB)' }, { status: 413 })
  }
  const title = (form.get('title') as string | null)?.trim() || ''

  // Transcribe with Whisper (same endpoint the Telegram bot uses)
  let transcript: string
  try {
    const wForm = new FormData()
    const filename = (audio as File).name || 'voice.webm'
    wForm.append('file', audio, filename)
    wForm.append('model', 'whisper-1')
    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}` },
      body: wForm,
    })
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      return NextResponse.json({ error: `Whisper failed: HTTP ${res.status}`, detail }, { status: 502 })
    }
    const json = (await res.json()) as { text?: string }
    transcript = (json.text ?? '').trim()
  } catch (err) {
    return NextResponse.json({ error: `Transcription error: ${(err as Error).message}` }, { status: 502 })
  }

  if (!transcript) {
    return NextResponse.json({ error: 'Empty transcript — nothing recognized' }, { status: 422 })
  }

  // Write to _raw/<timestamp>-voice-note.md
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  const heading = title || `Voice note ${stamp}`
  const relPath = path.posix.join('_raw', `${stamp}-voice-note.md`)

  const frontmatter = [
    '---',
    `title: ${JSON.stringify(heading)}`,
    'source: voice',
    `captured: ${now.toISOString()}`,
    'tags: [voice, raw]',
    '---',
    '',
  ].join('\n')

  try {
    writeWikiPage(relPath, `${frontmatter}# ${heading}\n\n${transcript}\n`)
  } catch (err) {
    return NextResponse.json({ error: `Failed to write note: ${(err as Error).message}` }, { status: 500 })
  }

  return NextResponse.json({ ok: true, path: relPath, transcript })
}
