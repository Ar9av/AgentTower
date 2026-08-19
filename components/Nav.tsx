'use client'
import { appPath } from '@/lib/base-path'
import { useRouter, usePathname } from 'next/navigation'
import { useState, useRef, useEffect } from 'react'
import Link from 'next/link'
import { useTheme } from './ThemeProvider'
import { useSidebar } from './SidebarProvider'
import Notifications from './Notifications'

// ── Inline SVG icons ────────────────────────────────────────────────────────
function IconBarChart() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="12" width="4" height="9" rx="1"/>
      <rect x="10" y="6" width="4" height="15" rx="1"/>
      <rect x="17" y="3" width="4" height="18" rx="1"/>
    </svg>
  )
}

function IconTower() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18"/>
      <path d="M6 12H2l2-4h2"/>
      <path d="M18 12h4l-2-4h-2"/>
      <path d="M6 12h12"/>
      <path d="M10 22v-5h4v5"/>
    </svg>
  )
}

function IconClipboard() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/>
      <rect x="9" y="3" width="6" height="4" rx="1"/>
      <line x1="9" y1="12" x2="15" y2="12"/>
      <line x1="9" y1="16" x2="13" y2="16"/>
    </svg>
  )
}

function IconPlug() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M18 6H7l-2 4h13"/>
      <path d="M18 10v4a4 4 0 0 1-8 0v-4"/>
      <line x1="12" y1="18" x2="12" y2="22"/>
      <line x1="9" y1="22" x2="15" y2="22"/>
    </svg>
  )
}

function IconSettings() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="3"/>
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 8.92 4.6H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9c0 .66.39 1.26 1 1.51H21a2 2 0 0 1 0 4h-.09c-.61.25-1 .85-1 1.49Z"/>
    </svg>
  )
}

function IconBookmark() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
    </svg>
  )
}

function IconOrchestrate() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="5" r="2"/>
      <circle cx="5" cy="19" r="2"/>
      <circle cx="19" cy="19" r="2"/>
      <path d="M12 7v4"/>
      <path d="M12 11L5 17"/>
      <path d="M12 11l7 6"/>
    </svg>
  )
}

function IconSearch() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="11" cy="11" r="8"/>
      <line x1="21" y1="21" x2="16.65" y2="16.65"/>
    </svg>
  )
}

function IconSun() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="5"/>
      <line x1="12" y1="1" x2="12" y2="3"/>
      <line x1="12" y1="21" x2="12" y2="23"/>
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
      <line x1="1" y1="12" x2="3" y2="12"/>
      <line x1="21" y1="12" x2="23" y2="12"/>
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
    </svg>
  )
}

function IconMoon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
    </svg>
  )
}

function IconLogout() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
      <polyline points="16 17 21 12 16 7"/>
      <line x1="21" y1="12" x2="9" y2="12"/>
    </svg>
  )
}

function IconMenu() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <line x1="3" y1="6" x2="21" y2="6"/>
      <line x1="3" y1="12" x2="21" y2="12"/>
      <line x1="3" y1="18" x2="21" y2="18"/>
    </svg>
  )
}

// ── Logo mark ───────────────────────────────────────────────────────────────
function LogoMark() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
      style={{ color: 'var(--accent)', flexShrink: 0 }} aria-hidden>
      <rect x="5" y="2" width="14" height="20" rx="2"/>
      <path d="M5 9h14"/>
      <path d="M5 16h14"/>
      <path d="M9 22v-6h6v6"/>
    </svg>
  )
}

function IconProjects() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
      <polyline points="9 22 9 12 15 12 15 22"/>
    </svg>
  )
}

// ── Mobile tab helper ─────────────────────────────────────────────────────────
function MobileTab({ href, icon, label, active }: { href: string; icon: React.ReactNode; label: string; active: boolean }) {
  return (
    <Link href={href} className={`mobile-tab${active ? ' mobile-tab-active' : ''}`} aria-label={label}>
      <span className="mobile-tab-icon">{icon}</span>
      <span className="mobile-tab-label">{label}</span>
    </Link>
  )
}

// ── Nav link helper ──────────────────────────────────────────────────────────
function NavLink({
  href, icon, label, active,
}: { href: string; icon: React.ReactNode; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      className={`nav-link${active ? ' nav-link-active' : ''}`}
      title={label}
    >
      {icon}
      <span>{label}</span>
    </Link>
  )
}

