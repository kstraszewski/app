import { createHash } from 'node:crypto'
import type { MailMessageDetail } from '../../shared/types/mail.ts'

export interface BankSenderIdentity {
  bank_id: string
  sender_domain: string
  allow_subdomains: boolean
}

export function mailAddressDomain(value: string | null | undefined): string {
  const normalized = String(value ?? '').trim().toLowerCase()
  const separator = normalized.lastIndexOf('@')
  return separator > 0 ? normalized.slice(separator + 1).replace(/\.$/u, '') : ''
}

export function matchingBankSenderIdentity(
  identities: readonly BankSenderIdentity[],
  message: MailMessageDetail,
): BankSenderIdentity | null {
  return matchingBankSenderIdentityForEmail(identities, message.from?.email)
}

export function matchingBankSenderIdentityForEmail(
  identities: readonly BankSenderIdentity[],
  email: string | null | undefined,
): BankSenderIdentity | null {
  const domain = mailAddressDomain(email)
  if (!domain) return null
  return [...identities]
    .sort((left, right) => right.sender_domain.length - left.sender_domain.length)
    .find(identity => (
      domain === identity.sender_domain
      || (identity.allow_subdomains && domain.endsWith(`.${identity.sender_domain}`))
    )) ?? null
}

export function canonicalBankMailSourceSha256(message: MailMessageDetail): string {
  const canonical = JSON.stringify({
    subject: message.subject,
    sentAt: message.sentAt,
    fromDomain: mailAddressDomain(message.from?.email),
    replyToDomains: message.replyTo
      .map(address => mailAddressDomain(address.email))
      .filter(Boolean)
      .sort(),
    bodyText: message.bodyText,
    bodyTruncated: message.bodyTruncated,
    attachments: message.attachments.map(attachment => ({
      filename: attachment.filename,
      mimeType: attachment.mimeType,
      size: attachment.size,
    })),
    // Keep this projection backward compatible for provider-message replay.
    // DKIM alignment is a separately signed ingress claim and deliberately
    // does not change the immutable source hash of an already-seen message.
    security: {
      authentication: message.security.authentication,
      dmarcAligned: message.security.dmarcAligned,
      replyToMismatch: message.security.replyToMismatch,
    },
  })
  return createHash('sha256').update(canonical, 'utf8').digest('hex')
}

export function bankMailAttachmentEncrypted(
  filename: string,
  mimeType: string,
): boolean | null {
  const normalizedName = filename.trim().toLowerCase()
  const normalizedType = mimeType.trim().toLowerCase()
  if (normalizedName.endsWith('.zip') || normalizedType === 'application/zip') return true
  return null
}
