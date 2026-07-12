import { getQuery, setHeader } from 'h3'
import {
  parseClientSearchFilters,
  searchCrmClients,
} from '~~/server/utils/clients'
import { requireCrmSession } from '~~/server/utils/crm'

function facetArray(facets: Record<string, unknown>, ...keys: string[]): unknown[] {
  for (const key of keys) {
    if (Array.isArray(facets[key])) return facets[key] as unknown[]
  }
  return []
}

function facetRecord(facets: Record<string, unknown>, ...keys: string[]): Record<string, unknown> | null {
  for (const key of keys) {
    const value = facets[key]
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>
    }
  }
  return null
}

function normalizedConsentDefinitions(values: unknown[]): Record<string, unknown>[] {
  return values.flatMap((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return []
    const definition = value as Record<string, unknown>
    const versionValue = definition.currentVersion ?? definition.current_version
    if (!versionValue || typeof versionValue !== 'object' || Array.isArray(versionValue)) return []
    const version = versionValue as Record<string, unknown>
    const versionId = definition.currentVersionId ?? definition.current_version_id ?? version.id
    if (typeof definition.id !== 'string' || typeof versionId !== 'string') return []

    return [{
      id: definition.id,
      code: definition.code,
      current_version_id: versionId,
      current_version: {
        id: version.id,
        version: version.version,
        display_title: version.displayTitle ?? version.display_title,
        content: version.content,
        purpose: version.purpose,
        channel: version.channel,
        legal_basis: version.legalBasis ?? version.legal_basis,
        is_required: version.isRequired ?? version.is_required ?? false,
      },
      counts: definition.counts ?? null,
    }]
  })
}

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  setHeader(event, 'Cache-Control', 'no-store')
  const filters = parseClientSearchFilters({
    ...getQuery(event),
    limit: 1,
    offset: 0,
    cursor: undefined,
  }, session, { forceFacets: true })
  const result = await searchCrmClients(session, filters)
  const facets = result.facets ?? {}
  const statuses = facetArray(facets, 'statuses', 'statusCodes', 'status_codes')
  const sources = facetArray(facets, 'leadSources', 'lead_sources', 'sources')
  const tags = facetArray(facets, 'tags')
  const owners = facetArray(facets, 'owners')
  const consentDefinitions = normalizedConsentDefinitions(facetArray(
    facets,
    'consentDefinitions',
    'consent_definitions',
    'definitions',
  ))
  const rawDateBounds = facetRecord(facets, 'dateBounds', 'date_bounds')
  const dateBounds = rawDateBounds
    ? {
        created_min: rawDateBounds.createdMin ?? rawDateBounds.created_min ?? null,
        created_max: rawDateBounds.createdMax ?? rawDateBounds.created_max ?? null,
        updated_min: rawDateBounds.updatedMin ?? rawDateBounds.updated_min ?? null,
        updated_max: rawDateBounds.updatedMax ?? rawDateBounds.updated_max ?? null,
      }
    : null
  const rawContactCounts = facetRecord(facets, 'contactCounts', 'contact_counts')
  const emailCount = Number(rawContactCounts?.email ?? rawContactCounts?.with_email ?? 0)
  const phoneCount = Number(rawContactCounts?.phone ?? rawContactCounts?.with_phone ?? 0)
  const contactCounts = rawContactCounts
    ? {
        with_email: emailCount,
        without_email: Math.max(0, result.count - emailCount),
        with_phone: phoneCount,
        without_phone: Math.max(0, result.count - phoneCount),
        with_both: Number(rawContactCounts.both ?? 0),
        without_contact: Number(rawContactCounts.none ?? 0),
      }
    : null

  return {
    statuses,
    sources,
    lead_sources: sources,
    tags,
    owners,
    consent_definitions: consentDefinitions,
    definitions: consentDefinitions,
    date_bounds: dateBounds,
    contact_counts: contactCounts,
    total: result.count,
    facets,
  }
})
