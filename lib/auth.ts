import crypto from 'crypto'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'

const COOKIE_NAME = 'clv_session'
const PBKDF2_ITERATIONS = 260_000
const LOCKOUT_BASE_SECS = 2
const MAX_LOCKOUT_SECS = 3600
const TOKEN_VERSION = 'v1'

// ─── In-memory state (survives Next.js hot reload via module singleton) ────

interface AuthState {
  // token -> expiry timestamp (ms)
  sessions: Map<string, number>
  // ip -> list of failed attempt timestamps (ms)
  ipAttempts: Map<string, number[]>
  // ip -> lockout expiry timestamp (ms)
  ipLockout: Map<string, number>
  // password hash derived at startup
  passwordHash: Buffer | null
  passwordSalt: Buffer | null
}

const globalKey = '__clv_auth_state__'
declare global {
  // eslint-disable-next-line no-var
  var __clv_auth_state__: AuthState | undefined
}

function getState(): AuthState {
  if (!global[globalKey]) {
    const salt = crypto.randomBytes(32)
    const password = process.env.AUTH_PASSWORD ?? ''
    const hash = password
      ? crypto.pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, 32, 'sha256')
      : null
    global[globalKey] = {
      sessions: new Map(),
      ipAttempts: new Map(),
      ipLockout: new Map(),
      passwordHash: hash,
      passwordSalt: salt,
    }
  }
  return global[globalKey]!
}

// ─── Password verification ─────────────────────────────────────────────────

export function verifyPassword(plaintext: string): boolean {
  const state = getState()
  if (!state.passwordHash || !state.passwordSalt) return false
  const dk = crypto.pbkdf2Sync(plaintext, state.passwordSalt, PBKDF2_ITERATIONS, 32, 'sha256')
  return crypto.timingSafeEqual(dk, state.passwordHash)
}

// ─── Rate limiting ─────────────────────────────────────────────────────────

export function isLockedOut(ip: string): { locked: boolean; retryAfter: number } {
  const state = getState()
  const until = state.ipLockout.get(ip) ?? 0
  const now = Date.now()
  if (until > now) return { locked: true, retryAfter: Math.ceil((until - now) / 1000) }
  return { locked: false, retryAfter: 0 }
}

export function recordFailedAttempt(ip: string): void {
  const state = getState()
  const now = Date.now()
  const attempts = (state.ipAttempts.get(ip) ?? []).filter(t => t > now - 3_600_000)
  attempts.push(now)
  state.ipAttempts.set(ip, attempts)
  const lockoutSecs = Math.min(Math.pow(LOCKOUT_BASE_SECS, attempts.length), MAX_LOCKOUT_SECS)
  state.ipLockout.set(ip, now + lockoutSecs * 1000)
}

export function clearAttempts(ip: string): void {
  const state = getState()
  state.ipAttempts.delete(ip)
  state.ipLockout.delete(ip)
}

// ─── Session tokens ────────────────────────────────────────────────────────

export function createSession(): string {
  const ttlDays = parseInt(process.env.SESSION_TTL_DAYS ?? '7', 10)
  const expiry = Date.now() + ttlDays * 86_400_000
  const nonce = crypto.randomBytes(16).toString('base64url')
  const payload = `${TOKEN_VERSION}.${expiry}.${nonce}`
  return `${payload}.${signSessionPayload(payload)}`
}

export function validateSession(token: string | undefined): boolean {
  if (!token) return false

  // Signed cookies survive process restarts and deployments. Keep the legacy
  // in-memory lookup below so sessions created before this version still work
  // until the next restart.
  const parts = token.split('.')
  if (parts.length === 4 && parts[0] === TOKEN_VERSION) {
    const [version, expiryString, nonce, signature] = parts
    const expiry = Number(expiryString)
    if (!Number.isFinite(expiry) || Date.now() > expiry || !nonce || !signature) return false
    const payload = `${version}.${expiryString}.${nonce}`
    const expected = signSessionPayload(payload)
    const actualBuffer = Buffer.from(signature)
    const expectedBuffer = Buffer.from(expected)
    return actualBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(actualBuffer, expectedBuffer)
  }

  const state = getState()
  const expiry = state.sessions.get(token)
  if (!expiry) return false
  if (Date.now() > expiry) {
    state.sessions.delete(token)
    return false
  }
  return true
}

function signSessionPayload(payload: string): string {
  const password = process.env.AUTH_PASSWORD ?? ''
  if (!password) return ''
  return crypto.createHmac('sha256', password).update(`agenttower-session:${payload}`).digest('base64url')
}

export function destroySession(token: string): void {
  getState().sessions.delete(token)
}

// ─── Cookie helpers ────────────────────────────────────────────────────────

export async function getSessionToken(): Promise<string | undefined> {
  const jar = await cookies()
  return jar.get(COOKIE_NAME)?.value
}

export function sessionCookieHeader(token: string): string {
  const ttlDays = parseInt(process.env.SESSION_TTL_DAYS ?? '7', 10)
  return `${COOKIE_NAME}=${token}; HttpOnly; SameSite=Strict; Max-Age=${ttlDays * 86400}; Path=/`
}

export function clearCookieHeader(): string {
  return `${COOKIE_NAME}=; HttpOnly; SameSite=Strict; Max-Age=0; Path=/`
}

// ─── API key (for external / non-browser access) ──────────────────────────

export function validateApiKey(key: string | undefined | null): boolean {
  if (!key) return false
  const expected = process.env.API_KEY ?? ''
  if (!expected) return false
  const actual = Buffer.from(key)
  const expectedBuffer = Buffer.from(expected)
  return actual.length === expectedBuffer.length && crypto.timingSafeEqual(actual, expectedBuffer)
}

function getBearerToken(req: NextRequest): string | null {
  const header = req.headers.get('authorization') ?? ''
  const match = /^Bearer\s+(.+)$/i.exec(header)
  return match ? match[1].trim() : null
}

// ─── Auth guard for API routes ─────────────────────────────────────────────
// Accepts either the browser session cookie or an `Authorization: Bearer
// <API_KEY>` header, so the same endpoints work for the UI and for external
// callers (scripts, other agents) without a browser session.

export async function requireAuth(req: NextRequest): Promise<NextResponse | null> {
  const bearer = getBearerToken(req)
  if (bearer && validateApiKey(bearer)) return null

  const token = req.cookies.get(COOKIE_NAME)?.value
  if (!validateSession(token)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return null
}

// ─── Client IP ────────────────────────────────────────────────────────────

export function getClientIp(req: NextRequest): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0].trim() ??
    req.headers.get('x-real-ip') ??
    '127.0.0.1'
  )
}
