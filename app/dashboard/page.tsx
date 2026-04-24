import { redirect } from 'next/navigation'
import { getSessionToken, validateSession } from '@/lib/auth'
import Nav from '@/components/Nav'
import DashboardView from '@/components/DashboardView'
import type { Metadata } from 'next'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Mission Control — AgentTower',
  description: 'Live overview of all Claude Code sessions',
}

export default async function DashboardPage() {
  const token = await getSessionToken()
  if (!validateSession(token)) redirect('/login')

  return (
    <>
      <Nav />
      <main>
        <DashboardView />
      </main>
    </>
  )
}
