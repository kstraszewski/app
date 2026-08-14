import { createHash } from 'node:crypto'

/**
 * Connection-bound RFC Message-ID for newly claimed sends. Previously stored
 * rows remain compatible because recovery always uses their persisted header.
 */
export function connectionBoundMailMessageId(
  connectionId: string,
  idempotencyKey: string,
): string {
  const localPart = createHash('sha256')
    .update('openexpert-mail-message-id-v2\0', 'utf8')
    .update(connectionId, 'utf8')
    .update('\0', 'utf8')
    .update(idempotencyKey, 'utf8')
    .digest('hex')
  return `<${localPart}@mail.openexpert.app>`
}

export function mailSendCanRecoverWithoutNewAttempt(
  status: 'pending' | 'sent' | 'unknown' | 'failed' | null,
): boolean {
  return status !== null && status !== 'failed'
}
