import { createHash } from 'node:crypto'
import {
  BANK_MAIL_AGENT_MODEL,
  CRM_AGENT_CAPABILITIES_TOOL_VERSION,
} from '@openexpert/crm-agent-capabilities'
import {
  buildBankMailReanalysisPrompt,
  type BankMailAgentPromptInput,
} from './bank-mail-agent-prompt.ts'
import { normalizeBankMailAgentServiceUrl } from './bank-mail-agent-dispatch-core.ts'

export const BANK_MAIL_REANALYSIS_CRM_SERVICE_ID
  = 'openexpert-crm-bank-mail-reanalysis' as const
export const BANK_MAIL_REANALYSIS_PRESET = 'bank-mail-reanalysis' as const
export const BANK_MAIL_REANALYSIS_CLAIM_SOURCE
  = 'crm-bank-mail-reanalysis-claim-v1' as const
export const BANK_MAIL_REANALYSIS_FAILURE_SOURCE
  = 'crm-bank-mail-reanalysis-failure-v1' as const
export const BANK_MAIL_REANALYSIS_PROMPT_VERSION
  = 'bank-mail-reanalysis.prompt.v1' as const
export const BANK_MAIL_REANALYSIS_POLICY_VERSION
  = 'bank-mail-reanalysis-policy.v1' as const

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const sha256Pattern = /^[0-9a-f]{64}$/u
const organizationSlugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u
const statePattern = /^[a-z0-9_:-]{1,100}$/u
const eveSessionIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,255}$/u

export interface BankMailReanalysisDispatchInput extends BankMailAgentPromptInput {
  reanalysisRequestId: string
  intakeId: string
  organizationId: string
  organizationSlug: string
  connectionId: string
  mailboxOwnerUserId: string
}

export interface BankMailReanalysisInvocationClaims {
  serviceId: typeof BANK_MAIL_REANALYSIS_CRM_SERVICE_ID
  preset: typeof BANK_MAIL_REANALYSIS_PRESET
  organizationId: string
  organizationSlug: string
  intakeId: string
  analysisRunId: string
  reanalysisRequestId: string
  connectionId: string
  mailboxOwnerUserId: string
}

export interface BankMailReanalysisDispatchResult {
  reanalysisRequestId: string
  intakeId: string
  state: string
  dispatched: boolean
  replayed: boolean
  sessionId: string | null
}

export interface BankMailReanalysisClaimClaims {
  source: typeof BANK_MAIL_REANALYSIS_CLAIM_SOURCE
  serviceId: typeof BANK_MAIL_REANALYSIS_CRM_SERVICE_ID
  preset: typeof BANK_MAIL_REANALYSIS_PRESET
  organizationId: string
  reanalysisRequestId: string
  intakeId: string
  connectionId: string
  mailboxOwnerUserId: string
  model: string
  promptVersion: typeof BANK_MAIL_REANALYSIS_PROMPT_VERSION
  toolsetVersion: string
  policyVersion: typeof BANK_MAIL_REANALYSIS_POLICY_VERSION
  normalizedInputSha256: string
}

export interface BankMailReanalysisDispatchFailureClaims {
  source: typeof BANK_MAIL_REANALYSIS_FAILURE_SOURCE
  serviceId: typeof BANK_MAIL_REANALYSIS_CRM_SERVICE_ID
  preset: typeof BANK_MAIL_REANALYSIS_PRESET
  organizationId: string
  reanalysisRequestId: string
  intakeId: string
  connectionId: string
  mailboxOwnerUserId: string
  failureCode: 'dispatch_failed'
}

export interface BankMailReanalysisRpcContext {
  scopedClaims?: BankMailReanalysisClaimClaims | BankMailReanalysisDispatchFailureClaims
}

interface RpcResult {
  data: unknown
  error: { code?: string, message?: string } | null
}

export interface BankMailReanalysisDispatcherDependencies {
  rpc(
    name: string,
    args: Record<string, unknown>,
    context?: BankMailReanalysisRpcContext,
  ): Promise<RpcResult>
  signServiceToken(claims: BankMailReanalysisInvocationClaims): string
  createSession(input: {
    serviceUrl: string
    bearerToken: string
    prompt: string
  }): Promise<{ sessionId: string }>
}

