import { createError, readBody } from 'h3'
import {
  asRecord,
  requireCrmSession,
  requireOrganizationAdmin,
  throwDbError,
} from '~~/server/utils/crm'
import {
  capacityExpectedRevision,
  defaultMortgageCapacityPolicy,
} from '~~/server/utils/mortgage-capacity'

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  requireOrganizationAdmin(session)
  const body = asRecord(await readBody(event))
  const expectedRevision = capacityExpectedRevision(body.expectedRevision)
  const { data: existing, error: existingError } = await session.supabase
    .from('mortgage_capacity_settings')
    .select('revision')
    .eq('organization_id', session.organizationId)
    .maybeSingle()
  throwDbError(existingError)
  if ((existing?.revision ?? 0) !== expectedRevision) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Założenia zmieniły się w innym panelu. Odśwież stronę przed resetem.',
    })
  }

  const { data: removed, error } = await session.supabase
    .from('mortgage_capacity_settings')
    .delete()
    .eq('organization_id', session.organizationId)
    .eq('revision', expectedRevision)
    .select('revision')
    .maybeSingle()
  throwDbError(error)
  if (existing && !removed) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Założenia zmieniły się w innym panelu. Odśwież stronę przed resetem.',
    })
  }

  return {
    settings: defaultMortgageCapacityPolicy(),
    notes: null,
    isCustomized: false,
    revision: 0,
    updatedAt: null,
    role: session.role,
  }
})
