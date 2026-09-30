// Personal colour themes. Each colleague picks their own; it's saved on
// their profile and never affects anybody else.

export interface ThemeSettings {
  preset: string
  background?: string
  primary?: string
}

export interface ThemePreset {
  id: string
  name: string
  background: string
  primary: string
}

export const PRESETS: ThemePreset[] = [
  { id: 'paradise', name: 'Paradise blue', background: '#f3f5fa', primary: '#2563eb' },
  { id: 'ocean', name: 'Ocean', background: '#eef6f8', primary: '#0e7490' },
  { id: 'forest', name: 'Forest', background: '#f1f5f0', primary: '#15803d' },
  { id: 'sunset', name: 'Sunset', background: '#fbf5ef', primary: '#ea580c' },
  { id: 'berry', name: 'Berry', background: '#f7f3fa', primary: '#9333ea' },
  { id: 'graphite', name: 'Graphite', background: '#f4f4f5', primary: '#27272a' },
  { id: 'midnight', name: 'Midnight', background: '#0f172a', primary: '#60a5fa' },
]

export const DEFAULT_THEME: ThemeSettings = { preset: 'paradise' }

const CACHE_KEY = 'pcr-theme'

export function resolveTheme(theme: ThemeSettings | null | undefined): { background: string; primary: string } {
  const preset = PRESETS.find((p) => p.id === theme?.preset) ?? PRESETS[0]
  return {
    background: theme?.background ?? preset.background,
    primary: theme?.primary ?? preset.primary,
  }
}

function hexToRgb(hex: string): [number, number, number] {
  const value = hex.replace('#', '')
  const full = value.length === 3 ? value.split('').map((c) => c + c).join('') : value
  const n = parseInt(full, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((c) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function mix(a: string, b: string, weightOfB: number): string {
  const ca = hexToRgb(a)
  const cb = hexToRgb(b)
  const out = ca.map((c, i) => Math.round(c * (1 - weightOfB) + cb[i] * weightOfB))
  return `#${out.map((c) => c.toString(16).padStart(2, '0')).join('')}`
}

export function isDark(hex: string): boolean {
  return luminance(hex) < 0.2
}

/** Text colour that stays readable on the given button colour. */
export function readableOn(hex: string): string {
  return luminance(hex) > 0.45 ? '#0f172a' : '#ffffff'
}

export function themeVariables(theme: ThemeSettings | null | undefined): Record<string, string> {
  const { background, primary } = resolveTheme(theme)
  const dark = isDark(background)
  return {
    '--bg': background,
    '--surface': dark ? mix(background, '#ffffff', 0.06) : '#ffffff',
    '--surface-2': dark ? mix(background, '#ffffff', 0.11) : mix('#ffffff', '#0f172a', 0.035),
    '--fg': dark ? '#e2e8f0' : '#0f172a',
    '--muted': dark ? '#94a3b8' : '#64748b',
    '--line': dark ? 'rgba(255,255,255,0.12)' : 'rgba(15,23,42,0.11)',
    '--line-soft': dark ? 'rgba(255,255,255,0.05)' : 'rgba(15,23,42,0.05)',
    '--primary': primary,
    '--primary-fg': readableOn(primary),
    'color-scheme': dark ? 'dark' : 'light',
  }
}

export function applyTheme(theme: ThemeSettings | null | undefined): void {
  const root = document.documentElement
  for (const [name, value] of Object.entries(themeVariables(theme))) {
    root.style.setProperty(name, value)
  }
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(theme ?? DEFAULT_THEME))
  } catch {
    // storage unavailable: fine, the theme just isn't remembered before login
  }
}

/** The last theme used on this device, so the login page doesn't flash. */
export function cachedTheme(): ThemeSettings {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (raw) return JSON.parse(raw) as ThemeSettings
  } catch {
    // ignore
  }
  return DEFAULT_THEME
}
