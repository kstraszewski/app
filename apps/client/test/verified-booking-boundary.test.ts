import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const endpointUrl = new URL(
  '../server/api/client/booking/widgets/[widgetKey].post.ts',
  import.meta.url,
)
const migrationUrl = new URL(
  '../../../packages/database/postgres/migrations/0046_verified_portal_booking.sql',
  import.meta.url,
)
const bookingPageUrl = new URL('../app/pages/book/[widgetKey].vue', import.meta.url)

test('final booking is protected by the verified client identity boundary', async () => {
  const source = await readFile(endpointUrl, 'utf8')
  assert.match(source, /requireAvailablePortalIdentity\(event\)/u)
  assert.match(source, /create_verified_portal_booking/u)
  assert.doesNotMatch(source, /body\.customerEmail|body\.customer_email/u)
  assert.doesNotMatch(source, /rpc\(['"]create_widget_booking/u)
})

test('database atomically derives the email and links the booked CRM person', async () => {
  const source = await readFile(migrationUrl, 'utf8')
  assert.match(source, /FROM identity\.users AS auth_user/u)
  assert.match(source, /auth_user\.email_verified = true/u)
  assert.match(source, /booking_result := public\.create_widget_booking/u)
  assert.match(source, /INSERT INTO public\.client_account_links/u)
  assert.match(source, /'identityVerification', 'verified_email_account'/u)
  assert.match(source, /GRANT EXECUTE ON FUNCTION public\.create_verified_portal_booking[\s\S]+TO openexpert_service/u)
  assert.match(source, /REVOKE ALL ON FUNCTION public\.create_verified_portal_booking[\s\S]+FROM PUBLIC, anonymous, authenticated, openexpert_service/u)
})

test('booking UI confirms the account before using the protected mutation', async () => {
  const source = await readFile(bookingPageUrl, 'utf8')
  assert.match(source, /\/api\/auth\/booking-magic-link/u)
  assert.match(source, /\/api\/client\/booking\/widgets/u)
  assert.doesNotMatch(source, /\/api\/booking\/widgets\/\$\{[^}]+\}\/booking/u)
})
