export const DESIGN_SETTINGS_VERSION = 1 as const

export const fontFamilyOptions = [
  { label: 'DM Sans', value: 'dm-sans' },
  { label: 'System UI', value: 'system' },
  { label: 'Imbue', value: 'imbue' },
  { label: 'Georgia', value: 'georgia' },
  { label: 'Arial', value: 'arial' },
  { label: 'System Mono', value: 'system-mono' },
] as const

export type FontFamilyKey = typeof fontFamilyOptions[number]['value']

export interface DesignColorTokens {
  primary: string
  secondary: string
  info: string
  success: string
  warning: string
  error: string
  textDimmed: string
  textMuted: string
  textToned: string
  text: string
  textHighlighted: string
  textInverted: string
  background: string
  backgroundMuted: string
  backgroundElevated: string
  backgroundAccented: string
  backgroundInverted: string
  border: string
  borderMuted: string
  borderAccented: string
  borderInverted: string
}

export interface OrganizationDesignSettings {
  version: typeof DESIGN_SETTINGS_VERSION
  branding: {
    productName: string
    logoOnLight: string
    logoOnDark: string
    sidebarBackground: string
    sidebarForeground: string
  }
  colors: {
    light: DesignColorTokens
    dark: DesignColorTokens
  }
  typography: {
    bodyFamily: FontFamilyKey
    displayFamily: FontFamilyKey
    serifFamily: FontFamilyKey
    monoFamily: FontFamilyKey
    baseSize: number
    bodyWeight: number
    headingWeight: number
    lineHeight: number
    headingTracking: number
  }
  shape: {
    radiusBase: number
    radiusControl: number
    radiusSurface: number
    radiusEmphasis: number
    controlHeight: number
    buttonPaddingX: number
    buttonFontWeight: number
  }
  layout: {
    contentWidth: number
    sidebarWidth: number
    sidebarCollapsedWidth: number
    spacingScale: number
  }
  motion: {
    fast: number
    base: number
    slow: number
  }
}

const lightColors: DesignColorTokens = {
  primary: '#000000',
  secondary: '#525252',
  info: '#525252',
  success: '#16a34a',
  warning: '#a16207',
  error: '#dc2626',
  textDimmed: '#a8a8a8',
  textMuted: '#737373',
  textToned: '#525252',
  text: '#404040',
  textHighlighted: '#0a0a0a',
  textInverted: '#ffffff',
  background: '#ffffff',
  backgroundMuted: '#fafafa',
  backgroundElevated: '#f4f4f4',
  backgroundAccented: '#e8e8e8',
  backgroundInverted: '#000000',
  border: '#e8e8e8',
  borderMuted: '#e8e8e8',
  borderAccented: '#d1d1d1',
  borderInverted: '#000000',
}

const darkColors: DesignColorTokens = {
  primary: '#ffffff',
  secondary: '#a8a8a8',
  info: '#a8a8a8',
  success: '#4ade80',
  warning: '#facc15',
  error: '#f87171',
  textDimmed: '#737373',
  textMuted: '#a8a8a8',
  textToned: '#d1d1d1',
  text: '#e8e8e8',
  textHighlighted: '#ffffff',
  textInverted: '#000000',
  background: '#0a0a0a',
  backgroundMuted: '#171717',
  backgroundElevated: '#262626',
  backgroundAccented: '#404040',
  backgroundInverted: '#ffffff',
  border: '#262626',
  borderMuted: '#262626',
  borderAccented: '#404040',
  borderInverted: '#ffffff',
}

export const DEFAULT_ORGANIZATION_DESIGN: OrganizationDesignSettings = {
  version: DESIGN_SETTINGS_VERSION,
  branding: {
    productName: 'OpenExpert',
    logoOnLight: '/assets/logo-light.svg',
    logoOnDark: '/assets/logo-dark.svg',
    sidebarBackground: '#000000',
    sidebarForeground: '#ffffff',
  },
  colors: {
    light: lightColors,
    dark: darkColors,
  },
  typography: {
    bodyFamily: 'dm-sans',
    displayFamily: 'dm-sans',
    serifFamily: 'imbue',
    monoFamily: 'system-mono',
    baseSize: 16,
    bodyWeight: 400,
    headingWeight: 300,
    lineHeight: 1.5,
    headingTracking: 0,
  },
  shape: {
    radiusBase: 12,
    radiusControl: 12,
    radiusSurface: 16,
    radiusEmphasis: 20,
    controlHeight: 40,
    buttonPaddingX: 16,
    buttonFontWeight: 600,
  },
  layout: {
    contentWidth: 1408,
    sidebarWidth: 248,
    sidebarCollapsedWidth: 72,
    spacingScale: 1,
  },
  motion: {
    fast: 150,
    base: 220,
    slow: 320,
  },
}

