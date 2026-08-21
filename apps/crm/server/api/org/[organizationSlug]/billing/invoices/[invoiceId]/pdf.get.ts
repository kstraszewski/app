import { createError, sendRedirect, setHeader } from 'h3'
import {
  getRequiredParam,
  requireCrmSession,
  requireOrganizationAdmin,
} from '~~/server/utils/crm'
import {
  organizationBillingAccount,
  stripeBillingClient,
} from '~~/server/utils/stripe-billing'

function objectId(value: unknown): string | null {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object' && 'id' in value) {
    const id = (value as { id?: unknown }).id
    return typeof id === 'string' ? id : null
  }
  return null
}

function safeStripePdfUrl(value: string | null | undefined): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password) return null
    return url.toString()
  }
  catch {
    return null
  }
}

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  setHeader(event, 'Referrer-Policy', 'no-referrer')
  const session = await requireCrmSession(event, undefined, { allowUnsubscribed: true })
  requireOrganizationAdmin(session)
  const invoiceId = getRequiredParam(event, 'invoiceId')
  if (!/^in_[A-Za-z0-9]+$/u.test(invoiceId)) {
    throw createError({ statusCode: 404, statusMessage: 'Invoice not found' })
  }
  const account = await organizationBillingAccount(event, session.organizationId)
  if (!account?.stripe_customer_id) {
    throw createError({ statusCode: 404, statusMessage: 'Invoice not found' })
  }
  const invoice = await stripeBillingClient(event).invoices.retrieve(invoiceId)
  if (
    objectId(invoice.customer) !== account.stripe_customer_id
    || invoice.livemode !== account.livemode
  ) {
    throw createError({ statusCode: 404, statusMessage: 'Invoice not found' })
  }
  const pdfUrl = safeStripePdfUrl(invoice.invoice_pdf)
  if (!pdfUrl) throw createError({ statusCode: 404, statusMessage: 'Invoice PDF is unavailable' })
  return sendRedirect(event, pdfUrl, 302)
})
