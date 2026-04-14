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

  // Group by session
  const bySession = results.reduce<Record<string, SearchResult[]>>((acc, r) => {
    ;(acc[r.sessionId] = acc[r.sessionId] ?? []).push(r)
    return acc
  }, {})

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
            <p style={{ margin: '8px 0 0', fontSize: 13, color: 'var(--text2)' }}>
              {loading ? 'Searching…' : `${results.length} result${results.length !== 1 ? 's' : ''} across ${Object.keys(bySession).length} session${Object.keys(bySession).length !== 1 ? 's' : ''}`}
            </p>
          )}
        </div>

        {Object.entries(bySession).map(([sessionId, hits]) => {
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
