import { NextRequest, NextResponse } from 'next/server'
import {
  verifyPassword,
  isLockedOut,
  recordFailedAttempt,
  clearAttempts,
  createSession,
  sessionCookieHeader,
  getClientIp,
} from '@/lib/auth'

export async function POST(req: NextRequest) {
  const ip = getClientIp(req)

  const { locked, retryAfter } = isLockedOut(ip)
  if (locked) {
    return NextResponse.json(
      { error: 'Too many failed attempts', retryAfter },
      { status: 429, headers: { 'Retry-After': String(retryAfter) } }
    )
  }

  let password: string
  const ct = req.headers.get('content-type') ?? ''
  if (ct.includes('application/json')) {
    const body = await req.json().catch(() => ({}))
    password = body.password ?? ''
  } else {
    const form = await req.formData().catch(() => new FormData())
    password = (form.get('password') as string) ?? ''
  }

  if (!verifyPassword(password)) {
    recordFailedAttempt(ip)
    return NextResponse.json({ error: 'Invalid password' }, { status: 401 })
  }

  clearAttempts(ip)
  const token = createSession()

  return NextResponse.json(
    { ok: true },
    { headers: { 'Set-Cookie': sessionCookieHeader(token) } }
  )
}
