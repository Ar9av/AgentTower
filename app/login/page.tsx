'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function LoginPage() {
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      if (res.ok) {
        router.push('/projects')
      } else {
        const data = await res.json()
        if (res.status === 429) {
          setError(`Too many attempts. Try again in ${data.retryAfter}s.`)
        } else {
          setError('Invalid password')
        }
      }
    } catch {
      setError('Connection error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', overflow: 'hidden' }}>
      {/* Ambient orbs */}
      <div className="orb orb-1" />
      <div className="orb orb-2" />
      <div className="orb orb-3" />

      {/* Glass card */}
      <div className="glass" style={{
        borderRadius: 20,
        padding: '44px 40px',
        width: '100%',
        maxWidth: 380,
        position: 'relative',
        zIndex: 1,
      }}>
        {/* Logo mark */}
        <div style={{ marginBottom: 28 }}>
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 44,
            height: 44,
            borderRadius: 12,
            background: 'rgba(91,163,255,0.15)',
            border: '1px solid rgba(91,163,255,0.3)',
            marginBottom: 16,
            fontSize: 22,
          }}>
            🗼
          </div>
          <h1 style={{
            margin: '0 0 4px',
            fontSize: 24,
            fontWeight: 700,
            background: 'linear-gradient(135deg, var(--text) 0%, var(--text2) 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            letterSpacing: '-0.02em',
          }}>
            AgentTower
          </h1>
          <p style={{ margin: 0, color: 'var(--text2)', fontSize: 14 }}>
            Monitor your Claude Code sessions
          </p>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <input
            className="glass-input"
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="Password"
            autoFocus
            required
            style={{
              fontSize: 15,
              padding: '11px 14px',
              borderRadius: 12,
              borderColor: error ? 'rgba(255,90,90,0.5)' : undefined,
            }}
          />
          {error && (
            <p style={{ margin: 0, color: 'var(--red)', fontSize: 13, display: 'flex', alignItems: 'center', gap: 5 }}>
              <span>⚠</span> {error}
            </p>
          )}
          <button
            type="submit"
            className="glass-btn-prominent"
            disabled={loading || !password}
            style={{ marginTop: 4 }}
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  )
}
