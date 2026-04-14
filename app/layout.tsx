import type { Metadata } from 'next'
import Script from 'next/script'
import './globals.css'
import ThemeProvider, { themeScript } from '@/components/ThemeProvider'
import SidebarProvider from '@/components/SidebarProvider'
import Sidebar from '@/components/Sidebar'

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
    <html lang="en" className="h-full" suppressHydrationWarning>
      <body className="min-h-full flex flex-col" style={{ background: 'var(--bg-mesh)', color: 'var(--text)' }}>
        {/* Runs before hydration — sets data-theme with no flash */}
        <Script id="theme-init" strategy="beforeInteractive" dangerouslySetInnerHTML={{ __html: themeScript }} />
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
