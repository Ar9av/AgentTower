import { redirect } from 'next/navigation'
import { getSessionToken, validateSession } from '@/lib/auth'
import { loadSettings } from '@/lib/settings'
import Nav from '@/components/Nav'
import TerminalView from '@/components/TerminalView'

export const dynamic = 'force-dynamic'

export default async function TerminalPage() {
  const token = await getSessionToken()
  if (!validateSession(token)) redirect('/login')

  const enabled = loadSettings().terminalEnabled

  return (
    <>
      <Nav />
      <main style={{ padding: 'clamp(16px, 4vw, 32px) clamp(12px, 4vw, 28px)', maxWidth: 1000, margin: '0 auto', width: '100%' }}>
        <div style={{ marginBottom: 20 }}>
          <h1 style={{ margin: '0 0 4px', fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em' }}>Terminal</h1>
          <p style={{ margin: 0, color: 'var(--text2)', fontSize: 13 }}>
            Runs shell commands directly on the host. Not a full PTY — interactive full-screen apps (vim, htop) won&apos;t render correctly.
          </p>
        </div>

        {enabled ? (
          <TerminalView />
        ) : (
          <div className="glass" style={{ borderRadius: 16, padding: 24 }}>
            <p style={{ margin: 0, fontSize: 14 }}>
              The terminal is disabled. Enable it in{' '}
              <a href="/settings" style={{ color: 'var(--accent)' }}>Settings</a> first.
            </p>
          </div>
        )}
      </main>
    </>
  )
}
