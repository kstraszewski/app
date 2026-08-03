import type { H3Event } from 'h3'
import type { PortalExpertDetails } from '../../shared/types/portal-dashboard.ts'
import { resolvePortalAvatarUrl } from '../../shared/utils/portal-avatar.ts'
import { serverDataBackend } from './data-api'
import { throwPortalDbError } from './portal-auth'
import { chunkPortalQueryValues, runPortalQueryChunks } from './portal-query'

type Row = Record<string, any>

export interface PortalExpertReference {
  organizationId: string
  userId: string
}

function scopeKey(organizationId: string, userId: string): string {
  return JSON.stringify([organizationId, userId])
}

function optionalText(value: unknown): string | null {
  const normalized = typeof value === 'string' ? value.trim() : ''
  return normalized || null
}

function brandPortraitUrl(backend: any, value: unknown): string | null {
  const path = optionalText(value)
  if (!path) return null
  const publicUrl = optionalText(
    backend.storage.from('expert-brand-assets').getPublicUrl(path).data.publicUrl,
  )
  if (!publicUrl) return null
  try {
    const url = new URL(publicUrl)
    return url.protocol === 'https:' || url.protocol === 'http:'
      ? url.toString()
      : null
  }
  catch {
    return null
  }
}

async function loadExpertRowsByUserIds(
  backend: any,
  table: string,
  select: string,
  userIdColumn: string,
  userIds: string[],
  errorContext: string,
): Promise<Row[]> {
  const rowsByChunk = await runPortalQueryChunks(
    chunkPortalQueryValues(userIds),
    async (ids) => {
      const result = await backend
        .from(table)
        .select(select)
        .in(userIdColumn, ids)
      throwPortalDbError(result.error, errorContext)
      return (result.data ?? []) as Row[]
    },
  )
  return rowsByChunk.flat()
}

/**
 * Loads only expert data that was explicitly configured for outward-facing
 * materials. In particular, this helper never selects `users.email`.
 */
export async function loadPublicPortalExperts(
  event: H3Event,
  references: PortalExpertReference[],
): Promise<Map<string, PortalExpertDetails>> {
  const uniqueReferences = new Map(
    references
      .filter(reference => reference.organizationId && reference.userId)
      .map(reference => [scopeKey(reference.organizationId, reference.userId), reference]),
  )
  if (!uniqueReferences.size) return new Map()

  const userIds = [...new Set(
    [...uniqueReferences.values()].map(reference => reference.userId),
  )]
  const publicAssetBaseUrl = String(
    useRuntimeConfig(event).portalAssets.publicBaseUrl || '',
  )
  const backend = serverDataBackend(event) as any
  const [userRows, membershipRows, brandProfileRows] = await Promise.all([
    loadExpertRowsByUserIds(
      backend,
      'users',
      'id, full_name, avatar_url',
      'id',
      userIds,
      'could not load assigned experts',
    ),
    loadExpertRowsByUserIds(
      backend,
      'organization_memberships',
      'organization_id, user_id, role',
      'user_id',
      userIds,
      'could not validate assigned expert roles',
    ),
    loadExpertRowsByUserIds(
      backend,
      'expert_brand_profiles',
      `
        organization_id,
        user_id,
        expert_name,
        professional_title,
        contact_email,
        contact_phone,
        portrait_path
      `,
      'user_id',
      userIds,
      'could not load public expert profiles',
    ),
  ])

  const users = new Map<string, Row>(
    userRows.map(row => [String(row.id), row]),
  )
  const memberships = new Map<string, Row>(
    membershipRows.map(row => [
      scopeKey(String(row.organization_id), String(row.user_id)),
      row,
    ]),
  )
  const brandProfiles = new Map<string, Row>(
    brandProfileRows.map(row => [
      scopeKey(String(row.organization_id), String(row.user_id)),
      row,
    ]),
  )

  const experts = new Map<string, PortalExpertDetails>()
  for (const [key, reference] of uniqueReferences) {
    const membership = memberships.get(key)
    const user = users.get(reference.userId)
    // A stale case assignment must not expose data of a former organization member.
    if (!membership || !user) continue

    const brandProfile = brandProfiles.get(key)
    const email = optionalText(brandProfile?.contact_email)
    const phone = optionalText(brandProfile?.contact_phone)
    const portraitUrl = brandPortraitUrl(backend, brandProfile?.portrait_path)
    const role = membership.role === 'admin' ? 'admin' as const : 'expert' as const
    experts.set(key, {
      id: reference.userId,
      name: optionalText(brandProfile?.expert_name)
        ?? optionalText(user.full_name)
        ?? 'Twój ekspert',
      avatarUrl: portraitUrl
        ?? resolvePortalAvatarUrl(user.avatar_url, publicAssetBaseUrl),
      role,
      professionalTitle: optionalText(brandProfile?.professional_title),
      contact: email || phone ? { email, phone } : null,
    })
  }
  return experts
}

export function portalExpertScopeKey(
  organizationId: string,
  userId: string,
): string {
  return scopeKey(organizationId, userId)
}
