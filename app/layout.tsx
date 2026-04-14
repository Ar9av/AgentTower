import type { Metadata } from 'next'
import './globals.css'
import ThemeProvider from '@/components/ThemeProvider'
import SidebarProvider from '@/components/SidebarProvider'
import Sidebar from '@/components/Sidebar'

export const metadata: Metadata = {
  title: 'AgentTower',
  description: 'Monitor, tail, and control Claude Code sessions',
  icons: { icon: '/icon.png', shortcut: '/icon.png', apple: '/icon.png' },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full" suppressHydrationWarning>
      <body className="min-h-full flex flex-col" style={{ background: 'var(--bg-mesh)', color: 'var(--text)' }}>
        <ThemeProvider>
          <SidebarProvider>
            <Sidebar />
            {children}
          </SidebarProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
