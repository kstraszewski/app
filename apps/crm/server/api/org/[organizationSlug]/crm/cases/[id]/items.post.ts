import { readBody } from 'h3'
import {
  asRecord,
  defaultItemStatus,
  getRequiredParam,
  numberValue,
  recordCrmActivity,
  requireCrmSession,
  requiredText,
  resolveProductType,
  textValue,
  throwDbError,
} from '~~/server/utils/crm'

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  const caseId = getRequiredParam(event, 'id')
  const body = asRecord(await readBody(event))
  const productType = await resolveProductType(session, body)
  const title = textValue(body.title) ?? productType.name

  const { data: caseRow, error: caseError } = await session.dataApi
    .from('crm_cases')
    .select('id, client_id')
    .eq('organization_id', session.organizationId)
    .eq('id', caseId)
    .single()
  throwDbError(caseError, 404)

  const { data, error } = await session.dataApi
    .from('crm_case_items')
    .insert({
      organization_id: session.organizationId,
      case_id: caseId,
      product_type_id: productType.id,
      owner_user_id: textValue(body.owner_user_id) ?? session.userId,
      title: requiredText(title, 'title'),
      status_code: textValue(body.status_code) ?? defaultItemStatus(productType.domain),
      amount_value: numberValue(body.amount_value) ?? null,
      currency: textValue(body.currency) ?? 'PLN',
      expected_close_date: textValue(body.expected_close_date) ?? null,
      metadata: asRecord(body.metadata),
    })
    .select('*')
    .single()

  throwDbError(error)

  const expectedAmount = numberValue(body.settlement_expected_amount)
  if (expectedAmount !== undefined) {
    const { error: settlementError } = await session.dataApi
      .from('crm_case_item_settlements')
      .insert({
        organization_id: session.organizationId,
        case_item_id: data.id,
        status_code: 'szacowane',
        expected_amount: expectedAmount,
        currency: textValue(body.currency) ?? 'PLN',
      })
    throwDbError(settlementError)
  }

  await recordCrmActivity(session, {
    client_id: caseRow.client_id,
    case_id: caseId,
    case_item_id: data.id,
    activity_type: 'case_item_created',
    title: 'Dodano produkt do sprawy',
    body: title,
  })

  return { data }
})
