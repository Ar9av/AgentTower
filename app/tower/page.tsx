import { redirect } from 'next/navigation'
import { getSessionToken, validateSession } from '@/lib/auth'
import Nav from '@/components/Nav'
import TowerView from '@/components/TowerView'

export const dynamic = 'force-dynamic'

export default async function TowerPage() {
  const token = await getSessionToken()
  if (!validateSession(token)) redirect('/login')

  return (
    <>
      <Nav />
      <TowerView />
    </>
  )
}
