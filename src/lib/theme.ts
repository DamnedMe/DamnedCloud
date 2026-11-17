import type { RemoteTheme } from '../shared/remote/protocol'

const THEME_KEY = 'damnedcloud.theme'

function rgba(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
}

/**
 * Applies the desktop theme (dark/light + primary color), like the IDE does in App.tsx.
 * Without one (bridge up to IDE 0.1.2, or offline) the last theme seen is kept.
 */
export function applyTheme(theme: RemoteTheme | null | undefined): void {
  let t = theme
  try {
    if (t) localStorage.setItem(THEME_KEY, JSON.stringify(t))
    else t = JSON.parse(localStorage.getItem(THEME_KEY) ?? 'null') as RemoteTheme | null
  } catch {
    /* storage unavailable: defaults below */
  }
  const root = document.documentElement
  root.dataset.theme = t?.mode === 'light' ? 'light' : 'dark'
  // the theme's own accent stays when the desktop sends none or a malformed one
  for (const prop of ['--accent', '--accent-dim', '--accent-soft']) root.style.removeProperty(prop)
  if (t?.accent && /^#[0-9a-f]{6}$/i.test(t.accent)) {
    root.style.setProperty('--accent', t.accent)
    root.style.setProperty('--accent-dim', rgba(t.accent, 0.13))
    root.style.setProperty('--accent-soft', rgba(t.accent, 0.06))
  }
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', getComputedStyle(root).getPropertyValue('--bg-elev').trim())
}
