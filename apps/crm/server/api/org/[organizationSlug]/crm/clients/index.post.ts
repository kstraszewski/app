import { createError, readBody } from 'h3'
import {
  asRecord,
  requireCrmSession,
  textValue,
  throwDbError,
} from '~~/server/utils/crm'
import { issueClientPortalInvitation } from '~~/server/utils/client-portal-invitations'

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function optionalText(input: unknown, field: string, maximumLength: number): string | null {
  if (input === undefined || input === null || input === '') return null
  if (typeof input !== 'string') {
    throw createError({ statusCode: 400, statusMessage: `${field} must be text or null` })
  }
  const value = input.trim()
  if (!value) return null
  if (value.length > maximumLength) {
    throw createError({
      statusCode: 400,
      statusMessage: `${field} must not exceed ${maximumLength} characters`,
    })
  }
  return value
}

function optionalEmail(input: unknown, field: string): string | null {
  const value = optionalText(input, field, 320)?.toLowerCase() ?? null
  if (value && !emailPattern.test(value)) {
    throw createError({ statusCode: 400, statusMessage: `${field} must be a valid email address` })
  }
  return value
}

function objectValue(input: unknown, field: string): Record<string, unknown> {
  if (input === undefined || input === null) return {}
  if (typeof input !== 'object' || Array.isArray(input)) {
    throw createError({ statusCode: 400, statusMessage: `${field} must be an object` })
  }
  return input as Record<string, unknown>
}

function metadataValue(input: unknown, field: string): Record<string, unknown> {
  const value = objectValue(input, field)
  if (JSON.stringify(value).length > 64_000) {
    throw createError({ statusCode: 400, statusMessage: `${field} is too large` })
  }
  return value
}

function clientTags(input: unknown): string[] {
  if (input === undefined || input === null) return []
  if (!Array.isArray(input)) {
    throw createError({ statusCode: 400, statusMessage: 'tags must be an array' })
  }
  const tags = [...new Set(input.map((tag, index) => {
    const value = optionalText(tag, `tags[${index}]`, 80)
    if (!value) {
      throw createError({ statusCode: 400, statusMessage: `tags[${index}] must not be empty` })
    }
    return value
  }))]
  if (tags.length > 50) {
    throw createError({ statusCode: 400, statusMessage: 'tags must contain at most 50 values' })
  }
  return tags
}

