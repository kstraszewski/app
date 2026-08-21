import assert from 'node:assert/strict'
import test from 'node:test'
import {
  BANK_MAIL_REANALYSIS_CLAIM_SOURCE,
  BANK_MAIL_REANALYSIS_CRM_SERVICE_ID,
  BANK_MAIL_REANALYSIS_FAILURE_SOURCE,
  BANK_MAIL_REANALYSIS_POLICY_VERSION,
  BANK_MAIL_REANALYSIS_PRESET,
  BANK_MAIL_REANALYSIS_PROMPT_VERSION,
  bankMailReanalysisNormalizedInputSha256,
  dispatchBankMailReanalysisWithDependencies,
  type BankMailReanalysisDispatchInput,
  type BankMailReanalysisDispatcherDependencies,
} from '../server/utils/bank-mail-reanalysis-dispatch-core.ts'

const requestId = '11111111-1111-4111-8111-111111111111'
const intakeId = '22222222-2222-4222-8222-222222222222'
const organizationId = '33333333-3333-4333-8333-333333333333'
const connectionId = '44444444-4444-4444-8444-444444444444'
const ownerUserId = '55555555-5555-4555-8555-555555555555'
const leaseToken = 'a'.repeat(64)
const sessionId = 'eve_reanalysis_session_123'

const input: BankMailReanalysisDispatchInput = {
  reanalysisRequestId: requestId,
  intakeId,
  organizationId,
  organizationSlug: 'jasne-finanse',
  connectionId,
  mailboxOwnerUserId: ownerUserId,
  subject: 'Ponowna ocena ABC/2026/1234',
  bodyText: 'PESEL 90010112345, wniosek ABC/2026/1234',
  bodyTruncated: false,
  attachments: [],
}

test('claims, creates and binds one separate advisory reanalysis session', async () => {
  const rpcCalls: Array<{
    name: string
    args: Record<string, unknown>
    context: Parameters<BankMailReanalysisDispatcherDependencies['rpc']>[2]
  }> = []
  let invocationClaims: Record<string, unknown> | undefined
  let createdPrompt = ''
  const result = await dispatchBankMailReanalysisWithDependencies(
    'https://bank-mail-agent.example',
    input,
    {
      async rpc(name, args, context) {
        rpcCalls.push({ name, args, context })
        if (name === 'claim_bank_mail_agent_reanalysis') {
          return {
            data: {
              reanalysisRequestId: requestId,
              state: 'leased',
              shouldDispatch: true,
              leaseToken,
              sessionId: null,
              replayed: false,
            },
            error: null,
          }
        }
        assert.equal(name, 'bind_bank_mail_agent_reanalysis_session')
        return {
          data: {
            reanalysisRequestId: requestId,
            state: 'session_bound',
            sessionId,
            replayed: false,
          },
          error: null,
        }
      },
      signServiceToken(claims) {
        invocationClaims = claims
        return 'signed-reanalysis-token'
      },
      async createSession(created) {
        createdPrompt = created.prompt
        assert.equal(created.serviceUrl, 'https://bank-mail-agent.example')
        assert.equal(created.bearerToken, 'signed-reanalysis-token')
        return { sessionId }
      },
    },
  )

  assert.deepEqual(result, {
    reanalysisRequestId: requestId,
    intakeId,
    state: 'session_bound',
    dispatched: true,
    replayed: false,
    sessionId,
  })
  assert.deepEqual(rpcCalls.map(call => call.name), [
    'claim_bank_mail_agent_reanalysis',
    'bind_bank_mail_agent_reanalysis_session',
  ])
  assert.equal(rpcCalls.some(call => call.name === 'bind_bank_mail_agent_run_session'), false)
  assert.match(createdPrompt, /"surface":"bank-mail-reanalysis"/u)
  assert.match(createdPrompt, /"advisoryOnly":true/u)
  assert.doesNotMatch(createdPrompt, /90010112345|reanalysisRequestId|intakeId/u)

  const normalizedInputSha256 = bankMailReanalysisNormalizedInputSha256(
    requestId,
    createdPrompt,
  )
  const claimArgs = {
    p_reanalysis_request_id: requestId,
    p_model: 'deepseek/deepseek-v4-flash-0731',
    p_prompt_version: BANK_MAIL_REANALYSIS_PROMPT_VERSION,
    p_toolset_version: 'crm-agent-capabilities.tools.v1',
    p_policy_version: BANK_MAIL_REANALYSIS_POLICY_VERSION,
    p_normalized_input_sha256: normalizedInputSha256,
  }
  assert.deepEqual(rpcCalls[0]?.args, claimArgs)
  assert.deepEqual(rpcCalls[0]?.context?.scopedClaims, {
    source: BANK_MAIL_REANALYSIS_CLAIM_SOURCE,
    serviceId: BANK_MAIL_REANALYSIS_CRM_SERVICE_ID,
    preset: BANK_MAIL_REANALYSIS_PRESET,
    organizationId,
    reanalysisRequestId: requestId,
    intakeId,
    connectionId,
    mailboxOwnerUserId: ownerUserId,
    model: claimArgs.p_model,
    promptVersion: claimArgs.p_prompt_version,
    toolsetVersion: claimArgs.p_toolset_version,
    policyVersion: claimArgs.p_policy_version,
    normalizedInputSha256,
  })
  assert.deepEqual(rpcCalls[1]?.args, {
    p_reanalysis_request_id: requestId,
    p_lease_token: leaseToken,
    p_eve_session_id: sessionId,
  })
  assert.equal(rpcCalls[1]?.context, undefined)
  assert.deepEqual(invocationClaims, {
    serviceId: BANK_MAIL_REANALYSIS_CRM_SERVICE_ID,
    preset: BANK_MAIL_REANALYSIS_PRESET,
    organizationId,
    reanalysisRequestId: requestId,
    intakeId,
    connectionId,
    mailboxOwnerUserId: ownerUserId,
    organizationSlug: 'jasne-finanse',
    analysisRunId: requestId,
  })
})

