import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import {
  bankMailProviderMessageIdentitySha256,
  mapBankMailAgentStatuses,
  parseBankMailAgentStatusRequest,
} from '../server/utils/bank-mail-agent-status-core.ts'

const connectionId = '22222222-2222-4222-8222-222222222222'

test('accepts a bounded status request and removes duplicate message IDs', () => {
  assert.deepEqual(parseBankMailAgentStatusRequest({
    connectionId,
    messageIds: ['message-1', 'message-1', 'message-2'],
  }), {
    connectionId,
    messageIds: ['message-1', 'message-2'],
  })

  assert.throws(
    () => parseBankMailAgentStatusRequest({
      connectionId,
      messageIds: Array.from({ length: 51 }, (_, index) => `message-${index}`),
    }),
    /liczba wiadomości/u,
  )
  assert.throws(
    () => parseBankMailAgentStatusRequest({ connectionId, messageIds: ['message-1'], extra: true }),
    /nieobsługiwane pole/u,
  )
})

test('uses stable provider identities and never hashes randomized IMAP route references', () => {
  assert.equal(
    bankMailProviderMessageIdentitySha256('google', 'gmail-message-1'),
    createHash('sha256').update('gmail-message-1', 'utf8').digest('hex'),
  )
  const imapIdentity = { mailbox: 'INBOX', uidValidity: '12345', uid: 77 }
  assert.equal(
    bankMailProviderMessageIdentitySha256('imap', 'random-envelope-a', imapIdentity),
    bankMailProviderMessageIdentitySha256('imap', 'random-envelope-b', imapIdentity),
  )
})

test('maps only controlled lifecycle states back to requested message IDs', () => {
  const firstHash = 'a'.repeat(64)
  const secondHash = 'b'.repeat(64)
  assert.deepEqual(mapBankMailAgentStatuses([
    { messageId: 'message-1', sha256: firstHash },
    { messageId: 'message-1-randomized-imap-reference', sha256: firstHash },
    { messageId: 'message-2', sha256: secondHash },
  ], [
    { providerMessageIdSha256: firstHash, state: 'processing' },
    { providerMessageIdSha256: secondHash, state: 'review_required' },
    { providerMessageIdSha256: 'c'.repeat(64), state: 'processing' },
    { providerMessageIdSha256: firstHash, state: 'internal-secret-state' },
  ]), [
    {
      messageId: 'message-1',
      state: 'processing',
      result: null,
      link: null,
      context: null,
      reanalysis: {
        state: null,
        attemptNo: 0,
        requestedAt: null,
        completedAt: null,
        canRerun: false,
        retryAfterSeconds: 0,
        result: null,
      },
    },
    {
      messageId: 'message-1-randomized-imap-reference',
      state: 'processing',
      result: null,
      link: null,
      context: null,
      reanalysis: {
        state: null,
        attemptNo: 0,
        requestedAt: null,
        completedAt: null,
        canRerun: false,
        retryAfterSeconds: 0,
        result: null,
      },
    },
    {
      messageId: 'message-2',
      state: 'review_required',
      result: null,
      link: null,
      context: null,
      reanalysis: {
        state: null,
        attemptNo: 0,
        requestedAt: null,
        completedAt: null,
        canRerun: false,
        retryAfterSeconds: 0,
        result: null,
      },
    },
  ])
})

test('maps only controlled EVE results, links and advisory reanalysis fields', () => {
  const hash = 'a'.repeat(64)
  const completedAt = '2026-08-21T12:34:56.000Z'
  assert.deepEqual(mapBankMailAgentStatuses([
    { messageId: 'message-1', sha256: hash },
  ], [{
    providerMessageIdSha256: hash,
    state: 'review_required',
    result: {
      code: 'proposal_created',
      classification: 'strong_candidate',
      evidenceCodes: ['bank_application_reference', 'bank_identity', 'applicant_identity'],
      contradictionCodes: [],
      reasonCodes: ['human_review_required', 'policy_requires_review'],
      completedAt,
      caseId: '11111111-1111-4111-8111-111111111111',
      applicationId: '33333333-3333-4333-8333-333333333333',
    },
    link: {
      state: 'linked',
      resolutionCode: 'strong_proposal_linked',
      caseId: '11111111-1111-4111-8111-111111111111',
    },
    reanalysis: {
      state: 'completed',
      attemptNo: 1,
      requestedAt: '2026-08-21T12:35:00.000Z',
      completedAt: '2026-08-21T12:35:12.000Z',
      canRerun: false,
      retryAfterSeconds: 48,
      result: {
        code: 'no_match',
        classification: null,
        evidenceCodes: [],
        contradictionCodes: [],
        reasonCodes: ['no_candidate'],
        completedAt: '2026-08-21T12:35:12.000Z',
        caseId: null,
        applicationId: null,
      },
    },
  }]), [{
    messageId: 'message-1',
    state: 'review_required',
    result: {
      code: 'proposal_created',
      classification: 'strong_candidate',
      evidenceCodes: ['bank_application_reference', 'bank_identity', 'applicant_identity'],
      contradictionCodes: [],
      reasonCodes: ['human_review_required', 'policy_requires_review'],
      completedAt,
      caseId: '11111111-1111-4111-8111-111111111111',
      applicationId: '33333333-3333-4333-8333-333333333333',
    },
    link: {
      state: 'linked',
      resolutionCode: 'strong_proposal_linked',
      caseId: '11111111-1111-4111-8111-111111111111',
    },
    context: null,
    reanalysis: {
      state: 'completed',
      attemptNo: 1,
      requestedAt: '2026-08-21T12:35:00.000Z',
      completedAt: '2026-08-21T12:35:12.000Z',
      canRerun: false,
      retryAfterSeconds: 48,
      result: {
        code: 'no_match',
        classification: null,
        evidenceCodes: [],
        contradictionCodes: [],
        reasonCodes: ['no_candidate'],
        completedAt: '2026-08-21T12:35:12.000Z',
        caseId: null,
        applicationId: null,
      },
    },
  }])

  const [unsafe] = mapBankMailAgentStatuses([
    { messageId: 'message-1', sha256: hash },
  ], [{
    providerMessageIdSha256: hash,
    state: 'review_required',
    result: {
      code: 'proposal_created',
      classification: 'strong_candidate',
      evidenceCodes: ['mail_body_excerpt'],
      contradictionCodes: [],
      reasonCodes: [],
      completedAt,
      caseId: '11111111-1111-4111-8111-111111111111',
      applicationId: '33333333-3333-4333-8333-333333333333',
    },
  }])
  assert.equal(unsafe?.result, null)
})

