'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  BarChart,
  Bar,
  Cell,
} from 'recharts'

type Range = 'daily' | 'weekly' | 'monthly'

interface AnalyticsData {
  range: Range
  timeline: { date: string; cost: number; sessions: number }[]
  byProject: { dirName: string; displayName: string; cost: number; sessions: number }[]
  totals: { cost: number; sessions: number; projects: number }
  topSessions: { sessionId: string; cost: number; firstPrompt: string; project: string; encodedFilepath: string }[]
}

function fmt(usd: number) {
  if (usd === 0) return '$0'
  if (usd < 0.001) return '<$0.001'
  if (usd < 0.01) return `$${usd.toFixed(3)}`
  if (usd < 1) return `$${usd.toFixed(2)}`
  return `$${usd.toFixed(2)}`
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="glass" style={{ borderRadius: 12, padding: '16px 20px', flex: 1, minWidth: 140 }}>
      <div style={{ fontSize: 11, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.03em' }}>{value}</div>
    </div>
  )
}

export default function AnalyticsDashboard() {
  const [range, setRange] = useState<Range>('daily')
  const [data, setData] = useState<AnalyticsData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/analytics?range=${range}`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [range])

  const tickStyle = { fill: 'var(--text3)', fontSize: 11 }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em' }}>Analytics</h1>
        <div style={{ display: 'flex', gap: 6 }}>
          {(['daily', 'weekly', 'monthly'] as Range[]).map(r => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className="glass-btn"
              style={{
                padding: '5px 12px',
                fontSize: 12,
                minHeight: 32,
                background: range === r ? 'var(--accent)' : undefined,
                color: range === r ? '#fff' : undefined,
              }}
            >
              {r.charAt(0).toUpperCase() + r.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {loading && (
        <div style={{ color: 'var(--text3)', fontSize: 14, padding: '40px 0', textAlign: 'center' }}>Loading…</div>
      )}

      {data && !loading && (
        <>
          {/* Summary row */}
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 28 }}>
            <StatCard label="Total Spend" value={fmt(data.totals.cost)} />
            <StatCard label="Sessions" value={data.totals.sessions.toLocaleString()} />
            <StatCard label="Projects" value={data.totals.projects.toLocaleString()} />
            <StatCard
              label="Avg / Session"
              value={data.totals.sessions > 0 ? fmt(data.totals.cost / data.totals.sessions) : '$0'}
            />
          </div>

          {/* Timeline chart */}
          <div className="glass" style={{ borderRadius: 14, padding: '20px 16px', marginBottom: 20 }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 14, color: 'var(--text2)' }}>
              Spend over time
            </div>
            {data.timeline.length === 0 ? (
              <div style={{ color: 'var(--text3)', fontSize: 13, padding: '24px 0', textAlign: 'center' }}>No data in the last 90 days</div>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={data.timeline} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                  <XAxis
                    dataKey="date"
                    tick={tickStyle}
                    tickLine={false}
                    axisLine={false}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    tick={tickStyle}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={v => `$${Number(v).toFixed(2)}`}
                    width={56}
                  />
                  <Tooltip
                    contentStyle={{
                      background: 'var(--surface)',
                      border: '1px solid var(--border)',
                      borderRadius: 8,
                      fontSize: 12,
                      color: 'var(--text)',
                    }}
                    formatter={(v) => [`$${Number(v).toFixed(4)}`, 'Cost']}
                  />
                  <Line
                    type="monotone"
                    dataKey="cost"
                    stroke="var(--accent)"
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Projects bar chart */}
          {data.byProject.filter(p => p.cost > 0).length > 0 && (
            <div className="glass" style={{ borderRadius: 14, padding: '20px 16px', marginBottom: 20 }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 14, color: 'var(--text2)' }}>
                Spend by project
              </div>
              <ResponsiveContainer width="100%" height={Math.max(120, data.byProject.filter(p => p.cost > 0).length * 28)}>
                <BarChart
                  data={data.byProject.filter(p => p.cost > 0)}
                  layout="vertical"
                  margin={{ top: 0, right: 8, bottom: 0, left: 0 }}
                >
                  <XAxis
                    type="number"
                    tick={tickStyle}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={v => `$${Number(v).toFixed(2)}`}
                  />
                  <YAxis
                    type="category"
                    dataKey="displayName"
                    tick={tickStyle}
                    tickLine={false}
                    axisLine={false}
                    width={120}
                    tickFormatter={(v: string) => v.length > 18 ? v.slice(0, 17) + '…' : v}
                  />
                  <Tooltip
                    contentStyle={{
                      background: 'var(--surface)',
                      border: '1px solid var(--border)',
                      borderRadius: 8,
                      fontSize: 12,
                      color: 'var(--text)',
                    }}
                    formatter={(v) => [`$${Number(v).toFixed(4)}`, 'Cost']}
                  />
                  <Bar dataKey="cost" radius={[0, 4, 4, 0]}>
                    {data.byProject.filter(p => p.cost > 0).map((_, i) => (
                      <Cell key={i} fill={i === 0 ? 'var(--accent)' : 'var(--border)'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Top sessions table */}
          {data.topSessions.filter(s => s.cost > 0).length > 0 && (
            <div className="glass" style={{ borderRadius: 14, padding: '20px', marginBottom: 20 }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 14, color: 'var(--text2)' }}>
                Top sessions by cost
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {data.topSessions.filter(s => s.cost > 0).map(s => (
                  <div key={s.sessionId} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontWeight: 600, minWidth: 64, fontSize: 13, color: 'var(--accent)' }}>
                      {fmt(s.cost)}
                    </span>
                    <Link
                      href={`/session?f=${s.encodedFilepath}`}
                      style={{
                        flex: 1,
                        fontSize: 13,
                        color: 'var(--text)',
                        textDecoration: 'none',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {s.firstPrompt}
                    </Link>
                    <span style={{ fontSize: 11, color: 'var(--text3)', whiteSpace: 'nowrap' }}>{s.project}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {data.totals.cost === 0 && (
            <div style={{ color: 'var(--text3)', fontSize: 14, textAlign: 'center', padding: '40px 0' }}>
              No cost data found. Cost is estimated from token usage recorded in session files.
            </div>
          )}
        </>
      )}
    </div>
  )
}
