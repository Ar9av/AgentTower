'use client'
import { useEffect, useState, useCallback } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import Nav from '@/components/Nav'
import { SearchResult } from '@/lib/types'
import { Suspense } from 'react'

function SearchInner() {
  const params = useSearchParams()
  const initialQ = params.get('q') ?? ''
  const [query, setQuery] = useState(initialQ)
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)

  const doSearch = useCallback(async (q: string) => {
    if (q.trim().length < 2) { setResults([]); return }
    setLoading(true)
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`)
      if (res.ok) setResults(await res.json())
    } finally {
      setLoading(false)
    }
  }, [])

  // Debounce
  useEffect(() => {
    const id = setTimeout(() => doSearch(query), 300)
    return () => clearTimeout(id)
  }, [query, doSearch])

  // Run initial search from URL param
  useEffect(() => {
    if (initialQ) doSearch(initialQ)
  }, [initialQ, doSearch])

  function highlight(text: string, q: string): React.ReactNode {
    if (!q) return text
    const idx = text.toLowerCase().indexOf(q.toLowerCase())
    if (idx === -1) return text
    return (
      <>
        {text.slice(0, idx)}
        <mark style={{ background: 'var(--yellow)', color: '#000', borderRadius: 2, padding: '0 2px' }}>
          {text.slice(idx, idx + q.length)}
        </mark>
        {text.slice(idx + q.length)}
      </>
    )
  }

  const [sortBy, setSortBy] = useState<'newest' | 'oldest' | 'hits'>('newest')

  // Group by session
  const bySession = results.reduce<Record<string, SearchResult[]>>((acc, r) => {
    ;(acc[r.sessionId] = acc[r.sessionId] ?? []).push(r)
    return acc
  }, {})

  const sortedSessions = Object.entries(bySession).sort(([, a], [, b]) => {
    if (sortBy === 'hits') return b.length - a.length
    const diff = b[0].mtime - a[0].mtime
    return sortBy === 'oldest' ? -diff : diff
  })

  function fmtDate(mtime: number) {
    const d = new Date(mtime)
    const now = new Date()
    const diffMs = now.getTime() - d.getTime()
    const diffDays = Math.floor(diffMs / 86400000)
    if (diffDays === 0) return 'today ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    if (diffDays === 1) return 'yesterday'
    if (diffDays < 7) return `${diffDays}d ago`
    return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined })
  }

  const SORT_OPTS: { key: typeof sortBy; label: string }[] = [
    { key: 'newest', label: 'Newest' },
    { key: 'oldest', label: 'Oldest' },
    { key: 'hits', label: 'Most hits' },
  ]

  return (
    <>
      <Nav />
      <main style={{ padding: '28px 24px', maxWidth: 900, margin: '0 auto', width: '100%' }}>
        <div style={{ marginBottom: 20 }}>
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search across all sessions…"
            autoFocus
            style={{
              width: '100%',
              background: 'var(--bg2)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              color: 'var(--text)',
              padding: '10px 14px',
              fontSize: 15,
              outline: 'none',
            }}
          />
          {query.length >= 2 && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
              <p style={{ margin: 0, fontSize: 13, color: 'var(--text2)' }}>
                {loading ? 'Searching…' : `${results.length} result${results.length !== 1 ? 's' : ''} across ${sortedSessions.length} session${sortedSessions.length !== 1 ? 's' : ''}`}
              </p>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ fontSize: 12, color: 'var(--text2)' }}>Sort:</span>
                {SORT_OPTS.map(opt => (
                  <button
                    key={opt.key}
                    onClick={() => setSortBy(opt.key)}
                    style={{
                      background: sortBy === opt.key ? 'var(--accent)' : 'var(--bg2)',
                      color: sortBy === opt.key ? '#fff' : 'var(--text2)',
                      border: '1px solid var(--border)',
                      borderRadius: 4,
                      padding: '2px 8px',
                      fontSize: 12,
                      cursor: 'pointer',
                    }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {sortedSessions.map(([sessionId, hits]) => {
          const first = hits[0]
          return (
            <div key={sessionId} style={{ marginBottom: 24 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 8 }}>
                <Link
                  href={`/session?f=${encodeFilepath(first.filepath)}`}
                  style={{ fontWeight: 600, fontSize: 14, color: 'var(--accent)', textDecoration: 'none' }}
                >
                  {first.decodedProjectPath.split('/').pop()} / {sessionId.slice(0, 8)}
                </Link>
                <span style={{ fontSize: 12, color: 'var(--text2)' }}>{first.decodedProjectPath}</span>
                <span style={{ fontSize: 11, color: 'var(--text2)', marginLeft: 'auto' }}>{fmtDate(first.mtime)}</span>
              </div>
              {hits.map((r, i) => (
                <Link
                  key={i}
                  href={`/session?f=${encodeFilepath(r.filepath)}`}
                  style={{ textDecoration: 'none' }}
                >
                  <div style={{
                    background: 'var(--bg2)',
                    border: '1px solid var(--border)',
                    borderRadius: 6,
                    padding: '8px 12px',
                    marginBottom: 4,
                    fontSize: 13,
                    color: 'var(--text)',
                    cursor: 'pointer',
                  }}>
                    <span style={{ color: 'var(--text2)', marginRight: 8, fontFamily: 'ui-monospace, monospace', fontSize: 11 }}>L{r.lineNo}</span>
                    {highlight(r.context, query)}
                  </div>
                </Link>
              ))}
            </div>
          )
        })}

        {query.length >= 2 && !loading && results.length === 0 && (
          <div style={{ textAlign: 'center', color: 'var(--text2)', marginTop: 60 }}>
            No results found for &ldquo;{query}&rdquo;
          </div>
        )}
      </main>
    </>
  )
}

function encodeFilepath(filepath: string): string {
  return btoa(unescape(encodeURIComponent(filepath)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

export default function SearchPage() {
  return (
    <Suspense fallback={<div style={{ padding: 40, color: 'var(--text2)' }}>Loading…</div>}>
      <SearchInner />
    </Suspense>
  )
}
