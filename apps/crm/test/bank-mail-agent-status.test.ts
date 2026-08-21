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
    { messageId: 'message-1', state: 'processing' },
    { messageId: 'message-1-randomized-imap-reference', state: 'processing' },
    { messageId: 'message-2', state: 'review_required' },
  ])
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
})
