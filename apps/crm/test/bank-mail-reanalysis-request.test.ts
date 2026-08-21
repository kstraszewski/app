import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import {
  parseBankMailReanalysisOperation,
  parseBankMailReanalysisRequest,
  publicBankMailReanalysisState,
} from '../server/utils/bank-mail-reanalysis-request-core.ts'

const connectionId = '22222222-2222-4222-8222-222222222222'

test('accepts only exact Gmail references for a bank-mail reanalysis request', () => {
  assert.deepEqual(parseBankMailReanalysisRequest({
    connectionId,
    threadId: '18cafe_Bank-Thread',
    messageId: '18cafe_Message-1',
  }), {
    connectionId,
    threadId: '18cafe_Bank-Thread',
    messageId: '18cafe_Message-1',
  })

  assert.throws(
    () => parseBankMailReanalysisRequest({
      connectionId,
      threadId: '18cafe_Bank-Thread',
      messageId: '18cafe_Message-1',
      caseId: '11111111-1111-4111-8111-111111111111',
    }),
    /nieobsługiwane pole/u,
  )
  assert.throws(
    () => parseBankMailReanalysisRequest({
      connectionId,
      threadId: 'thread/../../case',
      messageId: 'message-1',
    }),
    /identyfikator wątku/u,
  )
  assert.throws(
    () => parseBankMailReanalysisRequest({
      connectionId,
      threadId: 'thread-1',
      messageId: 'message\n2',
    }),
    /identyfikator wiadomości/u,
  )
})

test('reanalysis endpoint rebuilds trusted input from the owned Gmail message', async () => {
  const endpoint = await readFile(
    new URL('../server/api/org/[organizationSlug]/mail/agent-reanalysis.post.ts', import.meta.url),
    'utf8',
  )
  const parser = await readFile(
    new URL('../server/utils/bank-mail-reanalysis-request-core.ts', import.meta.url),
    'utf8',
  )

  assert.match(endpoint, /requireSameOriginMailRequest\(event\)/u)
  assert.match(endpoint, /requireCrmSession\(event\)/u)
  assert.match(endpoint, /requireUserMailConnection\(/u)
  assert.match(endpoint, /connection\.provider !== 'google'/u)
  assert.match(endpoint, /fetchGmailThread\(/u)
  assert.match(endpoint, /gmailBankMailMessageDispatchInput\(event/u)
  assert.match(endpoint, /p_provider_message_id_hash: dispatchInput\.providerMessageIdSha256/u)
  assert.match(endpoint, /p_source_sha256: dispatchInput\.sourceSha256/u)
  assert.match(endpoint, /dispatchBankMailReanalysis\(event/u)
  assert.match(parser, /new Set\(\['connectionId', 'threadId', 'messageId'\]\)/u)
  const inputParserStart = parser.indexOf('export function parseBankMailReanalysisRequest')
  const operationParserStart = parser.indexOf('export function parseBankMailReanalysisOperation')
  const browserInputParser = parser.slice(inputParserStart, operationParserStart)
  assert.doesNotMatch(browserInputParser, /caseId|intakeId|reanalysisRequestId/u)
})

test('maps only a controlled reanalysis operation back to the browser lifecycle', () => {
  const operation = parseBankMailReanalysisOperation({
    requestId: '11111111-1111-4111-8111-111111111111',
    intakeId: '33333333-3333-4333-8333-333333333333',
    state: 'queued',
    attemptNo: 2,
    accepted: true,
    shouldDispatch: true,
    retryAfterSeconds: 60,
    replayed: false,
    canRequest: false,
  })
  assert.equal(publicBankMailReanalysisState(operation.state), 'processing')
  assert.equal(publicBankMailReanalysisState('session_bound'), 'processing')
  assert.equal(publicBankMailReanalysisState('completed'), 'completed')
  assert.equal(publicBankMailReanalysisState('failed'), 'failed')

  assert.throws(() => parseBankMailReanalysisOperation({
    ...operation,
    requestId: 'not-a-uuid',
  }), /Nieprawidłowa odpowiedź/u)
  assert.throws(() => parseBankMailReanalysisOperation({
    ...operation,
    state: 'canonical_mutation_pending',
  }), /Nieprawidłowa odpowiedź/u)
  assert.throws(() => parseBankMailReanalysisOperation({
    ...operation,
    accepted: true,
    replayed: true,
  }), /Nieprawidłowa odpowiedź/u)
  assert.throws(() => parseBankMailReanalysisOperation({
    ...operation,
    state: 'completed',
    shouldDispatch: true,
  }), /Nieprawidłowa odpowiedź/u)
  assert.throws(() => parseBankMailReanalysisOperation({
    ...operation,
    accepted: 'true',
  }), /Nieprawidłowa odpowiedź/u)
})
