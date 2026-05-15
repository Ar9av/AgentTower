import { redirect } from 'next/navigation'
import { getSessionToken, validateSession } from '@/lib/auth'
import Nav from '@/components/Nav'
import AnalyticsDashboard from '@/components/AnalyticsDashboard'

export const dynamic = 'force-dynamic'

export default async function AnalyticsPage() {
  const token = await getSessionToken()
  if (!validateSession(token)) redirect('/login')

  return (
    <>
      <Nav />
      <main style={{ padding: 'clamp(16px, 4vw, 32px) clamp(12px, 4vw, 28px)', maxWidth: 1240, margin: '0 auto', width: '100%' }}>
        <AnalyticsDashboard />
      </main>
    </>
  )
}
