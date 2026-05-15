'use client'
import { useRouter } from 'next/navigation'
import { useState, useRef, useEffect } from 'react'
import Link from 'next/link'
import { useTheme } from './ThemeProvider'
import { useSidebar } from './SidebarProvider'
import Notifications from './Notifications'

export default function Nav() {
  const router = useRouter()
  const { theme, toggle } = useTheme()
  const { toggle: toggleSidebar } = useSidebar()
  const [search, setSearch] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        if (window.innerWidth >= 640) {
          searchRef.current?.focus()
          searchRef.current?.select()
        } else {
          setSearchOpen(true)
        }
      }
      if (e.key === 'Escape') {
        searchRef.current?.blur()
        setSearchOpen(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' })
    router.push('/login')
  }

  function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    const q = search.trim()
    if (q.length >= 2) {
      router.push(`/search?q=${encodeURIComponent(q)}`)
      setSearchOpen(false)
    }
  }

  return (
    <>
      <nav className="glass-lg" style={{
        padding: '0 16px',
        height: 54,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        position: 'sticky',
        top: 0,
        zIndex: 500,
        borderLeft: 'none',
        borderRight: 'none',
        borderTop: 'none',
        borderRadius: 0,
        WebkitTapHighlightColor: 'transparent',
      }}>
        {/* Hamburger — mobile only */}
        <button
          className="glass-btn show-mobile"
          onClick={toggleSidebar}
          style={{ padding: '8px 10px', minHeight: 36, fontSize: 17, flexShrink: 0 }}
          aria-label="Open recent sessions"
        >
          ☰
        </button>

        {/* Logo — taps to home */}
        <Link href="/projects" style={{
          fontWeight: 700,
          fontSize: 15,
          textDecoration: 'none',
          whiteSpace: 'nowrap',
          display: 'flex',
          alignItems: 'center',
          gap: 7,
          flexShrink: 0,
          padding: '6px 4px',
          minHeight: 36,
          minWidth: 36,
        }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="https://cdn-icons-png.flaticon.com/512/3016/3016606.png"
            alt=""
            width={20}
            height={20}
            style={{ filter: theme === 'dark' ? 'brightness(0) invert(1)' : 'brightness(0)', opacity: theme === 'dark' ? 0.85 : 0.75 }}
          />
          <span
            className="hide-mobile"
            style={{
              color: 'var(--text)',
              fontWeight: 800,
              letterSpacing: '-0.02em',
            }}
          >AgentTower</span>
        </Link>

        {/* Desktop search */}
        <form onSubmit={handleSearch} style={{ flex: 1, maxWidth: 360 }} className="hide-mobile">
          <input
            ref={searchRef}
            className="glass-input"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="⌕  Search sessions… (⌘K)"
            style={{ fontSize: 13, padding: '6px 12px', borderRadius: 8, minHeight: 36 }}
          />
        </form>

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* Mobile search toggle */}
          <button
            className="glass-btn show-mobile"
            onClick={() => setSearchOpen(v => !v)}
            style={{ padding: '8px 10px', minHeight: 36, fontSize: 16 }}
            aria-label="Search"
          >
            ⌕
          </button>

          <Notifications />

          {/* Analytics */}
          <Link
            href="/analytics"
            className="glass-btn hide-mobile"
            style={{ padding: '6px 12px', minHeight: 36, fontSize: 13, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 5 }}
            title="Analytics"
          >
            📊 Analytics
          </Link>

          {/* Tower */}
          <Link
            href="/tower"
            className="glass-btn hide-mobile"
            style={{ padding: '6px 12px', minHeight: 36, fontSize: 13, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 5 }}
            title="Agent Tower"
          >
            🏰 Tower
          </Link>

          {/* Daily Brief */}
          <Link
            href="/daily-brief"
            className="glass-btn hide-mobile"
            style={{ padding: '6px 12px', minHeight: 36, fontSize: 13, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 5 }}
            title="Daily Brief"
          >
            📋 Brief
          </Link>

          {/* Integrations */}
          <Link
            href="/integrations"
            className="glass-btn hide-mobile"
            style={{ padding: '6px 12px', minHeight: 36, fontSize: 13, textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}
            title="Integrations"
          >
            Integrations
          </Link>

          {/* Theme toggle */}
          <button
            onClick={toggle}
            className="glass-btn"
            style={{ padding: '6px 10px', minHeight: 36, fontSize: 15 }}
            aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
          >
            {theme === 'dark' ? '☀️' : '🌙'}
          </button>

          {/* Logout */}
          <button
            onClick={handleLogout}
            className="glass-btn"
            style={{ padding: '6px 14px', minHeight: 36, fontSize: 13 }}
          >
            <span className="hide-mobile">Logout</span>
            <span className="show-mobile" style={{ fontSize: 16 }}>⏏</span>
          </button>
        </div>
      </nav>

      {/* Mobile search dropdown */}
      {searchOpen && (
        <div className="glass" style={{
          position: 'sticky',
          top: 54,
          zIndex: 99,
          padding: '10px 16px',
          borderLeft: 'none',
          borderRight: 'none',
          borderTop: 'none',
          borderRadius: 0,
          animation: 'fadeIn 0.15s ease',
        }}>
          <form onSubmit={handleSearch}>
            <input
              className="glass-input"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search sessions…"
              autoFocus
              style={{ fontSize: 16, padding: '10px 14px', borderRadius: 10 }}
            />
          </form>
        </div>
      )}
    </>
  )
}
