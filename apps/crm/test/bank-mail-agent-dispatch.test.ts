import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import {
  BANK_MAIL_AGENT_PRESET,
  BANK_MAIL_AGENT_SERVICE_ID,
  dispatchBankMailAgentWithDependencies,
  normalizeBankMailAgentServiceUrl,
  selectBankMailAgentServiceUrl,
  type BankMailAgentDispatchInput,
  type BankMailAgentDispatcherDependencies,
} from '../server/utils/bank-mail-agent-dispatch-core.ts'

const organizationId = '11111111-1111-4111-8111-111111111111'
const connectionId = '22222222-2222-4222-8222-222222222222'
const ownerUserId = '33333333-3333-4333-8333-333333333333'
const intakeId = '44444444-4444-4444-8444-444444444444'
const runId = '55555555-5555-4555-8555-555555555555'
const bankId = '66666666-6666-4666-8666-666666666666'
const providerMessageIdSha256 = 'a'.repeat(64)
const sourceSha256 = 'b'.repeat(64)
const leaseToken = 'c'.repeat(64)
const threadKeySha256 = 'd'.repeat(64)
const threadReference = 'gmail_thread_safe_123'
const sessionId = 'eve_session_safe_123'

const input: BankMailAgentDispatchInput = {
  organizationId,
  organizationSlug: 'jasne-finanse',
  connectionId,
  mailboxOwnerUserId: ownerUserId,
  provider: 'google',
  providerMessageIdSha256,
  sourceSha256,
  senderDomain: 'decyzje.bank.pl',
  authenticationStatus: 'passed',
  dkimAligned: true,
  dmarcAligned: true,
  replyToMismatch: false,
  bankId,
  threadLink: {
    keySha256: threadKeySha256,
    reference: threadReference,
  },
  subject: 'Decyzja ABC/2026/1234 dla Jan Kowalski',
  bodyText: 'PESEL 90010112345, kontakt ekspert@bank.pl, wniosek ABC/2026/1234',
  bodyTruncated: false,
  attachments: [{
    filename: 'decyzja-90010112345.pdf',
    mimeType: 'application/pdf',
    size: 4_096,
    encrypted: true,
  }],
}

test('claims once, sends only a sanitized prompt, signs exact scope and binds the EVE session', async () => {
  const rpcCalls: Array<{
    name: string
    args: Record<string, unknown>
    context: Parameters<BankMailAgentDispatcherDependencies['rpc']>[2]
  }> = []
  let signedClaims: Record<string, unknown> | undefined
  let createdInput: { serviceUrl: string, bearerToken: string, prompt: string } | undefined
  const dependencies: BankMailAgentDispatcherDependencies = {
    async rpc(name, args, context) {
      rpcCalls.push({ name, args, context })
      if (name === 'claim_bank_mail_agent_intake') {
        return {
          data: { intakeId, state: 'claimed', replayed: false },
          error: null,
        }
      }
      if (name === 'claim_bank_mail_agent_run') {
        return {
          data: {
            runId,
            state: 'claimed',
            shouldDispatch: true,
            leaseToken,
            sessionId: null,
          },
          error: null,
        }
      }
      assert.equal(name, 'bind_bank_mail_agent_run_session')
      return {
        data: { runId, state: 'session_bound', sessionId },
        error: null,
      }
    },
    signServiceToken(claims) {
      signedClaims = claims
      return 'signed-service-token'
    },
    async createSession(created) {
      createdInput = created
      return { sessionId }
    },
  }

  const result = await dispatchBankMailAgentWithDependencies(
    'https://bank-mail-agent.example',
    input,
    dependencies,
  )

  assert.deepEqual(result, {
    intakeId,
    runId,
    state: 'session_bound',
    dispatched: true,
    replayed: false,
    sessionId,
  })
  assert.deepEqual(rpcCalls.map(call => call.name), [
    'claim_bank_mail_agent_intake',
    'claim_bank_mail_agent_run',
    'bind_bank_mail_agent_run_session',
  ])
  assert.deepEqual(rpcCalls[0]?.args, {
    p_organization_id: organizationId,
    p_connection_id: connectionId,
    p_mailbox_owner_user_id: ownerUserId,
    p_provider: 'google',
    p_provider_message_id_hash: providerMessageIdSha256,
    p_source_sha256: sourceSha256,
    p_sender_domain: 'decyzje.bank.pl',
    p_authentication_status: 'passed',
    p_dmarc_aligned: true,
    p_reply_to_mismatch: false,
    p_bank_id: bankId,
  })
  assert.deepEqual(rpcCalls[0]?.context, {
    bankMailIngress: {
      serviceId: BANK_MAIL_AGENT_SERVICE_ID,
      preset: BANK_MAIL_AGENT_PRESET,
      organizationId,
      connectionId,
      mailboxOwnerUserId: ownerUserId,
      provider: 'google',
      dkimAligned: true,
      threadKeySha256,
      threadReference,
    },
  })
  assert.equal(rpcCalls[1]?.context, undefined)
  assert.equal(rpcCalls[2]?.context, undefined)
  assert.deepEqual(signedClaims, {
    serviceId: BANK_MAIL_AGENT_SERVICE_ID,
    preset: BANK_MAIL_AGENT_PRESET,
    organizationId,
    organizationSlug: 'jasne-finanse',
    intakeId,
    analysisRunId: runId,
    connectionId,
    mailboxOwnerUserId: ownerUserId,
  })
  assert.equal(createdInput?.serviceUrl, 'https://bank-mail-agent.example')
  assert.equal(createdInput?.bearerToken, 'signed-service-token')
  assert.doesNotMatch(
    createdInput?.prompt ?? '',
    /90010112345|ekspert@bank\.pl|decyzje\.bank\.pl|aaaaaaaaaaaaaaaa|gmail_thread_safe|dkimAligned/u,
  )
  assert.match(createdInput?.prompt ?? '', /ABC\/2026\/1234/u)

  const normalizedInputSha256 = createHash('sha256')
    .update(createdInput?.prompt ?? '', 'utf8')
    .digest('hex')
  assert.deepEqual(rpcCalls[1]?.args, {
    p_intake_id: intakeId,
    p_model: 'deepseek/deepseek-v4-flash-0731',
    p_prompt_version: 'bank-mail-agent.prompt.v1',
    p_toolset_version: 'crm-agent-capabilities.tools.v1',
    p_policy_version: 'bank-mail-match-policy.v1',
    p_normalized_input_sha256: normalizedInputSha256,
  })
  assert.deepEqual(rpcCalls[2]?.args, {
    p_run_id: runId,
    p_lease_token: leaseToken,
    p_eve_session_id: sessionId,
  })

  const databasePayloads = JSON.stringify(rpcCalls.map(call => call.args))
  assert.doesNotMatch(databasePayloads, /Jan Kowalski|90010112345|ekspert@bank\.pl/u)
  assert.doesNotMatch(JSON.stringify(signedClaims), new RegExp(leaseToken, 'u'))
  assert.doesNotMatch(JSON.stringify(signedClaims), /gmail_thread_safe|dddddddddddddddd/u)
  assert.equal(Object.hasOwn(signedClaims ?? {}, 'dkimAligned'), false)
})

