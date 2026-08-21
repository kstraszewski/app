import type { H3Event } from 'h3'
import type {
  MailMessageDetail,
  MailThreadDetail,
  MailThreadSummary,
} from '../../shared/types/mail.ts'
import type { CrmSession } from './crm.ts'
import { throwDbError } from './crm.ts'
import { dispatchBankMailAgent } from './bank-mail-agent-dispatch.ts'
import { bankMailProviderMessageIdentitySha256 } from './bank-mail-agent-status-core.ts'
import type { MailConnectionRow } from './mail-connections.ts'
import { upsertMailContextThreadLink } from './mail-context.ts'
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

async function strongProposalCaseId(backendData: any, intakeId: string): Promise<string | null> {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const { data, error } = await backendData.rpc('get_bank_mail_agent_intake', {
      p_intake_id: intakeId,
    })
    throwDbError(error)
    const caseId = String(data?.strongProposalCaseId ?? '')
    if (/^[0-9a-f]{8}-[0-9a-f-]{27}$/u.test(caseId)) return caseId
    if (attempt < 5) await new Promise(resolve => setTimeout(resolve, 1_500))
  }
  return null
}

/**
 * Trusted Gmail ingress for one provider-fetched thread. EVE may only propose
 * a case. A deterministic server-side ceiling links the mailbox thread (never
 * an attachment) when the proposal is strong, unique and contradiction-free.
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

  for (const message of inboundMessages) {
    const result = await dispatchBankMailAgent(event, {
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
      dmarcAligned: message.security.dmarcAligned === true,
      replyToMismatch: message.security.replyToMismatch,
      bankId: null,
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

    const caseId = await strongProposalCaseId(input.backendData, result.intakeId)
    if (!caseId) continue
    await upsertMailContextThreadLink(input.backendData, input.session, {
      connectionId: input.connection.id,
      provider: input.connection.provider,
      referenceSecret: deriveMailReferenceSecret(event, {
        organizationId: input.connection.organization_id,
        ownerUserId: input.connection.owner_user_id,
        connectionId: input.connection.id,
      }),
      scope: { type: 'case', id: caseId },
      threadReference: input.thread.id,
      linkSource: 'bank_mail_agent',
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
