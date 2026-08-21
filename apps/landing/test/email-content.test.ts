import assert from 'node:assert/strict'
import test from 'node:test'

import { landingAuthEmailDefinition, renderLandingAuthEmail } from '../server/utils/auth-email-content.ts'
import { renderWaitlistConfirmationEmail } from '../server/utils/waitlist-email-content.ts'

test('landing auth emails are specific and include a short-lived security notice', () => {
  const email = landingAuthEmailDefinition('password-reset', 'https://www.example.test/token')
  assert.equal(email.actionLabel, 'Ustaw nowe hasło')
  assert.match(email.notice?.title ?? '', /1 godzinę/u)
})

test('waitlist confirmation uses the Vue renderer for HTML and plain text', async () => {
  const calls: Array<{ component: string, plainText: boolean }> = []
  const email = await renderWaitlistConfirmationEmail('https://www.openexpert.app', async (component, props, options) => {
    calls.push({ component, plainText: options?.plainText === true })
    return { html: options?.plainText ? 'plain' : '<html></html>', subject: String(props.subject) }
  })

  assert.equal(email.subject, 'Twój start z OpenExpert')
  assert.deepEqual(calls, [
    { component: 'WaitlistConfirmationEmail', plainText: false },
    { component: 'WaitlistConfirmationEmail', plainText: true },
  ])
})

test('landing access email renders both alternatives from the same props', async () => {
  const calls: Record<string, unknown>[] = []
  await renderLandingAuthEmail('magic-link', 'https://www.example.test/token', async (_component, props, options) => {
    calls.push({ props, plainText: options?.plainText === true })
    return { html: 'content', subject: String(props.subject) }
  })
  assert.strictEqual((calls[0] as { props: unknown }).props, (calls[1] as { props: unknown }).props)
})
