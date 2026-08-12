import { setHeader } from 'h3'
import { bookingWidgetPublicUrl } from '#shared/utils/booking-widget-urls'
import { serverDataBackend } from '~~/server/utils/data-api'
import { requireCrmSession, throwDbError } from '~~/server/utils/crm'
import {
  expertBrandProfileSelect,
  profileFromRow,
  type ExpertBrandProfileRow,
} from '~~/server/utils/brand'
import {
  publicDirectoryCardCandidate,
  selectPublicDirectoryCard,
  type PublicDirectoryCardCandidate,
} from '~~/server/utils/public-expert-card'

const rpcBatchSize = 20
const bundledExpertAvatarPattern = /^\/avatars\/experts\/[a-z0-9][a-z0-9-]*\.webp$/iu

function textValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function safeAbsoluteUrl(value: unknown, baseUrl = ''): string | null {
  const normalized = textValue(value)
  if (!normalized) return null
  try {
    const url = baseUrl ? new URL(normalized, baseUrl) : new URL(normalized)
    return url.protocol === 'https:' || url.protocol === 'http:'
      ? url.toString()
      : null
  }
  catch {
    return null
  }
}

function portalFallbackAvatar(value: unknown, landingBaseUrl: string): string | null {
  const normalized = textValue(value)
  const absolute = safeAbsoluteUrl(normalized)
  if (absolute?.startsWith('https://')) return absolute
  if (!bundledExpertAvatarPattern.test(normalized)) return null
  const bundled = safeAbsoluteUrl(normalized, landingBaseUrl)
  return bundled?.startsWith('https://') ? bundled : null
}

