import { createError } from 'h3'
import { caseDocumentPublicSelect } from '~~/server/utils/case-documents'
import { attachSignedPropertyImages, propertyPublicSelect } from '~~/server/utils/case-properties'
import { caseUuidPattern } from '~~/server/utils/cases'
import { getRequiredParam, requireCrmSession, throwDbError } from '~~/server/utils/crm'

type Row = Record<string, any>

function singleRelation<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  const id = getRequiredParam(event, 'id')
  if (!caseUuidPattern.test(id)) {
    throw createError({ statusCode: 404, statusMessage: 'Case not found' })
  }

  const { data: caseRow, error } = await session.supabase
    .from('crm_cases')
    .select('id, organization_id, owner_user_id, title, description, status_code, priority, progress_percent, opened_at, closed_at, created_at, updated_at')
    .eq('organization_id', session.organizationId)
    .eq('id', id)
    .maybeSingle()

  if (error || !caseRow) {
    throw createError({ statusCode: 404, statusMessage: 'Case not found' })
  }

  const [
    caseClientsResult,
    offersResult,
    selectionResult,
    propertySelectionResult,
    bankApplicationsResult,
    contractSelectionResult,
    documentsResult,
    itemsResult,
  ] = await Promise.all([
    session.supabase
      .from('crm_case_clients')
      .select('client_id, is_primary, created_at')
      .eq('organization_id', session.organizationId)
      .eq('case_id', id)
      .order('is_primary', { ascending: false })
      .order('created_at'),
    session.supabase
      .from('crm_case_offer_snapshots')
      .select('id, case_id, bank_id, mortgage_product_id, mortgage_product_version_id, offer_type, bank_name, product_name, version_key, calculator_version, currency, loan_amount, first_installment, first_monthly_outflow, cost_first_five_years, total_cost, representative_apr_pct, scenario_snapshot, catalog_snapshot, calculation_snapshot, saved_at')
      .eq('organization_id', session.organizationId)
      .eq('case_id', id)
      .order('saved_at', { ascending: false }),
    session.supabase
      .from('crm_case_offer_selections')
      .select('offer_id')
      .eq('organization_id', session.organizationId)
      .eq('case_id', id)
      .maybeSingle(),
    session.supabase
      .from('crm_case_property_selections')
      .select('property_id')
      .eq('organization_id', session.organizationId)
      .eq('case_id', id)
      .maybeSingle(),
    session.supabase
      .from('crm_case_bank_applications')
      .select('submission_id, case_id, case_item_id, offer_id, bank_id, property_id, slot, created_by_user_id, created_at, snapshot_status, snapshot_schema_version, calculator_version, comparison_baseline_offer_id, scenario_snapshot, calculation_snapshot, purchase_price_amount, appraisal_value_amount, net_loan_amount, gross_loan_amount, financed_costs, ltv_debt_basis, collateral_value_basis, ltv_debt_amount, collateral_value_amount, ltv_pct, first_installment, first_monthly_outflow, cost_first_five_years, total_cost, calculated_at')
      .eq('organization_id', session.organizationId)
      .eq('case_id', id)
      .order('slot'),
    session.supabase
      .from('crm_case_contract_selections')
      .select('application_id, signed_at')
      .eq('organization_id', session.organizationId)
      .eq('case_id', id)
      .maybeSingle(),
    session.supabase
      .from('crm_documents')
      .select(caseDocumentPublicSelect)
      .eq('organization_id', session.organizationId)
      .eq('case_id', id)
      .order('created_at', { ascending: false }),
    session.supabase
      .from('crm_case_items')
      .select(`
        id,
        case_id,
        product_type_id,
        owner_user_id,
        title,
        status_code,
        amount_value,
        currency,
        expected_close_date,
        won_at,
        lost_at,
        metadata,
        created_at,
        updated_at,
        product_type:crm_product_types!crm_case_items_product_type_id_fkey(
          id,
          domain,
          code,
          name,
          description
        )
      `)
      .eq('organization_id', session.organizationId)
      .eq('case_id', id)
      .order('updated_at', { ascending: false }),
  ])
  throwDbError(caseClientsResult.error)
  throwDbError(offersResult.error)
  throwDbError(selectionResult.error)
  throwDbError(propertySelectionResult.error)
  throwDbError(bankApplicationsResult.error)
  throwDbError(contractSelectionResult.error)
  throwDbError(documentsResult.error)
  throwDbError(itemsResult.error)

  const links = (caseClientsResult.data ?? []) as Row[]
  const offers = (offersResult.data ?? []) as Row[]
  const bankApplications = (bankApplicationsResult.data ?? []) as Row[]
  const items = (itemsResult.data ?? []) as Row[]
  const clientIds = links.map(link => String(link.client_id))
  const bankIds = [...new Set(offers
    .map(offer => offer.bank_id ? String(offer.bank_id) : null)
    .filter((bankId): bankId is string => Boolean(bankId)))]
  const itemIds = items.map(item => String(item.id))
  const submissionIds = bankApplications.map(application => String(application.submission_id))
  const relatedEntityFilter = itemIds.length
    ? `case_id.eq.${id},case_item_id.in.(${itemIds.join(',')})`
    : `case_id.eq.${id}`

  const [clientsResult, banksResult, propertiesResult, submissionsResult, tasksResult, activitiesResult] = await Promise.all([
    clientIds.length
      ? session.supabase
          .from('crm_clients')
          .select('id, display_name, primary_email, primary_phone')
          .eq('organization_id', session.organizationId)
          .in('id', clientIds)
      : Promise.resolve({ data: [], error: null }),
    bankIds.length
      ? session.supabase
          .from('mortgage_banks')
          .select('id, logo_url, logo_background_color')
          .in('id', bankIds)
      : Promise.resolve({ data: [], error: null }),
    session.supabase
      .from('crm_properties')
      .select(propertyPublicSelect)
      .eq('organization_id', session.organizationId)
      .or(relatedEntityFilter)
      .order('updated_at', { ascending: false }),
    submissionIds.length
      ? session.supabase
          .from('crm_item_submissions')
          .select('id, status_code, external_reference, submitted_at, decision_at, notes, metadata, created_at, updated_at')
          .eq('organization_id', session.organizationId)
          .in('id', submissionIds)
      : Promise.resolve({ data: [], error: null }),
    session.supabase
      .from('crm_tasks')
      .select('id, assignee_user_id, client_id, case_id, case_item_id, title, description, status_code, priority, due_at, completed_at, metadata, created_at, updated_at')
      .eq('organization_id', session.organizationId)
      .or(relatedEntityFilter)
      .neq('status_code', 'done')
      .order('due_at', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: false })
      .limit(20),
    session.supabase
      .from('crm_activities')
      .select('id, actor_user_id, client_id, case_id, case_item_id, submission_id, activity_type, title, body, payload, created_at')
      .eq('organization_id', session.organizationId)
      .or(relatedEntityFilter)
      .order('created_at', { ascending: false })
      .limit(20),
  ])
  throwDbError(clientsResult.error)
  throwDbError(banksResult.error)
  throwDbError(propertiesResult.error)
  throwDbError(submissionsResult.error)
  throwDbError(tasksResult.error)
  throwDbError(activitiesResult.error)

  const tasks = (tasksResult.data ?? []) as Row[]
  const activities = (activitiesResult.data ?? []) as Row[]
  const profileIds = [...new Set([
    caseRow.owner_user_id ? String(caseRow.owner_user_id) : null,
    ...items.map(item => item.owner_user_id ? String(item.owner_user_id) : null),
    ...tasks.map(task => task.assignee_user_id ? String(task.assignee_user_id) : null),
    ...activities.map(activity => activity.actor_user_id ? String(activity.actor_user_id) : null),
  ].filter((profileId): profileId is string => Boolean(profileId)))]
  const profilesResult = profileIds.length
    ? await session.supabase
        .from('organization_memberships')
        .select('user_id, user:users!organization_memberships_user_id_fkey!inner(id, email, full_name)')
        .eq('organization_id', session.organizationId)
        .in('user_id', profileIds)
    : { data: [], error: null }
  throwDbError(profilesResult.error)

  const clientById = new Map(((clientsResult.data ?? []) as Row[]).map(client => [String(client.id), client]))
  const bankById = new Map(((banksResult.data ?? []) as Row[]).map(bank => [String(bank.id), bank]))
  const submissionById = new Map(((submissionsResult.data ?? []) as Row[]).map(submission => [String(submission.id), submission]))
  const profileById = new Map(((profilesResult.data ?? []) as Row[]).flatMap((membership) => {
    const user = singleRelation<Row>(membership.user)
    return user ? [[String(membership.user_id), user] as const] : []
  }))
  const properties = await attachSignedPropertyImages(
    session,
    (propertiesResult.data ?? []) as Array<Row & { id: string }>,
  )

  return {
    data: {
      ...caseRow,
      owner: caseRow.owner_user_id
        ? profileById.get(String(caseRow.owner_user_id)) ?? null
        : null,
      selected_offer_id: selectionResult.data?.offer_id
        ? String(selectionResult.data.offer_id)
        : null,
      selected_property_id: propertySelectionResult.data?.property_id
        ? String(propertySelectionResult.data.property_id)
        : null,
      bank_applications: bankApplications.flatMap((application) => {
        const submission = submissionById.get(String(application.submission_id))
        return submission
          ? [{
              ...application,
              id: String(application.submission_id),
              status_code: String(submission.status_code),
              external_reference: submission.external_reference ?? null,
              submitted_at: submission.submitted_at ?? null,
              decision_at: submission.decision_at ?? null,
              notes: submission.notes ?? null,
              metadata: submission.metadata ?? {},
              updated_at: String(submission.updated_at),
            }]
          : []
      }),
      contract_application_id: contractSelectionResult.data?.application_id
        ? String(contractSelectionResult.data.application_id)
        : null,
      contract_signed_at: contractSelectionResult.data?.signed_at
        ? String(contractSelectionResult.data.signed_at)
        : null,
      clients: links.flatMap((link) => {
        const client = clientById.get(String(link.client_id))
        return client ? [{ ...client, is_primary: Boolean(link.is_primary) }] : []
      }),
      offers: offers.map((offer) => {
        const bank = offer.bank_id ? bankById.get(String(offer.bank_id)) : null
        return {
          ...offer,
          calculation_status: offer.calculation_snapshot?.status
            ?? (offer.catalog_snapshot?.version?.unknown_fields?.length ? 'partial' : 'complete'),
          bank_logo_url: bank?.logo_url ?? null,
          bank_logo_background: bank?.logo_background_color ?? null,
        }
      }),
      documents: documentsResult.data ?? [],
      items: items.map(item => ({
        ...item,
        product_type: singleRelation<Row>(item.product_type),
        owner: item.owner_user_id
          ? profileById.get(String(item.owner_user_id)) ?? null
          : null,
      })),
      properties,
      open_tasks: tasks.map(task => ({
        ...task,
        assignee: task.assignee_user_id
          ? profileById.get(String(task.assignee_user_id)) ?? null
          : null,
      })),
      recent_activities: activities.map(activity => ({
        ...activity,
        actor: activity.actor_user_id
          ? profileById.get(String(activity.actor_user_id)) ?? null
          : null,
      })),
    },
  }
})
