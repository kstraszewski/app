import assert from 'node:assert/strict'
import test from 'node:test'
import {
  denseMailBodyExcerpt,
  mailAgentCorrespondenceMessages,
  mailAgentMessageMatchesParticipants,
} from '../server/utils/mail-agent-thread-core.ts'
import {
  boundedMailAgentAddress,
  boundedMailAgentText,
  visibleMailAgentMatchedEmails,
} from '../server/utils/mail-agent-dto.ts'
import { withMailMessageBlindRecipients } from '../server/utils/mail-message-blind-recipients.ts'
import {
  mailMessageIsDraft,
  withMailMessageDraftState,
} from '../server/utils/mail-message-draft-state.ts'

const account = 'expert@openexpert.pl'
const client = 'client@example.com'

function address(email: string) {
  return { name: email, email, label: email }
}

test('participant-bound reads keep only exact inbound and outbound correspondence', () => {
  assert.equal(mailAgentMessageMatchesParticipants({
    from: address(client),
    to: [address(account)],
    cc: [],
  }, [client], account), true)
  assert.equal(mailAgentMessageMatchesParticipants({
    from: address('other@example.com'),
    to: [address(account)],
    cc: [],
  }, [client], account), false)
  assert.equal(mailAgentMessageMatchesParticipants({
    from: address(account),
    to: [address(client)],
    cc: [],
  }, [client], account), true)
  assert.equal(mailAgentMessageMatchesParticipants({
    from: address(account),
    to: [address('other@example.com')],
    cc: [address(client.toUpperCase())],
  }, [client], account), true)
  const blindCopy = { ...withMailMessageBlindRecipients({
    from: address(account),
    to: [address('other@example.com')],
    cc: [],
  }, [address(client.toUpperCase())]) }
  assert.equal(mailAgentMessageMatchesParticipants(blindCopy, [client], account), true)
  assert.doesNotMatch(JSON.stringify(blindCopy), /client@example\.com/iu)
  assert.equal(mailAgentMessageMatchesParticipants(withMailMessageBlindRecipients({
    from: address('other@example.com'),
    to: [address(account)],
    cc: [],
  }, [address(client)]), [client], account), false)
  assert.equal(mailAgentMessageMatchesParticipants({
    from: address(account),
    to: [address('other@example.com')],
    cc: [],
  }, [client], account), false)
})

test('draft state survives internal spreads but is absent from JSON and correspondence', () => {
  const sent = { id: 'message-1' }
  const draft = { ...withMailMessageDraftState({ id: 'message-2' }, true) }

  assert.equal(mailMessageIsDraft(draft), true)
  assert.deepEqual(mailAgentCorrespondenceMessages([sent, draft]), [sent])
  assert.equal(JSON.stringify(draft), '{"id":"message-2"}')
})

test('dense body excerpts focus a late matching passage and remain bounded', () => {
  const body = `${'wstęp '.repeat(500)}DECYZJA POZYTYWNA${' koniec'.repeat(500)}`
  const focused = denseMailBodyExcerpt(body, 600, 'jaka jest decyzja')
  assert.equal(focused.text.length, 600)
  assert.ok(focused.start > 0)
  assert.match(focused.text, /DECYZJA POZYTYWNA/u)
  assert.equal(focused.truncated, true)

  assert.deepEqual(denseMailBodyExcerpt('  krótka   treść  ', 100), {
    text: 'krótka treść',
    start: 0,
    truncated: false,
  })
})

test('bounds provider-controlled DTO text and removes display controls', () => {
  assert.equal(boundedMailAgentText(`a\u0000b\u202Ec`, 3), 'abc')
  assert.deepEqual(boundedMailAgentAddress({
    name: `N\u0000${'x'.repeat(600)}`,
    email: 'CLIENT@EXAMPLE.COM',
    label: `Klient\u202E${'y'.repeat(600)}`,
  }), {
    name: `N${'x'.repeat(499)}`,
    email: 'client@example.com',
    label: `Klient${'y'.repeat(494)}`,
  })
})

test('matched email DTOs never disclose hidden BCC-only participants', () => {
  const participants = [
    address('visible@example.com'),
    address('second@example.com'),
  ]

  assert.deepEqual(visibleMailAgentMatchedEmails([
    'VISIBLE@EXAMPLE.COM',
    'hidden-bcc@example.com',
    'visible@example.com',
  ], participants), ['visible@example.com'])
  assert.deepEqual(
    visibleMailAgentMatchedEmails(['hidden-bcc@example.com'], participants),
    [],
  )
})
