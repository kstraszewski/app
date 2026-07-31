import { createError, readBody } from 'h3'
import {
  mortgageBackofficeSlug,
  mortgageBackofficeText,
  mortgageBackofficeUuid,
  mortgageOfferDraftData,
  mortgageProductClassification,
  requireMortgageBackoffice,
  throwMortgageBackofficeDbError,
} from '~~/server/utils/mortgage-backoffice'
import { asRecord, getRequiredParam } from '~~/server/utils/crm'

export default defineEventHandler(async (event) => {
  const { session, backendData } = await requireMortgageBackoffice(event)
  const bankId = mortgageBackofficeUuid(getRequiredParam(event, 'bankId'), 'bankId')
  const body = asRecord(await readBody(event))
  const name = mortgageBackofficeText(body.name, 'name', { min: 3, max: 160 })
  const slug = mortgageBackofficeSlug(body.slug ?? body.code)
  const classification = mortgageProductClassification(
    body.category ?? body.productKind,
    body.productKind,
  )
  const distributionChannel = typeof body.distributionChannel === 'string'
    ? body.distributionChannel.slice(0, 80)
    : 'backoffice'
  const draftData = mortgageOfferDraftData(body.draftData)

  const { data: bank, error: bankError } = await backendData
    .from('mortgage_banks')
    .select('id')
    .eq('id', bankId)
    .maybeSingle()
  throwMortgageBackofficeDbError(bankError)
  if (!bank) throw createError({ statusCode: 404, statusMessage: 'Institution not found' })

  const { data: createdData, error: createRpcError } = await backendData.rpc(
    'create_mortgage_product_draft_v2',
    {
      p_bank_id: bankId,
      p_slug: slug,
      p_name: name,
      p_category: classification.rpcCategory,
      p_distribution_channel: distributionChannel,
      p_draft_data: draftData,
      p_actor_user_id: session.userId,
    },
  )
  throwMortgageBackofficeDbError(createRpcError)
  const created = asRecord(createdData)

  return {
    data: {
      product: {
        id: created.productId,
        bankId: created.bankId,
        code: created.slug,
        name: created.name,
        slug: created.slug,
        productKind: created.productKind ?? classification.productKind,
        category: created.category ?? classification.category,
        productType: created.category ?? classification.category,
        currency: 'PLN',
        status: 'draft',
        createdAt: created.productCreatedAt,
        updatedAt: created.productUpdatedAt,
      },
      draft: {
        id: created.draftId,
        revision: Number(created.draftRevision),
        status: 'draft',
        draftData: created.draftData,
        updatedAt: created.draftUpdatedAt,
        updatedBy: created.draftUpdatedBy,
      },
    },
  }
})
