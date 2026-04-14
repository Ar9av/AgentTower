import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'AgentTower',
  description: 'Monitor, tail, and control Claude Code sessions',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-full flex flex-col" style={{ background: 'var(--bg)', color: 'var(--text)' }}>
        {children}
      </body>
    </html>
  )
}
