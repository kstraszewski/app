import { createHash, randomBytes } from 'node:crypto'

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/u

export function createOrganizationInvitationToken(): string {
  return randomBytes(32).toString('base64url')
}

export function isOrganizationInvitationToken(value: unknown): value is string {
  return typeof value === 'string' && TOKEN_PATTERN.test(value)
}

export function hashOrganizationInvitationToken(token: string): string {
  if (!isOrganizationInvitationToken(token)) {
    throw new TypeError('Organization invitation token is invalid')
  }
  return createHash('sha256').update(token, 'utf8').digest('hex')
}
