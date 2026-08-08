import {
  createTransactionalEmailSender,
  EmailDeliveryError,
  normalizeTransactionalEmailAddress,
} from '@openexpert/email'
import { createError, readBody } from 'h3'
import {
  createCaseMultiformArchive,
  filterCaseMultiformSelection,
  requireCaseMultiformSelection,
} from '~~/server/utils/case-multiform'
import {
  assertMultiformEmailArchiveSize,
  MULTIFORM_EMAIL_ARCHIVE_NAME,
  multiformPackageEmailTemplate,
  normalizeMultiformDeliveryRequestId,
  normalizeMultiformPeselPassword,
} from '~~/server/utils/multiform-package-email'
import { recordCrmActivity, requireCrmSession, throwDbError } from '~~/server/utils/crm'

type Row = Record<string, any>

interface MultiformEmailRuntimeConfig {
  apiKey?: string
  from?: string
  replyTo?: string
  smtp?: {
    host?: string
    port?: number
    secure?: boolean
    user?: string
    password?: string
  }
}

interface DeliveryRecipient {
  clientId: string
  displayName: string
  email: string
  pesel: string
}

function deliverySender(event: Parameters<typeof useRuntimeConfig>[0]) {
  const email = useRuntimeConfig(event).authEmail as MultiformEmailRuntimeConfig
  return createTransactionalEmailSender({
    apiKey: email.apiKey,
    from: email.from,
    replyTo: email.replyTo,
    smtp: email.smtp?.host
      ? {
          host: email.smtp.host,
          port: email.smtp.port,
          secure: email.smtp.secure,
          user: email.smtp.user || undefined,
          password: email.smtp.password || undefined,
        }
      : undefined,
  })
}

function primaryPerson(people: Row[]) {
  return people.find(person => String(person.role) === 'primary') ?? people[0] ?? null
}

