import { requireCrmSession } from '~~/server/utils/crm'

export default defineEventHandler(async (event) => {
  const organizationSlug = getHeader(event, 'x-openexpert-organization')?.trim() ?? ''
  await requireCrmSession(event, organizationSlug)

  const config = useRuntimeConfig(event)
  const available = Boolean(
    config.aiGatewayApiKey
    || process.env.AI_GATEWAY_API_KEY
    || process.env.VERCEL_OIDC_TOKEN,
  )

  return {
    available,
    message: available
      ? undefined
      : 'Brakuje połączenia z modelem AI. Administrator musi skonfigurować AI Gateway.',
  }
})