test('replay returns the already-bound session without signing or creating another one', async () => {
  const calls: string[] = []
  let sideEffects = 0
  const result = await dispatchBankMailAgentWithDependencies(
    'http://127.0.0.1:3014',
    input,
    {
      async rpc(name) {
        calls.push(name)
        if (name === 'claim_bank_mail_agent_intake') {
          return { data: { intakeId, state: 'analyzing', replayed: true }, error: null }
        }
        assert.equal(name, 'claim_bank_mail_agent_run')
        return {
          data: {
            runId,
            state: 'session_bound',
            shouldDispatch: false,
            sessionId,
          },
          error: null,
        }
      },
      signServiceToken() {
        sideEffects += 1
        return 'must-not-be-created'
      },
      async createSession() {
        sideEffects += 1
        return { sessionId: 'must_not_exist' }
      },
    },
  )

  assert.deepEqual(calls, [
    'claim_bank_mail_agent_intake',
    'claim_bank_mail_agent_run',
  ])
  assert.equal(sideEffects, 0)
  assert.equal(result.dispatched, false)
  assert.equal(result.replayed, true)
  assert.equal(result.sessionId, sessionId)
})

test('security-rejected intake records a run decision but never receives an EVE token', async () => {
  const calls: string[] = []
  let sideEffects = 0
  const result = await dispatchBankMailAgentWithDependencies(
    'https://bank-mail-agent.example',
    { ...input, authenticationStatus: 'failed', dkimAligned: false, dmarcAligned: false },
    {
      async rpc(name) {
        calls.push(name)
        if (name === 'claim_bank_mail_agent_intake') {
          return {
            data: { intakeId, state: 'security_rejected', replayed: false },
            error: null,
          }
        }
        return {
          data: {
            runId: null,
            state: 'security_rejected',
            shouldDispatch: false,
            sessionId: null,
          },
          error: null,
        }
      },
      signServiceToken() {
        sideEffects += 1
        return 'must-not-be-created'
      },
      async createSession() {
        sideEffects += 1
        return { sessionId: 'must_not_exist' }
      },
    },
  )

  assert.deepEqual(calls, [
    'claim_bank_mail_agent_intake',
    'claim_bank_mail_agent_run',
  ])
  assert.equal(sideEffects, 0)
  assert.equal(result.state, 'security_rejected')
  assert.equal(result.runId, null)
})

