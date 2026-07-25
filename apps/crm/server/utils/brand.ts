import type { CrmSession } from './crm'
import {
  createEmptyExpertBrandProfile,
  normalizeExpertBrandProfile,
  type ExpertBrandProfile,
} from '#shared/brand'

export const brandAssetBucket = 'expert-brand-assets'

export interface ExpertBrandProfileRow {
  organization_id: string
  user_id: string
  expert_name: string
  professional_title: string
  tagline: string
  contact_email: string
  contact_phone: string
  website_url: string
  location: string
  bio: string
  specializations: string[]
  visual_style: string
  portrait_path: string | null
  updated_at: string
}

export const expertBrandProfileSelect = [
  'organization_id',
  'user_id',
  'expert_name',
  'professional_title',
  'tagline',
  'contact_email',
  'contact_phone',
  'website_url',
  'location',
  'bio',
  'specializations',
  'visual_style',
  'portrait_path',
  'updated_at',
].join(', ')

function publicAssetUrl(session: CrmSession, path: string | null): string | null {
  if (!path) return null
  return session.supabase.storage.from(brandAssetBucket).getPublicUrl(path).data.publicUrl
}

export function defaultExpertBrandProfile(session: CrmSession): ExpertBrandProfile {
  return createEmptyExpertBrandProfile({
    expertName: session.fullName,
    email: session.email,
    phone: session.phone,
  })
}

export function profileFromRow(
  session: CrmSession,
  row: ExpertBrandProfileRow | null,
): ExpertBrandProfile {
  const fallback = defaultExpertBrandProfile(session)
  if (!row) return fallback

  return normalizeExpertBrandProfile({
    expertName: row.expert_name,
    professionalTitle: row.professional_title,
    tagline: row.tagline,
    email: row.contact_email,
    phone: row.contact_phone,
    website: row.website_url,
    location: row.location,
    bio: row.bio,
    specializations: row.specializations,
    visualStyle: row.visual_style,
    portraitUrl: publicAssetUrl(session, row.portrait_path),
  }, fallback)
}

export function profileToRow(profileValue: unknown) {
  const profile = normalizeExpertBrandProfile(profileValue)
  return {
    expert_name: profile.expertName,
    professional_title: profile.professionalTitle,
    tagline: profile.tagline,
    contact_email: profile.email,
    contact_phone: profile.phone,
    website_url: profile.website,
    location: profile.location,
    bio: profile.bio,
    specializations: profile.specializations,
    visual_style: profile.visualStyle,
  }
}
