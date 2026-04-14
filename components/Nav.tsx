'use client'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import Link from 'next/link'

export default function Nav() {
  const router = useRouter()
  const [search, setSearch] = useState('')

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' })
    router.push('/login')
  }

  function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    if (search.trim().length >= 2) router.push(`/search?q=${encodeURIComponent(search.trim())}`)
  }

  return (
    <nav className="glass-lg" style={{
      padding: '0 24px',
      height: 56,
      display: 'flex',
      alignItems: 'center',
      gap: 20,
      position: 'sticky',
      top: 0,
      zIndex: 100,
      borderLeft: 'none',
      borderRight: 'none',
      borderTop: 'none',
      borderRadius: 0,
    }}>
      <Link href="/projects" style={{
        fontWeight: 700,
        fontSize: 16,
        color: 'var(--accent)',
        textDecoration: 'none',
        whiteSpace: 'nowrap',
        letterSpacing: '-0.01em',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
      }}>
        <span style={{
          background: 'linear-gradient(135deg, var(--accent) 0%, var(--purple) 100%)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
        }}>AgentTower</span>
      </Link>

      <form onSubmit={handleSearch} style={{ flex: 1, maxWidth: 380 }}>
        <input
          className="glass-input"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="⌕  Search sessions…"
          style={{ fontSize: 13, padding: '6px 12px', borderRadius: 8 }}
        />
      </form>

      <button
        onClick={handleLogout}
        className="glass-btn"
        style={{ marginLeft: 'auto', padding: '5px 14px', fontSize: 13 }}
      >
        Logout
      </button>
    </nav>
  )
}
