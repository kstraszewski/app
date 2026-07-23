import { requireCrmSession, throwDbError } from '~~/server/utils/crm'
import { ensureGenericMeetingService, requireFacilityPermission } from '~~/server/utils/scheduling'

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  const access = await requireFacilityPermission(session, getRouterParam(event, 'facilityId'), 'view')
  await ensureGenericMeetingService(event, session.organizationId, String(access.facility.id))
  const [linksResult, catalogResult, expertsResult] = await Promise.all([
    session.supabase
      .from('facility_services')
      .select('*')
      .eq('organization_id', session.organizationId)
      .eq('facility_id', access.facility.id),
    session.supabase
      .from('booking_services')
      .select('*')
      .eq('organization_id', session.organizationId)
      .eq('slug', 'spotkanie')
      .order('name'),
    session.supabase
      .from('facility_service_experts')
      .select('service_id, user_id, is_active')
      .eq('organization_id', session.organizationId)
      .eq('facility_id', access.facility.id),
  ])
  throwDbError(linksResult.error)
  throwDbError(catalogResult.error)
  throwDbError(expertsResult.error)

  const linksByService = new Map((linksResult.data ?? []).map((link: any) => [String(link.service_id), link]))
  const expertsByService = new Map<string, string[]>()
  for (const expert of expertsResult.data ?? []) {
    if (!expert.is_active) continue
    const serviceId = String(expert.service_id)
    expertsByService.set(serviceId, [...(expertsByService.get(serviceId) ?? []), String(expert.user_id)])
  }
  const catalog = catalogResult.data ?? []
  const data = catalog.flatMap((service: any) => {
    const link = linksByService.get(String(service.id)) as any
    if (!link) return []
    return [{
      ...service,
      isAvailable: Boolean(link.is_active),
      expertUserIds: expertsByService.get(String(service.id)) ?? [],
    }]
  })

  return { data, catalog }
})
