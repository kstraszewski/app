import { createHash } from 'node:crypto'
import {
  BANK_MAIL_AGENT_MODEL,
  BANK_MAIL_AGENT_PROMPT_VERSION,
  BANK_MAIL_MATCH_POLICY_VERSION,
  CRM_AGENT_CAPABILITIES_TOOL_VERSION,
} from '@openexpert/crm-agent-capabilities'
import {
  buildBankMailAgentPrompt,
  type BankMailAgentPromptInput,
} from './bank-mail-agent-prompt.ts'

export const BANK_MAIL_AGENT_SERVICE_ID = 'openexpert-crm-bank-mail-ingestion' as const
export const BANK_MAIL_AGENT_PRESET = 'bank-mail-intake' as const

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const sha256Pattern = /^[0-9a-f]{64}$/u
const organizationSlugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u
const senderDomainPattern = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/u
const statePattern = /^[a-z0-9_:-]{1,100}$/u
const eveSessionIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,255}$/u

type BankMailProvider = 'google' | 'microsoft' | 'imap'
type AuthenticationStatus = 'passed' | 'failed' | 'indeterminate'

export interface BankMailAgentDispatchInput extends BankMailAgentPromptInput {
  organizationId: string
  organizationSlug: string
  connectionId: string
  mailboxOwnerUserId: string
  provider: BankMailProvider
  /**
   * The provider message identity must be hashed by trusted ingress before this
   * boundary. The dispatcher deliberately has no API that accepts its raw form.
   */
  providerMessageIdSha256: string
  sourceSha256: string
  senderDomain: string
  authenticationStatus: AuthenticationStatus
  dmarcAligned: boolean
  replyToMismatch: boolean
  bankId?: string | null
}

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

export interface BankMailAgentDispatchResult {
  intakeId: string
  runId: string | null
  state: string
  dispatched: boolean
  replayed: boolean
  sessionId: string | null
}

interface RpcResult {
  data: unknown
  error: { code?: string, message?: string } | null
}

export interface BankMailAgentDispatcherDependencies {
  rpc(name: string, args: Record<string, unknown>): Promise<RpcResult>
  signServiceToken(claims: BankMailInvocationClaims): string
  createSession(input: {
    serviceUrl: string
    bearerToken: string
    prompt: string
  }): Promise<{ sessionId: string }>
}

interface ClaimedIntake {
  intakeId: string
  state: string
  replayed: boolean
}

interface ClaimedRun {
  runId: string | null
  state: string
  shouldDispatch: boolean
  leaseToken: string | null
  sessionId: string | null
}

function record(value: unknown): Record<string, unknown> {
  const candidate = Array.isArray(value) ? value[0] : value
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    throw new Error('Invalid bank-mail dispatcher RPC response.')
  }
  return candidate as Record<string, unknown>
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function selectBankMailAgentServiceUrl(
  internalBindingUrl: unknown,
  configuredUrl: unknown,
): string {
  return text(internalBindingUrl) || text(configuredUrl)
}

function requiredUuid(value: unknown, label: string): string {
  const normalized = text(value).toLowerCase()
  if (!uuidPattern.test(normalized)) throw new TypeError(`Invalid ${label}.`)
  return normalized
}

function nullableUuid(value: unknown, label: string): string | null {
  if (value === null || value === undefined || value === '') return null
  return requiredUuid(value, label)
}

function requiredSha256(value: unknown, label: string): string {
  const normalized = text(value)
  if (!sha256Pattern.test(normalized)) throw new TypeError(`Invalid ${label}.`)
  return normalized
}

function controlledState(value: unknown, label: string): string {
  const normalized = text(value)
  if (!statePattern.test(normalized)) throw new TypeError(`Invalid ${label}.`)
  return normalized
}

function nullableSessionId(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null
  const normalized = text(value)
  if (!eveSessionIdPattern.test(normalized)) {
    throw new TypeError('Invalid bank-mail agent session id.')
  }
  return normalized
}