const fontStacks: Record<FontFamilyKey, string> = {
  'dm-sans': '"DM Sans", ui-sans-serif, system-ui, sans-serif',
  system: 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  imbue: '"Imbue", Georgia, serif',
  georgia: 'Georgia, "Times New Roman", serif',
  arial: 'Arial, Helvetica, sans-serif',
  'system-mono': '"SFMono-Regular", "Cascadia Code", "Liberation Mono", monospace',
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function color(value: unknown, fallback: string): string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : fallback
}

function text(value: unknown, fallback: string, maxLength: number): string {
  if (typeof value !== 'string') return fallback
  const normalized = value.trim()
  return normalized ? normalized.slice(0, maxLength) : fallback
}

function assetUrl(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback
  const normalized = value.trim()
  if (/^\/[a-z0-9/_\-.]+$/i.test(normalized) || /^https:\/\/[^\s]+$/i.test(normalized)) {
    return normalized.slice(0, 1000)
  }
  return fallback
}

function number(value: unknown, fallback: number, min: number, max: number, precision = 0): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) return fallback
  const bounded = Math.min(max, Math.max(min, parsed))
  const multiplier = 10 ** precision
  return Math.round(bounded * multiplier) / multiplier
}

function font(value: unknown, fallback: FontFamilyKey): FontFamilyKey {
  return typeof value === 'string' && value in fontStacks ? value as FontFamilyKey : fallback
}

function normalizeColors(value: unknown, fallback: DesignColorTokens): DesignColorTokens {
  const input = asRecord(value)
  return Object.fromEntries(
    Object.entries(fallback).map(([key, fallbackValue]) => [key, color(input[key], fallbackValue)]),
  ) as unknown as DesignColorTokens
}

export function cloneDefaultOrganizationDesign(): OrganizationDesignSettings {
  return clone(DEFAULT_ORGANIZATION_DESIGN)
}

export function normalizeOrganizationDesign(value: unknown): OrganizationDesignSettings {
  const input = asRecord(value)
  const branding = asRecord(input.branding)
  const colors = asRecord(input.colors)
  const typography = asRecord(input.typography)
  const shape = asRecord(input.shape)
  const layout = asRecord(input.layout)
  const motion = asRecord(input.motion)
  const defaults = DEFAULT_ORGANIZATION_DESIGN

  return {
    version: DESIGN_SETTINGS_VERSION,
    branding: {
      productName: text(branding.productName, defaults.branding.productName, 60),
      logoOnLight: assetUrl(branding.logoOnLight, defaults.branding.logoOnLight),
      logoOnDark: assetUrl(branding.logoOnDark, defaults.branding.logoOnDark),
      sidebarBackground: color(branding.sidebarBackground, defaults.branding.sidebarBackground),
      sidebarForeground: color(branding.sidebarForeground, defaults.branding.sidebarForeground),
    },
    colors: {
      light: normalizeColors(colors.light, defaults.colors.light),
      dark: normalizeColors(colors.dark, defaults.colors.dark),
    },
    typography: {
      bodyFamily: font(typography.bodyFamily, defaults.typography.bodyFamily),
      displayFamily: font(typography.displayFamily, defaults.typography.displayFamily),
      serifFamily: font(typography.serifFamily, defaults.typography.serifFamily),
      monoFamily: font(typography.monoFamily, defaults.typography.monoFamily),
      baseSize: number(typography.baseSize, defaults.typography.baseSize, 13, 20),
      bodyWeight: number(typography.bodyWeight, defaults.typography.bodyWeight, 300, 700),
      headingWeight: number(typography.headingWeight, defaults.typography.headingWeight, 200, 800),
      lineHeight: number(typography.lineHeight, defaults.typography.lineHeight, 1.2, 1.9, 2),
      headingTracking: number(typography.headingTracking, defaults.typography.headingTracking, -0.06, 0.08, 3),
    },
    shape: {
      radiusBase: number(shape.radiusBase, defaults.shape.radiusBase, 0, 28),
      radiusControl: number(shape.radiusControl, defaults.shape.radiusControl, 0, 28),
      radiusSurface: number(shape.radiusSurface, defaults.shape.radiusSurface, 0, 40),
      radiusEmphasis: number(shape.radiusEmphasis, defaults.shape.radiusEmphasis, 0, 56),
      controlHeight: number(shape.controlHeight, defaults.shape.controlHeight, 32, 56),
      buttonPaddingX: number(shape.buttonPaddingX, defaults.shape.buttonPaddingX, 8, 28),
      buttonFontWeight: number(shape.buttonFontWeight, defaults.shape.buttonFontWeight, 400, 800),
    },
    layout: {
      contentWidth: number(layout.contentWidth, defaults.layout.contentWidth, 960, 1920),
      sidebarWidth: number(layout.sidebarWidth, defaults.layout.sidebarWidth, 220, 360),
      sidebarCollapsedWidth: number(layout.sidebarCollapsedWidth, defaults.layout.sidebarCollapsedWidth, 60, 96),
      spacingScale: number(layout.spacingScale, defaults.layout.spacingScale, 0.8, 1.3, 2),
    },
    motion: {
      fast: number(motion.fast, defaults.motion.fast, 0, 500),
      base: number(motion.base, defaults.motion.base, 0, 700),
      slow: number(motion.slow, defaults.motion.slow, 0, 1000),
    },
  }
}

