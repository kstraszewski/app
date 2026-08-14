import { createError, type H3Event } from 'h3'
import {
  parseMortgageArtifactAttachmentCommand,
  parsePublicMortgageApplicationCommand,
} from './mortgage-artifact-command'
import { serverDataBackend } from './data-api'
import { asRecord, throwDbError, type CrmSession } from './crm'

export interface MortgageApplicationCommandResult {
  applicationId: string
  stage: string
  revision: number
  artifactId?: string
  decisionDueAt?: string | null
}

export interface MortgageComplianceArtifact {
  id: string
  kind: 'esis' | 'credit_decision' | 'draft_credit_agreement'
  validUntil: string | null
  decisionOutcome: 'positive' | 'negative' | null
  deliveredRecipientCount: number
}

export interface MortgageApplicationComplianceSnapshot {
  stage: string
  revision: number
  decisionOutcome: 'positive' | 'negative' | null
  requiredRecipientCount: number
  esis: MortgageComplianceArtifact | null
  decision: MortgageComplianceArtifact | null
  agreement: MortgageComplianceArtifact | null
}

export function parseMortgageApplicationCommand(input: unknown): Record<string, unknown> {
  return parsePublicMortgageApplicationCommand(input)
}

async function executeParsedMortgageApplicationCommand(
  event: H3Event,
  session: CrmSession,
  caseId: string,
  applicationId: string,
  body: Record<string, unknown>,
): Promise<MortgageApplicationCommandResult> {
  const backend = serverDataBackend(event) as any
  const { data, error } = await backend.rpc('execute_crm_mortgage_application_command', {
    p_request: {
      organizationId: session.organizationId,
      caseId,
      applicationId,
      actorUserId: session.userId,
      commandId: body.commandId,
      expectedRevision: body.expectedRevision,
      command: body.command,
    },
  })
  if (error) {
    const message = String(error.message ?? '')
    const code = String(error.code ?? '')
    if (code === 'P0002' || /not_found|not found/i.test(message)) {
      throw createError({ statusCode: 404, statusMessage: message || 'Mortgage application not found' })
    }
    if (code === '42501') {
      throw createError({ statusCode: 403, statusMessage: message || 'Mortgage application command is not allowed' })
    }
    if (code === '22023') {
      throw createError({ statusCode: 400, statusMessage: message || 'Invalid mortgage application command' })
    }
    if (['23505', '23514', '40001'].includes(code)
      || /revision|conflict|idempot|invalid_transition|validation|missing|expired|required|must_be|cannot|only_|too_short/i.test(message)) {
      throw createError({ statusCode: 409, statusMessage: message || 'Mortgage application command conflict' })
    }
    throwDbError(error)
  }
  const row = asRecord(Array.isArray(data) ? data[0] : data)
  const result = {
    applicationId: String(row.applicationId ?? row.application_id ?? applicationId),
    stage: String(row.stage ?? ''),
    revision: Number(row.revision),
    ...(row.artifactId || row.artifact_id
      ? { artifactId: String(row.artifactId ?? row.artifact_id) }
      : {}),
    decisionDueAt: typeof (row.decisionDueAt ?? row.decision_due_at) === 'string'
      ? String(row.decisionDueAt ?? row.decision_due_at)
      : null,
  }
  if (!result.stage || !Number.isSafeInteger(result.revision) || result.revision < 0) {
    throw createError({ statusCode: 500, statusMessage: 'Mortgage command returned an invalid result' })
  }
  return result
}

export async function executeMortgageApplicationCommand(
  event: H3Event,
  session: CrmSession,
  caseId: string,
  applicationId: string,
  input: unknown,
): Promise<MortgageApplicationCommandResult> {
  return executeParsedMortgageApplicationCommand(
    event,
    session,
    caseId,
    applicationId,
    parseMortgageApplicationCommand(input),
  )
}

/** Server-internal path used only after the dedicated PDF upload validation. */
export async function executeMortgageArtifactAttachmentCommand(
  event: H3Event,
  session: CrmSession,
  caseId: string,
  applicationId: string,
  input: unknown,
): Promise<MortgageApplicationCommandResult> {
  return executeParsedMortgageApplicationCommand(
    event,
    session,
    caseId,
    applicationId,
    parseMortgageArtifactAttachmentCommand(input),
  )
}

function latestByKind(rows: Array<Record<string, any>>) {
  const latest = new Map<string, Record<string, any>>()
  for (const row of rows) {
    const kind = String(row.kind)
    const current = latest.get(kind)
    if (!current || Number(row.version) > Number(current.version)) latest.set(kind, row)
  }
  return latest
}