function normalizeInput(input: BankMailAgentDispatchInput): BankMailAgentDispatchInput {
  const organizationId = requiredUuid(input.organizationId, 'organization id')
  const organizationSlug = text(input.organizationSlug).toLowerCase()
  if (!organizationSlugPattern.test(organizationSlug)) {
    throw new TypeError('Invalid organization slug.')
  }
  const provider = text(input.provider) as BankMailProvider
  if (!(['google', 'microsoft', 'imap'] as const).includes(provider)) {
    throw new TypeError('Invalid mail provider.')
  }
  const authenticationStatus = text(input.authenticationStatus) as AuthenticationStatus
  if (!(['passed', 'failed', 'indeterminate'] as const).includes(authenticationStatus)) {
    throw new TypeError('Invalid authentication status.')
  }
  const senderDomain = text(input.senderDomain).toLowerCase().replace(/\.$/u, '')
  if (!senderDomainPattern.test(senderDomain)) {
    throw new TypeError('Invalid sender domain.')
  }
  if (typeof input.dmarcAligned !== 'boolean' || typeof input.replyToMismatch !== 'boolean') {
    throw new TypeError('Invalid mail authentication flags.')
  }
  if (typeof input.subject !== 'string' || typeof input.bodyText !== 'string') {
    throw new TypeError('Invalid bank-mail prompt input.')
  }
  if (typeof input.bodyTruncated !== 'boolean' || !Array.isArray(input.attachments)) {
    throw new TypeError('Invalid bank-mail prompt metadata.')
  }

  return {
    ...input,
    organizationId,
    organizationSlug,
    connectionId: requiredUuid(input.connectionId, 'mail connection id'),
    mailboxOwnerUserId: requiredUuid(input.mailboxOwnerUserId, 'mailbox owner user id'),
    provider,
    providerMessageIdSha256: requiredSha256(
      input.providerMessageIdSha256,
      'provider message id SHA-256',
    ),
    sourceSha256: requiredSha256(input.sourceSha256, 'mail source SHA-256'),
    senderDomain,
    authenticationStatus,
    bankId: nullableUuid(input.bankId, 'bank id'),
  }
}

function parseClaimedIntake(value: unknown): ClaimedIntake {
  const result = record(value)
  return {
    intakeId: requiredUuid(result.intakeId, 'claimed intake id'),
    state: controlledState(result.state, 'claimed intake state'),
    replayed: result.replayed === true,
  }
}

function parseClaimedRun(value: unknown): ClaimedRun {
  const result = record(value)
  const shouldDispatch = result.shouldDispatch === true
  const runId = nullableUuid(result.runId, 'analysis run id')
  const leaseToken = result.leaseToken === null || result.leaseToken === undefined
    ? null
    : requiredSha256(result.leaseToken, 'analysis run lease token')

  if (shouldDispatch && (!runId || !leaseToken)) {
    throw new Error('Invalid dispatch lease returned for bank-mail agent run.')
  }
  if (!shouldDispatch && leaseToken) {
    throw new Error('Unexpected dispatch lease returned for replayed bank-mail agent run.')
  }

  return {
    runId,
    state: controlledState(result.state, 'analysis run state'),
    shouldDispatch,
    leaseToken,
    sessionId: nullableSessionId(result.sessionId),
  }
}

async function rpc(
  dependencies: BankMailAgentDispatcherDependencies,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const result = await dependencies.rpc(name, args)
  if (result.error) {
    const rawCode = text(result.error.code)
    const code = statePattern.test(rawCode) ? rawCode : 'rpc_rejected'
    throw new Error(`Bank-mail dispatcher RPC failed (${code}).`)
  }
  return result.data
}

export function normalizeBankMailAgentServiceUrl(value: string): string {
  let url: URL
  try {
    url = new URL(value.trim())
  }
  catch {
    throw new TypeError('Bank-mail agent service URL is invalid.')
  }

  const localHttp = url.protocol === 'http:'
    && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
  if (url.protocol !== 'https:' && !localHttp) {
    throw new TypeError('Bank-mail agent service URL must use HTTPS.')
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new TypeError('Bank-mail agent service URL must not contain credentials or parameters.')
  }
  if (url.pathname !== '/' && url.pathname !== '') {
    throw new TypeError('Bank-mail agent service URL must target the service root.')
  }
  return url.origin
}

