import {
  createError,
  getHeader,
  type H3Event,
} from 'h3'
import { verifyDataApiToken } from '@openexpert/data-api/token'
import { CRM_AGENT_MAIL_ACCESS } from '../../shared/types/agent-mail.ts'
import {
  isBillingAccessGranted,
  type BillingAccessState,
  type OrganizationKind,
} from '../../shared/organization-billing.ts'
import type { CrmSession } from './crm.ts'
import { setPrivateMailResponseHeaders } from './mail-http.ts'
import { readBoundedRequestBody } from './mail-multipart.ts'
import {
  serverBackendDataClient,
  serverDataTokenSigner,
  serverUserDataClient,
} from './platform-data.ts'

const MAX_AGENT_MAIL_REQUEST_BYTES = 32 * 1024
const organizationSlugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu

function claimText(claims: Record<string, unknown>, name: string): string {
  const value = claims[name]
  return typeof value === 'string' ? value.trim() : ''
}

export async function requireCrmAgentMailSession(event: H3Event): Promise<CrmSession> {
  setPrivateMailResponseHeaders(event)
  const authorization = getHeader(event, 'authorization')?.trim() ?? ''
  const accessToken = authorization.match(/^Bearer ([^\s,]+)$/iu)?.[1]
  if (!accessToken || accessToken.length > 16_384) {
    throw createError({ statusCode: 401, statusMessage: 'CRM Agent mail authentication is required' })
  }

  const runtimeConfig = useRuntimeConfig(event) as {
    dataApi?: { jwt?: { audience?: string, issuer?: string } }
  }
  const audience = String(runtimeConfig.dataApi?.jwt?.audience ?? '').trim()
  const issuer = String(runtimeConfig.dataApi?.jwt?.issuer ?? '').trim()
  const publicJwk = serverDataTokenSigner(event).jwks.keys[0]
  let claims: Record<string, unknown>
  try {
    if (!audience || !issuer || !publicJwk) throw new Error('Data API signing identity is missing')
    claims = verifyDataApiToken(accessToken, {
      audience,
      issuer,
      publicJwk,
      expectedRole: 'authenticated',
    }) as Record<string, unknown>
  }
  catch {
    throw createError({ statusCode: 401, statusMessage: 'CRM Agent mail authentication is invalid' })
  }

  const purpose = claimText(claims, CRM_AGENT_MAIL_ACCESS.purposeClaim)
  const organizationId = claimText(claims, CRM_AGENT_MAIL_ACCESS.organizationIdClaim).toLowerCase()
  const organizationSlug = claimText(claims, CRM_AGENT_MAIL_ACCESS.organizationSlugClaim)
  const userId = claimText(claims, 'sub').toLowerCase()

  if (
    purpose !== CRM_AGENT_MAIL_ACCESS.purpose
    || !uuidPattern.test(organizationId)
    || !organizationSlugPattern.test(organizationSlug)
    || !uuidPattern.test(userId)
  ) {
    throw createError({ statusCode: 403, statusMessage: 'CRM Agent mail access is not authorized' })
  }

  const dataApi = serverUserDataClient(event, userId)
  const [userResult, organizationResult, membershipResult] = await Promise.all([
    dataApi
      .from('users')
      .select('organization_id, email, full_name')
      .eq('id', userId)
      .maybeSingle(),
    dataApi
      .from('organizations')
      .select('id, name, slug, kind, billing_access_state')
      .eq('id', organizationId)
      .eq('slug', organizationSlug)
      .maybeSingle(),
    dataApi
      .from('organization_memberships')
      .select('role')
      .eq('organization_id', organizationId)
      .eq('user_id', userId)
      .maybeSingle(),
  ])
  if (
    userResult.error
    || organizationResult.error
    || membershipResult.error
    || !userResult.data
    || !organizationResult.data
    || !membershipResult.data
  ) {
    throw createError({ statusCode: 403, statusMessage: 'CRM Agent mail scope is invalid' })
  }

  const organizationKind = String(organizationResult.data.kind || 'intermediary') as OrganizationKind
  let billingAccessState = String(
    organizationResult.data.billing_access_state || 'not_required',
  ) as BillingAccessState
  if (organizationKind === 'application') {
    const accessResult = await serverBackendDataClient(event).rpc(
      'get_organization_billing_access_v1',
      { p_organization_id: organizationId },
    )
    if (accessResult.error) {
      throw createError({ statusCode: 403, statusMessage: 'CRM Agent billing access could not be verified' })
    }
    billingAccessState = String(
      (accessResult.data as { billingAccessState?: unknown } | null)?.billingAccessState ?? '',
    ) as BillingAccessState
    if (!isBillingAccessGranted(billingAccessState)) {
      throw createError({ statusCode: 402, statusMessage: 'Application subscription required' })
    }
  }

  return {
    dataApi,
    userId,
    email: String(userResult.data.email ?? ''),
    emailVerified: false,
    emailConfirmedAt: null,
    phone: '',
    fullName: String(userResult.data.full_name ?? ''),
    defaultOrganizationId: String(userResult.data.organization_id ?? organizationId),
    organizationId,
    organizationName: String(organizationResult.data.name),
    organizationSlug,
    organizationKind,
    billingAccessState,
    role: String(membershipResult.data.role ?? 'expert'),
  }
}

export async function readCrmAgentMailRequest(
  event: H3Event,
): Promise<Record<string, unknown>> {
  const contentType = getHeader(event, 'content-type')?.split(';')[0]?.trim().toLowerCase()
  if (contentType !== 'application/json') {
    throw createError({ statusCode: 415, statusMessage: 'CRM Agent mail requests require JSON' })
  }
  const contentLengthValue = getHeader(event, 'content-length')?.trim() ?? ''
  if (contentLengthValue) {
    if (!/^\d+$/u.test(contentLengthValue)) {
      throw createError({ statusCode: 400, statusMessage: 'Invalid request size' })
    }
    const contentLength = Number(contentLengthValue)
    if (!Number.isSafeInteger(contentLength) || contentLength > MAX_AGENT_MAIL_REQUEST_BYTES) {
      throw createError({ statusCode: 413, statusMessage: 'CRM Agent mail request is too large' })
    }
  }

  let parsed: unknown
  try {
    const raw = await readBoundedRequestBody(event, MAX_AGENT_MAIL_REQUEST_BYTES)
    parsed = JSON.parse(raw.toString('utf8'))
  }
  catch (error) {
    if (Number((error as { statusCode?: number })?.statusCode) === 413) throw error
    throw createError({ statusCode: 400, statusMessage: 'CRM Agent mail request is invalid' })
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw createError({ statusCode: 400, statusMessage: 'CRM Agent mail request is invalid' })
  }
  return parsed as Record<string, unknown>
}
