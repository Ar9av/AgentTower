'use client'
import { useEffect, useState, useCallback } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import Nav from '@/components/Nav'
import { SearchResult, ProjectInfo } from '@/lib/types'
import { Suspense } from 'react'

function highlight(text: string, q: string, isRegex: boolean): React.ReactNode {
  if (!q) return text
  try {
    const re = new RegExp(isRegex ? q : q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')
    const parts: React.ReactNode[] = []
    let last = 0
    let m: RegExpExecArray | null
    let k = 0
    while ((m = re.exec(text)) !== null) {
      if (m.index > last) parts.push(text.slice(last, m.index))
      parts.push(
        <mark key={k++} style={{ background: 'var(--yellow)', color: '#000', borderRadius: 2, padding: '0 2px' }}>
          {m[0]}
        </mark>
      )
      last = m.index + m[0].length
      if (m[0].length === 0) { re.lastIndex++; continue }
    }
    if (last < text.length) parts.push(text.slice(last))
    return parts.length > 0 ? <>{parts}</> : text
  } catch {
    return text
  }
}

function encodeFilepath(filepath: string): string {
  return btoa(unescape(encodeURIComponent(filepath)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

function SearchInner() {
  const params = useSearchParams()
  const initialQ = params.get('q') ?? ''
  const [query, setQuery] = useState(initialQ)
  const [regexMode, setRegexMode] = useState(false)
  const [regexError, setRegexError] = useState('')
  const [filterProject, setFilterProject] = useState('')
  const [projects, setProjects] = useState<ProjectInfo[]>([])
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [sortBy, setSortBy] = useState<'newest' | 'oldest' | 'hits'>('newest')

  // Fetch project list once
  useEffect(() => {
    fetch('/api/projects').then(r => r.json()).then((data: ProjectInfo[]) => {
      setProjects(data.sort((a, b) => a.displayName.localeCompare(b.displayName)))
    }).catch(() => {})
  }, [])

  // Validate regex as user types
  useEffect(() => {
    if (!regexMode || !query) { setRegexError(''); return }
    try { new RegExp(query); setRegexError('') }
    catch (e) { setRegexError((e as Error).message) }
  }, [query, regexMode])

  const doSearch = useCallback(async (q: string, project: string, regex: boolean) => {
    if (q.trim().length < 2) { setResults([]); return }
    if (regex) {
      try { new RegExp(q) } catch { setResults([]); return }
    }
    setLoading(true)
    try {
      const url = `/api/search?q=${encodeURIComponent(q)}${project ? `&project=${encodeURIComponent(project)}` : ''}${regex ? '&regex=1' : ''}`
      const res = await fetch(url)
      if (res.ok) setResults(await res.json())
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const id = setTimeout(() => doSearch(query, filterProject, regexMode), 300)
    return () => clearTimeout(id)
  }, [query, filterProject, regexMode, doSearch])

  useEffect(() => {
    if (initialQ) doSearch(initialQ, '', false)
  }, [initialQ, doSearch])

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
    const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000)
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

  const btnBase: React.CSSProperties = {
    border: '1px solid var(--border)',
    borderRadius: 4,
    padding: '2px 8px',
    fontSize: 12,
    cursor: 'pointer',
  }

  return (
    <>
      <Nav />
      <main style={{ padding: '28px 24px', maxWidth: 900, margin: '0 auto', width: '100%' }}>
        {/* Search input */}
        <div style={{ marginBottom: 10 }}>
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search across all sessions…"
            autoFocus
            style={{
              width: '100%',
              background: 'var(--bg2)',
              border: `1px solid ${regexError ? 'var(--red)' : 'var(--border)'}`,
              borderRadius: 8,
              color: 'var(--text)',
              padding: '10px 14px',
              fontSize: 15,
              outline: 'none',
            }}
          />
          {regexError && (
            <div style={{ fontSize: 12, color: 'var(--red)', marginTop: 4, paddingLeft: 2 }}>
              Invalid regex: {regexError}
            </div>
          )}
        </div>

        {/* Filters + sort row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
          {/* Project filter */}
          <select
            value={filterProject}
            onChange={e => setFilterProject(e.target.value)}
            style={{
              background: 'var(--bg2)',
              border: '1px solid var(--border)',
              borderRadius: 4,
              color: filterProject ? 'var(--text)' : 'var(--text2)',
              padding: '3px 8px',
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            <option value="">All projects</option>
            {projects.map(p => (
              <option key={p.dirName} value={p.dirName}>{p.displayName}</option>
            ))}
          </select>

          {/* Regex toggle */}
          <button
            onClick={() => setRegexMode(m => !m)}
            title="Toggle regex mode"
            style={{
              ...btnBase,
              background: regexMode ? 'color-mix(in srgb, var(--yellow) 20%, var(--bg2))' : 'var(--bg2)',
              color: regexMode ? 'var(--yellow)' : 'var(--text2)',
              border: `1px solid ${regexMode ? 'color-mix(in srgb, var(--yellow) 50%, transparent)' : 'var(--border)'}`,
              fontFamily: 'ui-monospace, monospace',
              fontWeight: 700,
              letterSpacing: '0.02em',
            }}
          >
            .*
          </button>

          {/* Results count */}
          {query.length >= 2 && (
            <span style={{ fontSize: 13, color: 'var(--text2)' }}>
              {loading ? 'Searching…' : `${results.length} result${results.length !== 1 ? 's' : ''} across ${sortedSessions.length} session${sortedSessions.length !== 1 ? 's' : ''}`}
            </span>
          )}

          {/* Sort controls pushed right */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 'auto' }}>
            <span style={{ fontSize: 12, color: 'var(--text2)' }}>Sort:</span>
            {SORT_OPTS.map(opt => (
              <button
                key={opt.key}
                onClick={() => setSortBy(opt.key)}
                style={{
                  ...btnBase,
                  background: sortBy === opt.key ? 'var(--accent)' : 'var(--bg2)',
                  color: sortBy === opt.key ? '#fff' : 'var(--text2)',
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Results */}
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
                  href={`/session?f=${encodeFilepath(r.filepath)}${r.msgUuid ? `&msg=${r.msgUuid}` : ''}`}
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
                    {highlight(r.context, query, regexMode)}
                  </div>
                </Link>
              ))}
            </div>
          )
        })}

        {query.length >= 2 && !loading && results.length === 0 && !regexError && (
          <div style={{ textAlign: 'center', color: 'var(--text2)', marginTop: 60 }}>
            No results found for &ldquo;{query}&rdquo;
            {filterProject ? ` in ${projects.find(p => p.dirName === filterProject)?.displayName ?? filterProject}` : ''}
          </div>
        )}
      </main>
    </>
  )
}

export default function SearchPage() {
  return (
    <Suspense fallback={<div style={{ padding: 40, color: 'var(--text2)' }}>Loading…</div>}>
      <SearchInner />
    </Suspense>
  )
}