// ── Main component ───────────────────────────────────────────────────────────
export default function Nav() {
  const router = useRouter()
  const pathname = usePathname()
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
    await fetch(appPath('/api/auth/logout'), { method: 'POST' })
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

  const is = (path: string) => pathname === path || pathname.startsWith(path + '/')

  return (
    <>
      <nav className="glass-lg" style={{
        padding: '0 16px',
        height: 54,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
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
          style={{ padding: '10px 13px', minHeight: 44, flexShrink: 0 }}
          aria-label="Open recent sessions"
        >
          <IconMenu />
        </button>

        {/* Logo */}
        <Link href="/projects" style={{
          fontWeight: 800,
          fontSize: 15,
          textDecoration: 'none',
          whiteSpace: 'nowrap',
          display: 'flex',
          alignItems: 'center',
          gap: 7,
          flexShrink: 0,
          padding: '4px 6px',
          marginRight: 4,
        }}>
          <LogoMark />
          <span
            className="gradient-text hide-mobile"
            style={{ letterSpacing: '-0.02em' }}
          >
            AgentTower
          </span>
        </Link>

        {/* Desktop search */}
        <form onSubmit={handleSearch} style={{ flex: 1, maxWidth: 340 }} className="hide-mobile">
          <div style={{ position: 'relative' }}>
            <span style={{
              position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)',
              color: 'var(--text3)', pointerEvents: 'none', display: 'flex',
            }}>
              <IconSearch />
            </span>
            <input
              ref={searchRef}
              className="glass-input"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search sessions… (⌘K)"
              style={{ fontSize: 13, padding: '6px 12px 6px 32px', borderRadius: 8, minHeight: 34 }}
            />
          </div>
        </form>

        {/* Desktop nav links */}
        <div className="hide-mobile" style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <NavLink href="/analytics" icon={<IconBarChart />} label="Analytics" active={is('/analytics')} />
          <NavLink href="/tower" icon={<IconTower />} label="Tower" active={is('/tower')} />
          <NavLink href="/bookmarks" icon={<IconBookmark />} label="Bookmarks" active={is('/bookmarks')} />
          <NavLink href="/orchestrate" icon={<IconOrchestrate />} label="Orchestrate" active={is('/orchestrate')} />
          <NavLink href="/daily-brief" icon={<IconClipboard />} label="Brief" active={is('/daily-brief')} />
          <NavLink href="/integrations" icon={<IconPlug />} label="Integrations" active={is('/integrations')} />
          <NavLink href="/settings" icon={<IconSettings />} label="Settings" active={is('/settings')} />
        </div>

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
          {/* Mobile search toggle */}
          <button
            className="glass-btn show-mobile"
            onClick={() => setSearchOpen(v => !v)}
            style={{ padding: '8px 10px', minHeight: 36, display: 'flex', alignItems: 'center' }}
            aria-label="Search"
          >
            <IconSearch />
          </button>

          {/* Brain button — desktop only (mobile uses the center tab) */}
          <Link
            href="/brain"
            className="glass-btn hide-mobile"
            title="AgentTower Brain — AI assistant"
            aria-label="Open Brain page"
            style={{
              padding: '6px 10px', minHeight: 34,
              display: 'flex', alignItems: 'center', gap: 5,
              color: is('/brain') ? 'var(--accent)' : undefined,
              background: is('/brain') ? 'var(--accent-dim)' : undefined,
              borderColor: is('/brain') ? 'color-mix(in srgb, var(--accent) 30%, transparent)' : undefined,
              textDecoration: 'none',
            }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
            </svg>
            <span style={{ fontSize: 13, fontWeight: 600 }}>Brain</span>
          </Link>

          <Notifications />

          <Link
            href="/settings"
            className="glass-btn"
            title="Settings"
            aria-label="Open settings"
            style={{
              padding: '6px 10px', minHeight: 34,
              display: 'flex', alignItems: 'center',
              color: is('/settings') ? 'var(--accent)' : undefined,
              background: is('/settings') ? 'var(--accent-dim)' : undefined,
              borderColor: is('/settings') ? 'color-mix(in srgb, var(--accent) 30%, transparent)' : undefined,
              textDecoration: 'none',
            }}
          >
            <IconSettings />
          </Link>

          {/* Theme toggle */}
          <button
            onClick={toggle}
            className="glass-btn"
            style={{ padding: '6px 10px', minHeight: 34, display: 'flex', alignItems: 'center' }}
            aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
          >
            {theme === 'dark' ? <IconSun /> : <IconMoon />}
          </button>

          {/* Logout */}
          <button
            onClick={handleLogout}
            className="glass-btn"
            style={{ padding: '6px 12px', minHeight: 34, fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <IconLogout />
            <span className="hide-mobile">Logout</span>
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
            <div style={{ position: 'relative' }}>
              <span style={{
                position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)',
                color: 'var(--text3)', pointerEvents: 'none', display: 'flex',
              }}>
                <IconSearch />
              </span>
              <input
                className="glass-input"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search sessions…"
                autoFocus
                style={{ fontSize: 16, padding: '10px 14px 10px 36px', borderRadius: 10 }}
              />
            </div>
          </form>
        </div>
      )}

      {/* Mobile bottom tab bar — Brain is the prominent center action */}
      <nav className="mobile-tab-bar show-mobile" aria-label="Main navigation">
        <MobileTab href="/projects" icon={<IconProjects />} label="Projects" active={is('/projects') || pathname === '/'} />
        <MobileTab href="/tower" icon={<IconTower />} label="Tower" active={is('/tower')} />

        {/* Center Brain button — elevated */}
        <Link
          href="/brain"
          className={`mobile-tab-brain${is('/brain') ? ' mobile-tab-brain-active' : ''}`}
          aria-label="Open Brain page"
        >
          <span className="mobile-tab-brain-orb">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
            </svg>
          </span>
          <span className="mobile-tab-label">Brain</span>
        </Link>

        <MobileTab href="/bookmarks" icon={<IconBookmark />} label="Saved" active={is('/bookmarks')} />
        <MobileTab href="/analytics" icon={<IconBarChart />} label="Analytics" active={is('/analytics')} />
      </nav>
    </>
  )
}
