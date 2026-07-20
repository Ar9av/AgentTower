import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { searchAllConversations, type ConversationSearchProvider } from '@/lib/conversation-search'

// GET /api/v1/search?q=...&provider=claude|codex|all&project=...&regex=1
export async function GET(req: NextRequest) {
  const authErr = await requireAuth(req)
  if (authErr) return authErr

  const q = req.nextUrl.searchParams.get('q') ?? ''
  if (q.length < 2) return NextResponse.json({ results: [] })

  const project = req.nextUrl.searchParams.get('project') ?? undefined
  const regex = req.nextUrl.searchParams.get('regex') === '1'
  const providerParam = req.nextUrl.searchParams.get('provider')
  const provider: ConversationSearchProvider =
    providerParam === 'claude' || providerParam === 'codex' ? providerParam : 'all'

  const results = searchAllConversations(q, { project, regex, provider })
  return NextResponse.json({ results })
}
