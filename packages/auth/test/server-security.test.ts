import assert from 'node:assert/strict'
import test from 'node:test'

import {
  getOpenExpertExternalJwt,
  hashOpenExpertMagicLinkToken,
  type OpenExpertAuthRuntime,
} from '../src/server.ts'

test('magic-link verification identifiers are isolated per auth surface', () => {
  const token = 'same-better-auth-token'
  const organizationInvitation = hashOpenExpertMagicLinkToken(
    'crm-organization-invitation',
    token,
  )
  const clientPortal = hashOpenExpertMagicLinkToken('client-portal', token)

  assert.match(organizationInvitation, /^[0-9a-f]{64}$/u)
  assert.match(clientPortal, /^[0-9a-f]{64}$/u)
  assert.notEqual(organizationInvitation, clientPortal)
  assert.equal(
    organizationInvitation,
    hashOpenExpertMagicLinkToken('crm-organization-invitation', token),
  )
  assert.equal(organizationInvitation.includes(token), false)
})

test('external JWTs are minted from the signed session, never caller Bearer input', async () => {
  let receivedHeaders: Headers | undefined
  const runtime = {
    auth: {
      api: {
        async getToken({ headers }: { headers: Headers }) {
          receivedHeaders = headers
          return { token: 'server-minted-token' }
        },
      },
    },
  } as unknown as OpenExpertAuthRuntime
  const headers = new Headers({
    authorization: 'Bearer attacker-controlled-token',
    cookie: 'openexpert.session_token=signed-session',
  })

  const token = await getOpenExpertExternalJwt(runtime, headers)

  assert.equal(token, 'server-minted-token')
  assert.equal(receivedHeaders?.get('authorization'), null)
  assert.equal(
    receivedHeaders?.get('cookie'),
    'openexpert.session_token=signed-session',
  )
  assert.equal(headers.get('authorization'), 'Bearer attacker-controlled-token')
})
