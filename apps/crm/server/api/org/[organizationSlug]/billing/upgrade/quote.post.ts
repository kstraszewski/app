import { createError, readBody, setHeader } from 'h3'
import {
  asRecord,
  numberValue,
  requireCrmSession,
  requireOrganizationAdmin,
} from '~~/server/utils/crm'
import {
  createOrganizationPlanUpgradeQuote,
  requireStripeBillingBrowserRequest,
} from '~~/server/utils/stripe-billing'

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  requireStripeBillingBrowserRequest(event)
  const session = await requireCrmSession(event)
  requireOrganizationAdmin(session)
  if (session.organizationKind !== 'application') {
    throw createError({ statusCode: 409, statusMessage: 'Application organization required' })
  }
  const body = asRecord(await readBody(event))
  const prorationDate = body.prorationDate == null
    ? undefined
    : numberValue(body.prorationDate)
  if (body.prorationDate != null && !Number.isSafeInteger(prorationDate)) {
    throw createError({ statusCode: 400, statusMessage: 'prorationDate is invalid' })
  }
  return createOrganizationPlanUpgradeQuote(
    event,
    session.organizationId,
    prorationDate,
  )
})