test('status RPC is mailbox-scoped and exposes no content-bearing columns', async () => {
  const migration = await readFile(
    new URL('../../../packages/database/postgres/migrations/0063_mail_bank_agent_processing_status.sql', import.meta.url),
    'utf8',
  )
  assert.match(migration, /connection\.owner_user_id = caller_user_id/u)
  assert.match(migration, /private\.is_organization_member\(p_organization_id\)/u)
  assert.match(migration, /TO authenticated, openexpert_owner/u)
  assert.doesNotMatch(migration, /subject|body_text|sender_email|attachment_filename/iu)
})

test('mail workspace shows and actively refreshes the per-message EVE state', async () => {
  const workspace = await readFile(
    new URL('../app/components/mail/MailWorkspace.vue', import.meta.url),
    'utf8',
  )
  assert.match(workspace, /EVE analizuje tę wiadomość/u)
  assert.match(workspace, /i-lucide-loader-circle[^\n]+animate-spin/u)
  assert.match(workspace, /hasActiveAnalysis \? 2_500 : 15_000/u)
  assert.match(workspace, /document\.visibilityState !== 'visible'/u)
})

test('mail workspace keeps manual reply available while blocking parallel quick actions', async () => {
  const workspace = await readFile(
    new URL('../app/components/mail/MailWorkspace.vue', import.meta.url),
    'utf8',
  )
  assert.match(workspace, /const mailQuickActionsBlocked = computed/u)
  assert.match(workspace, /selectedThreadBankMailAgentProcessing\.value/u)
  assert.match(workspace, /selectedThreadBankMailAgentStatusChecking\.value/u)
  assert.match(workspace, /Możesz odpowiedzieć ręcznie/u)
  assert.match(workspace, /class="mail-detail__action mail-detail__action--reply"\s+icon="i-lucide-reply"\s+title="Odpowiedz ręcznie"\s+@click="openReply"/u)
  assert.match(workspace, /:disabled="mailQuickActionsBlocked"/u)
  assert.match(workspace, /:disabled="agentMailReplyPending \|\| mailQuickActionsBlocked"/u)
  assert.match(workspace, /:disabled="contextLinking \|\| mailQuickActionsBlocked"/u)
  assert.doesNotMatch(
    workspace,
    /function openReplyForThread[\s\S]{0,160}mailQuickActionsBlocked/u,
  )
  const canonicalProcessingBlock = workspace.match(
    /const selectedThreadBankMailAgentProcessing = computed\([\s\S]*?\n\)\)/u,
  )?.[0] ?? ''
  assert.match(canonicalProcessingBlock, /bankMailAgentStatus\(message\.id\)\?\.state === 'processing'/u)
  assert.doesNotMatch(canonicalProcessingBlock, /reanalysis|Reanalysis/u)
})

test('mail message shows Eve answer, rerun action and linked case/client chips', async () => {
  const [workspace, panel] = await Promise.all([
    readFile(new URL('../app/components/mail/MailWorkspace.vue', import.meta.url), 'utf8'),
    readFile(new URL('../app/components/mail/MailEveAnalysisPanel.vue', import.meta.url), 'utf8'),
  ])
  assert.match(workspace, /<MailEveAnalysisPanel/u)
  assert.match(workspace, /@reanalyze="reanalyzeBankMailMessage"/u)
  assert.match(panel, />Odpowiedź Eve</u)
  assert.match(panel, /Przeanalizuj ponownie/u)
  assert.match(panel, />Powiązania</u)
  assert.match(panel, /orgPath\(`\/cases\/\$\{context\.case\.id\}`\)/u)
  assert.match(panel, /orgPath\(`\/clients\/\$\{client\.id\}`\)/u)
  assert.match(panel, /reanalysisCaseConflict/u)
  assert.match(panel, /Eve nie zmieniła istniejącego powiązania/u)
  assert.match(panel, /linkedCase\?\.id === result\.caseId/u)
})
