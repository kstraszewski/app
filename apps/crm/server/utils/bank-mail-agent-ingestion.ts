import type { H3Event } from 'h3'
import type {
  MailMessageDetail,
  MailThreadDetail,
  MailThreadSummary,
} from '../../shared/types/mail.ts'
import type { CrmSession } from './crm.ts'
import { dispatchBankMailAgent } from './bank-mail-agent-dispatch.ts'
import { bankMailProviderMessageIdentitySha256 } from './bank-mail-agent-status-core.ts'
import type { MailConnectionRow } from './mail-connections.ts'
import { mailContextThreadKeyHash } from './mail-context-core.ts'
import { deriveMailReferenceSecret } from './mail-crypto.ts'
import {
  bankMailAttachmentEncrypted,
  canonicalBankMailSourceSha256,
  mailAddressDomain,
} from './bank-mail-agent-ingestion-core.ts'

function configuredMockBankSenderDomain(event: H3Event): string {
  const runtimeConfig = useRuntimeConfig(event) as {
    mockBank?: { email?: { from?: string } }
  }
  const configuredFrom = String(runtimeConfig.mockBank?.email?.from ?? '')
  const angleAddress = configuredFrom.match(/<([^<>]+)>/u)?.[1]
  return mailAddressDomain(angleAddress ?? configuredFrom)
}

/**
 * Trusted Gmail ingress for one provider-fetched thread. EVE may only propose
 * a case. The intake claim durably registers this thread before EVE starts;
 * PostgreSQL later links only the mailbox thread (never an attachment) in the
 * same transaction that accepts a strong, unique, contradiction-free proposal.
 */
export async function ingestGmailBankMailThread(
  event: H3Event,
  input: {
    backendData: any
    session: CrmSession
    connection: MailConnectionRow
    thread: MailThreadDetail
  },
): Promise<void> {
  if (input.connection.provider !== 'google') return
  const senderDomain = configuredMockBankSenderDomain(event)
  if (!senderDomain) return

  const inboundMessages = input.thread.messages
    .filter((message: MailMessageDetail) => (
      mailAddressDomain(message.from?.email) === senderDomain
      && senderDomain !== mailAddressDomain(input.connection.account_email)
    ))
    .slice(-3)
  if (!inboundMessages.length) return
  const referenceSecret = deriveMailReferenceSecret(event, {
    organizationId: input.connection.organization_id,
    ownerUserId: input.connection.owner_user_id,
    connectionId: input.connection.id,
  })
  const threadLink = {
    keySha256: mailContextThreadKeyHash('google', input.thread.id, referenceSecret),
    reference: input.thread.id,
  }

  for (const message of inboundMessages) {
    await dispatchBankMailAgent(event, {
      organizationId: input.session.organizationId,
      organizationSlug: input.session.organizationSlug,
      connectionId: input.connection.id,
      mailboxOwnerUserId: input.session.userId,
      provider: 'google',
      providerMessageIdSha256: bankMailProviderMessageIdentitySha256('google', message.id),
      sourceSha256: canonicalBankMailSourceSha256(message),
      senderDomain: mailAddressDomain(message.from?.email),
      authenticationStatus: message.security.authentication === 'pass'
        ? 'passed'
        : message.security.authentication === 'fail'
          ? 'failed'
          : 'indeterminate',
      dkimAligned: message.security.dkimAligned === true,
      dmarcAligned: message.security.dmarcAligned === true,
      replyToMismatch: message.security.replyToMismatch,
      bankId: null,
      threadLink,
      subject: message.subject,
      bodyText: message.bodyText,
      bodyTruncated: message.bodyTruncated,
      attachments: message.attachments.map(attachment => ({
        filename: attachment.filename,
        mimeType: attachment.mimeType,
        size: attachment.size,
        encrypted: bankMailAttachmentEncrypted(attachment.filename, attachment.mimeType),
      })),
    })
  }
}

export async function ingestGmailBankMailThreadPage(
  event: H3Event,
  input: {
    backendData: any
    session: CrmSession
    connection: MailConnectionRow
    summaries: readonly MailThreadSummary[]
    loadThread: (threadId: string) => Promise<MailThreadDetail>
  },
): Promise<void> {
  if (input.connection.provider !== 'google') return
  const senderDomain = configuredMockBankSenderDomain(event)
  if (!senderDomain) return
  const candidateIds = input.summaries
    .filter(summary => summary.participants.some(participant => (
      mailAddressDomain(participant.email) === senderDomain
    )))
    .map(summary => summary.id)
    .slice(0, 3)

  for (const threadId of candidateIds) {
    const thread = await input.loadThread(threadId)
    await ingestGmailBankMailThread(event, { ...input, thread })
  }
}
