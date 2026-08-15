import { createError, readBody } from 'h3'
import {
  asRecord,
  getRequiredParam,
  recordCrmActivity,
  requireCrmSession,
  stringArrayValue,
  textValue,
  throwDbError,
} from '~~/server/utils/crm'
import { normalizeNip } from '~~/server/utils/ceidg-company'
import { lookupConfiguredCeidgCompany } from '~~/server/utils/ceidg-company-runtime'
import { assertCeidgLookupRateLimit } from '~~/server/utils/ceidg-rate-limit'
import { serverTrustedUserDataClient } from '~~/server/utils/platform-data'
import {
  mergeCeidgCompanyIntoClientMetadata,
  preserveCeidgClientCompanyMetadata,
  stripCeidgClientCompanyMetadata,
} from '#shared/utils/ceidg-client-company'

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  const id = getRequiredParam(event, 'id')
  const body = asRecord(await readBody(event))
  const expectedUpdatedAt = textValue(body.expected_updated_at)
  if (!expectedUpdatedAt || Number.isNaN(Date.parse(expectedUpdatedAt))) {
    throw createError({
      statusCode: 400,
      statusMessage: 'expected_updated_at must be a valid timestamp',
    })
  }

  const { data: currentClient, error: currentClientError } = await session.dataApi
    .from('crm_clients')
    .select('status_code, metadata, updated_at')
    .eq('organization_id', session.organizationId)
    .eq('id', id)
    .maybeSingle()
  throwDbError(currentClientError)
  if (!currentClient) {
    throw createError({ statusCode: 404, statusMessage: 'Client not found' })
  }
  if (textValue(currentClient.status_code) === 'anonymized') {
    throw createError({
      statusCode: 409,
      statusMessage: 'Zanonimizowanego klienta nie można ponownie edytować.',
    })
  }
  if (currentClient.updated_at !== expectedUpdatedAt) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Dane klienta zmieniły się od otwarcia formularza. Odśwież kartę i spróbuj ponownie.',
    })
  }
  if ('status_code' in body && textValue(body.status_code) === 'anonymized') {
    throw createError({
      statusCode: 422,
      statusMessage: 'Anonimizację wykonaj przez dedykowany proces prywatności.',
    })
  }

  const patch: Record<string, unknown> = {}
  for (const field of ['display_name', 'status_code', 'lead_source', 'primary_email', 'primary_phone', 'notes'] as const) {
    if (field in body) patch[field] = textValue(body[field]) ?? null
  }
  if ('owner_user_id' in body) {
    const ownerUserId = textValue(body.owner_user_id)
    if (!ownerUserId || !uuidPattern.test(ownerUserId)) {
      throw createError({ statusCode: 400, statusMessage: 'owner_user_id must be a UUID' })
    }
    if (session.role !== 'admin') {
      throw createError({
        statusCode: 403,
        statusMessage: 'Only an organization administrator can change the client owner.',
      })
    }

    const { data: ownerMembership, error: ownerMembershipError } = await session.dataApi
      .from('organization_memberships')
      .select('user_id')
      .eq('organization_id', session.organizationId)
      .eq('user_id', ownerUserId)
      .maybeSingle()
    throwDbError(ownerMembershipError)
    if (!ownerMembership) {
      throw createError({
        statusCode: 400,
        statusMessage: 'owner_user_id must identify a member of the organization',
      })
    }

    patch.owner_user_id = ownerUserId
  }
  if ('tags' in body) patch.tags = stringArrayValue(body.tags)
  if ('metadata' in body) {
    patch.metadata = preserveCeidgClientCompanyMetadata(
      asRecord(body.metadata),
      currentClient.metadata,
    )
  }
  if ('ceidg_nip' in body) {
    const baseMetadata = patch.metadata ?? currentClient.metadata
    if (body.ceidg_nip === null) {
      const currentRegistrySource = textValue(asRecord(currentClient.metadata).registry_source)
      if (currentRegistrySource?.toLocaleUpperCase('pl-PL') !== 'CEIDG') {
        throw createError({
          statusCode: 400,
          statusMessage: 'Klient nie ma dołączonych danych CEIDG.',
        })
      }
      patch.metadata = stripCeidgClientCompanyMetadata(baseMetadata)
    }
    else {
      const ceidgNip = normalizeNip(body.ceidg_nip)
      await assertCeidgLookupRateLimit(event, session.userId)
      const ceidg = await lookupConfiguredCeidgCompany(event, ceidgNip)
      const { data: latestClient, error: latestClientError } = await session.dataApi
        .from('crm_clients')
        .select('status_code, metadata, updated_at')
        .eq('organization_id', session.organizationId)
        .eq('id', id)
        .maybeSingle()
      throwDbError(latestClientError)
      if (!latestClient) {
        throw createError({ statusCode: 404, statusMessage: 'Client not found' })
      }
      if (textValue(latestClient.status_code) === 'anonymized') {
        throw createError({
          statusCode: 409,
          statusMessage: 'Klient został zanonimizowany podczas pobierania danych CEIDG.',
        })
      }
      if (latestClient.updated_at !== expectedUpdatedAt) {
        throw createError({
          statusCode: 409,
          statusMessage: 'Dane klienta zmieniły się podczas pobierania CEIDG. Odśwież kartę i spróbuj ponownie.',
        })
      }
      const latestBaseMetadata = 'metadata' in body
        ? preserveCeidgClientCompanyMetadata(asRecord(body.metadata), latestClient.metadata)
        : latestClient.metadata
      patch.metadata = mergeCeidgCompanyIntoClientMetadata(
        latestBaseMetadata,
        ceidg.company,
        ceidg.source,
      )
    }
  }

  const clientWriter = 'ceidg_nip' in body
    ? serverTrustedUserDataClient(event, session.userId)
    : session.dataApi
  const { data, error } = await clientWriter
    .from('crm_clients')
    .update(patch)
    .eq('organization_id', session.organizationId)
    .eq('id', id)
    .eq('updated_at', expectedUpdatedAt)
    .neq('status_code', 'anonymized')
    .select('*')
    .maybeSingle()

  if (error?.message?.includes('client_owner_assignment_admin_required')) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Only an organization administrator can change the client owner.',
    })
  }
  if (error?.message?.includes('ceidg_snapshot_actor_membership_required')) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Członkostwo w organizacji wygasło podczas zapisu klienta.',
    })
  }
  if (
    error?.message?.includes('anonymized_client_is_terminal')
    || error?.message?.includes('anonymized_client_payload_not_sanitized')
    || error?.message?.includes('anonymized_client_transition_requires_workflow')
  ) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Zanonimizowanego klienta nie można ponownie edytować.',
    })
  }
  throwDbError(error)
  if (!data) {
    const { data: conflictingClient } = await session.dataApi
      .from('crm_clients')
      .select('status_code')
      .eq('organization_id', session.organizationId)
      .eq('id', id)
      .maybeSingle()
    if (textValue(conflictingClient?.status_code) !== 'anonymized') {
      throw createError({
        statusCode: 409,
        statusMessage: 'Dane klienta zmieniły się podczas zapisu. Odśwież kartę i spróbuj ponownie.',
      })
    }
    throw createError({
      statusCode: 409,
      statusMessage: 'Klient został zanonimizowany podczas zapisu. Zmiany odrzucono.',
    })
  }

  await recordCrmActivity(session, {
    client_id: id,
    activity_type: 'client_updated',
    title: 'Zaktualizowano klienta',
    payload: patch,
  })

  return { data }
})
