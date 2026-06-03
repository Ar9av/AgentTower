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
          setError('Incorrect password')
        }
      }
    } catch {
      setError('Connection error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-root">
      {/* Ambient glow */}
      <div className="login-glow" />

      <div className="login-card">
        {/* Icon */}
        <div className="login-logo-icon">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
            style={{ color: 'var(--accent)' }}>
            <rect x="5" y="2" width="14" height="20" rx="2"/>
            <path d="M5 9h14"/>
            <path d="M5 16h14"/>
            <path d="M9 22v-6h6v6"/>
          </svg>
        </div>

        <h1 className="login-title">AgentTower</h1>
        <p className="login-subtitle">Monitor your Claude Code sessions</p>

        <div className="login-divider" />

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <input
            className="login-input"
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="Enter password"
            autoFocus
            required
            style={error ? { borderColor: 'var(--red)' } : undefined}
          />
          {error && (
            <p className="login-error">
              <span>⚠</span> {error}
            </p>
          )}
          <button
            type="submit"
            className="login-btn"
            disabled={loading || !password}
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  )
}
