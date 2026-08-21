import assert from 'node:assert/strict'
import test from 'node:test'
import type { SessionContext } from 'eve/context'
import {
  BANK_MAIL_AGENT_PRESET,
  BANK_MAIL_AGENT_SERVICE_ID,
  requireInitialBankMailAgentCaller,
  requireBankMailAgentCaller,
  requireReanalysisBankMailAgentCaller,
} from '../agent/lib/caller.ts'

const attributes = {
  serviceId: BANK_MAIL_AGENT_SERVICE_ID,
  preset: BANK_MAIL_AGENT_PRESET,
  organizationId: '11111111-1111-4111-8111-111111111111',
  organizationSlug: 'synthetic-bank-test',
  intakeId: '22222222-2222-4222-8222-222222222222',
  analysisRunId: '55555555-5555-4555-8555-555555555555',
  connectionId: '33333333-3333-4333-8333-333333333333',
  mailboxOwnerUserId: '44444444-4444-4444-8444-444444444444',
}

function principal(overrides: Record<string, unknown> = {}) {
  return {
    authenticator: 'test',
    issuer: 'test',
    principalId: BANK_MAIL_AGENT_SERVICE_ID,
    principalType: 'service',
    subject: attributes.intakeId,
    attributes: { ...attributes, ...overrides },
  }
}

function context(current = principal(), initiator = principal()): SessionContext {
  return {
    session: {
      id: 'session_test',
      auth: { current, initiator },
      turn: { id: 'turn_test', sequence: 0 },
    },
  } as unknown as SessionContext
}

test('returns scope only when current and initiating principals match', () => {
  assert.deepEqual(requireBankMailAgentCaller(context()), {
    mode: 'initial',
    serviceId: BANK_MAIL_AGENT_SERVICE_ID,
    preset: BANK_MAIL_AGENT_PRESET,
    organizationId: attributes.organizationId,
    organizationSlug: attributes.organizationSlug,
    intakeId: attributes.intakeId,
    analysisRunId: attributes.analysisRunId,
    connectionId: attributes.connectionId,
    mailboxOwnerUserId: attributes.mailboxOwnerUserId,
    reanalysisRequestId: null,
  })
})

test('returns immutable reanalysis scope only when request and run ids match', () => {
  const reanalysis = principal({
    serviceId: 'openexpert-crm-bank-mail-reanalysis',
    preset: 'bank-mail-reanalysis',
    reanalysisRequestId: attributes.analysisRunId,
  })
  reanalysis.principalId = 'openexpert-crm-bank-mail-reanalysis'
  assert.deepEqual(requireBankMailAgentCaller(context(reanalysis, reanalysis)), {
    mode: 'reanalysis',
    serviceId: 'openexpert-crm-bank-mail-reanalysis',
    preset: 'bank-mail-reanalysis',
    organizationId: attributes.organizationId,
    organizationSlug: attributes.organizationSlug,
    intakeId: attributes.intakeId,
    analysisRunId: attributes.analysisRunId,
    connectionId: attributes.connectionId,
    mailboxOwnerUserId: attributes.mailboxOwnerUserId,
    reanalysisRequestId: attributes.analysisRunId,
  })
  assert.throws(
    () => requireInitialBankMailAgentCaller(context(reanalysis, reanalysis)),
    /Initial.*scope/u,
  )

  const mismatched = principal({
    serviceId: 'openexpert-crm-bank-mail-reanalysis',
    preset: 'bank-mail-reanalysis',
    reanalysisRequestId: '66666666-6666-4666-8666-666666666666',
  })
  mismatched.principalId = 'openexpert-crm-bank-mail-reanalysis'
  assert.throws(
    () => requireBankMailAgentCaller(context(mismatched, mismatched)),
    /authenticated/u,
  )
})

test('keeps reanalysis-only operations unavailable to an initial caller', () => {
  assert.throws(
    () => requireReanalysisBankMailAgentCaller(context()),
    /reanalysis scope/u,
  )
})

test('rejects retargeting an existing session to a different run', () => {
  assert.throws(
    () => requireBankMailAgentCaller(context(
      principal({ analysisRunId: '66666666-6666-4666-8666-666666666666' }),
      principal(),
    )),
    /immutable/u,
  )
})

test('rejects a generic service principal even with otherwise valid attributes', () => {
  const other = {
    ...principal(),
    principalId: 'another-service',
  }
  assert.throws(
    () => requireBankMailAgentCaller(context(other, other)),
    /authenticated/u,
  )
})