function directoryPreviewAvatar(value: unknown, landingBaseUrl: string): string | null {
  const normalized = textValue(value)
  if (!normalized) return null
  return safeAbsoluteUrl(normalized)
    ?? (normalized.startsWith('/') ? safeAbsoluteUrl(normalized, landingBaseUrl) : null)
}

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  const session = await requireCrmSession(event)
  const backendData = serverDataBackend(event) as any
  const runtimeConfig = useRuntimeConfig(event)
  const landingBaseUrl = String(
    runtimeConfig.public.openexpert.landingBaseUrl || 'https://www.openexpert.app',
  )
  const clientPortalBaseUrl = String(
    runtimeConfig.public.openexpert.clientPortalBaseUrl || 'http://127.0.0.1:3006',
  )

  const [profileResult, userResult, assignmentsResult] = await Promise.all([
    session.dataApi
      .from('expert_brand_profiles')
      .select(expertBrandProfileSelect)
      .eq('organization_id', session.organizationId)
      .eq('user_id', session.userId)
      .maybeSingle(),
    session.dataApi
      .from('users')
      .select('id, full_name, avatar_url')
      .eq('id', session.userId)
      .single(),
    backendData
      .from('facility_service_experts')
      .select('organization_id, facility_id')
      .eq('organization_id', session.organizationId)
      .eq('user_id', session.userId)
      .eq('is_active', true),
  ])

  throwDbError(profileResult.error)
  throwDbError(userResult.error)
  throwDbError(assignmentsResult.error)

  const profile = profileFromRow(
    session,
    profileResult.data as ExpertBrandProfileRow | null,
  )
  const publicUserName = textValue(userResult.data?.full_name) || session.fullName || 'Ekspert'
  const portalAvatarUrl = profile.portraitUrl
    ?? portalFallbackAvatar(userResult.data?.avatar_url, landingBaseUrl)

  const assignmentPairs = new Set<string>()
  const facilityIds = new Set<string>()
  for (const assignment of assignmentsResult.data ?? []) {
    const organizationId = textValue(assignment.organization_id)
    const facilityId = textValue(assignment.facility_id)
    if (!organizationId || !facilityId) continue
    assignmentPairs.add(`${organizationId}:${facilityId}`)
    facilityIds.add(facilityId)
  }

  let directoryStatus: 'listed' | 'facility_only' | 'hidden' | 'partial' = 'hidden'
  let directoryCandidates: PublicDirectoryCardCandidate[] = []
  let rpcFailureCount = 0

  if (facilityIds.size) {
    const widgetsResult = await backendData
      .from('booking_widgets')
      .select('organization_id, facility_id, public_token')
      .eq('organization_id', session.organizationId)
      .eq('is_active', true)
      .eq('is_directory_listed', true)
      .eq('widget_type', 'calendar')
      .in('facility_id', [...facilityIds])
      .order('public_token')
    throwDbError(widgetsResult.error)

    const sources: Array<{ organizationId: string, widgetKey: string }> = (widgetsResult.data ?? [])
      .flatMap((widget: Record<string, unknown>) => {
        const organizationId = textValue(widget.organization_id)
        const facilityId = textValue(widget.facility_id)
        const widgetKey = textValue(widget.public_token)
        if (!widgetKey || !assignmentPairs.has(`${organizationId}:${facilityId}`)) return []
        return [{ organizationId, widgetKey }]
      })

    for (let start = 0; start < sources.length; start += rpcBatchSize) {
      const batch = sources.slice(start, start + rpcBatchSize)
      const results = await Promise.all(batch.map(async (source) => {
        const catalogResult = await backendData.rpc('get_booking_widget_catalog', {
          p_widget_token: source.widgetKey,
        })
        if (catalogResult.error) {
          rpcFailureCount += 1
          console.error('[account-public-visibility] booking widget catalog failed', {
            widgetKey: source.widgetKey,
            code: catalogResult.error.code,
            message: catalogResult.error.message,
          })
          return null
        }
        return publicDirectoryCardCandidate(catalogResult.data, source, session.userId)
      }))
      directoryCandidates.push(...results.filter(
        (candidate): candidate is PublicDirectoryCardCandidate => Boolean(candidate),
      ))
    }
  }

  const selectedDirectoryCard = selectPublicDirectoryCard(
    directoryCandidates,
    session.userId,
  )
  directoryStatus = rpcFailureCount
    ? 'partial'
    : selectedDirectoryCard
      ? 'listed'
      : directoryCandidates.length
        ? 'facility_only'
        : 'hidden'

  const directoryUrl = new URL('/eksperci', landingBaseUrl)
  directoryUrl.hash = `ekspert-${session.userId}`
  const bookingUrl = selectedDirectoryCard
    ? new URL(bookingWidgetPublicUrl(clientPortalBaseUrl, selectedDirectoryCard.widgetKey))
    : null
  if (bookingUrl) bookingUrl.searchParams.set('expertId', session.userId)
  const facilityAppearances = [...new Map(directoryCandidates.map(candidate => [
    candidate.facility.id,
    candidate.facility,
  ])).values()]

  return {
    portal: {
      audience: 'linked_clients' as const,
      card: {
        name: profile.expertName || publicUserName,
        professionalTitle: profile.professionalTitle || null,
        avatarUrl: portalAvatarUrl,
      },
      contact: {
        email: profile.email || null,
        phone: profile.phone || null,
      },
    },
    directory: {
      status: directoryStatus,
      listed: Boolean(selectedDirectoryCard),
      sourceIsCurrentOrganization: selectedDirectoryCard?.organizationId === session.organizationId,
      currentOrganizationListed: directoryCandidates.length > 0,
      rpcFailureCount,
      directoryUrl: directoryUrl.toString(),
      facilityAppearances,
      card: selectedDirectoryCard
        ? {
            name: selectedDirectoryCard.name,
            avatarUrl: directoryPreviewAvatar(
              selectedDirectoryCard.avatarUrl,
              landingBaseUrl,
            ),
            facility: selectedDirectoryCard.facility,
            services: selectedDirectoryCard.services.map(service => ({
              name: service.name,
              durationMinutes: service.durationMinutes,
            })),
            bookingUrl: bookingUrl?.toString() ?? null,
          }
        : null,
    },
    profileScope: {
      organizationId: session.organizationId,
      organizationName: session.organizationName,
    },
  }
})
