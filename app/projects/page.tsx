import { redirect } from 'next/navigation'
import { getSessionToken, validateSession } from '@/lib/auth'
import { discoverProjects } from '@/lib/claude-fs'
import { discoverCodexProjects } from '@/lib/codex-fs'
import Nav from '@/components/Nav'
import ProjectsView from '@/components/ProjectsView'
import type { AgentMode } from '@/lib/types'

export const dynamic = 'force-dynamic'

type ProjectsPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}

export default async function ProjectsPage({ searchParams }: ProjectsPageProps) {
  const token = await getSessionToken()
  if (!validateSession(token)) redirect('/login')

  const params = searchParams ? await searchParams : undefined
  const rawMode = Array.isArray(params?.mode) ? params?.mode[0] : params?.mode
  const mode: AgentMode = rawMode === 'codex' ? 'codex' : 'claude'
  const projects = mode === 'codex' ? discoverCodexProjects() : discoverProjects()

  return (
    <>
      <Nav />
      <main style={{ padding: 'clamp(16px, 4vw, 32px) clamp(12px, 4vw, 28px)', maxWidth: 1240, margin: '0 auto', width: '100%' }}>
        <ProjectsView initialProjects={projects} initialMode={mode} />
      </main>
    </>
  )
}
