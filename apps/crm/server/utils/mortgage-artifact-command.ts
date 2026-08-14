import { createHash } from 'node:crypto'
import { createError } from 'h3'

const artifactKinds = ['esis', 'credit_decision', 'draft_credit_agreement'] as const
const artifactFields = [
  'issuedAt',
  'receivedAt',
  'validFrom',
  'validUntil',
  'decisionOutcome',
  'supersedesArtifactId',
  'metadata',
] as const
const deliveryChannels = [
  'client_portal_download',
  'email_attachment',
  'registered_mail',
  'physical_copy',
  'other_durable_medium',
] as const
const deliveryFields = new Set([
  'recipientClientId',
  'deliveredAt',
  'channel',
  'evidenceReference',
  'metadata',
])
const attachmentCommandFields = new Set([
  'type',
  'kind',
  'documentId',
  ...artifactFields,
  'deliveries',
])
const publicCommandTypes = new Set([
  'deliver_artifact',
  'submit_application',
  'acknowledge_application',
  'confirm_completeness',
  'request_additional_information',
  'resume_review',
  'record_early_decision_consent',
  'complete_application',
  'close_application',
])
const commandFields: Record<string, Set<string>> = {
  attach_artifact: attachmentCommandFields,
  deliver_artifact: new Set(['type', 'artifactId', 'recipients']),
  submit_application: new Set(['type', 'submittedAt']),
  acknowledge_application: new Set(['type', 'acknowledgedAt']),
  confirm_completeness: new Set(['type', 'confirmedAt']),
  request_additional_information: new Set(['type', 'requestedAt']),
  resume_review: new Set(['type', 'resumedAt']),
  record_early_decision_consent: new Set([
    'type', 'clientId', 'decision', 'capturedAt', 'channel',
    'evidenceReference', 'documentId', 'metadata',
  ]),
  complete_application: new Set(['type', 'completedAt']),
  close_application: new Set(['type', 'closedAt']),
}
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const sha256Pattern = /^[0-9a-f]{64}$/i
const maxDeliveriesPerCommand = 32
const maxMetadataDepth = 12
const maxMetadataNodes = 2_000
const maxArtifactMetadataLength = 16_384
const maxDeliveryMetadataLength = 8_192

export type MortgageArtifactKind = typeof artifactKinds[number]
type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }

export interface NormalizedMortgageDelivery {
  recipientClientId: string
  deliveredAt: string
  channel: typeof deliveryChannels[number]
  evidenceReference?: string
  metadata: Record<string, JsonValue>
}

function invalid(statusMessage: string): never {
  throw createError({ statusCode: 400, statusMessage })
}

function record(input: unknown, field: string): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    invalid(`${field} must be a JSON object`)
  }
  return input as Record<string, unknown>
}

function normalizedUuid(input: unknown, field: string): string {
  if (typeof input !== 'string' || !uuidPattern.test(input)) {
    invalid(`${field} must be a UUID`)
  }
  return input.toLowerCase()
}

function normalizedDate(input: unknown, field: string): string {
  if (typeof input !== 'string' || !input.trim()) {
    invalid(`${field} must be an ISO date-time`)
  }
  const timestamp = Date.parse(input)
  if (!Number.isFinite(timestamp)) invalid(`${field} must be an ISO date-time`)
  return new Date(timestamp).toISOString()
}

function normalizedJson(
  input: unknown,
  field: string,
  state = { nodes: 0 },
  depth = 0,
): JsonValue {
  state.nodes += 1
  if (state.nodes > maxMetadataNodes || depth > maxMetadataDepth) {
    invalid(`${field} is too complex`)
  }
  if (input === null || typeof input === 'string' || typeof input === 'boolean') return input
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) invalid(`${field} must contain valid JSON values`)
    return input
  }
  if (Array.isArray(input)) {
    return input.map((value, index) => normalizedJson(value, `${field}[${index}]`, state, depth + 1))
  }
  if (input && typeof input === 'object') {
    const output: Record<string, JsonValue> = Object.create(null) as Record<string, JsonValue>
    for (const key of Object.keys(input as Record<string, unknown>).sort()) {
      const value = (input as Record<string, unknown>)[key]
      if (value === undefined) invalid(`${field}.${key} must contain a valid JSON value`)
      output[key] = normalizedJson(value, `${field}.${key}`, state, depth + 1)
    }
    return output
  }
  invalid(`${field} must contain valid JSON values`)
}

function normalizedMetadata(input: unknown, field: string, maxLength: number): Record<string, JsonValue> {
  const value = normalizedJson(input ?? {}, field)
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    invalid(`${field} must be a JSON object`)
  }
  if (JSON.stringify(value).length > maxLength) invalid(`${field} is too large`)
  return value as Record<string, JsonValue>
}

