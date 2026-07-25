import type { OrganizationDesignSettings } from './design'

export const EXPERT_BRAND_PROFILE_VERSION = 1 as const

export const brandVisualStyles = ['minimal', 'editorial', 'warm'] as const
export type BrandVisualStyle = typeof brandVisualStyles[number]

export const brandMaterialTypes = [
  'linkedin',
  'instagram',
  'story',
  'business-card',
  'one-pager',
] as const
export type BrandMaterialType = typeof brandMaterialTypes[number]

export interface ExpertBrandProfile {
  version: typeof EXPERT_BRAND_PROFILE_VERSION
  brandName: string
  expertName: string
  professionalTitle: string
  tagline: string
  email: string
  phone: string
  website: string
  location: string
  bio: string
  specializations: string[]
  visualStyle: BrandVisualStyle
  logoUrl: string | null
  portraitUrl: string | null
}

export interface BrandPalette {
  primary: string
  secondary: string
  background: string
  surface: string
  foreground: string
  muted: string
}

export interface BrandMaterialContent {
  eyebrow: string
  headline: string
  body: string
  callToAction: string
}

export const brandMaterialOptions: Array<{
  value: BrandMaterialType
  label: string
  description: string
  icon: string
}> = [
  {
    value: 'linkedin',
    label: 'Post LinkedIn',
    description: 'Ekspercki post 1200 × 1200',
    icon: 'i-lucide-panels-top-left',
  },
  {
    value: 'instagram',
    label: 'Post Instagram',
    description: 'Kwadrat do feedu 1080 × 1080',
    icon: 'i-lucide-image',
  },
  {
    value: 'story',
    label: 'Story',
    description: 'Pionowa relacja 1080 × 1920',
    icon: 'i-lucide-smartphone',
  },
  {
    value: 'business-card',
    label: 'Wizytówka',
    description: 'Dwie strony 85 × 55 mm',
    icon: 'i-lucide-contact',
  },
  {
    value: 'one-pager',
    label: 'Jak pracuję',
    description: 'Jednostronicowy materiał kontaktowy',
    icon: 'i-lucide-file-text',
  },
]

const emptyProfile: ExpertBrandProfile = {
  version: EXPERT_BRAND_PROFILE_VERSION,
  brandName: '',
  expertName: '',
  professionalTitle: 'Ekspert kredytowy',
  tagline: '',
  email: '',
  phone: '',
  website: '',
  location: '',
  bio: '',
  specializations: [],
  visualStyle: 'minimal',
  logoUrl: null,
  portraitUrl: null,
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function text(value: unknown, fallback: string, maxLength: number): string {
  if (typeof value !== 'string') return fallback
  return value.trim().slice(0, maxLength)
}

function optionalUrl(value: unknown, fallback: string | null): string | null {
  if (value === null || value === '') return null
  if (typeof value !== 'string') return fallback
  const normalized = value.trim()
  return /^https:\/\/[^\s]+$/i.test(normalized) || /^\/[a-z0-9/_\-.]+$/i.test(normalized)
    ? normalized.slice(0, 1000)
    : fallback
}

function specializations(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return [...fallback]
  return [...new Set(
    value
      .filter(item => typeof item === 'string')
      .map(item => item.trim().slice(0, 48))
      .filter(Boolean),
  )].slice(0, 8)
}

export function createEmptyExpertBrandProfile(
  seed: Partial<ExpertBrandProfile> = {},
): ExpertBrandProfile {
  return normalizeExpertBrandProfile({ ...emptyProfile, ...seed })
}

export function normalizeExpertBrandProfile(
  value: unknown,
  fallbackValue: Partial<ExpertBrandProfile> = {},
): ExpertBrandProfile {
  const input = record(value)
  const fallback = { ...emptyProfile, ...fallbackValue }
  const visualStyle = brandVisualStyles.includes(input.visualStyle as BrandVisualStyle)
    ? input.visualStyle as BrandVisualStyle
    : fallback.visualStyle

  return {
    version: EXPERT_BRAND_PROFILE_VERSION,
    brandName: text(input.brandName, fallback.brandName, 80),
    expertName: text(input.expertName, fallback.expertName, 100),
    professionalTitle: text(input.professionalTitle, fallback.professionalTitle, 100),
    tagline: text(input.tagline, fallback.tagline, 140),
    email: text(input.email, fallback.email, 160),
    phone: text(input.phone, fallback.phone, 40),
    website: text(input.website, fallback.website, 240),
    location: text(input.location, fallback.location, 100),
    bio: text(input.bio, fallback.bio, 800),
    specializations: specializations(input.specializations, fallback.specializations),
    visualStyle,
    logoUrl: optionalUrl(input.logoUrl, fallback.logoUrl),
    portraitUrl: optionalUrl(input.portraitUrl, fallback.portraitUrl),
  }
}

export function brandProfileCompletion(profileValue: unknown): {
  percentage: number
  complete: number
  total: number
  missing: string[]
} {
  const profile = normalizeExpertBrandProfile(profileValue)
  const fields = [
    { label: 'nazwa marki', ready: Boolean(profile.brandName) },
    { label: 'imię i nazwisko', ready: Boolean(profile.expertName) },
    { label: 'dane kontaktowe', ready: Boolean(profile.email || profile.phone) },
    { label: 'bio', ready: Boolean(profile.bio) },
    { label: 'specjalizacje', ready: profile.specializations.length > 0 },
    { label: 'logo', ready: Boolean(profile.logoUrl) },
    { label: 'zdjęcie portretowe', ready: Boolean(profile.portraitUrl) },
  ]
  const complete = fields.filter(field => field.ready).length
  return {
    percentage: Math.round((complete / fields.length) * 100),
    complete,
    total: fields.length,
    missing: fields.filter(field => !field.ready).map(field => field.label),
  }
}

export function buildBrandPalette(design: OrganizationDesignSettings): BrandPalette {
  return {
    primary: design.colors.light.primary,
    secondary: design.colors.light.secondary,
    background: design.colors.light.background,
    surface: design.colors.light.backgroundMuted,
    foreground: design.colors.light.textHighlighted,
    muted: design.colors.light.textMuted,
  }
}

export function brandInitials(profileValue: unknown): string {
  const profile = normalizeExpertBrandProfile(profileValue)
  const source = profile.brandName || profile.expertName || 'OE'
  return source
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0]?.toLocaleUpperCase('pl-PL') ?? '')
    .join('')
}

