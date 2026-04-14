import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'AgentTower',
  description: 'Monitor, tail, and control Claude Code sessions',
  icons: {
    icon: 'https://cdn-icons-png.flaticon.com/512/3016/3016606.png',
    shortcut: 'https://cdn-icons-png.flaticon.com/512/3016/3016606.png',
    apple: 'https://cdn-icons-png.flaticon.com/512/3016/3016606.png',
  },
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
