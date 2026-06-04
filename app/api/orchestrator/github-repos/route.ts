import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { getGitHubToken } from '@/lib/integrations'

interface GhRepo {
  full_name: string
  name: string
  private: boolean
  description: string | null
  updated_at: string
  default_branch: string
}

export async function GET(req: NextRequest) {
  const authErr = await requireAuth(req)
  if (authErr) return authErr

  const token = getGitHubToken()
  if (!token) {
    return NextResponse.json({ error: 'GitHub token not configured', repos: [] }, { status: 200 })
  }

  const repos: GhRepo[] = []
  let page = 1

  while (true) {
    const res = await fetch(
      `https://api.github.com/user/repos?per_page=100&sort=updated&page=${page}`,
      {
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${token}`,
          'X-GitHub-Api-Version': '2022-11-28',
        },
        signal: AbortSignal.timeout(15_000),
      },
    )
    if (!res.ok) {
      const msg = await res.text()
      return NextResponse.json({ error: `GitHub API ${res.status}: ${msg}`, repos: [] }, { status: 200 })
    }
    const batch: GhRepo[] = await res.json()
    repos.push(...batch)
    if (batch.length < 100) break
    page++
    if (repos.length >= 500) break  // hard ceiling
  }

  return NextResponse.json({
    repos: repos.map(r => ({
      fullName: r.full_name,
      name: r.name,
      private: r.private,
      description: r.description,
      defaultBranch: r.default_branch,
    })),
  })
}