export function contrastingTextColor(hex: string): '#ffffff' | '#111111' {
  const normalized = /^#[0-9a-f]{6}$/i.test(hex) ? hex.slice(1) : '000000'
  const red = Number.parseInt(normalized.slice(0, 2), 16)
  const green = Number.parseInt(normalized.slice(2, 4), 16)
  const blue = Number.parseInt(normalized.slice(4, 6), 16)
  const luminance = (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255
  return luminance > 0.58 ? '#111111' : '#ffffff'
}

export function buildBrandMaterialContent(
  profileValue: unknown,
  type: BrandMaterialType,
): BrandMaterialContent {
  const profile = normalizeExpertBrandProfile(profileValue)
  const specialty = profile.specializations[0] || 'finansowanie nieruchomości'
  const location = profile.location ? ` w ${profile.location}` : ''
  const contact = profile.email || profile.phone || profile.website || 'Umów bezpłatną konsultację'

  const common = {
    eyebrow: profile.professionalTitle || 'Ekspert kredytowy',
    headline: profile.tagline || 'Dobra decyzja kredytowa zaczyna się od dobrego planu.',
    body: profile.bio || `Pomagam przejść przez proces ${specialty}${location} — spokojnie, konkretnie i bez zbędnego żargonu.`,
    callToAction: contact,
  }

  if (type === 'linkedin') {
    return {
      ...common,
      eyebrow: `Wiedza eksperta · ${specialty}`,
      headline: 'Najlepszy kredyt to nie zawsze ten z najniższą ratą.',
      body: `Liczy się cały scenariusz: koszty, elastyczność i bezpieczeństwo domowego budżetu. ${common.body}`,
    }
  }
  if (type === 'instagram') {
    return {
      ...common,
      eyebrow: 'Finanse bez niedomówień',
      headline: '3 rzeczy, które sprawdzam przed złożeniem wniosku',
      body: 'Zdolność. Koszt całkowity. Bezpieczny margines w budżecie.',
    }
  }
  if (type === 'story') {
    return {
      ...common,
      eyebrow: 'Nowy poradnik',
      headline: 'Planujesz zakup mieszkania?',
      body: 'Zacznij od policzenia realnego budżetu — zanim zaczniesz oglądać oferty.',
      callToAction: 'Napisz do mnie',
    }
  }
  if (type === 'business-card') {
    return {
      ...common,
      eyebrow: profile.professionalTitle || 'Ekspert kredytowy',
      headline: profile.expertName || profile.brandName || 'Twój ekspert',
      body: profile.specializations.slice(0, 3).join(' · ') || 'Kredyty hipoteczne · Refinansowanie · Analiza zdolności',
    }
  }

  return {
    ...common,
    eyebrow: 'Jak pracuję',
    headline: 'Od pierwszej rozmowy do uruchomienia finansowania.',
    body: 'Najpierw poznaję Twoją sytuację i cel. Potem porównuję realne scenariusze, porządkuję dokumenty i prowadzę proces aż do decyzji.',
  }
}