interface ClaimedReanalysis {
  reanalysisRequestId: string
  state: string
  shouldDispatch: boolean
  leaseToken: string | null
  sessionId: string | null
  replayed: boolean
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function requiredUuid(value: unknown, label: string): string {
  const normalized = text(value).toLowerCase()
  if (!uuidPattern.test(normalized)) throw new TypeError(`Invalid ${label}.`)
  return normalized
}

function requiredSha256(value: unknown, label: string): string {
  const normalized = text(value)
  if (!sha256Pattern.test(normalized)) throw new TypeError(`Invalid ${label}.`)
  return normalized
}

function controlledState(value: unknown): string {
  const normalized = text(value)
  if (!statePattern.test(normalized)) throw new TypeError('Invalid reanalysis state.')
  return normalized
}

function nullableSessionId(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null
  const normalized = text(value)
  if (!eveSessionIdPattern.test(normalized)) {
    throw new TypeError('Invalid bank-mail reanalysis session id.')
  }
  return normalized
}

function record(value: unknown): Record<string, unknown> {
  const candidate = Array.isArray(value) ? value[0] : value
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    throw new Error('Invalid bank-mail reanalysis RPC response.')
  }
  return candidate as Record<string, unknown>
}

function normalizeInput(
  input: BankMailReanalysisDispatchInput,
): BankMailReanalysisDispatchInput {
  const organizationSlug = text(input.organizationSlug).toLowerCase()
  if (!organizationSlugPattern.test(organizationSlug)) {
    throw new TypeError('Invalid organization slug.')
  }
  if (typeof input.subject !== 'string' || typeof input.bodyText !== 'string') {
    throw new TypeError('Invalid bank-mail reanalysis prompt input.')
  }
  if (typeof input.bodyTruncated !== 'boolean' || !Array.isArray(input.attachments)) {
    throw new TypeError('Invalid bank-mail reanalysis prompt metadata.')
  }
  return {
    ...input,
    reanalysisRequestId: requiredUuid(input.reanalysisRequestId, 'reanalysis request id'),
    intakeId: requiredUuid(input.intakeId, 'intake id'),
    organizationId: requiredUuid(input.organizationId, 'organization id'),
    organizationSlug,
    connectionId: requiredUuid(input.connectionId, 'mail connection id'),
    mailboxOwnerUserId: requiredUuid(input.mailboxOwnerUserId, 'mailbox owner user id'),
  }
}

function parseClaimedReanalysis(value: unknown): ClaimedReanalysis {
  const result = record(value)
  const shouldDispatch = result.shouldDispatch === true
  const leaseToken = result.leaseToken === null || result.leaseToken === undefined
    ? null
    : requiredSha256(result.leaseToken, 'reanalysis lease token')
  const sessionId = nullableSessionId(result.sessionId)
  if (shouldDispatch && (!leaseToken || sessionId)) {
    throw new Error('Invalid bank-mail reanalysis dispatch lease.')
  }
  if (!shouldDispatch && leaseToken) {
    throw new Error('Unexpected bank-mail reanalysis replay lease.')
  }
  return {
    reanalysisRequestId: requiredUuid(
      result.reanalysisRequestId,
      'claimed reanalysis request id',
    ),
    state: controlledState(result.state),
    shouldDispatch,
    leaseToken,
    sessionId,
    replayed: result.replayed === true,
  }
}

async function rpc(
  dependencies: BankMailReanalysisDispatcherDependencies,
  name: string,
  args: Record<string, unknown>,
  context?: BankMailReanalysisRpcContext,
): Promise<unknown> {
  const result = await dependencies.rpc(name, args, context)
  if (result.error) {
    const rawCode = text(result.error.code)
    const code = statePattern.test(rawCode) ? rawCode : 'rpc_rejected'
    throw new Error(`Bank-mail reanalysis RPC failed (${code}).`)
  }
  return result.data
}

export function bankMailReanalysisNormalizedInputSha256(
  reanalysisRequestId: string,
  prompt: string,
): string {
  return createHash('sha256')
    .update('bank-mail-reanalysis-input-v1', 'utf8')
    .update('\u001f', 'utf8')
    .update(reanalysisRequestId, 'utf8')
    .update('\u001f', 'utf8')
    .update(prompt, 'utf8')
    .digest('hex')
}

