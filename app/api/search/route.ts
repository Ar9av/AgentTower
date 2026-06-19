import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { searchAllConversations, type ConversationSearchProvider } from '@/lib/conversation-search'

export async function GET(req: NextRequest) {
  const authErr = await requireAuth(req)
  if (authErr) return authErr

  const q = req.nextUrl.searchParams.get('q') ?? ''
  if (q.length < 2) return NextResponse.json([])

  const project = req.nextUrl.searchParams.get('project') ?? undefined
  const regex = req.nextUrl.searchParams.get('regex') === '1'
  const providerParam = req.nextUrl.searchParams.get('provider')
  const provider: ConversationSearchProvider =
    providerParam === 'claude' || providerParam === 'codex' ? providerParam : 'all'

  return NextResponse.json(searchAllConversations(q, { project, regex, provider }))
}
