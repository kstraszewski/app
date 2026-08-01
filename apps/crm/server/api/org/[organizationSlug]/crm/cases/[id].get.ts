import { createError } from 'h3'
import { caseDocumentPublicSelect } from '~~/server/utils/case-documents'
import { caseUuidPattern } from '~~/server/utils/case-identifiers'
import { attachSignedPropertyImages, propertyPublicSelect } from '~~/server/utils/case-properties'
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

  const { data: caseRow, error } = await session.dataApi
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
    session.dataApi
      .from('crm_case_clients')
      .select('client_id, is_primary, created_at')
      .eq('organization_id', session.organizationId)
      .eq('case_id', id)
      .order('is_primary', { ascending: false })
      .order('created_at'),
    session.dataApi
      .from('crm_case_offer_snapshots')
      .select('id, case_id, bank_id, mortgage_product_id, mortgage_product_version_id, offer_type, bank_name, product_name, version_key, calculator_version, currency, loan_amount, first_installment, first_monthly_outflow, cost_first_five_years, total_cost, representative_apr_pct, scenario_snapshot, catalog_snapshot, calculation_snapshot, saved_at')
      .eq('organization_id', session.organizationId)
      .eq('case_id', id)
      .order('saved_at', { ascending: false }),
    session.dataApi
      .from('crm_case_offer_selections')
      .select('offer_id')
      .eq('organization_id', session.organizationId)
      .eq('case_id', id)
      .maybeSingle(),
    session.dataApi
      .from('crm_case_property_selections')
      .select('property_id')
      .eq('organization_id', session.organizationId)
      .eq('case_id', id)
      .maybeSingle(),
    session.dataApi
      .from('crm_case_bank_applications')
      .select('submission_id, case_id, case_item_id, offer_id, bank_id, property_id, slot, created_by_user_id, created_at, snapshot_status, snapshot_schema_version, calculator_version, comparison_baseline_offer_id, scenario_snapshot, calculation_snapshot, purchase_price_amount, appraisal_value_amount, net_loan_amount, gross_loan_amount, financed_costs, ltv_debt_basis, collateral_value_basis, ltv_debt_amount, collateral_value_amount, ltv_pct, first_installment, first_monthly_outflow, cost_first_five_years, total_cost, calculated_at')
      .eq('organization_id', session.organizationId)
      .eq('case_id', id)
      .order('slot'),
    session.dataApi
      .from('crm_case_contract_selections')
      .select('application_id, signed_at')
      .eq('organization_id', session.organizationId)
      .eq('case_id', id)
      .maybeSingle(),
    session.dataApi
      .from('crm_documents')
      .select(caseDocumentPublicSelect)
      .eq('organization_id', session.organizationId)
      .eq('case_id', id)
      .order('created_at', { ascending: false }),
    session.dataApi
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
  const itemDomains = [...new Set(items.flatMap((item) => {
    const productType = singleRelation<Row>(item.product_type)
    return productType?.domain ? [String(productType.domain)] : []
  }))]
  const submissionIds = bankApplications.map(application => String(application.submission_id))
  const relatedEntityFilter = itemIds.length
    ? `case_id.eq.${id},case_item_id.in.(${itemIds.join(',')})`
    : `case_id.eq.${id}`

  const [
    clientsResult,
    banksResult,
    propertiesResult,
    submissionsResult,
    tasksResult,
    activitiesResult,
    handoffsResult,
    workflowsResult,
  ] = await Promise.all([
    clientIds.length
      ? session.dataApi
          .from('crm_clients')
          .select('id, display_name, primary_email, primary_phone')
          .eq('organization_id', session.organizationId)
          .in('id', clientIds)
      : Promise.resolve({ data: [], error: null }),
    bankIds.length
      ? session.dataApi
          .from('mortgage_banks')
          .select('id, logo_url, logo_background_color')
          .in('id', bankIds)
      : Promise.resolve({ data: [], error: null }),
    session.dataApi
      .from('crm_properties')
      .select(propertyPublicSelect)
      .eq('organization_id', session.organizationId)
      .or(relatedEntityFilter)
      .order('updated_at', { ascending: false }),
    submissionIds.length
      ? session.dataApi
          .from('crm_item_submissions')
          .select('id, status_code, external_reference, submitted_at, decision_at, notes, metadata, created_at, updated_at')
          .eq('organization_id', session.organizationId)
          .in('id', submissionIds)
      : Promise.resolve({ data: [], error: null }),
    session.dataApi
      .from('crm_tasks')
      .select('id, assignee_user_id, client_id, case_id, case_item_id, title, description, status_code, priority, due_at, completed_at, metadata, created_at, updated_at')
      .eq('organization_id', session.organizationId)
      .or(relatedEntityFilter)
      .neq('status_code', 'done')
      .order('due_at', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: false })
      .limit(20),
    session.dataApi
      .from('crm_activities')
      .select('id, actor_user_id, client_id, case_id, case_item_id, submission_id, activity_type, title, body, payload, created_at')
      .eq('organization_id', session.organizationId)
      .or(relatedEntityFilter)
      .order('created_at', { ascending: false })
      .limit(20),
    itemIds.length
      ? session.dataApi
          .from('crm_case_item_handoffs')
          .select('id, organization_id, case_id, case_item_id, previous_owner_user_id, proposed_owner_user_id, requested_by_user_id, status, request_note, response_note, requested_at, resolved_at, resolved_by_user_id, revision')
          .eq('organization_id', session.organizationId)
          .eq('case_id', id)
          .in('case_item_id', itemIds)
          .order('requested_at', { ascending: false })
          .limit(100)
      : Promise.resolve({ data: [], error: null }),
    itemDomains.length
      ? session.dataApi
          .from('crm_workflows')
          .select(`
            id,
            organization_id,
            domain,
            code,
            name,
            is_default,
            statuses:crm_workflow_statuses!crm_workflow_statuses_workflow_id_fkey(
              code,
              label,
              color,
              sort_order,
              is_initial,
              is_terminal
            )
          `)
          .eq('scope', 'case_item')
          .eq('is_default', true)
          .in('domain', itemDomains)
          .or(`organization_id.is.null,organization_id.eq.${session.organizationId}`)
      : Promise.resolve({ data: [], error: null }),
  ])
  throwDbError(clientsResult.error)
  throwDbError(banksResult.error)
  throwDbError(propertiesResult.error)
  throwDbError(submissionsResult.error)
  throwDbError(tasksResult.error)
  throwDbError(activitiesResult.error)
  throwDbError(handoffsResult.error)
  throwDbError(workflowsResult.error)

  const tasks = (tasksResult.data ?? []) as Row[]
  const activities = (activitiesResult.data ?? []) as Row[]
  const handoffs = (handoffsResult.data ?? []) as Row[]
  const workflows = (workflowsResult.data ?? []) as Row[]
  const profileIds = [...new Set([
    caseRow.owner_user_id ? String(caseRow.owner_user_id) : null,
    ...items.map(item => item.owner_user_id ? String(item.owner_user_id) : null),
    ...tasks.map(task => task.assignee_user_id ? String(task.assignee_user_id) : null),
    ...activities.map(activity => activity.actor_user_id ? String(activity.actor_user_id) : null),
    ...handoffs.flatMap(handoff => [
      handoff.previous_owner_user_id ? String(handoff.previous_owner_user_id) : null,
      handoff.proposed_owner_user_id ? String(handoff.proposed_owner_user_id) : null,
      handoff.requested_by_user_id ? String(handoff.requested_by_user_id) : null,
      handoff.resolved_by_user_id ? String(handoff.resolved_by_user_id) : null,
    ]),
  ].filter((profileId): profileId is string => Boolean(profileId)))]
  const profilesResult = profileIds.length
    ? await session.dataApi
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
  const workflowByDomain = new Map<string, Row>()
  for (const workflow of workflows) {
    const domain = String(workflow.domain ?? '')
    if (!domain) continue
    const current = workflowByDomain.get(domain)
    if (!current || (
      workflow.organization_id === session.organizationId
      && current.organization_id !== session.organizationId
    )) {
      workflowByDomain.set(domain, workflow)
    }
  }
  const handoffsByItemId = new Map<string, Row[]>()
  for (const handoff of handoffs) {
    const itemId = String(handoff.case_item_id)
    const entries = handoffsByItemId.get(itemId) ?? []
    entries.push({
      ...handoff,
      previous_owner: handoff.previous_owner_user_id
        ? profileById.get(String(handoff.previous_owner_user_id)) ?? null
        : null,
      proposed_owner: handoff.proposed_owner_user_id
        ? profileById.get(String(handoff.proposed_owner_user_id)) ?? null
        : null,
      requested_by: handoff.requested_by_user_id
        ? profileById.get(String(handoff.requested_by_user_id)) ?? null
        : null,
      resolved_by: handoff.resolved_by_user_id
        ? profileById.get(String(handoff.resolved_by_user_id)) ?? null
        : null,
    })
    handoffsByItemId.set(itemId, entries)
  }

  return {
    current_user_id: session.userId,
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
      items: items.map((item) => {
        const productType = singleRelation<Row>(item.product_type)
        const workflow = productType?.domain
          ? workflowByDomain.get(String(productType.domain)) ?? null
          : null
        const itemHandoffs = handoffsByItemId.get(String(item.id)) ?? []
        const canManage = session.role === 'admin'
          || String(caseRow.owner_user_id ?? '') === session.userId
          || String(item.owner_user_id ?? '') === session.userId

        return {
          ...item,
          product_type: productType,
          owner: item.owner_user_id
            ? profileById.get(String(item.owner_user_id)) ?? null
            : null,
          workflow: workflow
            ? {
                id: String(workflow.id),
                code: String(workflow.code),
                name: String(workflow.name),
                domain: workflow.domain ? String(workflow.domain) : null,
                statuses: ((workflow.statuses ?? []) as Row[])
                  .map(status => ({
                    code: String(status.code),
                    label: String(status.label),
                    color: String(status.color),
                    sort_order: Number(status.sort_order),
                    is_initial: Boolean(status.is_initial),
                    is_terminal: Boolean(status.is_terminal),
                  }))
                  .sort((left, right) => left.sort_order - right.sort_order),
              }
            : null,
          handoffs: itemHandoffs,
          pending_handoff: itemHandoffs.find(handoff => handoff.status === 'pending') ?? null,
          permissions: {
            can_handoff: canManage && !itemHandoffs.some(handoff => handoff.status === 'pending'),
            can_change_status: canManage,
          },
        }
      }),
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
