import { getQuery } from 'h3'
import { requireCrmSession } from '~~/server/utils/crm'
import { buildSalesPayload } from '~~/server/utils/sales'

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  const query = getQuery(event)

  return buildSalesPayload(session, [session.userId], {
    range: query.range,
    currency: query.currency,
    scope: {
      type: 'user',
      id: session.userId,
      label: session.fullName || session.email || 'Moja sprzedaż',
      memberCount: 1,
    },
  })
})
