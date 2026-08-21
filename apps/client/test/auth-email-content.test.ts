import assert from 'node:assert/strict'
import test from 'node:test'

import { clientAuthEmailDefinition, renderClientAuthEmail } from '../server/utils/auth-email-content.ts'

test('client booking and access emails have focused copy and a one-hour notice', () => {
  const booking = clientAuthEmailDefinition('magic-link', 'https://client.example.test/token', { clientPortalBooking: true })
  const login = clientAuthEmailDefinition('magic-link', 'https://client.example.test/token')

  assert.equal(booking.actionLabel, 'Potwierdź konto i kontynuuj')
  assert.match(booking.notice?.title ?? '', /1 godzinę/u)
  assert.equal(login.productLabel, 'Panel klienta')
})

test('client access email renders HTML and plain text from identical props', async () => {
  const calls: Array<{ plainText: boolean, props: Record<string, unknown> }> = []
  const result = await renderClientAuthEmail('password-reset', 'https://client.example.test/token', undefined, async (_component, props, options) => {
    calls.push({ plainText: options?.plainText === true, props })
    return { html: options?.plainText ? 'plain' : '<html></html>', subject: String(props.subject) }
  })

  assert.equal(result.subject, 'Ustaw nowe hasło w panelu OpenExpert')
  assert.deepEqual(calls.map(call => call.plainText), [false, true])
  assert.strictEqual(calls[0]?.props, calls[1]?.props)
})
