import assert from 'node:assert/strict'
import test from 'node:test'

import {
  getOpenExpertExternalJwt,
  type OpenExpertAuthRuntime,
} from '../src/server.ts'

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
