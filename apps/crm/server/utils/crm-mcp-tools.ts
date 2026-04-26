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
            .or(`display_name.ilike.%${query}%,primary_email.ilike.%${query}%,primary_phone.ilike.%${query}%`)
            .order('updated_at', { ascending: false })
            .limit(limit),
          session.supabase
            .from('crm_cases')
            .select('id, client_id, title, status_code, priority, updated_at')
            .or(`title.ilike.%${query}%,description.ilike.%${query}%`)
            .order('updated_at', { ascending: false })
            .limit(limit),
          session.supabase
            .from('crm_case_items')
            .select('id, case_id, title, status_code, amount_value, currency, updated_at')
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
      name: 'crm.create_client',
      description: 'Create a CRM client and optional primary person.',
      inputSchema: objectSchema({
        display_name: { type: 'string' },
        primary_email: { type: 'string' },
        primary_phone: { type: 'string' },
        lead_source: { type: 'string' },
      }, ['display_name']),
      async handler(event, input) {
        const session = await requireCrmSession(event)
        const body = asRecord(input)
        const displayName = requiredText(body.display_name, 'display_name')

        const { data, error } = await session.supabase
          .from('crm_clients')
          .insert({
            organization_id: session.organizationId,
            owner_user_id: session.userId,
            display_name: displayName,
            primary_email: textValue(body.primary_email) ?? null,
            primary_phone: textValue(body.primary_phone) ?? null,
            lead_source: textValue(body.lead_source) ?? 'mcp',
          })
          .select('*')
          .single()
        throwDbError(error)

        await recordCrmActivity(session, {
          client_id: data.id,
          activity_type: 'client_created',
          title: 'Dodano klienta przez MCP',
          body: displayName,
        })

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
