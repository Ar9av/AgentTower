import { NextRequest, NextResponse } from 'next/server'
import { destroySession, clearCookieHeader } from '@/lib/auth'

export async function POST(req: NextRequest) {
  const token = req.cookies.get('clv_session')?.value
  if (token) destroySession(token)
  return NextResponse.json({ ok: true }, { headers: { 'Set-Cookie': clearCookieHeader() } })
}
