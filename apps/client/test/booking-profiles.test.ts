import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import {
  bookingProfilesForOrganization,
  type BookingProfileLink,
} from '../server/utils/booking-profiles.ts'

const profilesEndpointUrl = new URL(
  '../server/api/client/booking/widgets/[widgetKey]/profiles.get.ts',
  import.meta.url,
)
const bookingEndpointUrl = new URL(
  '../server/api/client/booking/widgets/[widgetKey].post.ts',
  import.meta.url,
)
const bookingPageUrl = new URL('../app/pages/book/[widgetKey].vue', import.meta.url)

function profileLink(
  organizationId: string,
  clientPersonId: string,
  phone: string | null,
): BookingProfileLink {
  return {
    organizationId,
    clientPersonId,
    person: {
      displayName: `Klient ${clientPersonId}`,
      role: 'client',
      phone,
    },
  }
}

test('booking profiles are limited to the active widget organization', () => {
  const linkWithPrivateIdentity = {
    ...profileLink('org-a', 'person-a', '+48 500 100 100'),
    verifiedEmail: 'client@example.com',
  }
  const profiles = bookingProfilesForOrganization([
    linkWithPrivateIdentity,
    profileLink('org-b', 'person-b', '+48 500 200 200'),
  ], 'org-a')

  assert.deepEqual(profiles, [{
    clientPersonId: 'person-a',
    displayName: 'Klient person-a',
    role: 'client',
    phone: '+48 500 100 100',
  }])
  assert.equal('email' in profiles[0]!, false)
  assert.equal('verifiedEmail' in profiles[0]!, false)
})

test('profiles endpoint resolves the active widget tenant before projecting links', async () => {
  const source = await readFile(profilesEndpointUrl, 'utf8')

  assert.match(source, /loadClientPortalSession\(event\)/u)
  assert.match(source, /\.eq\('public_token', widgetKey\)/u)
  assert.match(source, /\.eq\('is_active', true\)/u)
  assert.match(source, /bookingProfilesForOrganization\([\s\S]*session\.links[\s\S]*widgetResult\.data\.organization_id/u)
})

test('booking UI requires profile selection and sends profile id with its phone', async () => {
  const source = await readFile(bookingPageUrl, 'utf8')

  assert.match(source, /bookingProfiles\.value\.length > 1 && !selectedClientPersonId\.value/u)
  assert.match(source, /v-model="selectedClientPersonId"/u)
  assert.match(source, /customerPhone: customer\.phone\.trim\(\) \|\| null/u)
  assert.match(source, /clientPersonId: selectedClientPersonId\.value \|\| null/u)
  assert.match(source, /if \(profile\?\.phone\) \{[\s\S]*customer\.phone = profile\.phone/u)
  assert.match(source, /previousProfile\?\.phone[\s\S]*customer\.phone === previousProfile\.phone[\s\S]*customer\.phone = ''/u)
  assert.doesNotMatch(source, /customerEmail\s*:/u)
})

test('protected booking endpoint ignores any body email field', async () => {
  const source = await readFile(bookingEndpointUrl, 'utf8')

  assert.doesNotMatch(source, /body\.(?:customerEmail|customer_email|email)\b/u)
  assert.match(source, /p_client_person_id: clientPersonId/u)
  assert.match(source, /p_customer_phone: customerPhone/u)
})
