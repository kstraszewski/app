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
  matchingBankSenderIdentity,
  matchingBankSenderIdentityForEmail,
  type BankSenderIdentity,
} from './bank-mail-agent-ingestion-core.ts'

async function loadBankSenderIdentities(backendData: any): Promise<BankSenderIdentity[]> {
  const { data, error } = await backendData
    .from('mortgage_bank_email_identities')
    .select('bank_id, sender_domain, allow_subdomains')
    .eq('is_active', true)
  throwDbError(error)
  return (data ?? []) as BankSenderIdentity[]
}

async function strongProposalCaseId(backendData: any, intakeId: string): Promise<string | null> {
  const { data, error } = await backendData
    .from('mail_bank_agent_match_proposals')
    .select('case_id')
    .eq('intake_id', intakeId)
    .eq('classification', 'strong_candidate')
    .eq('review_status', 'review_required')
    .maybeSingle()
  throwDbError(error)
  const caseId = String(data?.case_id ?? '')
  return /^[0-9a-f]{8}-[0-9a-f-]{27}$/u.test(caseId) ? caseId : null
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
  const identities = await loadBankSenderIdentities(input.backendData)
  if (!identities.length) return

  const inboundMessages = input.thread.messages
    .map(message => ({ message, identity: matchingBankSenderIdentity(identities, message) }))
    .filter((item): item is { message: MailMessageDetail, identity: BankSenderIdentity } => (
      Boolean(item.identity) && mailAddressDomain(item.message.from?.email) !== mailAddressDomain(input.connection.account_email)
    ))
    .slice(-3)

  for (const { message, identity } of inboundMessages) {
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
      bankId: identity.bank_id,
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
  const identities = await loadBankSenderIdentities(input.backendData)
  if (!identities.length) return
  const candidateIds = input.summaries
    .filter(summary => summary.participants.some(participant => (
      Boolean(matchingBankSenderIdentityForEmail(identities, participant.email))
    )))
    .map(summary => summary.id)
    .slice(0, 3)

  for (const threadId of candidateIds) {
    const thread = await input.loadThread(threadId)
    await ingestGmailBankMailThread(event, { ...input, thread })
  }
}
