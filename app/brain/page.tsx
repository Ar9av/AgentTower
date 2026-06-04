import { redirect } from 'next/navigation'
import { getSessionToken, validateSession } from '@/lib/auth'
import Nav from '@/components/Nav'
import BrainWorkspace from '@/components/BrainWorkspace'

export const dynamic = 'force-dynamic'

export default async function BrainPage() {
  const token = await getSessionToken()
  if (!validateSession(token)) redirect('/login')

  return (
    <>
      <Nav />
      <BrainWorkspace />
    </>
  )
}
