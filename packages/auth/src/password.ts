import { compare, hash } from 'bcryptjs'

import { createBcryptPasswordStrategy } from './password-strategy.ts'

export function createDefaultBcryptPasswordStrategy(cost = 10) {
  return createBcryptPasswordStrategy({ hash, compare }, cost)
}

export {
  assertBcryptCost,
  createBcryptPasswordStrategy,
  isBcryptHash,
  type BcryptImplementation,
} from './password-strategy.ts'
