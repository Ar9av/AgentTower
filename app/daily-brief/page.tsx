import { redirect } from 'next/navigation'
import { getSessionToken, validateSession } from '@/lib/auth'
import Nav from '@/components/Nav'
import DailyBriefConfig from '@/components/DailyBriefConfig'
import DailyBriefHistory from '@/components/DailyBriefHistory'

export const dynamic = 'force-dynamic'

export default async function DailyBriefPage() {
  const token = await getSessionToken()
  if (!validateSession(token)) redirect('/login')

  return (
    <>
      <Nav />
      <main style={{ padding: 'clamp(16px, 4vw, 32px) clamp(12px, 4vw, 28px)', maxWidth: 1000, margin: '0 auto', width: '100%' }}>
        <div style={{ marginBottom: 28 }}>
          <h1 style={{ margin: '0 0 4px', fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em' }}>Daily Brief</h1>
          <p style={{ margin: 0, color: 'var(--text2)', fontSize: 13 }}>
            Morning project analysis via Telegram. Approve tasks, get PRs back.
          </p>
        </div>

        <DailyBriefConfig />

        <div style={{ marginTop: 32 }}>
          <h2 style={{ margin: '0 0 14px', fontSize: 16, fontWeight: 700 }}>Brief history</h2>
          <DailyBriefHistory />
        </div>
      </main>
    </>
  )
}
