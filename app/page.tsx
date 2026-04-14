import { redirect } from 'next/navigation'
import { getSessionToken, validateSession } from '@/lib/auth'

export default async function Home() {
  const token = await getSessionToken()
  if (validateSession(token)) {
    redirect('/projects')
  } else {
    redirect('/login')
  }
}
