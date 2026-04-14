'use client'
import { useEffect, useState } from 'react'

function fmt(ms: number): string {
  const diff = Date.now() - ms
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return `${Math.floor(diff / 86_400_000)}d ago`
}

export default function RelativeTime({ ms }: { ms: number }) {
  const [label, setLabel] = useState(fmt(ms))
  useEffect(() => {
    const id = setInterval(() => setLabel(fmt(ms)), 30_000)
    return () => clearInterval(id)
  }, [ms])
  return <span title={new Date(ms).toLocaleString()}>{label}</span>
}
