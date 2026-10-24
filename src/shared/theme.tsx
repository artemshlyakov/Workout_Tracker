import { useEffect, useState } from 'react'

export type Theme = 'dark' | 'light'
const key = 'workout-tracker-theme'
function initialTheme(): Theme {
  try { return localStorage.getItem(key) === 'light' ? 'light' : 'dark' } catch { return 'dark' }
}
export function useTheme() {
  const [theme, setTheme] = useState<Theme>(initialTheme)
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'light' ? '#f3f6f4' : '#090d12')
    try { localStorage.setItem(key, theme) } catch { /* Private browsing may disable localStorage. */ }
  }, [theme])
  return { theme, toggle: () => setTheme((current) => current === 'dark' ? 'light' : 'dark') }
}
export function ThemeToggle({ theme, onToggle }: { theme: Theme; onToggle: () => void }) {
  return <button type="button" className="theme-toggle" aria-label={theme === 'dark' ? 'Включить светлую тему' : 'Включить тёмную тему'} aria-pressed={theme === 'light'} onClick={onToggle}>
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" /></svg>
    <span className="theme-toggle__orb" aria-hidden="true" />
  </button>
}
