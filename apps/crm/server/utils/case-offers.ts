import { throwDbError, type CrmSession } from './crm'

export async function selectCaseOfferIfNone(
  session: CrmSession,
  caseId: string,
  offerId: string,
  selectedAt = new Date().toISOString(),
): Promise<void> {
  const { error } = await session.supabase
    .from('crm_case_offer_selections')
    .upsert({
      organization_id: session.organizationId,
      case_id: caseId,
      offer_id: offerId,
      selected_by_user_id: session.userId,
      selected_at: selectedAt,
    }, {
      onConflict: 'organization_id,case_id',
      ignoreDuplicates: true,
    })
  throwDbError(error)
}
