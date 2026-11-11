// Light or dark mode for the shop system, chosen per device and remembered on it.
// 'system' follows the computer's own setting (Windows: Settings → Personalisation → Colours).
// admin/index.html applies the saved choice before the page draws, so there is no flash of the wrong colours.
import { useSyncExternalStore } from 'react'

const KEY = 'skinmatrix-theme'
const MODES = ['system', 'light', 'dark']
const listeners = new Set()
const media = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null

export function getThemeMode() {
  try { const saved = localStorage.getItem(KEY); return MODES.includes(saved) ? saved : 'system' } catch { return 'system' }
}

export const resolveTheme = (mode = getThemeMode()) => (mode === 'system' ? (media?.matches ? 'dark' : 'light') : mode)

export function applyTheme() {
  const theme = resolveTheme()
  document.documentElement.dataset.theme = theme
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#0e0f1d' : '#f3f3f7')
  for (const listener of listeners) listener()
}

export function setThemeMode(mode) {
  try { if (mode === 'system') localStorage.removeItem(KEY); else localStorage.setItem(KEY, mode) } catch { /* private window: this visit only */ }
  current = mode
  applyTheme()
}

let current = null
media?.addEventListener?.('change', () => { if (getThemeMode() === 'system') applyTheme() })

const subscribe = (listener) => { listeners.add(listener); return () => listeners.delete(listener) }
const snapshot = () => `${current ?? getThemeMode()}:${resolveTheme(current ?? getThemeMode())}`

// { mode: 'system' | 'light' | 'dark', theme: 'light' | 'dark' }
export function useTheme() {
  const [mode, theme] = useSyncExternalStore(subscribe, snapshot).split(':')
  return { mode, theme }
}

// The one-tap switch on the POS: light ↔ dark (leaves "follow the computer").
export const toggleTheme = () => setThemeMode(resolveTheme() === 'dark' ? 'light' : 'dark')
