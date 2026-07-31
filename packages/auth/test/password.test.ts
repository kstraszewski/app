import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createBcryptPasswordStrategy,
  isBcryptHash,
} from '../src/password-strategy.ts'
import { createDefaultBcryptPasswordStrategy } from '../src/password.ts'

test('bcrypt strategy preserves Better Auth argument order and configured cost', async () => {
  const calls: unknown[][] = []
  const strategy = createBcryptPasswordStrategy(
    {
      async hash(password, cost) {
        calls.push(['hash', password, cost])
        return 'stored-hash'
      },
      async compare(password, passwordHash) {
        calls.push(['compare', password, passwordHash])
        return password === 'secret' && passwordHash === 'stored-hash'
      },
    },
    10,
  )

  assert.equal(await strategy.hash('secret'), 'stored-hash')
  assert.equal(
    await strategy.verify({ hash: 'stored-hash', password: 'secret' }),
    true,
  )
  assert.deepEqual(calls, [
    ['hash', 'secret', 10],
    ['compare', 'secret', 'stored-hash'],
  ])
})

test('bcrypt hash detector accepts supported variants only', () => {
  const body = 'A'.repeat(53)
  assert.equal(isBcryptHash(`$2a$10$${body}`), true)
  assert.equal(isBcryptHash(`$2b$10$${body}`), true)
  assert.equal(isBcryptHash(`$2y$12$${body}`), true)
  assert.equal(isBcryptHash('not-a-bcrypt-hash'), false)
})

test('Better Auth verifier accepts existing bcrypt variants', async () => {
  const password = 'OpenExpert123!'
  const strategy = createDefaultBcryptPasswordStrategy(4)
  const bcrypt2b = await strategy.hash(password)

  for (const variant of ['2a', '2b', '2y']) {
    const importedHash = `$${variant}${bcrypt2b.slice(3)}`
    assert.equal(isBcryptHash(importedHash), true)
    assert.equal(
      await strategy.verify({ hash: importedHash, password }),
      true,
    )
  }
})
