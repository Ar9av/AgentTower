'use client'
import { createContext, useContext, useEffect, useState } from 'react'

type Theme = 'dark' | 'light'

const ThemeCtx = createContext<{ theme: Theme; toggle: () => void }>({
  theme: 'dark',
  toggle: () => {},
})

export function useTheme() { return useContext(ThemeCtx) }

export default function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>('dark')

  useEffect(() => {
    // Read from localStorage or system preference
    const stored = localStorage.getItem('clv-theme') as Theme | null
    const preferred = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
    const resolved = stored ?? preferred
    setTheme(resolved)
    document.documentElement.setAttribute('data-theme', resolved)
  }, [])

  function toggle() {
    const next: Theme = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    document.documentElement.setAttribute('data-theme', next)
    localStorage.setItem('clv-theme', next)
  }

  return <ThemeCtx.Provider value={{ theme, toggle }}>{children}</ThemeCtx.Provider>
}

// Inline script injected into <head> to set theme before first paint — prevents flash
export const themeScript = `
(function(){
  try {
    var t = localStorage.getItem('clv-theme');
    if (!t) t = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', t);
  } catch(e){}
})();
`
