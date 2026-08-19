'use client'
import { appPath } from '@/lib/base-path'
import { useEffect, useState, useCallback, useRef } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import Nav from '@/components/Nav'
import { SearchResult, ProjectInfo } from '@/lib/types'
import { Suspense } from 'react'

type SearchProvider = 'all' | 'claude' | 'codex'

interface SearchProjectOption {
  value: string
  label: string
  provider: Exclude<SearchProvider, 'all'>
}

function parseKeywords(query: string): string[] {
  const keywords: string[] = []
  const re = /"([^"]+)"|(\S+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(query)) !== null) {
    const kw = m[1] ?? m[2]
    if (kw.length > 0) keywords.push(kw)
  }
  return keywords
}

function highlight(text: string, q: string, isRegex: boolean): React.ReactNode {
  if (!q) return text
  try {
    let pattern: string
    if (isRegex) {
      pattern = q
    } else {
      const keywords = parseKeywords(q)
      pattern = keywords.map(kw => kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
    }
    const re = new RegExp(pattern, 'gi')
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

// Minimal markdown renderer: bold, inline code, headers, bullet lists
function renderMarkdown(text: string): React.ReactNode {
  const lines = text.split('\n')
  let key = 0
  return lines.map(line => {
    const trimmed = line.trimStart()

    // Header
    const hm = trimmed.match(/^(#{1,3})\s+(.+)/)
    if (hm) {
      const level = hm[1].length
      const sizes: Record<number, string> = { 1: '16px', 2: '14px', 3: '13px' }
      return (
        <div key={key++} style={{ fontWeight: 700, fontSize: sizes[level] ?? '13px', color: 'var(--text)', marginTop: 12, marginBottom: 4 }}>
          {renderInline(hm[2])}
        </div>
      )
    }

    // Bullet
    const bm = trimmed.match(/^[-*]\s+(.+)/)
    if (bm) {
      return (
        <div key={key++} style={{ display: 'flex', gap: 8, marginTop: 4, fontSize: 13, color: 'var(--text)' }}>
          <span style={{ color: 'var(--accent)', flexShrink: 0 }}>•</span>
          <span>{renderInline(bm[1])}</span>
        </div>
      )
    }

    // Numbered list
    const nm = trimmed.match(/^(\d+)\.\s+(.+)/)
    if (nm) {
      return (
        <div key={key++} style={{ display: 'flex', gap: 8, marginTop: 4, fontSize: 13, color: 'var(--text)' }}>
          <span style={{ color: 'var(--accent)', flexShrink: 0, minWidth: 16 }}>{nm[1]}.</span>
          <span>{renderInline(nm[2])}</span>
        </div>
      )
    }

    // Empty line
    if (trimmed === '') return <div key={key++} style={{ height: 6 }} />

    return (
      <div key={key++} style={{ fontSize: 13, color: 'var(--text)', marginTop: 2 }}>
        {renderInline(line)}
      </div>
    )
  })
}

function renderInline(text: string): React.ReactNode {
  const parts: React.ReactNode[] = []
  const re = /(`[^`]+`|\*\*[^*]+\*\*)/g
  let last = 0
  let k = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index))
    const token = m[0]
    if (token.startsWith('`')) {
      parts.push(
        <code key={k++} style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.9em', background: 'var(--bg)', padding: '1px 4px', borderRadius: 3 }}>
          {token.slice(1, -1)}
        </code>
      )
    } else {
      parts.push(<strong key={k++}>{token.slice(2, -2)}</strong>)
    }
    last = m.index + token.length
  }
  if (last < text.length) parts.push(text.slice(last))
  return <>{parts}</>
}

function SearchInner() {
  const params = useSearchParams()
  const initialQ = params.get('q') ?? ''
  const [query, setQuery] = useState(initialQ)
  const [regexMode, setRegexMode] = useState(false)
  const [regexError, setRegexError] = useState('')
  const [provider, setProvider] = useState<SearchProvider>('all')
  const [filterProject, setFilterProject] = useState('')
  const [projects, setProjects] = useState<SearchProjectOption[]>([])
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [sortBy, setSortBy] = useState<'newest' | 'oldest' | 'hits'>('newest')

  // AI analysis state
  const [aiOpen, setAiOpen] = useState(false)
  const [aiText, setAiText] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [aiError, setAiError] = useState('')
  const aiAbortRef = useRef<AbortController | null>(null)
  const aiScrollRef = useRef<HTMLDivElement>(null)

  // Fetch project list once
  useEffect(() => {
    Promise.all([
      fetch(appPath('/api/projects?mode=claude')).then(r => r.json() as Promise<ProjectInfo[]>),
      fetch(appPath('/api/projects?mode=codex')).then(r => r.json() as Promise<ProjectInfo[]>),
    ]).then(([claudeProjects, codexProjects]) => {
      const options: SearchProjectOption[] = [
        ...claudeProjects.map(project => ({
          value: `claude:${project.dirName}`,
          label: `${project.displayName} · Claude`,
          provider: 'claude' as const,
        })),
        ...codexProjects.map(project => ({
          value: `codex:${project.decodedPath}`,
          label: `${project.displayName} · Codex`,
          provider: 'codex' as const,
        })),
      ]
      options.sort((a, b) => a.label.localeCompare(b.label))
      setProjects(options)
    }).catch(() => {})
  }, [])

  // Validate regex as user types
  useEffect(() => {
    if (!regexMode || !query) { setRegexError(''); return }
    try { new RegExp(query); setRegexError('') }
    catch (e) { setRegexError((e as Error).message) }
  }, [query, regexMode])

  const doSearch = useCallback(async (q: string, project: string, regex: boolean, selectedProvider: SearchProvider) => {
    if (q.trim().length < 2) { setResults([]); return }
    if (regex) {
      try { new RegExp(q) } catch { setResults([]); return }
    }
    setLoading(true)
    try {
      const projectProvider = project ? project.split(':', 1)[0] as SearchProvider : 'all'
      const projectValue = project.includes(':') ? project.slice(project.indexOf(':') + 1) : project
      const effectiveProvider = project ? projectProvider : selectedProvider
      const url = `/api/search?q=${encodeURIComponent(q)}${project ? `&project=${encodeURIComponent(projectValue)}` : ''}${regex ? '&regex=1' : ''}${effectiveProvider !== 'all' ? `&provider=${effectiveProvider}` : ''}`
      const res = await fetch(url)
      if (res.ok) setResults(await res.json())
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const id = setTimeout(() => doSearch(query, filterProject, regexMode, provider), 300)
    return () => clearTimeout(id)
  }, [query, filterProject, regexMode, provider, doSearch])

  useEffect(() => {
    if (initialQ) doSearch(initialQ, '', false, 'all')
  }, [initialQ, doSearch])

  useEffect(() => {
    if (!filterProject || provider === 'all') return
    if (!filterProject.startsWith(`${provider}:`)) setFilterProject('')
  }, [provider, filterProject])

  // Close AI panel when query changes
  useEffect(() => {
    setAiOpen(false)
    setAiText('')
    setAiError('')
    aiAbortRef.current?.abort()
  }, [query, filterProject, provider])

  // Auto-scroll AI panel while streaming
  useEffect(() => {
    if (aiLoading && aiScrollRef.current) {
      aiScrollRef.current.scrollTop = aiScrollRef.current.scrollHeight
    }
  }, [aiText, aiLoading])

  const askClaude = useCallback(async () => {
    if (aiLoading) {
      aiAbortRef.current?.abort()
      setAiLoading(false)
      return
    }
    setAiOpen(true)
    setAiText('')
    setAiError('')
    setAiLoading(true)

    const ctrl = new AbortController()
    aiAbortRef.current = ctrl

    try {
      const res = await fetch(appPath('/api/search/summarize'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, results }),
        signal: ctrl.signal,
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }))
        setAiError(err.error ?? 'Request failed')
        setAiLoading(false)
        return
      }

      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        setAiText(prev => prev + decoder.decode(value, { stream: true }))
      }
    } catch (err: unknown) {
      if ((err as Error).name !== 'AbortError') {
        setAiError((err as Error).message ?? 'Unknown error')
      }
    } finally {
      setAiLoading(false)
    }
  }, [query, results, aiLoading])

  const bySession = results.reduce<Record<string, SearchResult[]>>((acc, r) => {
    const key = `${r.provider}:${r.sessionId}`
    ;(acc[key] = acc[key] ?? []).push(r)
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

  const hasResults = results.length > 0 && query.length >= 2

  return (
    <>
      <Nav />
      <main style={{ padding: '28px 24px', maxWidth: 900, margin: '0 auto', width: '100%' }}>
        {/* Search input */}
        <div style={{ marginBottom: 10 }}>
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder='Search sessions… (space = AND, "exact phrase" in quotes)'
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
          {!regexMode && !regexError && query.trim().includes(' ') && (
            <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 4, paddingLeft: 2 }}>
              Matching lines that contain all {parseKeywords(query).length} terms
            </div>
          )}
        </div>

        {/* Filters + sort row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
          <select
            value={provider}
            onChange={e => setProvider(e.target.value as SearchProvider)}
            style={{
              background: 'var(--bg2)',
              border: '1px solid var(--border)',
              borderRadius: 4,
              color: 'var(--text)',
              padding: '3px 8px',
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            <option value="all">All providers</option>
            <option value="claude">Claude</option>
            <option value="codex">Codex</option>
          </select>

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
            {projects
              .filter(project => provider === 'all' || project.provider === provider)
              .map(project => (
                <option key={project.value} value={project.value}>{project.label}</option>
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

          {/* Ask Claude button */}
          {hasResults && (
            <button
              onClick={askClaude}
              title="Ask Claude to summarize these results"
              style={{
                ...btnBase,
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                padding: '3px 10px',
                background: aiLoading
                  ? 'color-mix(in srgb, var(--accent) 15%, var(--bg2))'
                  : aiOpen
                  ? 'color-mix(in srgb, var(--accent) 20%, var(--bg2))'
                  : 'var(--bg2)',
                color: aiOpen || aiLoading ? 'var(--accent)' : 'var(--text2)',
                border: `1px solid ${aiOpen || aiLoading ? 'color-mix(in srgb, var(--accent) 50%, transparent)' : 'var(--border)'}`,
                fontWeight: 500,
              }}
            >
              <span style={{ fontSize: 14, lineHeight: 1 }}>✦</span>
              {aiLoading ? 'Stop' : aiOpen ? 'Re-analyze' : 'Ask Claude'}
            </button>
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

        {/* AI Analysis Panel */}
        {aiOpen && (
          <div style={{
            background: 'var(--bg2)',
            border: '1px solid color-mix(in srgb, var(--accent) 35%, var(--border))',
            borderRadius: 8,
            marginBottom: 20,
            overflow: 'hidden',
          }}>
            {/* Panel header */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '8px 14px',
              borderBottom: '1px solid var(--border)',
              background: 'color-mix(in srgb, var(--accent) 8%, var(--bg2))',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, fontWeight: 600, color: 'var(--accent)' }}>
                <span style={{ fontSize: 14 }}>✦</span>
                Claude&rsquo;s analysis
                {aiLoading && (
                  <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--text2)', animation: 'pulse 1.5s ease-in-out infinite' }}>
                    thinking…
                  </span>
                )}
              </div>
              <button
                onClick={() => { setAiOpen(false); aiAbortRef.current?.abort(); setAiLoading(false) }}
                style={{ background: 'none', border: 'none', color: 'var(--text2)', cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: '0 2px' }}
              >
                ×
              </button>
            </div>

            {/* Panel body */}
            <div
              ref={aiScrollRef}
              style={{ padding: '14px 16px', maxHeight: 400, overflowY: 'auto', lineHeight: 1.6 }}
            >
              {aiError ? (
                <div style={{ fontSize: 13, color: 'var(--red)' }}>Error: {aiError}</div>
              ) : aiText ? (
                renderMarkdown(aiText)
              ) : (
                <div style={{ fontSize: 13, color: 'var(--text2)' }}>Starting…</div>
              )}
              {aiLoading && aiText && (
                <span style={{ display: 'inline-block', width: 8, height: 13, background: 'var(--accent)', borderRadius: 1, verticalAlign: 'text-bottom', opacity: 0.8, animation: 'blink 1s step-end infinite' }} />
              )}
            </div>
          </div>
        )}

        {/* CSS for animations */}
        <style>{`
          @keyframes blink { 0%,100%{opacity:0.8} 50%{opacity:0} }
          @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
        `}</style>

        {/* Results */}
        {sortedSessions.map(([sessionKey, hits]) => {
          const first = hits[0]
          const sessionHref = first.provider === 'codex'
            ? `/session?mode=codex&f=${first.encodedFilepath}`
            : `/session?f=${first.encodedFilepath}`
          return (
            <div key={sessionKey} style={{ marginBottom: 24 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 8 }}>
                <Link
                  href={sessionHref}
                  style={{ fontWeight: 600, fontSize: 14, color: 'var(--accent)', textDecoration: 'none' }}
                >
                  {first.decodedProjectPath.split('/').pop()} / {first.sessionId.slice(0, 8)}
                </Link>
                <span style={{ fontSize: 11, color: first.provider === 'codex' ? 'var(--yellow)' : 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  {first.provider}
                </span>
                <span style={{ fontSize: 12, color: 'var(--text2)' }}>{first.decodedProjectPath}</span>
                <span style={{ fontSize: 11, color: 'var(--text2)', marginLeft: 'auto' }}>{fmtDate(first.mtime)}</span>
              </div>
              {hits.map((r, i) => (
                <Link
                  key={i}
                  href={`${r.provider === 'codex' ? '/session?mode=codex' : '/session?'}${r.provider === 'codex' ? '&' : ''}f=${r.encodedFilepath}${r.msgUuid ? `&msg=${r.msgUuid}` : ''}`}
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
            {filterProject ? ` in ${projects.find(project => project.value === filterProject)?.label ?? filterProject}` : ''}
            {!regexMode && parseKeywords(query).length > 1 && (
              <div style={{ fontSize: 12, marginTop: 8 }}>
                Tip: all {parseKeywords(query).length} terms must appear on the same message line. Try fewer keywords.
              </div>
            )}
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
