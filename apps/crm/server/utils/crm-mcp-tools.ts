import type { H3Event } from 'h3'
import { createError } from 'h3'
import {
  asRecord,
  defaultItemStatus,
  numberValue,
  recordCrmActivity,
  requireCrmSession,
  requiredText,
  resolveProductType,
  textValue,
  throwDbError,
} from '~~/server/utils/crm'
import { loadConsentDefinitions } from '~~/server/utils/consents'

export interface CrmMcpTool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  handler: (event: H3Event, input: unknown) => Promise<unknown>
}

const objectSchema = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
})

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function parseConsentDecisions(input: unknown) {
  if (input === undefined) return []
  if (!Array.isArray(input)) {
    throw createError({ statusCode: 400, statusMessage: 'consent_decisions must be an array' })
  }

  return input.map((rawDecision, index) => {
    const decision = asRecord(rawDecision)
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

    return {
      definition_id: definitionId,
      version_id: versionId,
      granted: decision.granted,
    }
  })
}

function throwCreateClientRpcError(error: { message?: string; code?: string } | null | undefined): void {
  if (!error) return
  if (
    error.message?.includes('consent_definition_is_stale')
    || error.message?.includes('consent_catalogue_is_stale')
  ) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Consent definitions changed. Load their current versions and try again.',
    })
  }
  if (error.message?.includes('consent_contact_value_is_required')) {
    throw createError({
      statusCode: 400,
      statusMessage: 'A contact value is required for the selected consent channel.',
    })
  }
  if (error.message?.includes('client_owner_assignment_admin_required')) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Only an organization administrator can assign a client to another user.',
    })
  }
  if (error.message?.includes('required_consent_not_granted')) {
    throw createError({
      statusCode: 422,
      statusMessage: 'All required consents must be granted before creating the client.',
    })
  }
  if (error.message?.includes('client_consent_decisions_required')) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Consent decisions are required for all active definitions.',
    })
  }
  throwDbError(error)
}

