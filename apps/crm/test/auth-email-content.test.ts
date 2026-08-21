import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import {
  authEmailDefinition,
  emailContent,
  type AuthEmailRenderer,
} from '../server/utils/auth-email-content.ts'

const TEST_URL = 'https://crm.openexpert.app/api/organization-auth/magic-link/verify?token=test-token&callbackURL=%2Fregister'
const TEMPLATE_SOURCE = readFileSync(
  new URL('../app/emails/AuthTransactionalEmail.vue', import.meta.url),
  'utf8',
)
const RENDERER_SOURCE = readFileSync(
  new URL('../server/utils/auth-email-content.ts', import.meta.url),
  'utf8',
)

test('self-service registration definition contains the plan summary and focused action', () => {
  const definition = authEmailDefinition('magic-link', TEST_URL, {
    organizationInvitation: true,
    onboardingSource: 'self_service',
    organizationName: 'Kancelaria Kowalski',
    billingPlan: 'individual',
    initialSeatCount: 1,
  })

  assert.equal(definition.subject, 'Dokończ rejestrację organizacji w OpenExpert')
  assert.equal(definition.props.title, 'Dokończ rejestrację')
  assert.equal(definition.props.actionLabel, 'Potwierdź e-mail i kontynuuj')
  assert.deepEqual(definition.props.details, [
    { label: 'Organizacja', value: 'Kancelaria Kowalski' },
    { label: 'Plan', value: 'Indywidualny' },
    { label: 'Dostęp', value: '1 użytkownik' },
  ])
  assert.match(definition.props.notice?.text ?? '', /Stripe Checkout/u)
  assert.match(definition.props.messageReference, /^OE-[A-F0-9]{8}$/u)
})

test('every authentication email variant maps to the shared typed template', () => {
  const definitions = [
    authEmailDefinition('password-reset', TEST_URL),
    authEmailDefinition('email-verification', TEST_URL),
    authEmailDefinition('magic-link', TEST_URL),
    authEmailDefinition('magic-link', TEST_URL, {
      organizationMemberInvitation: true,
      organizationName: 'Zespół Północ',
      role: 'admin',
    }),
    authEmailDefinition('magic-link', TEST_URL, {
      organizationInvitation: true,
      organizationName: 'Zespół Południe',
      billingDiscountLabel: 'Partner 20%',
    }),
    authEmailDefinition('magic-link', TEST_URL, { clientPortalInvitation: true }),
    authEmailDefinition('magic-link', TEST_URL, { clientPortalBookingActivation: true }),
  ]

  for (const definition of definitions) {
    assert.ok(definition.subject)
    assert.equal(definition.props.subject, definition.subject)
    assert.equal(definition.props.url, TEST_URL)
    assert.ok(definition.props.preheader.length <= 90)
    assert.ok(definition.props.securityText)
  }
})

test('nuxt-email-renderer produces HTML and plain text from the same props', async () => {
  const calls: Array<{
    componentName: string
    props: Record<string, unknown>
    plainText: boolean
    tables?: string[]
  }> = []
  const renderer: AuthEmailRenderer = async (componentName, props, options) => {
    calls.push({
      componentName,
      props,
      plainText: options?.plainText === true,
      tables: options?.htmlToTextOptions?.tables,
    })
    const subject = String(props.subject)
    return options?.plainText
      ? { html: `${String(props.title)}\n${String(props.url)}`, subject }
      : { html: `<!DOCTYPE html><html lang="pl"><h1>${String(props.title)}</h1></html>`, subject }
  }

  const content = await emailContent('magic-link', TEST_URL, undefined, renderer)

  assert.equal(content.subject, 'Twój link logowania do OpenExpert')
  assert.match(content.html, /<h1>Zaloguj się do OpenExpert<\/h1>/u)
  assert.ok(content.text.includes(TEST_URL))
  assert.deepEqual(calls.map(call => call.componentName), [
    'AuthTransactionalEmail',
    'AuthTransactionalEmail',
  ])
  assert.deepEqual(calls.map(call => call.plainText), [false, true])
  assert.deepEqual(calls[1]?.tables, ['.oe-details'])
  assert.strictEqual(calls[0]?.props, calls[1]?.props)
})

test('renderer subject drift is rejected before sending', async () => {
  const renderer: AuthEmailRenderer = async () => ({
    html: '<html></html>',
    subject: 'Nieoczekiwany temat',
  })

  await assert.rejects(
    emailContent('email-verification', TEST_URL, undefined, renderer),
    /subject does not match/u,
  )
})

test('production auth renderer is resolved explicitly instead of relying on a Nitro auto-import', () => {
  assert.match(RENDERER_SOURCE, /await import\('#openexpert\/email-renderer'\)/u)
  assert.match(RENDERER_SOURCE, /renderer \?\? defaultAuthEmailRenderer/u)
  assert.doesNotMatch(
    RENDERER_SOURCE,
    /renderer \?\? \(renderEmailComponent as AuthEmailRenderer\)/u,
  )
})

test('renewed links receive different visible references', () => {
  const first = authEmailDefinition('magic-link', `${TEST_URL}-one`)
  const second = authEmailDefinition('magic-link', `${TEST_URL}-two`)

  assert.notEqual(first.props.messageReference, second.props.messageReference)
})

test('Vue SFC uses nuxt-email-renderer components and accessible email semantics', () => {
  assert.match(TEMPLATE_SOURCE, /<EHtml\s[\s\S]*lang="pl"[\s\S]*dir="ltr"/u)
  assert.match(TEMPLATE_SOURCE, /<EHead>/u)
  assert.match(TEMPLATE_SOURCE, /<ESubject>/u)
  assert.match(TEMPLATE_SOURCE, /<EPreview id="__vue-email-preview">/u)
  assert.match(TEMPLATE_SOURCE, /<EContainer/u)
  assert.match(TEMPLATE_SOURCE, /<EButton/u)
  assert.match(TEMPLATE_SOURCE, /<EHeading/u)
  assert.match(TEMPLATE_SOURCE, /<body[^>]*>\s*<div\s+[\s\S]*lang="pl"[\s\S]*dir="ltr"/u)
  assert.doesNotMatch(TEMPLATE_SOURCE, /v-html/u)
  for (const [table] of TEMPLATE_SOURCE.matchAll(/<table\b[^>]*>/gu)) {
    assert.match(table, /role="presentation"/u)
  }
})
