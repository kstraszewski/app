import { verifyDataApiToken } from '@openexpert/data-api/token'
import { eveChannel } from 'eve/channels/eve'
import {
  extractBearerToken,
  type AuthFn,
  UnauthenticatedError,
} from 'eve/channels/auth'
import {
  BANK_MAIL_AGENT_PRESET,
  BANK_MAIL_AGENT_SERVICE_ID,
} from '../lib/caller.ts'
import { getBankMailDataApiVerificationOptions } from '../lib/data-api.ts'

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const organizationSlugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u

export interface BankMailInvocationClaims {
  serviceId: typeof BANK_MAIL_AGENT_SERVICE_ID
  preset: typeof BANK_MAIL_AGENT_PRESET
  organizationId: string
  organizationSlug: string
  intakeId: string
  analysisRunId: string
  connectionId: string
  mailboxOwnerUserId: string
}

function claimText(claims: Record<string, unknown>, key: string): string {
  const value = claims[key]
  return typeof value === 'string' ? value.trim() : ''
}

export function parseBankMailInvocationClaims(
  claims: Record<string, unknown>,
): BankMailInvocationClaims {
  const serviceId = claimText(claims, 'serviceId')
  const preset = claimText(claims, 'preset')
  const organizationId = claimText(claims, 'organizationId')
  const organizationSlug = claimText(claims, 'organizationSlug')
  const intakeId = claimText(claims, 'intakeId')
  const analysisRunId = claimText(claims, 'analysisRunId')
  const connectionId = claimText(claims, 'connectionId')
  const mailboxOwnerUserId = claimText(claims, 'mailboxOwnerUserId')

  if (serviceId !== BANK_MAIL_AGENT_SERVICE_ID) {
    throw new TypeError('Invalid bank mail agent service principal.')
  }
  if (preset !== BANK_MAIL_AGENT_PRESET) {
    throw new TypeError('Invalid bank mail agent invocation preset.')
  }
  if (!organizationSlugPattern.test(organizationSlug)) {
    throw new TypeError('Invalid bank mail agent organization slug.')
  }
  for (const [label, value] of [
    ['organizationId', organizationId],
    ['intakeId', intakeId],
    ['analysisRunId', analysisRunId],
    ['connectionId', connectionId],
    ['mailboxOwnerUserId', mailboxOwnerUserId],
  ] as const) {
    if (!uuidPattern.test(value)) throw new TypeError(`Invalid ${label} claim.`)
  }

  return {
    serviceId: BANK_MAIL_AGENT_SERVICE_ID,
    preset: BANK_MAIL_AGENT_PRESET,
    organizationId,
    organizationSlug,
    intakeId,
    analysisRunId,
    connectionId,
    mailboxOwnerUserId,
  }
}

function dataApiBankMailIntake(): AuthFn<Request> {
  return async (request) => {
    const accessToken = extractBearerToken(request.headers.get('authorization'))
    if (!accessToken) {
      throw new UnauthenticatedError({
        code: 'authentication_required',
        message: 'A bank-mail intake service token is required.',
      })
    }

    let invocation: BankMailInvocationClaims
    try {
      const claims = verifyDataApiToken(accessToken, {
        ...getBankMailDataApiVerificationOptions(),
        expectedRole: 'openexpert_service',
      })
      invocation = parseBankMailInvocationClaims(claims as Record<string, unknown>)
    }
    catch {
      throw new UnauthenticatedError({
        code: 'invalid_service_token',
        message: 'The bank-mail intake service token is invalid or expired.',
      })
    }

    return {
      authenticator: 'data-api',
      issuer: 'openexpert-data-api',
      principalId: BANK_MAIL_AGENT_SERVICE_ID,
      principalType: 'service',
      subject: invocation.intakeId,
      attributes: { ...invocation },
    }
  }
}

export default eveChannel({
  auth: [dataApiBankMailIntake()],
  uploadPolicy: 'disabled',
})