export default defineEventHandler(async (event) => {
  const selection = await requireCaseMultiformSelection(event)
  const session = await requireCrmSession(event)
  const body = await readBody<Record<string, unknown>>(event)
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw createError({ statusCode: 400, statusMessage: 'Dane wysyłki są nieprawidłowe.' })
  }

  const requestId = normalizeMultiformDeliveryRequestId(body.requestId)
  if (!requestId) {
    throw createError({ statusCode: 400, statusMessage: 'Identyfikator wysyłki jest nieprawidłowy.' })
  }
  const requestedSelection = filterCaseMultiformSelection(selection, body.applicationIds)
  if (!Array.isArray(body.documentIds)) {
    throw createError({ statusCode: 400, statusMessage: 'Lista załączników jest nieprawidłowa.' })
  }

  const linksResult = await session.dataApi
    .from('crm_case_clients')
    .select('client_id, is_primary, created_at')
    .eq('organization_id', session.organizationId)
    .eq('case_id', selection.caseId)
    .order('is_primary', { ascending: false })
    .order('created_at')
  throwDbError(linksResult.error)
  const links = (linksResult.data ?? []) as Row[]
  const clientIds = [...new Set(links.map(link => String(link.client_id)).filter(Boolean))]
  if (!clientIds.length) {
    throw createError({ statusCode: 409, statusMessage: 'Sprawa nie ma klientów do wysyłki.' })
  }

  const [clientsResult, peopleResult, previousDeliveriesResult] = await Promise.all([
    session.dataApi
      .from('crm_clients')
      .select('id, display_name, primary_email')
      .eq('organization_id', session.organizationId)
      .in('id', clientIds),
    session.dataApi
      .from('crm_client_people')
      .select('client_id, display_name, email, pesel, role, created_at')
      .eq('organization_id', session.organizationId)
      .in('client_id', clientIds)
      .order('created_at'),
    session.dataApi
      .from('crm_activities')
      .select('client_id')
      .eq('organization_id', session.organizationId)
      .eq('case_id', selection.caseId)
      .eq('activity_type', 'multiform_package_email_sent')
      .contains('payload', { requestId }),
  ])
  throwDbError(clientsResult.error)
  throwDbError(peopleResult.error)
  throwDbError(previousDeliveriesResult.error)

  const clientsById = new Map(
    ((clientsResult.data ?? []) as Row[]).map(client => [String(client.id), client]),
  )
  const peopleByClientId = new Map<string, Row[]>()
  for (const person of (peopleResult.data ?? []) as Row[]) {
    const clientId = String(person.client_id)
    peopleByClientId.set(clientId, [...(peopleByClientId.get(clientId) ?? []), person])
  }

  const blockers: Array<{
    clientId: string
    displayName: string
    missing: Array<'email' | 'pesel'>
  }> = []
  const recipients: DeliveryRecipient[] = []
  for (const clientId of clientIds) {
    const client = clientsById.get(clientId)
    const person = primaryPerson(peopleByClientId.get(clientId) ?? [])
    const displayName = String(client?.display_name || person?.display_name || 'Klient')
    const rawEmail = String(client?.primary_email || person?.email || '')
    let email = ''
    try {
      email = rawEmail ? normalizeTransactionalEmailAddress(rawEmail) : ''
    }
    catch {
      // A malformed address is reported to the operator without echoing its value.
    }
    const pesel = normalizeMultiformPeselPassword(person?.pesel)
    const missing = [
      ...(!email ? ['email' as const] : []),
      ...(!pesel ? ['pesel' as const] : []),
    ]
    if (missing.length) {
      blockers.push({ clientId, displayName, missing })
      continue
    }
    recipients.push({ clientId, displayName, email, pesel })
  }

  if (blockers.length) {
    throw createError({
      statusCode: 422,
      statusMessage: 'Uzupełnij adres e-mail i 11-cyfrowy PESEL każdego klienta przed wysyłką.',
      data: { recipients: blockers },
    })
  }

  const sender = deliverySender(event)
  if (!sender.isConfigured) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Wysyłka e-mail nie jest skonfigurowana.',
    })
  }

  const deliveredClientIds = new Set(
    ((previousDeliveriesResult.data ?? []) as Row[])
      .map(activity => String(activity.client_id || ''))
      .filter(Boolean),
  )
  const archives = new Map<string, Uint8Array>()
  for (const recipient of recipients) {
    if (deliveredClientIds.has(recipient.clientId)) continue
    const archive = await createCaseMultiformArchive(event, requestedSelection, {
      values: body.values,
      collectionCounts: body.collectionCounts,
      documentIds: body.documentIds,
      password: recipient.pesel,
    })
    try {
      assertMultiformEmailArchiveSize(archive)
    }
    catch (error) {
      throw createError({
        statusCode: 413,
        statusMessage: error instanceof Error
          ? error.message
          : 'Paczka ZIP przekracza limit załącznika e-mail.',
      })
    }
    archives.set(recipient.clientId, archive)
  }

  const sent: Array<{ clientId: string, displayName: string, email: string, alreadySent: boolean }> = []
  const failed: Array<{ clientId: string, displayName: string, email: string }> = []
  for (const recipient of recipients) {
    if (deliveredClientIds.has(recipient.clientId)) {
      sent.push({
        clientId: recipient.clientId,
        displayName: recipient.displayName,
        email: recipient.email,
        alreadySent: true,
      })
      continue
    }
    const archive = archives.get(recipient.clientId)
    if (!archive) continue
    const template = multiformPackageEmailTemplate({ recipientName: recipient.displayName })
    try {
      const result = await sender.send({
        to: recipient.email,
        ...template,
        idempotencyKey: `multiform-package/${selection.caseId}/${requestId}/${recipient.clientId}`,
        tags: [
          { name: 'email_type', value: 'multiform_package' },
          { name: 'case_id', value: selection.caseId },
        ],
        attachments: [{
          filename: MULTIFORM_EMAIL_ARCHIVE_NAME,
          content: archive,
          contentType: 'application/zip',
        }],
      })
      if (result.status !== 'sent') {
        failed.push({
          clientId: recipient.clientId,
          displayName: recipient.displayName,
          email: recipient.email,
        })
        continue
      }
      sent.push({
        clientId: recipient.clientId,
        displayName: recipient.displayName,
        email: recipient.email,
        alreadySent: false,
      })
      await recordCrmActivity(session, {
        client_id: recipient.clientId,
        case_id: selection.caseId,
        activity_type: 'multiform_package_email_sent',
        title: 'Wysłano klientowi paczkę Multiwniosku',
        body: 'Paczka ZIP została zabezpieczona numerem PESEL klienta.',
        payload: {
          requestId,
          applicationIds: requestedSelection.applicationIds,
          documentCount: body.documentIds.length,
          providerMessageId: result.id,
        },
      })
    }
    catch (error) {
      console.error('[case-multiform] email delivery failed', {
        clientId: recipient.clientId,
        provider: error instanceof EmailDeliveryError ? error.provider : undefined,
        retryable: error instanceof EmailDeliveryError ? error.retryable : false,
        statusCode: error instanceof EmailDeliveryError ? error.statusCode : undefined,
      })
      failed.push({
        clientId: recipient.clientId,
        displayName: recipient.displayName,
        email: recipient.email,
      })
    }
  }

  return {
    status: failed.length ? (sent.length ? 'partial' : 'failed') : 'complete',
    sent,
    failed,
  }
})