/**
 * Idempotent dispatcher core. The database elects the single process allowed
 * to create an EVE session. Replays return the durable run state without
 * minting a token or making another model request.
 */
export async function dispatchBankMailAgentWithDependencies(
  serviceUrl: string,
  untrustedInput: BankMailAgentDispatchInput,
  dependencies: BankMailAgentDispatcherDependencies,
): Promise<BankMailAgentDispatchResult> {
  const input = normalizeInput(untrustedInput)
  const normalizedServiceUrl = normalizeBankMailAgentServiceUrl(serviceUrl)
  const claimedIntake = parseClaimedIntake(await rpc(
    dependencies,
    'claim_bank_mail_agent_intake',
    {
      p_organization_id: input.organizationId,
      p_connection_id: input.connectionId,
      p_mailbox_owner_user_id: input.mailboxOwnerUserId,
      p_provider: input.provider,
      p_provider_message_id_hash: input.providerMessageIdSha256,
      p_source_sha256: input.sourceSha256,
      p_sender_domain: input.senderDomain,
      p_authentication_status: input.authenticationStatus,
      p_dmarc_aligned: input.dmarcAligned,
      p_reply_to_mismatch: input.replyToMismatch,
      p_bank_id: input.bankId ?? null,
    },
  ))

  // This is the only representation of message content that may cross into
  // EVE. The database receives its hash, never the subject or body.
  const prompt = buildBankMailAgentPrompt(input)
  const normalizedInputSha256 = createHash('sha256').update(prompt, 'utf8').digest('hex')
  const claimedRun = parseClaimedRun(await rpc(
    dependencies,
    'claim_bank_mail_agent_run',
    {
      p_intake_id: claimedIntake.intakeId,
      p_model: BANK_MAIL_AGENT_MODEL.id,
      p_prompt_version: BANK_MAIL_AGENT_PROMPT_VERSION,
      p_toolset_version: CRM_AGENT_CAPABILITIES_TOOL_VERSION,
      p_policy_version: BANK_MAIL_MATCH_POLICY_VERSION,
      p_normalized_input_sha256: normalizedInputSha256,
    },
  ))

  if (!claimedRun.shouldDispatch) {
    return {
      intakeId: claimedIntake.intakeId,
      runId: claimedRun.runId,
      state: claimedRun.state,
      dispatched: false,
      replayed: claimedIntake.replayed || claimedRun.sessionId !== null,
      sessionId: claimedRun.sessionId,
    }
  }

  const analysisRunId = claimedRun.runId!
  const leaseToken = claimedRun.leaseToken!
  const claims: BankMailInvocationClaims = {
    serviceId: BANK_MAIL_AGENT_SERVICE_ID,
    preset: BANK_MAIL_AGENT_PRESET,
    organizationId: input.organizationId,
    organizationSlug: input.organizationSlug,
    intakeId: claimedIntake.intakeId,
    analysisRunId,
    connectionId: input.connectionId,
    mailboxOwnerUserId: input.mailboxOwnerUserId,
  }
  const bearerToken = dependencies.signServiceToken(claims)
  if (!bearerToken.trim()) throw new Error('Bank-mail agent service token is empty.')

  const created = await dependencies.createSession({
    serviceUrl: normalizedServiceUrl,
    bearerToken,
    prompt,
  })
  const sessionId = nullableSessionId(created.sessionId)
  if (!sessionId) throw new Error('Bank-mail agent did not return a session id.')

  const bound = record(await rpc(
    dependencies,
    'bind_bank_mail_agent_run_session',
    {
      p_run_id: analysisRunId,
      p_lease_token: leaseToken,
      p_eve_session_id: sessionId,
    },
  ))
  const boundSessionId = nullableSessionId(bound.sessionId)
  if (boundSessionId !== sessionId) {
    throw new Error('Bank-mail agent session binding mismatch.')
  }

  return {
    intakeId: claimedIntake.intakeId,
    runId: analysisRunId,
    state: controlledState(bound.state, 'bound analysis run state'),
    dispatched: true,
    replayed: false,
    sessionId,
  }
}
