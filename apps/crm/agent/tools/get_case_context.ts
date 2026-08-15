import { defineTool } from 'eve/tools'
import { z } from 'zod'
import { requireCrmAgentCaller } from '../lib/caller'
import { createAgentServiceClient } from '../lib/data-api'

type Row = Record<string, any>

function text(value: unknown, maximum = 4_000): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return normalized ? normalized.slice(0, maximum) : null
}

function throwQueryError(error: { message?: string } | null, label: string): void {
  if (error) throw new Error(`Nie udało się pobrać ${label}: ${error.message ?? 'błąd bazy danych'}`)
}

export default defineTool({
  description: 'Load a read-only, organization-scoped summary of one CRM case: clients, bank applications, offers, document metadata, property, open tasks and recent activity. Use the exact case UUID from client context or from a case URL returned by list_user_cases. It never downloads document binaries and never changes CRM data.',
  inputSchema: z.object({
    caseId: z.string().uuid().optional()
      .describe('Exact case UUID. Omit it when the current Agent AI invocation has a server-verified fixed case.'),
  }),
  async execute({ caseId: requestedCaseId }, ctx) {
    const caller = requireCrmAgentCaller(ctx)
    const fixedCaseId = caller.invocation?.scope.caseId
    if (fixedCaseId && requestedCaseId && requestedCaseId !== fixedCaseId) {
      throw new Error('To uruchomienie Agenta AI jest przypięte do innej sprawy.')
    }
    const caseId = fixedCaseId ?? requestedCaseId
    if (!caseId) throw new Error('Podaj identyfikator sprawy.')
    const dataApi = createAgentServiceClient()
    const caseResult = await dataApi
      .from('crm_cases')
      .select('id, title, description, status_code, priority, progress_percent, opened_at, closed_at, updated_at')
      .eq('organization_id', caller.organizationId)
      .eq('id', caseId)
      .maybeSingle()
    throwQueryError(caseResult.error, 'sprawy')
    if (!caseResult.data) throw new Error('Sprawa nie istnieje albo nie należy do bieżącej organizacji.')

    const [
      clientLinksResult,
      offersResult,
      applicationsResult,
      documentsResult,
      propertiesResult,
      tasksResult,
      activitiesResult,
    ] = await Promise.all([
      dataApi
        .from('crm_case_clients')
        .select('client_id, is_primary')
        .eq('organization_id', caller.organizationId)
        .eq('case_id', caseId)
        .order('is_primary', { ascending: false }),
      dataApi
        .from('crm_case_offer_snapshots')
        .select('id, bank_id, bank_name, product_name, currency, loan_amount, first_installment, first_monthly_outflow, cost_first_five_years, total_cost, representative_apr_pct, saved_at')
        .eq('organization_id', caller.organizationId)
        .eq('case_id', caseId)
        .order('saved_at', { ascending: false })
        .limit(12),
      dataApi
        .from('crm_case_bank_applications')
        .select('submission_id, offer_id, bank_id, slot, gross_loan_amount, net_loan_amount, ltv_pct, calculated_at, created_at')
        .eq('organization_id', caller.organizationId)
        .eq('case_id', caseId)
        .order('slot'),
      dataApi
        .from('crm_documents')
        .select('client_id, submission_id, document_type, name, status_code, mime_type, size_bytes, received_at, verified_at, updated_at')
        .eq('organization_id', caller.organizationId)
        .eq('case_id', caseId)
        .order('updated_at', { ascending: false })
        .limit(50),
      dataApi
        .from('crm_properties')
        .select('address, city, postal_code, property_type, market_type, price_amount, appraisal_value_amount, currency, area_m2, rooms, listing_title, updated_at')
        .eq('organization_id', caller.organizationId)
        .eq('case_id', caseId)
        .order('updated_at', { ascending: false })
        .limit(5),
      dataApi
        .from('crm_tasks')
        .select('title, description, status_code, priority, due_at, updated_at')
        .eq('organization_id', caller.organizationId)
        .eq('case_id', caseId)
        .neq('status_code', 'done')
        .order('due_at', { ascending: true, nullsFirst: false })
        .limit(20),
      dataApi
        .from('crm_activities')
        .select('activity_type, title, body, created_at')
        .eq('organization_id', caller.organizationId)
        .eq('case_id', caseId)
        .order('created_at', { ascending: false })
        .limit(20),
    ])
    throwQueryError(clientLinksResult.error, 'powiązań klientów')
    throwQueryError(offersResult.error, 'ofert')
    throwQueryError(applicationsResult.error, 'wniosków bankowych')
    throwQueryError(documentsResult.error, 'dokumentów')
    throwQueryError(propertiesResult.error, 'nieruchomości')
    throwQueryError(tasksResult.error, 'zadań')
    throwQueryError(activitiesResult.error, 'historii sprawy')

    const clientLinks = (clientLinksResult.data ?? []) as Row[]
    const clientIds = clientLinks.map(link => String(link.client_id))
    const applications = (applicationsResult.data ?? []) as Row[]
    const submissionIds = applications.map(application => String(application.submission_id))
    const [clientsResult, submissionsResult] = await Promise.all([
      clientIds.length
        ? dataApi
            .from('crm_clients')
            .select('id, display_name, primary_email, primary_phone')
            .eq('organization_id', caller.organizationId)
            .in('id', clientIds)
        : Promise.resolve({ data: [], error: null }),
      submissionIds.length
        ? dataApi
            .from('crm_item_submissions')
            .select('id, status_code, external_reference, submitted_at, decision_at, notes, updated_at')
            .eq('organization_id', caller.organizationId)
            .in('id', submissionIds)
        : Promise.resolve({ data: [], error: null }),
    ])
    throwQueryError(clientsResult.error, 'danych klientów')
    throwQueryError(submissionsResult.error, 'statusów wniosków')

    const clientsById = new Map(((clientsResult.data ?? []) as Row[]).map(row => [String(row.id), row]))
    const submissionsById = new Map(((submissionsResult.data ?? []) as Row[]).map(row => [String(row.id), row]))
    const offers = (offersResult.data ?? []) as Row[]
    const offersById = new Map(offers.map(row => [String(row.id), row]))
    const bankNameBySubmissionId = new Map(applications.flatMap((application) => {
      const offer = offersById.get(String(application.offer_id))
      return offer ? [[String(application.submission_id), String(offer.bank_name)] as const] : []
    }))

    return {
      ...(caller.invocation
        ? {
            fixedScope: {
              caseId: caller.invocation.scope.caseId,
              clientId: caller.invocation.scope.clientId,
              clientName: caller.invocation.scope.clientName,
            },
          }
        : {}),
      case: {
        title: String(caseResult.data.title),
        description: text(caseResult.data.description),
        statusCode: String(caseResult.data.status_code),
        priority: String(caseResult.data.priority),
        progressPercent: Number(caseResult.data.progress_percent ?? 0),
        openedAt: caseResult.data.opened_at ?? null,
        closedAt: caseResult.data.closed_at ?? null,
        updatedAt: String(caseResult.data.updated_at),
        url: `/org/${encodeURIComponent(caller.organizationSlug)}/cases/${encodeURIComponent(caseId)}`,
      },
      clients: clientLinks.flatMap((link) => {
        const client = clientsById.get(String(link.client_id))
        return client
          ? [{
              displayName: String(client.display_name),
              primaryEmail: client.primary_email ?? null,
              primaryPhone: client.primary_phone ?? null,
              isPrimary: Boolean(link.is_primary),
            }]
          : []
      }),
      bankApplications: applications.map((application) => {
        const submission = submissionsById.get(String(application.submission_id))
        const offer = offersById.get(String(application.offer_id))
        return {
          bankName: offer?.bank_name ? String(offer.bank_name) : 'Bank',
          productName: offer?.product_name ? String(offer.product_name) : null,
          statusCode: submission?.status_code ? String(submission.status_code) : null,
          externalReference: text(submission?.external_reference, 500),
          submittedAt: submission?.submitted_at ?? null,
          decisionAt: submission?.decision_at ?? null,
          notes: text(submission?.notes),
          grossLoanAmount: application.gross_loan_amount ?? null,
          netLoanAmount: application.net_loan_amount ?? null,
          ltvPercent: application.ltv_pct ?? null,
          updatedAt: submission?.updated_at ?? application.calculated_at ?? application.created_at,
        }
      }),
      savedOffers: offers.map(offer => ({
        bankName: String(offer.bank_name),
        productName: String(offer.product_name),
        currency: String(offer.currency),
        loanAmount: offer.loan_amount ?? null,
        firstInstallment: offer.first_installment ?? null,
        firstMonthlyOutflow: offer.first_monthly_outflow ?? null,
        costFirstFiveYears: offer.cost_first_five_years ?? null,
        totalCost: offer.total_cost ?? null,
        representativeAprPercent: offer.representative_apr_pct ?? null,
        savedAt: String(offer.saved_at),
      })),
      documents: ((documentsResult.data ?? []) as Row[]).map(document => ({
        name: String(document.name),
        documentType: String(document.document_type),
        statusCode: String(document.status_code),
        bankName: document.submission_id
          ? bankNameBySubmissionId.get(String(document.submission_id)) ?? null
          : null,
        mimeType: document.mime_type ?? null,
        sizeBytes: document.size_bytes ?? null,
        receivedAt: document.received_at ?? null,
        verifiedAt: document.verified_at ?? null,
        updatedAt: String(document.updated_at),
      })),
      properties: ((propertiesResult.data ?? []) as Row[]).map(property => ({
        listingTitle: text(property.listing_title, 500),
        address: text(property.address, 500),
        city: text(property.city, 200),
        postalCode: text(property.postal_code, 30),
        propertyType: property.property_type ?? null,
        marketType: property.market_type ?? null,
        priceAmount: property.price_amount ?? null,
        appraisalValueAmount: property.appraisal_value_amount ?? null,
        currency: property.currency ?? null,
        areaM2: property.area_m2 ?? null,
        rooms: property.rooms ?? null,
      })),
      openTasks: ((tasksResult.data ?? []) as Row[]).map(task => ({
        title: String(task.title),
        description: text(task.description),
        statusCode: String(task.status_code),
        priority: String(task.priority),
        dueAt: task.due_at ?? null,
        updatedAt: String(task.updated_at),
      })),
      recentActivity: ((activitiesResult.data ?? []) as Row[]).map(activity => ({
        type: String(activity.activity_type),
        title: String(activity.title),
        body: text(activity.body),
        createdAt: String(activity.created_at),
      })),
    }
  },
})