test('replays an existing reanalysis session without a token or model call', async () => {
  let sideEffects = 0
  const result = await dispatchBankMailReanalysisWithDependencies(
    'https://bank-mail-agent.example',
    input,
    {
      async rpc(name) {
        assert.equal(name, 'claim_bank_mail_agent_reanalysis')
        return {
          data: {
            reanalysisRequestId: requestId,
            state: 'session_bound',
            shouldDispatch: false,
            leaseToken: null,
            sessionId,
            replayed: true,
          },
          error: null,
        }
      },
      signServiceToken() {
        sideEffects += 1
        return 'must-not-exist'
      },
      async createSession() {
        sideEffects += 1
        return { sessionId: 'must_not_exist' }
      },
    },
  )

  assert.equal(sideEffects, 0)
  assert.equal(result.dispatched, false)
  assert.equal(result.replayed, true)
  assert.equal(result.sessionId, sessionId)
})

test('recovers an expired lease and dispatches with the newly elected lease', async () => {
  const recoveredLeaseToken = 'b'.repeat(64)
  const calls: string[] = []
  const result = await dispatchBankMailReanalysisWithDependencies(
    'https://bank-mail-agent.example',
    input,
    {
      async rpc(name, args) {
        calls.push(name)
        if (name === 'claim_bank_mail_agent_reanalysis') {
          return {
            data: {
              reanalysisRequestId: requestId,
              state: 'leased',
              shouldDispatch: true,
              leaseToken: recoveredLeaseToken,
              sessionId: null,
              replayed: true,
            },
            error: null,
          }
        }
        assert.equal(name, 'bind_bank_mail_agent_reanalysis_session')
        assert.equal(args.p_lease_token, recoveredLeaseToken)
        return {
          data: {
            reanalysisRequestId: requestId,
            state: 'session_bound',
            sessionId,
            replayed: false,
          },
          error: null,
        }
      },
      signServiceToken: () => 'signed-recovery-token',
      createSession: async () => ({ sessionId }),
    },
  )

  assert.deepEqual(calls, [
    'claim_bank_mail_agent_reanalysis',
    'bind_bank_mail_agent_reanalysis_session',
  ])
  assert.equal(result.dispatched, true)
  assert.equal(result.replayed, true)
  assert.equal(result.sessionId, sessionId)
})

test('fails closed when claim dispatch flags are not exact booleans', async () => {
  let created = false
  await assert.rejects(
    dispatchBankMailReanalysisWithDependencies(
      'https://bank-mail-agent.example',
      input,
      {
        async rpc() {
          return {
            data: {
              reanalysisRequestId: requestId,
              state: 'leased',
              shouldDispatch: 'true',
              leaseToken,
              sessionId: null,
              replayed: false,
            },
            error: null,
          }
        },
        signServiceToken: () => 'unused',
        async createSession() {
          created = true
          return { sessionId }
        },
      },
    ),
    /dispatch flags/u,
  )
  assert.equal(created, false)
})

test('binds the normalized hash to the request id', () => {
  const prompt = '{"surface":"bank-mail-reanalysis"}'
  assert.notEqual(
    bankMailReanalysisNormalizedInputSha256(requestId, prompt),
    bankMailReanalysisNormalizedInputSha256(
      '66666666-6666-4666-8666-666666666666',
      prompt,
    ),
  )
})