test('carries aligned DKIM independently from an aggregate DMARC failure', async () => {
  let claimArgs: Record<string, unknown> | undefined
  let claimContext: Parameters<BankMailAgentDispatcherDependencies['rpc']>[2]
  await dispatchBankMailAgentWithDependencies(
    'https://bank-mail-agent.example',
    {
      ...input,
      authenticationStatus: 'failed',
      dkimAligned: true,
      dmarcAligned: false,
    },
    {
      async rpc(name, args, context) {
        if (name === 'claim_bank_mail_agent_intake') {
          claimArgs = args
          claimContext = context
          return {
            data: { intakeId, state: 'security_rejected', replayed: false },
            error: null,
          }
        }
        return {
          data: {
            runId: null,
            state: 'security_rejected',
            shouldDispatch: false,
            sessionId: null,
          },
          error: null,
        }
      },
      signServiceToken: () => 'must-not-be-created',
      createSession: async () => ({ sessionId: 'must_not_exist' }),
    },
  )

  assert.equal(claimArgs?.p_authentication_status, 'failed')
  assert.equal(claimArgs?.p_dmarc_aligned, false)
  assert.equal(Object.hasOwn(claimArgs ?? {}, 'p_dkim_aligned'), false)
  assert.equal(claimContext?.bankMailIngress?.dkimAligned, true)
})

test('requires pre-hashed provider identity before any RPC call', async () => {
  let rpcCalls = 0
  await assert.rejects(
    dispatchBankMailAgentWithDependencies(
      'https://bank-mail-agent.example',
      { ...input, providerMessageIdSha256: 'raw-provider-message-id' },
      {
        async rpc() {
          rpcCalls += 1
          return { data: null, error: null }
        },
        signServiceToken: () => 'unused',
        createSession: async () => ({ sessionId }),
      },
    ),
    /provider message id SHA-256/u,
  )
  assert.equal(rpcCalls, 0)
})

test('requires a bounded opaque thread reference and stable thread hash before any RPC call', async () => {
  for (const threadLink of [
    { keySha256: 'raw-thread-id', reference: threadReference },
    { keySha256: threadKeySha256, reference: 'thread\nwith-control' },
    { keySha256: threadKeySha256, reference: ' leading-space' },
    { keySha256: threadKeySha256, reference: 'x'.repeat(4_097) },
    { keySha256: threadKeySha256, reference: '' },
  ]) {
    let rpcCalls = 0
    await assert.rejects(
      dispatchBankMailAgentWithDependencies(
        'https://bank-mail-agent.example',
        { ...input, threadLink },
        {
          async rpc() {
            rpcCalls += 1
            return { data: null, error: null }
          },
          signServiceToken: () => 'unused',
          createSession: async () => ({ sessionId }),
        },
      ),
      /thread/u,
    )
    assert.equal(rpcCalls, 0)
  }
})

test('preserves opaque provider thread references with non-control separators', async () => {
  const opaqueReference = 'AQMk:thread/segment+value=='
  let signedReference: string | undefined

  await dispatchBankMailAgentWithDependencies(
    'https://bank-mail-agent.example',
    { ...input, threadLink: { ...input.threadLink, reference: opaqueReference } },
    {
      async rpc(name, _args, context) {
        if (name === 'claim_bank_mail_agent_intake') {
          signedReference = context?.bankMailIngress?.threadReference
          return {
            data: { intakeId, state: 'security_rejected', replayed: false },
            error: null,
          }
        }
        return {
          data: {
            runId: null,
            state: 'security_rejected',
            shouldDispatch: false,
            sessionId: null,
          },
          error: null,
        }
      },
      signServiceToken: () => 'must-not-be-created',
      createSession: async () => ({ sessionId: 'must_not_exist' }),
    },
  )

  assert.equal(signedReference, opaqueReference)
})

test('Gmail ingestion relies on the durable database job instead of timing-dependent polling', async () => {
  const source = await readFile(
    new URL('../server/utils/bank-mail-agent-ingestion.ts', import.meta.url),
    'utf8',
  )
  assert.match(source, /threadLink/u)
  assert.doesNotMatch(source, /get_bank_mail_agent_intake|setTimeout|upsertMailContextThreadLink/u)
})

test('only accepts HTTPS service roots, with loopback HTTP for local development', () => {
  assert.equal(
    normalizeBankMailAgentServiceUrl('https://agent.example/'),
    'https://agent.example',
  )
  assert.equal(
    normalizeBankMailAgentServiceUrl('http://localhost:3014'),
    'http://localhost:3014',
  )
  assert.throws(() => normalizeBankMailAgentServiceUrl('http://agent.example'), /HTTPS/u)
  assert.throws(() => normalizeBankMailAgentServiceUrl('https://agent.example/eve'), /service root/u)
  assert.throws(() => normalizeBankMailAgentServiceUrl('https://user:secret@agent.example'), /credentials/u)
})

test('prefers the private Vercel service binding over a configured fallback', () => {
  assert.equal(
    selectBankMailAgentServiceUrl(
      ' https://internal-bank-mail.example ',
      'https://legacy-bank-mail.example',
    ),
    'https://internal-bank-mail.example',
  )
  assert.equal(
    selectBankMailAgentServiceUrl(undefined, ' http://127.0.0.1:3014 '),
    'http://127.0.0.1:3014',
  )
})