function optionalDate(input: unknown, field: string): string | undefined {
  return input === null || input === undefined || input === ''
    ? undefined
    : normalizedDate(input, field)
}

export function normalizeMortgageArtifactPayload(input: unknown): Record<string, JsonValue> {
  const value = record(input, 'artifact')
  const unsupported = Object.keys(value).filter(key => !artifactFields.includes(key as typeof artifactFields[number]))
  if (unsupported.length) invalid(`Unsupported artifact fields: ${unsupported.join(', ')}`)

  const decisionOutcome = value.decisionOutcome
  if (decisionOutcome !== undefined && decisionOutcome !== null
    && decisionOutcome !== 'positive' && decisionOutcome !== 'negative') {
    invalid('artifact.decisionOutcome must be positive or negative')
  }

  const issuedAt = optionalDate(value.issuedAt, 'artifact.issuedAt')
  const receivedAt = optionalDate(value.receivedAt, 'artifact.receivedAt')
  const validFrom = optionalDate(value.validFrom, 'artifact.validFrom')
  const validUntil = optionalDate(value.validUntil, 'artifact.validUntil')
  return {
    ...(issuedAt ? { issuedAt } : {}),
    ...(receivedAt ? { receivedAt } : {}),
    ...(validFrom ? { validFrom } : {}),
    ...(validUntil ? { validUntil } : {}),
    ...(decisionOutcome ? { decisionOutcome } : {}),
    ...(value.supersedesArtifactId === null || value.supersedesArtifactId === undefined || value.supersedesArtifactId === ''
      ? {}
      : { supersedesArtifactId: normalizedUuid(value.supersedesArtifactId, 'artifact.supersedesArtifactId') }),
    metadata: normalizedMetadata(value.metadata, 'artifact.metadata', maxArtifactMetadataLength),
  }
}

export function normalizeMortgageDeliveries(
  input: unknown,
  field = 'deliveries',
): NormalizedMortgageDelivery[] {
  if (!Array.isArray(input)) invalid(`${field} must be an array`)
  if (input.length > maxDeliveriesPerCommand) {
    invalid(`${field} must contain at most ${maxDeliveriesPerCommand} entries`)
  }

  const recipients = new Set<string>()
  const deliveries = input.map((candidate, index): NormalizedMortgageDelivery => {
    const delivery = record(candidate, `${field}[${index}]`)
    const unsupported = Object.keys(delivery).filter(key => !deliveryFields.has(key))
    if (unsupported.length) invalid(`Unsupported ${field}[${index}] fields: ${unsupported.join(', ')}`)

    const recipientClientId = normalizedUuid(
      delivery.recipientClientId,
      `${field}[${index}].recipientClientId`,
    )
    if (recipients.has(recipientClientId)) {
      invalid(`${field} contains a duplicate recipientClientId`)
    }
    recipients.add(recipientClientId)

    const channel = delivery.channel
    if (typeof channel !== 'string' || !deliveryChannels.includes(channel as typeof deliveryChannels[number])) {
      invalid(`${field}[${index}].channel is not supported`)
    }
    const evidenceReference = typeof delivery.evidenceReference === 'string'
      ? delivery.evidenceReference.trim()
      : ''
    if (evidenceReference.length > 500) {
      invalid(`${field}[${index}].evidenceReference must not exceed 500 characters`)
    }
    if (channel !== 'client_portal_download' && !evidenceReference) {
      invalid(`${field}[${index}].evidenceReference is required for this channel`)
    }

    return {
      recipientClientId,
      deliveredAt: normalizedDate(delivery.deliveredAt, `${field}[${index}].deliveredAt`),
      channel: channel as typeof deliveryChannels[number],
      ...(evidenceReference ? { evidenceReference } : {}),
      metadata: normalizedMetadata(
        delivery.metadata,
        `${field}[${index}].metadata`,
        maxDeliveryMetadataLength,
      ),
    }
  })

  return deliveries.sort((left, right) => {
    const recipientOrder = left.recipientClientId.localeCompare(right.recipientClientId)
    if (recipientOrder) return recipientOrder
    return left.deliveredAt.localeCompare(right.deliveredAt)
  })
}

function stableJson(input: JsonValue): string {
  if (input === null || typeof input !== 'object') return JSON.stringify(input)
  if (Array.isArray(input)) return `[${input.map(stableJson).join(',')}]`
  return `{${Object.keys(input).sort().map(key => `${JSON.stringify(key)}:${stableJson(input[key]!)}`).join(',')}}`
}

