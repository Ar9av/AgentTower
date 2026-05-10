import { redirect } from 'next/navigation'
import { getSessionToken, validateSession } from '@/lib/auth'
import Nav from '@/components/Nav'
import TelegramIntegration from '@/components/TelegramIntegration'
import AntigravityIntegration from '@/components/AntigravityIntegration'

export const dynamic = 'force-dynamic'

export default async function IntegrationsPage() {
  const token = await getSessionToken()
  if (!validateSession(token)) redirect('/login')

  return (
    <>
      <Nav />
      <main style={{ padding: 'clamp(16px, 4vw, 32px) clamp(12px, 4vw, 28px)', maxWidth: 1000, margin: '0 auto', width: '100%' }}>
        <div style={{ marginBottom: 28 }}>
          <h1 style={{ margin: '0 0 4px', fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em' }}>Integrations</h1>
          <p style={{ margin: 0, color: 'var(--text2)', fontSize: 13 }}>
            Connect AgentTower to messaging and external services.
          </p>
        </div>

        <TelegramIntegration />
        <AntigravityIntegration />
      </main>
    </>
  )
}