test('fails closed on claim scope mismatch before creating a session', async () => {
  let created = false
  await assert.rejects(
    dispatchBankMailReanalysisWithDependencies(
      'https://bank-mail-agent.example',
      input,
      {
        async rpc() {
          return {
            data: {
              reanalysisRequestId: '66666666-6666-4666-8666-666666666666',
              state: 'leased',
              shouldDispatch: true,
              leaseToken,
              sessionId: null,
              replayed: false,
            },
            error: null,
          }
        },
        signServiceToken: () => 'unused',
        async createSession() {
          created = true
          return { sessionId }
        },
      },
    ),
    /scope mismatch/u,
  )
  assert.equal(created, false)
})

test('does not terminalize a request when claiming it is rejected', async () => {
  const calls: string[] = []
  await assert.rejects(
    dispatchBankMailReanalysisWithDependencies(
      'https://bank-mail-agent.example',
      input,
      {
        async rpc(name) {
          calls.push(name)
          return {
            data: null,
            error: { code: 'claim_replay_conflict' },
          }
        },
        signServiceToken: () => 'unused',
        async createSession() {
          throw new Error('must not create a session')
        },
      },
    ),
    /claim_replay_conflict/u,
  )
  assert.deepEqual(calls, ['claim_bank_mail_agent_reanalysis'])
})

test('records a scoped dispatch failure when session creation fails', async () => {
  const calls: Array<{
    name: string
    args: Record<string, unknown>
    context: Parameters<BankMailReanalysisDispatcherDependencies['rpc']>[2]
  }> = []
  await assert.rejects(
    dispatchBankMailReanalysisWithDependencies(
      'https://bank-mail-agent.example',
      input,
      {
        async rpc(name, args, context) {
          calls.push({ name, args, context })
          if (name === 'claim_bank_mail_agent_reanalysis') {
            return {
              data: {
                reanalysisRequestId: requestId,
                state: 'leased',
                shouldDispatch: true,
                leaseToken,
                sessionId: null,
                replayed: false,
              },
              error: null,
            }
          }
          assert.equal(name, 'fail_bank_mail_agent_reanalysis')
          return {
            data: {
              reanalysisRequestId: requestId,
              state: 'failed',
              failureCode: 'dispatch_failed',
              completedAt: '2026-08-21T20:00:00.000Z',
              replayed: false,
            },
            error: null,
          }
        },
        signServiceToken: () => 'signed-reanalysis-token',
        async createSession() {
          throw new Error('synthetic create failure')
        },
      },
    ),
    /synthetic create failure/u,
  )

  assert.deepEqual(calls.map(call => call.name), [
    'claim_bank_mail_agent_reanalysis',
    'fail_bank_mail_agent_reanalysis',
  ])
  assert.deepEqual(calls[1]?.args, {
    p_reanalysis_request_id: requestId,
    p_failure_code: 'dispatch_failed',
  })
  assert.deepEqual(calls[1]?.context?.scopedClaims, {
    source: BANK_MAIL_REANALYSIS_FAILURE_SOURCE,
    serviceId: BANK_MAIL_REANALYSIS_CRM_SERVICE_ID,
    preset: BANK_MAIL_REANALYSIS_PRESET,
    organizationId,
    reanalysisRequestId: requestId,
    intakeId,
    connectionId,
    mailboxOwnerUserId: ownerUserId,
    failureCode: 'dispatch_failed',
  })
})

test('fails and records failure when the bind response targets another session', async () => {
  const calls: string[] = []
  await assert.rejects(
    dispatchBankMailReanalysisWithDependencies(
      'https://bank-mail-agent.example',
      input,
      {
        async rpc(name) {
          calls.push(name)
          if (name === 'claim_bank_mail_agent_reanalysis') {
            return {
              data: {
                reanalysisRequestId: requestId,
                state: 'leased',
                shouldDispatch: true,
                leaseToken,
                sessionId: null,
                replayed: false,
              },
              error: null,
            }
          }
          if (name === 'bind_bank_mail_agent_reanalysis_session') {
            return {
              data: {
                reanalysisRequestId: requestId,
                state: 'session_bound',
                sessionId: 'eve_other_session_123',
                replayed: false,
              },
              error: null,
            }
          }
          return { data: { state: 'failed' }, error: null }
        },
        signServiceToken: () => 'signed-reanalysis-token',
        createSession: async () => ({ sessionId }),
      },
    ),
    /binding mismatch/u,
  )
  assert.deepEqual(calls, [
    'claim_bank_mail_agent_reanalysis',
    'bind_bank_mail_agent_reanalysis_session',
    'fail_bank_mail_agent_reanalysis',
  ])
})
