import { createError, setHeader } from 'h3'
import {
  requireCrmSession,
  requireOrganizationAdmin,
} from '~~/server/utils/crm'
import { organizationStripeBillingHistory } from '~~/server/utils/stripe-billing'

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  const session = await requireCrmSession(event, undefined, { allowUnsubscribed: true })
  requireOrganizationAdmin(session)
  if (session.organizationKind !== 'application') {
    throw createError({ statusCode: 409, statusMessage: 'This organization does not use Stripe Billing' })
  }
  const history = await organizationStripeBillingHistory(event, session.organizationId)
  return {
    ...history,
    invoices: history.invoices.map(invoice => ({
      ...invoice,
      invoicePdf: invoice.invoicePdf
        ? `/api/org/${encodeURIComponent(session.organizationSlug)}/billing/invoices/${encodeURIComponent(invoice.id)}/pdf`
        : undefined,
    })),
  }
})