function colorVariables(tokens: DesignColorTokens): Record<string, string> {
  return {
    '--ui-primary': tokens.primary,
    '--ui-secondary': tokens.secondary,
    '--ui-info': tokens.info,
    '--ui-success': tokens.success,
    '--ui-warning': tokens.warning,
    '--ui-error': tokens.error,
    '--ui-text-dimmed': tokens.textDimmed,
    '--ui-text-muted': tokens.textMuted,
    '--ui-text-toned': tokens.textToned,
    '--ui-text': tokens.text,
    '--ui-text-highlighted': tokens.textHighlighted,
    '--ui-text-inverted': tokens.textInverted,
    '--ui-bg': tokens.background,
    '--ui-bg-muted': tokens.backgroundMuted,
    '--ui-bg-elevated': tokens.backgroundElevated,
    '--ui-bg-accented': tokens.backgroundAccented,
    '--ui-bg-inverted': tokens.backgroundInverted,
    '--ui-border': tokens.border,
    '--ui-border-muted': tokens.borderMuted,
    '--ui-border-accented': tokens.borderAccented,
    '--ui-border-inverted': tokens.borderInverted,
  }
}

function declarations(values: Record<string, string>): string {
  return Object.entries(values).map(([key, value]) => `${key}:${value}`).join(';')
}

export function buildOrganizationDesignCss(value: unknown): string {
  const settings = normalizeOrganizationDesign(value)
  const base: Record<string, string> = {
    '--font-sans': fontStacks[settings.typography.bodyFamily],
    '--font-display': fontStacks[settings.typography.displayFamily],
    '--font-serif': fontStacks[settings.typography.serifFamily],
    '--font-mono': fontStacks[settings.typography.monoFamily],
    '--ui-radius': `${settings.shape.radiusBase}px`,
    '--oe-radius-control': `${settings.shape.radiusControl}px`,
    '--oe-radius-surface': `${settings.shape.radiusSurface}px`,
    '--oe-radius-emphasis': `${settings.shape.radiusEmphasis}px`,
    '--oe-control-height': `${settings.shape.controlHeight}px`,
    '--oe-button-padding-x': `${settings.shape.buttonPaddingX}px`,
    '--oe-button-font-weight': String(settings.shape.buttonFontWeight),
    '--ui-container': `${settings.layout.contentWidth}px`,
    '--oe-sidebar-width': `${settings.layout.sidebarWidth}px`,
    '--oe-sidebar-collapsed-width': `${settings.layout.sidebarCollapsedWidth}px`,
    '--oe-spacing-scale': String(settings.layout.spacingScale),
    '--oe-body-font-size': `${settings.typography.baseSize}px`,
    '--oe-body-font-weight': String(settings.typography.bodyWeight),
    '--oe-body-line-height': String(settings.typography.lineHeight),
    '--oe-heading-font-weight': String(settings.typography.headingWeight),
    '--oe-heading-letter-spacing': `${settings.typography.headingTracking}em`,
    '--oe-duration-fast': `${settings.motion.fast}ms`,
    '--oe-duration-base': `${settings.motion.base}ms`,
    '--oe-duration-slow': `${settings.motion.slow}ms`,
    '--oe-motion-fast': 'var(--oe-duration-fast) var(--ease-oe)',
    '--oe-motion-base': 'var(--oe-duration-base) var(--ease-oe)',
    '--oe-motion-slow': 'var(--oe-duration-slow) var(--ease-oe)',
    '--oe-sidebar-bg': settings.branding.sidebarBackground,
    '--oe-sidebar-fg': settings.branding.sidebarForeground,
  }

  return `html:root{${declarations({ ...base, ...colorVariables(settings.colors.light) })}}html.dark{${declarations(colorVariables(settings.colors.dark))}}`
}
