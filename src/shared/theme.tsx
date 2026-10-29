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
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'light' ? '#f1f3ed' : '#151d22')
    try { localStorage.setItem(key, theme) } catch { /* Private browsing may disable localStorage. */ }
  }, [theme])
  return { theme, toggle: () => setTheme((current) => current === 'dark' ? 'light' : 'dark') }
}
export function ThemeToggle({ theme, onToggle }: { theme: Theme; onToggle: () => void }) {
  return <button type="button" className="theme-toggle" aria-label={theme === 'dark' ? 'Включить светлую тему' : 'Включить тёмную тему'} aria-pressed={theme === 'light'} onClick={onToggle}>
    <span className="theme-toggle__thumb" aria-hidden="true" />
    <svg className="theme-toggle__moon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20.2 15.5A8.5 8.5 0 0 1 8.5 3.8 8.5 8.5 0 1 0 20.2 15.5Z" /></svg>
    <svg className="theme-toggle__sun" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3.6" /><path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" /></svg>
  </button>
}