export function mortgageArtifactReplayFingerprint(input: {
  kind: unknown
  sha256: unknown
  command: unknown
}): string {
  if (typeof input.kind !== 'string' || !artifactKinds.includes(input.kind as MortgageArtifactKind)) {
    invalid(`kind must be one of: ${artifactKinds.join(', ')}`)
  }
  if (typeof input.sha256 !== 'string' || !sha256Pattern.test(input.sha256)) {
    invalid('sha256 must be a lowercase hexadecimal SHA-256 digest')
  }
  const command = record(input.command, 'artifact command')
  const unsupported = Object.keys(command).filter(key => !attachmentCommandFields.has(key))
  if (unsupported.length) invalid(`Unsupported artifact command fields: ${unsupported.join(', ')}`)
  if (command.type !== undefined && command.type !== 'attach_artifact') {
    invalid('Artifact replay command has an invalid type')
  }
  if (command.kind !== undefined && command.kind !== input.kind) {
    invalid('Artifact replay command kind does not match the artifact')
  }

  const artifact = Object.fromEntries(
    artifactFields.flatMap(field => Object.hasOwn(command, field) ? [[field, command[field]]] : []),
  )
  const normalizedDeliveries: JsonValue[] = normalizeMortgageDeliveries(command.deliveries ?? [])
    .map(delivery => ({
      recipientClientId: delivery.recipientClientId,
      deliveredAt: delivery.deliveredAt,
      channel: delivery.channel,
      ...(delivery.evidenceReference ? { evidenceReference: delivery.evidenceReference } : {}),
      metadata: delivery.metadata,
    }))
  const semanticCommand: JsonValue = {
    kind: input.kind as MortgageArtifactKind,
    sha256: input.sha256.toLowerCase(),
    artifact: normalizeMortgageArtifactPayload(artifact),
    deliveries: normalizedDeliveries,
  }

  return createHash('sha256').update(stableJson(semanticCommand)).digest('hex')
}

function parseMortgageApplicationCommandForTypes(
  input: unknown,
  allowedCommandTypes: ReadonlySet<string>,
): Record<string, unknown> {
  let encodedSize = 0
  try {
    const encoded = JSON.stringify(input)
    if (typeof encoded !== 'string') invalid('Mortgage application command must be JSON')
    encodedSize = Buffer.byteLength(encoded, 'utf8')
  }
  catch {
    invalid('Mortgage application command must be JSON')
  }
  if (encodedSize > 131_072) {
    throw createError({ statusCode: 413, statusMessage: 'Mortgage application command is too large' })
  }

  const body = record(input, 'Mortgage application command')
  const unsupportedEnvelopeFields = Object.keys(body)
    .filter(key => !['commandId', 'expectedRevision', 'command'].includes(key))
  if (unsupportedEnvelopeFields.length) {
    invalid(`Unsupported mortgage command envelope fields: ${unsupportedEnvelopeFields.join(', ')}`)
  }
  if (!Number.isSafeInteger(body.expectedRevision) || Number(body.expectedRevision) < 0) {
    invalid('expectedRevision must be a non-negative integer')
  }
  const commandId = normalizedUuid(body.commandId, 'commandId')
  const command = record(body.command, 'command')
  if (typeof command.type !== 'string' || !allowedCommandTypes.has(command.type)) {
    invalid('Unsupported mortgage application command')
  }
  const commandType = command.type
  const unsupportedFields = Object.keys(command).filter(key => !commandFields[commandType]!.has(key))
  if (unsupportedFields.length) {
    invalid(`Unsupported fields for ${commandType}: ${unsupportedFields.join(', ')}`)
  }

  let normalizedCommand: Record<string, unknown> = command
  if (commandType === 'deliver_artifact') {
    normalizedCommand = {
      ...command,
      artifactId: normalizedUuid(command.artifactId, 'command.artifactId'),
      recipients: normalizeMortgageDeliveries(command.recipients, 'command.recipients'),
    }
  }
  else if (commandType === 'attach_artifact') {
    if (typeof command.kind !== 'string' || !artifactKinds.includes(command.kind as MortgageArtifactKind)) {
      invalid(`command.kind must be one of: ${artifactKinds.join(', ')}`)
    }
    const artifact = Object.fromEntries(
      artifactFields.flatMap(field => Object.hasOwn(command, field) ? [[field, command[field]]] : []),
    )
    normalizedCommand = {
      type: 'attach_artifact',
      kind: command.kind,
      documentId: normalizedUuid(command.documentId, 'command.documentId'),
      ...normalizeMortgageArtifactPayload(artifact),
      deliveries: normalizeMortgageDeliveries(command.deliveries ?? [], 'command.deliveries'),
    }
  }

  return {
    commandId,
    expectedRevision: body.expectedRevision,
    command: normalizedCommand,
  }
}

export function parsePublicMortgageApplicationCommand(input: unknown): Record<string, unknown> {
  return parseMortgageApplicationCommandForTypes(input, publicCommandTypes)
}

export function parseMortgageArtifactAttachmentCommand(input: unknown): Record<string, unknown> {
  return parseMortgageApplicationCommandForTypes(input, new Set(['attach_artifact']))
}
