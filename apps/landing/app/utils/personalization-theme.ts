export type PresetThemeId = 'ocean' | 'ember' | 'plum'
export type ThemeId = PresetThemeId | 'custom'
export type ThemeFontKey = 'roboto' | 'manrope' | 'dm-sans' | 'system' | 'imbue' | 'georgia'

export type ThemeColorKey = keyof PersonalizationTheme['colors']

export interface PersonalizationTheme {
  id: ThemeId
  name: string
  description: string
  colors: {
    primary: string
    accent: string
    onPrimary: string
    background: string
    surface: string
    text: string
    muted: string
    border: string
  }
  fonts: {
    display: ThemeFontKey
    body: ThemeFontKey
  }
  radius: number
}

export const themeFontOptions: Array<{ label: string, value: ThemeFontKey, stack: string }> = [
  {
    label: 'Roboto',
    value: 'roboto',
    stack: 'Roboto, "DM Sans", Arial, sans-serif',
  },
  {
    label: 'Manrope',
    value: 'manrope',
    stack: 'Manrope, "DM Sans", ui-sans-serif, system-ui, sans-serif',
  },
  {
    label: 'DM Sans',
    value: 'dm-sans',
    stack: '"DM Sans", ui-sans-serif, system-ui, sans-serif',
  },
  {
    label: 'System UI',
    value: 'system',
    stack: 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  },
  {
    label: 'Imbue',
    value: 'imbue',
    stack: 'Imbue, Georgia, serif',
  },
  {
    label: 'Georgia',
    value: 'georgia',
    stack: 'Georgia, "Times New Roman", serif',
  },
]

const fontStacks = Object.fromEntries(
  themeFontOptions.map(option => [option.value, option.stack]),
) as Record<ThemeFontKey, string>

export const personalizationPresets: PersonalizationTheme[] = [
  {
    id: 'ocean',
    name: 'Ocean',
    description: 'Energetyczny błękit, jasne powierzchnie i granatowy tekst.',
    colors: {
      primary: '#2563EB',
      accent: '#06B6D4',
      onPrimary: '#FFFFFF',
      background: '#F6F9FC',
      surface: '#FFFFFF',
      text: '#172554',
      muted: '#64748B',
      border: '#D7E1EC',
    },
    fonts: {
      display: 'dm-sans',
      body: 'dm-sans',
    },
    radius: 12,
  },
  {
    id: 'ember',
    name: 'Ember',
    description: 'Głęboka terakota, ciepły akcent i neutralne szarości.',
    colors: {
      primary: '#C2410C',
      accent: '#F59E0B',
      onPrimary: '#FFFFFF',
      background: '#FAF7F2',
      surface: '#FFFFFF',
      text: '#3F2A22',
      muted: '#78716C',
      border: '#E7DDD4',
    },
    fonts: {
      display: 'roboto',
      body: 'roboto',
    },
    radius: 4,
  },
  {
    id: 'plum',
    name: 'Plum',
    description: 'Burgund, pomarańczowy akcent i chłodny grafit.',
    colors: {
      primary: '#9B0050',
      accent: '#EF7F1A',
      onPrimary: '#FFFFFF',
      background: '#F9FAFB',
      surface: '#FFFFFF',
      text: '#111928',
      muted: '#6B7280',
      border: '#E5E7EB',
    },
    fonts: {
      display: 'manrope',
      body: 'manrope',
    },
    radius: 8,
  },
]

const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i

export function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && HEX_COLOR_PATTERN.test(value)
}

export function clonePersonalizationTheme(theme: PersonalizationTheme): PersonalizationTheme {
  return JSON.parse(JSON.stringify(theme)) as PersonalizationTheme
}

export function createCustomTheme(source: PersonalizationTheme): PersonalizationTheme {
  const custom = clonePersonalizationTheme(source)
  custom.id = 'custom'
  custom.name = 'Custom'
  custom.description = `Własny wariant na bazie ${source.name}.`
  return custom
}

function normalizeColor(value: unknown, fallback: string): string {
  return isHexColor(value) ? value.toUpperCase() : fallback
}

function normalizeFont(value: unknown, fallback: ThemeFontKey): ThemeFontKey {
  return typeof value === 'string' && value in fontStacks
    ? value as ThemeFontKey
    : fallback
}

export function normalizeCustomTheme(
  value: unknown,
  fallback: PersonalizationTheme,
): PersonalizationTheme {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return createCustomTheme(fallback)
  }

  const input = value as Partial<PersonalizationTheme>
  const inputColors: Partial<PersonalizationTheme['colors']> = input.colors ?? {}
  const inputFonts: Partial<PersonalizationTheme['fonts']> = input.fonts ?? {}
  const custom = createCustomTheme(fallback)

  custom.colors = {
    primary: normalizeColor(inputColors.primary, custom.colors.primary),
    accent: normalizeColor(inputColors.accent, custom.colors.accent),
    onPrimary: normalizeColor(inputColors.onPrimary, custom.colors.onPrimary),
    background: normalizeColor(inputColors.background, custom.colors.background),
    surface: normalizeColor(inputColors.surface, custom.colors.surface),
    text: normalizeColor(inputColors.text, custom.colors.text),
    muted: normalizeColor(inputColors.muted, custom.colors.muted),
    border: normalizeColor(inputColors.border, custom.colors.border),
  }
  custom.fonts = {
    display: normalizeFont(inputFonts.display, custom.fonts.display),
    body: normalizeFont(inputFonts.body, custom.fonts.body),
  }
  custom.radius = Math.min(24, Math.max(0, Number.isFinite(Number(input.radius)) ? Number(input.radius) : custom.radius))

  return custom
}

function hexToRgb(hex: string): [number, number, number] {
  const normalized = hex.replace('#', '')
  return [
    Number.parseInt(normalized.slice(0, 2), 16),
    Number.parseInt(normalized.slice(2, 4), 16),
    Number.parseInt(normalized.slice(4, 6), 16),
  ]
}

export function hexToRgba(hex: string, alpha: number): string {
  const [red, green, blue] = hexToRgb(hex)
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`
}

export function themeToCssVariables(theme: PersonalizationTheme): Record<string, string> {
  const safe = normalizeCustomTheme(theme, theme)

  return {
    '--theme-primary': safe.colors.primary,
    '--theme-accent': safe.colors.accent,
    '--theme-on-primary': safe.colors.onPrimary,
    '--theme-background': safe.colors.background,
    '--theme-surface': safe.colors.surface,
    '--theme-text': safe.colors.text,
    '--theme-muted': safe.colors.muted,
    '--theme-border': safe.colors.border,
    '--theme-primary-soft': hexToRgba(safe.colors.primary, 0.09),
    '--theme-accent-soft': hexToRgba(safe.colors.accent, 0.14),
    '--theme-font-display': fontStacks[safe.fonts.display],
    '--theme-font-body': fontStacks[safe.fonts.body],
    '--theme-radius': `${safe.radius}px`,
  }
}

function relativeLuminance(hex: string): number {
  const [red, green, blue] = hexToRgb(hex).map(channel => {
    const normalized = channel / 255
    return normalized <= 0.03928
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]

  return (0.2126 * red) + (0.7152 * green) + (0.0722 * blue)
}

export function getContrastRatio(foreground: string, background: string): number {
  if (!isHexColor(foreground) || !isHexColor(background)) return 1
  const first = relativeLuminance(foreground)
  const second = relativeLuminance(background)
  const lighter = Math.max(first, second)
  const darker = Math.min(first, second)
  return (lighter + 0.05) / (darker + 0.05)
}
