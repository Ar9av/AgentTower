'use client'
import { appPath } from '@/lib/base-path'
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

interface QualityMetrics {
  avgQuality: number
  avgEfficiency: number
  avgErrors: number
  successRate: number
  scoredSessions: number
}

interface AnalyticsData {
  range: Range
  timeline: { date: string; cost: number; sessions: number }[]
  byProject: { dirName: string; displayName: string; cost: number; sessions: number }[]
  totals: { cost: number; sessions: number; projects: number }
  topSessions: { sessionId: string; cost: number; firstPrompt: string; project: string; encodedFilepath: string }[]
  qualityMetrics: QualityMetrics | null
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
    <div className="stat-card">
      <div className="stat-card-label">{label}</div>
      <div className="stat-card-value">{value}</div>
    </div>
  )
}

function QualityBar({ value, color }: { value: number; color: string }) {
  return (
    <div style={{ marginTop: 6, background: 'var(--glass-border)', borderRadius: 4, height: 5, overflow: 'hidden' }}>
      <div style={{ height: '100%', width: `${value}%`, background: color, borderRadius: 4, transition: 'width 0.4s ease' }} />
    </div>
  )
}

export default function AnalyticsDashboard() {
  const [range, setRange] = useState<Range>('daily')
  const [data, setData] = useState<AnalyticsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [scoring, setScoring] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    fetch(appPath(`/api/analytics?range=${range}`))
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [range])

  async function scoreSession(sessionId: string, encodedFilepath: string) {
    setScoring(sessionId)
    try {
      await fetch(appPath('/api/brain/score'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId, encodedFilepath }),
      })
      // Refresh to show updated metrics
      const r = await fetch(appPath(`/api/analytics?range=${range}`))
      if (r.ok) setData(await r.json())
    } finally {
      setScoring(null)
    }
  }

  const tickStyle = { fill: 'var(--text3)', fontSize: 11 }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28, flexWrap: 'wrap', gap: 12 }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, letterSpacing: '-0.03em' }}>Analytics</h1>
        <div style={{ display: 'flex', gap: 6 }}>
          {(['daily', 'weekly', 'monthly'] as Range[]).map(r => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className="glass-btn"
              style={{
                padding: '5px 14px',
                fontSize: 12,
                minHeight: 32,
                fontWeight: range === r ? 600 : 500,
                background: range === r ? 'var(--accent-dim)' : undefined,
                color: range === r ? 'var(--accent)' : 'var(--text2)',
                borderColor: range === r ? 'color-mix(in srgb, var(--accent) 30%, transparent)' : undefined,
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
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
            <StatCard label="Total Spend" value={fmt(data.totals.cost)} />
            <StatCard label="Sessions" value={data.totals.sessions.toLocaleString()} />
            <StatCard label="Projects" value={data.totals.projects.toLocaleString()} />
            <StatCard
              label="Avg / Session"
              value={data.totals.sessions > 0 ? fmt(data.totals.cost / data.totals.sessions) : '$0'}
            />
          </div>

          {/* Quality metrics */}
          {data.qualityMetrics && (
            <div className="glass" style={{ borderRadius: 14, padding: '18px 20px', marginBottom: 20 }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 14, color: 'var(--text2)' }}>
                Session Quality <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--text3)', marginLeft: 6 }}>{data.qualityMetrics.scoredSessions} scored sessions</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 16 }}>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--text3)' }}>Avg Quality</div>
                  <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--accent)' }}>{data.qualityMetrics.avgQuality}</div>
                  <QualityBar value={data.qualityMetrics.avgQuality} color="var(--accent)" />
                </div>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--text3)' }}>Success Rate</div>
                  <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--green)' }}>{data.qualityMetrics.successRate}%</div>
                  <QualityBar value={data.qualityMetrics.successRate} color="var(--green)" />
                </div>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--text3)' }}>Output Efficiency</div>
                  <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--purple)' }}>{data.qualityMetrics.avgEfficiency}%</div>
                  <QualityBar value={data.qualityMetrics.avgEfficiency} color="var(--purple)" />
                </div>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--text3)' }}>Avg Errors</div>
                  <div style={{ fontSize: 22, fontWeight: 700, color: data.qualityMetrics.avgErrors > 2 ? 'var(--red)' : 'var(--text2)' }}>{data.qualityMetrics.avgErrors}</div>
                  <QualityBar value={Math.min(100, data.qualityMetrics.avgErrors * 20)} color="var(--red)" />
                </div>
              </div>
            </div>
          )}

          {!data.qualityMetrics && (
            <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 20, padding: '10px 14px', background: 'var(--bg3)', borderRadius: 10, border: '1px solid var(--glass-border)' }}>
              No quality scores yet — click <strong>Score</strong> on any session below to analyze it.
            </div>
          )}

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
                      background: 'var(--bg2)',
                      border: '1px solid var(--glass-border)',
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
                      background: 'var(--bg2)',
                      border: '1px solid var(--glass-border)',
                      borderRadius: 8,
                      fontSize: 12,
                      color: 'var(--text)',
                    }}
                    formatter={(v) => [`$${Number(v).toFixed(4)}`, 'Cost']}
                  />
                  <Bar dataKey="cost" radius={[0, 4, 4, 0]}>
                    {data.byProject.filter(p => p.cost > 0).map((_, i) => (
                      <Cell key={i} fill={i === 0 ? 'var(--accent)' : 'var(--glass-border-hi)'} />
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
                    <button
                      onClick={() => scoreSession(s.sessionId, s.encodedFilepath)}
                      disabled={scoring === s.sessionId}
                      style={{
                        fontSize: 10, fontWeight: 600, padding: '3px 8px', borderRadius: 6, cursor: 'pointer',
                        background: 'var(--glass-bg)', color: 'var(--text3)',
                        border: '1px solid var(--glass-border)', whiteSpace: 'nowrap', flexShrink: 0,
                      }}
                    >
                      {scoring === s.sessionId ? '…' : 'Score'}
                    </button>
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