export async function loadMortgageApplicationComplianceSnapshot(
  session: CrmSession,
  caseId: string,
  applicationId: string,
): Promise<MortgageApplicationComplianceSnapshot> {
  const [processResult, artifactsResult, partiesResult] = await Promise.all([
    session.dataApi
      .from('crm_mortgage_application_processes')
      .select('stage, revision, decision_outcome')
      .eq('organization_id', session.organizationId)
      .eq('case_id', caseId)
      .eq('application_id', applicationId)
      .maybeSingle(),
    session.dataApi
      .from('crm_mortgage_application_artifacts')
      .select('id, kind, version, valid_until, decision_outcome')
      .eq('organization_id', session.organizationId)
      .eq('case_id', caseId)
      .eq('application_id', applicationId),
    session.dataApi
      .from('crm_mortgage_application_parties')
      .select('client_id')
      .eq('organization_id', session.organizationId)
      .eq('case_id', caseId)
      .eq('application_id', applicationId),
  ])
  throwDbError(processResult.error)
  throwDbError(artifactsResult.error)
  throwDbError(partiesResult.error)
  if (!processResult.data) {
    throw createError({ statusCode: 404, statusMessage: 'Mortgage application process not found' })
  }

  const process = processResult.data as Record<string, any>
  const artifacts = (artifactsResult.data ?? []) as Array<Record<string, any>>
  const latest = latestByKind(artifacts)
  const latestIds = [...latest.values()].map(artifact => String(artifact.id))
  const currentClientsResult = String(process.stage) === 'pre_application'
    ? await session.dataApi
        .from('crm_case_clients')
        .select('client_id')
        .eq('organization_id', session.organizationId)
        .eq('case_id', caseId)
    : { data: [], error: null }
  throwDbError(currentClientsResult.error)
  const requiredRecipientIds = new Set(
    String(process.stage) === 'pre_application'
      ? ((currentClientsResult.data ?? []) as Array<Record<string, any>>).map(row => String(row.client_id))
      : ((partiesResult.data ?? []) as Array<Record<string, any>>).map(row => String(row.client_id)),
  )
  const deliveriesResult = latestIds.length
    ? await session.dataApi
        .from('crm_mortgage_artifact_deliveries')
        .select('artifact_id, recipient_client_id')
        .eq('organization_id', session.organizationId)
        .eq('case_id', caseId)
        .eq('application_id', applicationId)
        .in('artifact_id', latestIds)
    : { data: [], error: null }
  throwDbError(deliveriesResult.error)
  const deliveries = (deliveriesResult.data ?? []) as Array<Record<string, any>>

  function artifact(kind: MortgageComplianceArtifact['kind']): MortgageComplianceArtifact | null {
    const row = latest.get(kind)
    if (!row) return null
    const deliveredRecipients = new Set(deliveries.flatMap((delivery) => {
      const recipientId = String(delivery.recipient_client_id ?? '')
      return String(delivery.artifact_id) === String(row.id) && requiredRecipientIds.has(recipientId)
        ? [recipientId]
        : []
    }))
    const outcome = String(row.decision_outcome ?? '')
    return {
      id: String(row.id),
      kind,
      validUntil: row.valid_until ? String(row.valid_until) : null,
      decisionOutcome: outcome === 'positive' || outcome === 'negative' ? outcome : null,
      deliveredRecipientCount: deliveredRecipients.size,
    }
  }

  const outcome = String(process.decision_outcome ?? '')
  return {
    stage: String(process.stage),
    revision: Number(process.revision),
    decisionOutcome: outcome === 'positive' || outcome === 'negative' ? outcome : null,
    requiredRecipientCount: requiredRecipientIds.size,
    esis: artifact('esis'),
    decision: artifact('credit_decision'),
    agreement: artifact('draft_credit_agreement'),
  }
}

export function mortgageContractSelectionIssues(
  snapshot: MortgageApplicationComplianceSnapshot,
  at = new Date(),
): string[] {
  const issues: string[] = []
  if (snapshot.stage !== 'ready_for_contract' || snapshot.decisionOutcome !== 'positive') {
    issues.push('Ścieżka banku nie została zakończona pozytywną decyzją.')
  }
  if (!snapshot.requiredRecipientCount) {
    issues.push('Brakuje zamrożonej listy wnioskodawców.')
  }
  if (!snapshot.decision || snapshot.decision.decisionOutcome !== 'positive') {
    issues.push('Brakuje aktualnej pozytywnej decyzji kredytowej.')
  }
  else {
    if (snapshot.decision.deliveredRecipientCount !== snapshot.requiredRecipientCount) {
      issues.push('Decyzja nie została przekazana wszystkim wnioskodawcom.')
    }
    const validUntil = snapshot.decision.validUntil ? Date.parse(snapshot.decision.validUntil) : Number.NaN
    if (!Number.isFinite(validUntil) || validUntil <= at.getTime()) {
      issues.push('Okres związania banku ofertą wygasł.')
    }
  }
  if (!snapshot.agreement) {
    issues.push('Brakuje aktualnego projektu umowy kredytowej.')
  }
  else if (snapshot.agreement.deliveredRecipientCount !== snapshot.requiredRecipientCount) {
    issues.push('Projekt umowy nie został przekazany wszystkim wnioskodawcom.')
  }
  return issues
}
