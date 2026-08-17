import { createError } from 'h3'
import type {
  MailComposerContextClientCases,
  MailContextRelatedCase,
} from '../../shared/types/mail.ts'

export const MAX_MAIL_COMPOSER_CONTEXT_CLIENTS = 10

interface MailComposerCaseRow {
  id?: unknown
  title?: unknown
  closed_at?: unknown
  updated_at?: unknown
  client_id?: unknown
}

interface MailComposerCaseClientRow {
  case_id?: unknown
  client_id?: unknown
}

interface IndexedComposerCase extends MailContextRelatedCase {
  updatedAt: string
}

export function parseMailComposerContextClientIds(value: unknown): string[] {
  if (
    !Array.isArray(value)
    || value.length === 0
    || value.length > MAX_MAIL_COMPOSER_CONTEXT_CLIENTS
  ) throw invalidClientIdsError()

  const unique = new Set<string>()
  for (const rawId of value) {
    if (typeof rawId !== 'string') throw invalidClientIdsError()
    const id = rawId.trim().toLowerCase()
    if (!isUuid(id)) throw invalidClientIdsError()
    unique.add(id)
  }
  return [...unique]
}

export function groupMailComposerContextCases(
  clientIds: readonly string[],
  fallbackCaseRows: readonly MailComposerCaseRow[],
  caseClientRows: readonly MailComposerCaseClientRow[],
  linkedCaseRows: readonly MailComposerCaseRow[],
): MailComposerContextClientCases[] {
  const requestedClientIds = new Set(clientIds)
  const caseIdsByClient = new Map(
    clientIds.map(clientId => [clientId, new Set<string>()]),
  )
  const casesById = new Map<string, IndexedComposerCase>()

  for (const row of [...fallbackCaseRows, ...linkedCaseRows]) {
    const id = normalizedUuid(row.id)
    if (!id) continue
    casesById.set(id, {
      id,
      label: String(row.title ?? '').trim() || 'Sprawa',
      closedAt: typeof row.closed_at === 'string' ? row.closed_at : null,
      updatedAt: typeof row.updated_at === 'string' ? row.updated_at : '',
    })
  }

  for (const row of fallbackCaseRows) {
    const clientId = normalizedUuid(row.client_id)
    const caseId = normalizedUuid(row.id)
    if (!clientId || !caseId || !requestedClientIds.has(clientId)) continue
    caseIdsByClient.get(clientId)?.add(caseId)
  }
  for (const row of caseClientRows) {
    const clientId = normalizedUuid(row.client_id)
    const caseId = normalizedUuid(row.case_id)
    if (!clientId || !caseId || !requestedClientIds.has(clientId)) continue
    caseIdsByClient.get(clientId)?.add(caseId)
  }

  return clientIds.map(clientId => ({
    clientId,
    cases: [...(caseIdsByClient.get(clientId) ?? [])]
      .map(caseId => casesById.get(caseId))
      .filter((item): item is IndexedComposerCase => Boolean(item))
      .sort(compareComposerCases)
      .map(({ id, label, closedAt }) => ({ id, label, closedAt })),
  }))
}

function compareComposerCases(left: IndexedComposerCase, right: IndexedComposerCase): number {
  const closedOrder = Number(Boolean(left.closedAt)) - Number(Boolean(right.closedAt))
  if (closedOrder) return closedOrder
  const updatedOrder = right.updatedAt.localeCompare(left.updatedAt)
  if (updatedOrder) return updatedOrder
  const labelOrder = left.label.localeCompare(right.label, 'pl')
  return labelOrder || left.id.localeCompare(right.id)
}

function normalizedUuid(value: unknown): string | null {
  const id = String(value ?? '').trim().toLowerCase()
  return isUuid(id) ? id : null
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(value)
}

function invalidClientIdsError() {
  return createError({
    statusCode: 400,
    statusMessage: 'Nieprawidłowi klienci kontekstu poczty.',
  })
}
