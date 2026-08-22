import assert from 'node:assert/strict'
import test from 'node:test'
import {
  denseMailBodyExcerpt,
  mailAgentMessageMatchesParticipants,
} from '../server/utils/mail-agent-thread-core.ts'

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
  assert.equal(mailAgentMessageMatchesParticipants({
    from: address(account),
    to: [address('other@example.com')],
    cc: [],
  }, [client], account), false)
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
