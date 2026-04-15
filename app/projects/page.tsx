import { redirect } from 'next/navigation'
import { getSessionToken, validateSession } from '@/lib/auth'
import { discoverProjects } from '@/lib/claude-fs'
import Nav from '@/components/Nav'
import ProjectsView from '@/components/ProjectsView'

export const dynamic = 'force-dynamic'

export default async function ProjectsPage() {
  const token = await getSessionToken()
  if (!validateSession(token)) redirect('/login')

  const projects = discoverProjects()

  return (
    <>
      <Nav />
      <main style={{ padding: 'clamp(16px, 4vw, 32px) clamp(12px, 4vw, 28px)', maxWidth: 1240, margin: '0 auto', width: '100%' }}>
        <ProjectsView initialProjects={projects} />
      </main>
    </>
  )
}