function dateValue(input: unknown, field: string): string | null {
  const value = optionalText(input, field, 10)
  if (!value) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw createError({ statusCode: 400, statusMessage: `${field} must use YYYY-MM-DD` })
  }
  const parsed = new Date(`${value}T00:00:00.000Z`)
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) {
    throw createError({ statusCode: 400, statusMessage: `${field} must be a valid date` })
  }
  if (parsed > new Date()) {
    throw createError({ statusCode: 400, statusMessage: `${field} must not be in the future` })
  }
  return value
}

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  const body = asRecord(await readBody(event))
  const primaryPersonInput = objectValue(body.primary_person, 'primary_person')
  const primaryPersonEmail = optionalEmail(primaryPersonInput.email, 'primary_person.email')
  const primaryPersonPhone = optionalText(primaryPersonInput.phone, 'primary_person.phone', 50)
  const primaryPerson = {
    role: optionalText(primaryPersonInput.role, 'primary_person.role', 80) ?? 'primary',
    first_name: optionalText(primaryPersonInput.first_name, 'primary_person.first_name', 120),
    last_name: optionalText(primaryPersonInput.last_name, 'primary_person.last_name', 120),
    display_name: optionalText(primaryPersonInput.display_name, 'primary_person.display_name', 200),
    email: primaryPersonEmail,
    phone: primaryPersonPhone,
    pesel: optionalText(primaryPersonInput.pesel, 'primary_person.pesel', 32),
    date_of_birth: dateValue(primaryPersonInput.date_of_birth, 'primary_person.date_of_birth'),
    metadata: metadataValue(primaryPersonInput.metadata, 'primary_person.metadata'),
  }
  const personName = textValue(
    [primaryPerson.first_name, primaryPerson.last_name]
      .filter(Boolean)
      .join(' '),
  )
  const primaryEmail = optionalEmail(body.primary_email, 'primary_email') ?? primaryPersonEmail
  const primaryPhone = optionalText(body.primary_phone, 'primary_phone', 50) ?? primaryPersonPhone
  const displayName = optionalText(body.display_name, 'display_name', 200)
    ?? personName
    ?? primaryEmail
    ?? primaryPhone

  if (!displayName) {
    throw createError({
      statusCode: 400,
      statusMessage: 'display_name or primary person contact data is required',
    })
  }

  const requestedOwnerUserId = textValue(body.owner_user_id)
  if ('owner_user_id' in body && !requestedOwnerUserId) {
    throw createError({ statusCode: 400, statusMessage: 'owner_user_id must be a UUID' })
  }
  const ownerUserId = requestedOwnerUserId ?? session.userId
  if (!uuidPattern.test(ownerUserId)) {
    throw createError({ statusCode: 400, statusMessage: 'owner_user_id must be a UUID' })
  }
  if (session.role !== 'admin' && ownerUserId !== session.userId) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Only an organization administrator can assign a client to another user.',
    })
  }

  if (body.consent_decisions !== undefined && !Array.isArray(body.consent_decisions)) {
    throw createError({ statusCode: 400, statusMessage: 'consent_decisions must be an array' })
  }
  const seenConsentDefinitions = new Set<string>()
  const consentDecisions = Array.isArray(body.consent_decisions)
    ? body.consent_decisions.map((rawDecision, index) => {
        const decision = objectValue(rawDecision, `consent_decisions[${index}]`)
        const definitionId = textValue(decision.definition_id)
        const versionId = textValue(decision.version_id)
        if (
          !definitionId
          || !uuidPattern.test(definitionId)
          || !versionId
          || !uuidPattern.test(versionId)
          || typeof decision.granted !== 'boolean'
        ) {
          throw createError({
            statusCode: 400,
            statusMessage: `Invalid consent_decisions[${index}]`,
          })
        }
        if (seenConsentDefinitions.has(definitionId)) {
          throw createError({
            statusCode: 400,
            statusMessage: `Duplicate consent decision for definition ${definitionId}`,
          })
        }
        seenConsentDefinitions.add(definitionId)

        return {
          definition_id: definitionId,
          version_id: versionId,
          granted: decision.granted,
        }
      })
    : []

  if (consentDecisions.length) {
    throw createError({
      statusCode: 422,
      statusMessage: 'Consent decisions must be confirmed by the client through the verified SMS flow.',
    })
  }

  const { data, error } = await session.dataApi.rpc('create_crm_client_with_consents', {
    p_organization_id: session.organizationId,
    p_owner_user_id: ownerUserId,
    p_display_name: displayName,
    p_status_code: optionalText(body.status_code, 'status_code', 80) ?? 'lead',
    p_lead_source: optionalText(body.lead_source, 'lead_source', 200),
    p_primary_email: primaryEmail,
    p_primary_phone: primaryPhone,
    p_tags: clientTags(body.tags),
    p_notes: optionalText(body.notes, 'notes', 20_000),
    p_metadata: metadataValue(body.metadata, 'metadata'),
    p_primary_person: primaryPerson,
    p_consent_decisions: consentDecisions,
  })

  if (
    error?.message?.includes('consent_definition_is_stale')
    || error?.message?.includes('consent_catalogue_is_stale')
  ) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Consent definitions changed. Refresh the form and try again.',
    })
  }
  if (error?.message?.includes('consent_contact_value_is_required')) {
    throw createError({
      statusCode: 400,
      statusMessage: 'A contact value is required for the selected consent channel.',
    })
  }
  if (error?.message?.includes('client_owner_assignment_admin_required')) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Only an organization administrator can assign a client to another user.',
    })
  }
  if (
    error?.message?.includes('client_owner_not_organization_member')
    || error?.message?.includes('client_owner_is_required')
  ) {
    throw createError({
      statusCode: 400,
      statusMessage: 'owner_user_id must identify a member of the organization',
    })
  }
  if (error?.message?.includes('required_consent_not_granted')) {
    throw createError({
      statusCode: 422,
      statusMessage: 'All required consents must be granted before creating the client.',
    })
  }
  if (error?.message?.includes('client_consent_decisions_required')) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Consent decisions are required for all active definitions.',
    })
  }
  if (
    error?.message?.includes('consent_decision_is_invalid')
    || error?.message?.includes('duplicate_consent_decision')
    || error?.message?.includes('consent_decisions_must_be_an_array')
  ) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Consent decisions are invalid.',
    })
  }
  throwDbError(error)

  const created = asRecord(data)
  const createdClient = asRecord(created.data)
  const createdPeople = Array.isArray(created.people) ? created.people.map(asRecord) : []
  const createdPrimaryPerson = createdPeople[0]
  const invitationEmail = textValue(createdPrimaryPerson?.email) ?? primaryEmail
  let portalInvitation: Awaited<ReturnType<typeof issueClientPortalInvitation>> | null = null

  if (
    invitationEmail
    && textValue(createdClient.id)
    && textValue(createdPrimaryPerson?.id)
  ) {
    try {
      portalInvitation = await issueClientPortalInvitation(event, {
        organizationId: session.organizationId,
        clientId: textValue(createdClient.id)!,
        clientPersonId: textValue(createdPrimaryPerson?.id)!,
        email: invitationEmail,
        invitedByUserId: session.userId,
        name: textValue(createdPrimaryPerson?.display_name) ?? displayName,
      })
    }
    catch (invitationError) {
      console.error('Unable to create a client portal invitation', invitationError)
    }
  }

  return {
    ...created,
    portal_invitation: portalInvitation,
  }
})
