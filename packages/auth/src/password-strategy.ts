export interface BcryptImplementation {
  hash(password: string, cost: number): Promise<string>
  compare(password: string, hash: string): Promise<boolean>
}

export function assertBcryptCost(cost: number): void {
  if (!Number.isInteger(cost) || cost < 4 || cost > 31) {
    throw new RangeError('bcrypt cost must be an integer between 4 and 31')
  }
}

export function createBcryptPasswordStrategy(
  implementation: BcryptImplementation,
  cost = 10,
) {
  assertBcryptCost(cost)

  return {
    hash: (password: string) => implementation.hash(password, cost),
    verify: ({ hash: passwordHash, password }: { hash: string; password: string }) =>
      implementation.compare(password, passwordHash),
  }
}

export function isBcryptHash(value: string): boolean {
  return /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(value)
}