export async function dispatchBankMailReanalysisWithDependencies(
  serviceUrl: string,
  untrustedInput: BankMailReanalysisDispatchInput,
  dependencies: BankMailReanalysisDispatcherDependencies,
): Promise<BankMailReanalysisDispatchResult> {
  const input = normalizeInput(untrustedInput)
  const normalizedServiceUrl = normalizeBankMailAgentServiceUrl(serviceUrl)
  const prompt = buildBankMailReanalysisPrompt(input)
  const normalizedInputSha256 = bankMailReanalysisNormalizedInputSha256(
    input.reanalysisRequestId,
    prompt,
  )
  const claimArgs = {
    p_reanalysis_request_id: input.reanalysisRequestId,
    p_model: BANK_MAIL_AGENT_MODEL.id,
    p_prompt_version: BANK_MAIL_REANALYSIS_PROMPT_VERSION,
    p_toolset_version: CRM_AGENT_CAPABILITIES_TOOL_VERSION,
    p_policy_version: BANK_MAIL_REANALYSIS_POLICY_VERSION,
    p_normalized_input_sha256: normalizedInputSha256,
  }
  const commonScope = {
    serviceId: BANK_MAIL_REANALYSIS_CRM_SERVICE_ID,
    preset: BANK_MAIL_REANALYSIS_PRESET,
    organizationId: input.organizationId,
    reanalysisRequestId: input.reanalysisRequestId,
    intakeId: input.intakeId,
    connectionId: input.connectionId,
    mailboxOwnerUserId: input.mailboxOwnerUserId,
  } as const
  const claimed = parseClaimedReanalysis(await rpc(
    dependencies,
    'claim_bank_mail_agent_reanalysis',
    claimArgs,
    {
      scopedClaims: {
        source: BANK_MAIL_REANALYSIS_CLAIM_SOURCE,
        ...commonScope,
        model: BANK_MAIL_AGENT_MODEL.id,
        promptVersion: BANK_MAIL_REANALYSIS_PROMPT_VERSION,
        toolsetVersion: CRM_AGENT_CAPABILITIES_TOOL_VERSION,
        policyVersion: BANK_MAIL_REANALYSIS_POLICY_VERSION,
        normalizedInputSha256,
      },
    },
  ))
  if (claimed.reanalysisRequestId !== input.reanalysisRequestId) {
    throw new Error('Bank-mail reanalysis claim scope mismatch.')
  }
  if (!claimed.shouldDispatch) {
    return {
      reanalysisRequestId: input.reanalysisRequestId,
      intakeId: input.intakeId,
      state: claimed.state,
      dispatched: false,
      replayed: claimed.replayed,
      sessionId: claimed.sessionId,
    }
  }

  try {
    const invocationClaims: BankMailReanalysisInvocationClaims = {
      ...commonScope,
      organizationSlug: input.organizationSlug,
      analysisRunId: input.reanalysisRequestId,
    }
    const bearerToken = dependencies.signServiceToken(invocationClaims)
    if (!bearerToken.trim()) throw new Error('Bank-mail reanalysis service token is empty.')
    const created = await dependencies.createSession({
      serviceUrl: normalizedServiceUrl,
      bearerToken,
      prompt,
    })
    const sessionId = nullableSessionId(created.sessionId)
    if (!sessionId) throw new Error('Bank-mail reanalysis did not return a session id.')
    const bound = record(await rpc(
      dependencies,
      'bind_bank_mail_agent_reanalysis_session',
      {
        p_reanalysis_request_id: input.reanalysisRequestId,
        p_lease_token: claimed.leaseToken!,
        p_eve_session_id: sessionId,
      },
    ))
    if (
      requiredUuid(bound.reanalysisRequestId, 'bound reanalysis request id')
        !== input.reanalysisRequestId
      || nullableSessionId(bound.sessionId) !== sessionId
    ) {
      throw new Error('Bank-mail reanalysis session binding mismatch.')
    }
    return {
      reanalysisRequestId: input.reanalysisRequestId,
      intakeId: input.intakeId,
      state: controlledState(bound.state),
      dispatched: true,
      replayed: false,
      sessionId,
    }
  }
  catch (error) {
    await rpc(
      dependencies,
      'fail_bank_mail_agent_reanalysis',
      {
        p_reanalysis_request_id: input.reanalysisRequestId,
        p_failure_code: 'dispatch_failed',
      },
      {
        scopedClaims: {
          source: BANK_MAIL_REANALYSIS_FAILURE_SOURCE,
          ...commonScope,
          failureCode: 'dispatch_failed',
        },
      },
    )
    throw error
  }
}
