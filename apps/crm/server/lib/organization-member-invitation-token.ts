import { createHash, randomBytes } from 'node:crypto'

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/u

export function createOrganizationMemberInvitationToken(): string {
  return randomBytes(32).toString('base64url')
}

export function isOrganizationMemberInvitationToken(value: unknown): value is string {
  return typeof value === 'string' && TOKEN_PATTERN.test(value)
}

export function hashOrganizationMemberInvitationToken(token: string): string {
  if (!isOrganizationMemberInvitationToken(token)) {
    throw new TypeError('Organization member invitation token is invalid')
  }
  return createHash('sha256').update(token).digest('hex')
}
