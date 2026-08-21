import type { H3Event } from 'h3'
import type {
  MailMessageDetail,
  MailThreadDetail,
  MailThreadSummary,
} from '../../shared/types/mail.ts'
import type { CrmSession } from './crm.ts'
import { dispatchBankMailAgent } from './bank-mail-agent-dispatch.ts'
import type { BankMailAgentDispatchInput } from './bank-mail-agent-dispatch-core.ts'
import { bankMailProviderMessageIdentitySha256 } from './bank-mail-agent-status-core.ts'
import type { MailConnectionRow } from './mail-connections.ts'
import { mailContextThreadKeyHash } from './mail-context-core.ts'
import { deriveMailReferenceSecret } from './mail-crypto.ts'
import {
  bankMailAttachmentEncrypted,
  canonicalBankMailSourceSha256,
  mailAddressDomain,
} from './bank-mail-agent-ingestion-core.ts'

export function configuredMockBankSenderDomain(event: H3Event): string {
  const runtimeConfig = useRuntimeConfig(event) as {
    mockBank?: { email?: { from?: string } }
  }
  const configuredFrom = String(runtimeConfig.mockBank?.email?.from ?? '')
  const angleAddress = configuredFrom.match(/<([^<>]+)>/u)?.[1]
  return mailAddressDomain(angleAddress ?? configuredFrom)
}

export function gmailBankMailMessageDispatchInput(
  event: H3Event,
  input: {
    session: CrmSession
    connection: MailConnectionRow
    thread: MailThreadDetail
    message: MailMessageDetail
  },
): BankMailAgentDispatchInput | null {
  if (input.connection.provider !== 'google') return null
  const senderDomain = configuredMockBankSenderDomain(event)
  if (
    !senderDomain
    || mailAddressDomain(input.message.from?.email) !== senderDomain
    || senderDomain === mailAddressDomain(input.connection.account_email)
    || !input.thread.messages.some(message => message.id === input.message.id)
  ) return null

  const referenceSecret = deriveMailReferenceSecret(event, {
    organizationId: input.connection.organization_id,
    ownerUserId: input.connection.owner_user_id,
    connectionId: input.connection.id,
  })
  return {
    organizationId: input.session.organizationId,
    organizationSlug: input.session.organizationSlug,
    connectionId: input.connection.id,
    mailboxOwnerUserId: input.session.userId,
    provider: 'google',
    providerMessageIdSha256: bankMailProviderMessageIdentitySha256('google', input.message.id),
    sourceSha256: canonicalBankMailSourceSha256(input.message),
    senderDomain: mailAddressDomain(input.message.from?.email),
    authenticationStatus: input.message.security.authentication === 'pass'
      ? 'passed'
      : input.message.security.authentication === 'fail'
        ? 'failed'
        : 'indeterminate',
    dkimAligned: input.message.security.dkimAligned === true,
    dmarcAligned: input.message.security.dmarcAligned === true,
    replyToMismatch: input.message.security.replyToMismatch,
    bankId: null,
    threadLink: {
      keySha256: mailContextThreadKeyHash('google', input.thread.id, referenceSecret),
      reference: input.thread.id,
    },
    subject: input.message.subject,
    bodyText: input.message.bodyText,
    bodyTruncated: input.message.bodyTruncated,
    attachments: input.message.attachments.map(attachment => ({
      filename: attachment.filename,
      mimeType: attachment.mimeType,
      size: attachment.size,
      encrypted: bankMailAttachmentEncrypted(attachment.filename, attachment.mimeType),
    })),
  }
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
  for (const message of inboundMessages) {
    const dispatchInput = gmailBankMailMessageDispatchInput(event, {
      session: input.session,
      connection: input.connection,
      thread: input.thread,
      message,
    })
    if (dispatchInput) await dispatchBankMailAgent(event, dispatchInput)
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