export function getCrmMcpTools(): CrmMcpTool[] {
  return [
    {
      name: 'crm.search',
      description: 'Search clients, cases and case items in the current organization.',
      inputSchema: objectSchema({
        query: { type: 'string' },
        limit: { type: 'number', default: 10 },
      }, ['query']),
      async handler(event, input) {
        const session = await requireCrmSession(event)
        const body = asRecord(input)
        const query = requiredText(body.query, 'query').replaceAll('%', '\\%').replaceAll(',', ' ')
        const limit = Math.min(numberValue(body.limit) ?? 10, 25)

        const [clientsResult, casesResult, itemsResult] = await Promise.all([
          session.supabase
            .from('crm_clients')
            .select('id, display_name, status_code, primary_email, primary_phone, updated_at')
            .eq('organization_id', session.organizationId)
            .or(`display_name.ilike.%${query}%,primary_email.ilike.%${query}%,primary_phone.ilike.%${query}%`)
            .order('updated_at', { ascending: false })
            .limit(limit),
          session.supabase
            .from('crm_cases')
            .select('id, client_id, title, status_code, priority, updated_at')
            .eq('organization_id', session.organizationId)
            .or(`title.ilike.%${query}%,description.ilike.%${query}%`)
            .order('updated_at', { ascending: false })
            .limit(limit),
          session.supabase
            .from('crm_case_items')
            .select('id, case_id, title, status_code, amount_value, currency, updated_at')
            .eq('organization_id', session.organizationId)
            .or(`title.ilike.%${query}%,status_code.ilike.%${query}%`)
            .order('updated_at', { ascending: false })
            .limit(limit),
        ])

        throwDbError(clientsResult.error)
        throwDbError(casesResult.error)
        throwDbError(itemsResult.error)

        return {
          clients: clientsResult.data ?? [],
          cases: casesResult.data ?? [],
          items: itemsResult.data ?? [],
        }
      },
    },
    {
      name: 'crm.client_creation_consents',
      description: 'Load the exact active consent versions required when creating a client.',
      inputSchema: objectSchema({}),
      async handler(event) {
        const session = await requireCrmSession(event)
        const definitions = await loadConsentDefinitions(session, { activeOnly: true })

        return definitions.map(definition => ({
          definition_id: definition.id,
          version_id: definition.current_version_id,
          code: definition.code,
          version: definition.current_version?.version,
          title: definition.current_version?.display_title,
          content: definition.current_version?.content,
          channel: definition.current_version?.channel,
          is_required: definition.current_version?.is_required ?? false,
        }))
      },
    },
    {
      name: 'crm.create_client',
      description: 'Create a CRM client with a complete consent trail. Call crm.client_creation_consents first and pass one decision for every returned version.',
      inputSchema: objectSchema({
        display_name: { type: 'string' },
        primary_email: { type: 'string' },
        primary_phone: { type: 'string' },
        lead_source: { type: 'string' },
        owner_user_id: { type: 'string', format: 'uuid' },
        consent_decisions: {
          type: 'array',
          items: objectSchema({
            definition_id: { type: 'string', format: 'uuid' },
            version_id: { type: 'string', format: 'uuid' },
            granted: { type: 'boolean' },
          }, ['definition_id', 'version_id', 'granted']),
        },
      }, ['display_name', 'consent_decisions']),
      async handler(event, input) {
        const session = await requireCrmSession(event)
        const body = asRecord(input)
        const displayName = requiredText(body.display_name, 'display_name')
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

        const primaryEmail = textValue(body.primary_email) ?? null
        const primaryPhone = textValue(body.primary_phone) ?? null
        const consentDecisions = parseConsentDecisions(body.consent_decisions)
        const { data, error } = await session.supabase.rpc('create_crm_client_with_consents', {
          p_organization_id: session.organizationId,
          p_owner_user_id: ownerUserId,
          p_display_name: displayName,
          p_status_code: 'lead',
          p_lead_source: textValue(body.lead_source) ?? 'mcp',
          p_primary_email: primaryEmail,
          p_primary_phone: primaryPhone,
          p_tags: [],
          p_notes: null,
          p_metadata: { source: 'mcp' },
          p_primary_person: {
            display_name: displayName,
            email: primaryEmail,
            phone: primaryPhone,
            metadata: { source: 'mcp' },
          },
          p_consent_decisions: consentDecisions,
        })
        throwCreateClientRpcError(error)

        return data
      },
    },
    {
      name: 'crm.create_case',
      description: 'Create a case for an existing client.',
      inputSchema: objectSchema({
        client_id: { type: 'string' },
        title: { type: 'string' },
        description: { type: 'string' },
        priority: { type: 'string' },
      }, ['client_id', 'title']),
      async handler(event, input) {
        const session = await requireCrmSession(event)
        const body = asRecord(input)
        const clientId = requiredText(body.client_id, 'client_id')
        const title = requiredText(body.title, 'title')

        const { data: client, error: clientError } = await session.supabase
          .from('crm_clients')
          .select('id')
          .eq('organization_id', session.organizationId)
          .eq('id', clientId)
          .maybeSingle()
        if (clientError || !client) throwDbError(clientError ?? { message: 'Client not found' }, 404)

        const { data, error } = await session.supabase
          .from('crm_cases')
          .insert({
            organization_id: session.organizationId,
            client_id: clientId,
            owner_user_id: session.userId,
            title,
            description: textValue(body.description) ?? null,
            priority: textValue(body.priority) ?? 'normal',
          })
          .select('*')
          .single()
        throwDbError(error)

        await recordCrmActivity(session, {
          client_id: clientId,
          case_id: data.id,
          activity_type: 'case_created',
          title: 'Dodano sprawe przez MCP',
          body: title,
        })

        return data
      },
    },
    {
      name: 'crm.add_case_item',
      description: 'Add a product or application to a case.',
      inputSchema: objectSchema({
        case_id: { type: 'string' },
        product_type_id: { type: 'string' },
        product_type_code: { type: 'string' },
        title: { type: 'string' },
        amount_value: { type: 'number' },
        currency: { type: 'string' },
      }, ['case_id']),
      async handler(event, input) {
        const session = await requireCrmSession(event)
        const body = asRecord(input)
        const caseId = requiredText(body.case_id, 'case_id')
        const productType = await resolveProductType(session, body)

        const { data: caseRow, error: caseError } = await session.supabase
          .from('crm_cases')
          .select('id')
          .eq('organization_id', session.organizationId)
          .eq('id', caseId)
          .maybeSingle()
        if (caseError || !caseRow) throwDbError(caseError ?? { message: 'Case not found' }, 404)

        const { data, error } = await session.supabase
          .from('crm_case_items')
          .insert({
            organization_id: session.organizationId,
            case_id: caseId,
            product_type_id: productType.id,
            owner_user_id: session.userId,
            title: textValue(body.title) ?? productType.name,
            status_code: defaultItemStatus(productType.domain),
            amount_value: numberValue(body.amount_value) ?? null,
            currency: textValue(body.currency) ?? 'PLN',
          })
          .select('*')
          .single()
        throwDbError(error)

        await recordCrmActivity(session, {
          case_id: caseId,
          case_item_id: data.id,
          activity_type: 'case_item_created',
          title: 'Dodano produkt przez MCP',
          body: data.title,
        })

        return data
      },
    },
    {
      name: 'crm.update_status',
      description: 'Update status for a case, item, submission or settlement.',
      inputSchema: objectSchema({
        entity: { type: 'string', enum: ['case', 'item', 'submission', 'settlement'] },
        id: { type: 'string' },
        status_code: { type: 'string' },
        note: { type: 'string' },
      }, ['entity', 'id', 'status_code']),
      async handler(event, input) {
        const session = await requireCrmSession(event)
        const body = asRecord(input)
        const entity = requiredText(body.entity, 'entity')
        const id = requiredText(body.id, 'id')
        const statusCode = requiredText(body.status_code, 'status_code')

        const tables: Record<string, string> = {
          case: 'crm_cases',
          item: 'crm_case_items',
          submission: 'crm_item_submissions',
          settlement: 'crm_case_item_settlements',
        }
        const table = tables[entity]
        if (!table) {
          throw createError({ statusCode: 400, statusMessage: `Unsupported CRM entity: ${entity}` })
        }

        const { data, error } = await session.supabase
          .from(table)
          .update({ status_code: statusCode })
          .eq('organization_id', session.organizationId)
          .eq('id', id)
          .select('*')
          .single()
        throwDbError(error)

        await recordCrmActivity(session, {
          client_id: entity === 'case' ? data.client_id : undefined,
          case_id: entity === 'case' ? data.id : data.case_id,
          case_item_id: entity === 'item' ? data.id : data.case_item_id,
          submission_id: entity === 'submission' ? data.id : undefined,
          activity_type: 'status_changed',
          title: `Zmieniono status: ${entity}`,
          body: textValue(body.note),
          payload: { status_code: statusCode },
        })

        return data
      },
    },
    {
      name: 'crm.add_note',
      description: 'Add a timeline note to a client, case, item or submission.',
      inputSchema: objectSchema({
        client_id: { type: 'string' },
        case_id: { type: 'string' },
        case_item_id: { type: 'string' },
        submission_id: { type: 'string' },
        body: { type: 'string' },
      }, ['body']),
      async handler(event, input) {
        const session = await requireCrmSession(event)
        const body = asRecord(input)
        const note = requiredText(body.body, 'body')
        const clientId = textValue(body.client_id)
        const caseId = textValue(body.case_id)
        const caseItemId = textValue(body.case_item_id)
        const submissionId = textValue(body.submission_id)

        if (!clientId && !caseId && !caseItemId && !submissionId) {
          throw createError({
            statusCode: 400,
            statusMessage: 'client_id, case_id, case_item_id or submission_id is required',
          })
        }

        const { error } = await session.supabase.from('crm_activities').insert({
          organization_id: session.organizationId,
          actor_user_id: session.userId,
          client_id: clientId ?? null,
          case_id: caseId ?? null,
          case_item_id: caseItemId ?? null,
          submission_id: submissionId ?? null,
          activity_type: 'note',
          title: 'Notatka',
          body: note,
        })
        throwDbError(error)

        return { ok: true }
      },
    },
    {
      name: 'crm.upsert_settlement',
      description: 'Create or update commission settlement for a case item.',
      inputSchema: objectSchema({
        case_item_id: { type: 'string' },
        status_code: { type: 'string' },
        expected_amount: { type: 'number' },
        due_amount: { type: 'number' },
        paid_amount: { type: 'number' },
        currency: { type: 'string' },
        notes: { type: 'string' },
      }, ['case_item_id']),
      async handler(event, input) {
        const session = await requireCrmSession(event)
        const body = asRecord(input)
        const caseItemId = requiredText(body.case_item_id, 'case_item_id')

        const { data: caseItem, error: caseItemError } = await session.supabase
          .from('crm_case_items')
          .select('id')
          .eq('organization_id', session.organizationId)
          .eq('id', caseItemId)
          .maybeSingle()
        if (caseItemError || !caseItem) throwDbError(caseItemError ?? { message: 'Case item not found' }, 404)

        const payload = {
          organization_id: session.organizationId,
          case_item_id: caseItemId,
          status_code: textValue(body.status_code) ?? 'szacowane',
          expected_amount: numberValue(body.expected_amount) ?? 0,
          due_amount: numberValue(body.due_amount) ?? 0,
          paid_amount: numberValue(body.paid_amount) ?? 0,
          currency: textValue(body.currency) ?? 'PLN',
          notes: textValue(body.notes) ?? null,
        }

        const { data, error } = await session.supabase
          .from('crm_case_item_settlements')
          .upsert(payload, { onConflict: 'case_item_id' })
          .select('*')
          .single()
        throwDbError(error)

        await recordCrmActivity(session, {
          case_item_id: caseItemId,
          activity_type: 'settlement_upserted',
          title: 'Zaktualizowano rozliczenie przez MCP',
          payload,
        })

        return data
      },
    },
  ]
}
