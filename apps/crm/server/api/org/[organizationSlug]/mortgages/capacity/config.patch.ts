import { createError, readBody } from 'h3'
import {
  asRecord,
  requireAdministrativePermission,
  requireCrmSession,
  throwDbError,
} from '~~/server/utils/crm'
import {
  capacityExpectedRevision,
  capacityNotes,
  mortgageCapacityPolicyFromRow,
  mortgageCapacityPolicyToRow,
  sanitizeMortgageCapacityPolicy,
} from '~~/server/utils/mortgage-capacity'

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  await requireAdministrativePermission(session, 'crm.configuration.manage')
  const body = asRecord(await readBody(event))
  const settings = sanitizeMortgageCapacityPolicy(body.settings)
  const notes = capacityNotes(body.notes)
  const expectedRevision = capacityExpectedRevision(body.expectedRevision)

  const { data: existing, error: existingError } = await session.supabase
    .from('mortgage_capacity_settings')
    .select('organization_id, revision')
    .eq('organization_id', session.organizationId)
    .maybeSingle()
  throwDbError(existingError)
  if ((existing?.revision ?? 0) !== expectedRevision) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Założenia zmieniły się w innym panelu. Odśwież stronę przed ponownym zapisem.',
    })
  }

  const values = { ...mortgageCapacityPolicyToRow(settings), notes }
  const { data, error } = existing
    ? await session.supabase
        .from('mortgage_capacity_settings')
        .update(values)
        .eq('organization_id', session.organizationId)
        .eq('revision', expectedRevision)
        .select('*')
        .maybeSingle()
    : await session.supabase
        .from('mortgage_capacity_settings')
        .insert({ organization_id: session.organizationId, ...values })
        .select('*')
        .maybeSingle()
  if (error?.code === '23505') {
    throw createError({
      statusCode: 409,
      statusMessage: 'Założenia zostały właśnie utworzone w innym panelu. Odśwież stronę.',
    })
  }
  throwDbError(error)
  if (!data) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Założenia zmieniły się w innym panelu. Odśwież stronę przed ponownym zapisem.',
    })
  }

  return {
    settings: mortgageCapacityPolicyFromRow(data),
    notes: data.notes ?? null,
    isCustomized: true,
    revision: data.revision,
    updatedAt: data.updated_at,
    role: session.role,
  }
})
