import { requireCrmSession, throwDbError } from '~~/server/utils/crm'
import { listAccessibleFacilityIds } from '~~/server/utils/scheduling'

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  const accessibleIds = await listAccessibleFacilityIds(session)
  if (accessibleIds?.length === 0) {
    return { data: [], role: session.role, canCreate: false }
  }

  let request = session.supabase
    .from('facilities')
    .select('id, organization_id, name, slug, description, timezone, address_line1, address_line2, postal_code, city, country_code, phone, email, is_active, created_at, updated_at')
    .eq('organization_id', session.organizationId)
    .order('is_active', { ascending: false })
    .order('name')
  if (accessibleIds) request = request.in('id', accessibleIds)

  const { data, error } = await request
  throwDbError(error)
  return {
    data: data ?? [],
    role: session.role,
    canCreate: session.role === 'admin',
  }
})
