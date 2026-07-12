import { requireCrmSession, throwDbError } from '~~/server/utils/crm'
import {
  defaultMortgageCapacityPolicy,
  mortgageCapacityPolicyFromRow,
} from '~~/server/utils/mortgage-capacity'

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  const { data, error } = await session.supabase
    .from('mortgage_capacity_settings')
    .select('*')
    .eq('organization_id', session.organizationId)
    .maybeSingle()
  throwDbError(error)

  return {
    settings: data ? mortgageCapacityPolicyFromRow(data) : defaultMortgageCapacityPolicy(),
    defaults: defaultMortgageCapacityPolicy(),
    notes: data?.notes ?? null,
    isCustomized: Boolean(data),
    revision: data?.revision ?? 0,
    updatedAt: data?.updated_at ?? null,
    role: session.role,
  }
})
