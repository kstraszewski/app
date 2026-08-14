import type { CrmSession } from './crm'
import { requiredMortgageRecipientIds } from './mortgage-urgent-actions.ts'

type Row = Record<string, any>

export interface MortgageReadModelApplication {
  id: string
  bankName: string
}

export interface MortgageApplicationReadModel {
  mortgage_process: Record<string, any>
  next_action: Record<string, any>
}

export interface BuildMortgageApplicationReadModelsInput {
  applications: MortgageReadModelApplication[]
  processes: Row[]
  artifacts: Row[]
  parties: Row[]
  deliveries: Row[]
  consents?: Row[]
  currentCaseClientIds: string[]
  clientNames?: Record<string, string>
  contractApplicationId?: string | null
  now?: Date
}

interface ArtifactState {
  artifact: Row | null
  requiredRecipientCount: number
  deliveredRecipientCount: number
  fullyDelivered: boolean
  deliveredAt: string | null
}

const processSelect = [
  'application_id',
  'stage',
  'revision',
  'application_submitted_at',
  'application_acknowledged_at',
  'completeness_confirmed_at',
  'decision_due_at',
  'deadline_policy_version',
  'additional_information_requested_at',
  'decision_received_at',
  'decision_outcome',
  'closed_at',
].join(', ')

const artifactSelect = [
  'id',
  'application_id',
  'kind',
  'version',
  'issued_at',
  'received_at',
  'valid_from',
  'valid_until',
  'decision_outcome',
].join(', ')

function grouped<RowType extends Row>(rows: RowType[], key: keyof RowType | string) {
  const result = new Map<string, RowType[]>()
  for (const row of rows) {
    const value = row[key]
    if (value == null) continue
    const groupKey = String(value)
    const entries = result.get(groupKey) ?? []
    entries.push(row)
    result.set(groupKey, entries)
  }
  return result
}

function latestArtifact(rows: Row[], kind: string): Row | null {
  let latest: Row | null = null
  for (const row of rows) {
    if (String(row.kind) !== kind) continue
    if (!latest || Number(row.version) > Number(latest.version)) latest = row
  }
  return latest
}

function validTime(value: unknown): number | null {
  if (typeof value !== 'string' || !value) return null
  const time = Date.parse(value)
  return Number.isFinite(time) ? time : null
}

function lastDeliveryAt(deliveries: Row[]): string | null {
  let latest: string | null = null
  let latestTime = Number.NEGATIVE_INFINITY
  for (const delivery of deliveries) {
    const value = typeof delivery.delivered_at === 'string' ? delivery.delivered_at : null
    const time = validTime(value)
    if (value && time !== null && time > latestTime) {
      latest = value
      latestTime = time
    }
  }
  return latest
}

function effectiveGrantedConsentCount(
  consents: Row[],
  requiredRecipientIds: string[],
  nowTime: number,
): number {
  const required = new Set(requiredRecipientIds)
  const effective = new Map<string, { decision: string, capturedAt: number, tieBreaker: string }>()
  for (const consent of consents) {
    const clientId = String(consent.client_id ?? '')
    const capturedAt = validTime(consent.captured_at)
    if (!required.has(clientId) || capturedAt === null || capturedAt > nowTime) continue
    const tieBreaker = `${String(consent.created_at ?? '')}:${String(consent.id ?? '')}`
    const current = effective.get(clientId)
    if (!current || capturedAt > current.capturedAt || (capturedAt === current.capturedAt && tieBreaker > current.tieBreaker)) {
      effective.set(clientId, {
        decision: String(consent.decision ?? ''),
        capturedAt,
        tieBreaker,
      })
    }
  }
  return [...effective.values()].filter(consent => consent.decision === 'granted').length
}

function artifactState(
  artifact: Row | null,
  requiredRecipientIds: string[],
  deliveriesByArtifact: Map<string, Row[]>,
): ArtifactState {
  const deliveries = artifact
    ? deliveriesByArtifact.get(String(artifact.id)) ?? []
    : []
  const required = new Set(requiredRecipientIds)
  const delivered = new Set(deliveries.flatMap((delivery) => {
    const clientId = delivery.recipient_client_id
    return clientId != null && required.has(String(clientId)) ? [String(clientId)] : []
  }))

  return {
    artifact,
    requiredRecipientCount: required.size,
    deliveredRecipientCount: delivered.size,
    fullyDelivered: required.size > 0 && delivered.size === required.size,
    deliveredAt: delivered.size === required.size && required.size > 0
      ? lastDeliveryAt(deliveries.filter(delivery => required.has(String(delivery.recipient_client_id))))
      : null,
  }
}

function step(
  status: 'missing' | 'pending' | 'complete' | 'expired' | 'not_applicable',
  detail: string,
  actionKind: string | null,
  values: Record<string, unknown> = {},
) {
  return {
    status,
    detail,
    action_kind: actionKind,
    ...values,
  }
}

function nextAction(
  applicationId: string,
  bankName: string,
  kind: string,
  title: string,
  description: string,
  responsibility: 'expert' | 'client' | 'bank',
  severity: 'critical' | 'warning' | 'normal' | 'waiting',
  values: Record<string, unknown> = {},
) {
  return {
    kind,
    title,
    description,
    responsibility,
    severity,
    application_id: applicationId,
    bank_name: bankName,
    ...values,
  }
}

export function buildMortgageApplicationReadModels(
  input: BuildMortgageApplicationReadModelsInput,
): Map<string, MortgageApplicationReadModel> {
  const now = input.now ?? new Date()
  const nowTime = now.getTime()
  const processesByApplication = new Map(
    input.processes.map(process => [String(process.application_id), process]),
  )
  const artifactsByApplication = grouped(input.artifacts, 'application_id')
  const partiesByApplication = grouped(input.parties, 'application_id')
  const consentsByApplication = grouped(input.consents ?? [], 'application_id')
  const deliveriesByArtifact = grouped(input.deliveries, 'artifact_id')
  const result = new Map<string, MortgageApplicationReadModel>()

  for (const application of input.applications) {
    const process = processesByApplication.get(application.id)
    if (!process) continue
    const stage = String(process.stage)
    const partyIds = (partiesByApplication.get(application.id) ?? [])
      .map(party => String(party.client_id))
    const requiredRecipientIds = requiredMortgageRecipientIds(
      stage,
      input.currentCaseClientIds,
      partyIds,
    )
    const artifacts = artifactsByApplication.get(application.id) ?? []
    const esis = artifactState(
      latestArtifact(artifacts, 'esis'),
      requiredRecipientIds,
      deliveriesByArtifact,
    )
    const decision = artifactState(
      latestArtifact(artifacts, 'credit_decision'),
      requiredRecipientIds,
      deliveriesByArtifact,
    )
    const agreement = artifactState(
      latestArtifact(artifacts, 'draft_credit_agreement'),
      requiredRecipientIds,
      deliveriesByArtifact,
    )
    const esisValidUntil = validTime(esis.artifact?.valid_until)
    const esisValid = esisValidUntil !== null && esisValidUntil > nowTime
    const decisionDue = validTime(process.decision_due_at)
    const decisionOverdue = decisionDue !== null && decisionDue < nowTime
    const decisionDueSoon = decisionDue !== null && decisionDue <= nowTime + 7 * 86_400_000
    const outcome = decision.artifact?.decision_outcome ?? process.decision_outcome ?? null
    const decisionValidUntil = validTime(decision.artifact?.valid_until)
    const positiveDecisionExpired = outcome === 'positive'
      && (decisionValidUntil === null || decisionValidUntil <= nowTime)
    const earlyConsentGrantedCount = effectiveGrantedConsentCount(
      consentsByApplication.get(application.id) ?? [],
      requiredRecipientIds,
      nowTime,
    )
    const earlyConsentComplete = requiredRecipientIds.length > 0
      && earlyConsentGrantedCount === requiredRecipientIds.length

    const esisStep = !esis.artifact
      ? step('missing', 'Brak formularza z banku', 'upload-esis')
      : !esisValid
        ? step('expired', 'Formularz nieważny lub bez daty ważności', 'upload-esis', {
            artifact_id: String(esis.artifact.id),
            valid_until: esis.artifact.valid_until ?? null,
          })
        : esis.fullyDelivered
          ? step('complete', 'Ważny i przekazany wszystkim', null, {
              artifact_id: String(esis.artifact.id),
              completed_at: esis.deliveredAt,
              valid_until: esis.artifact.valid_until,
              delivered_recipient_count: esis.deliveredRecipientCount,
              required_recipient_count: esis.requiredRecipientCount,
            })
          : step('pending', `Przekazano ${esis.deliveredRecipientCount}/${esis.requiredRecipientCount}`, 'deliver-esis', {
              artifact_id: String(esis.artifact.id),
              valid_until: esis.artifact.valid_until,
              delivered_recipient_count: esis.deliveredRecipientCount,
              required_recipient_count: esis.requiredRecipientCount,
            })

    // Historical applications can already be beyond pre-application without a
    // trustworthy legacy submission timestamp. Never reopen their submit step.
    const submitted = Boolean(process.application_submitted_at) || stage !== 'pre_application'
    const completenessConfirmed = Boolean(process.completeness_confirmed_at)
    const decisionReceived = Boolean(decision.artifact || process.decision_received_at)
    const decisionReadinessRequired = completenessConfirmed || decisionReceived
    const applicationStep = submitted
      ? step('complete', 'Wysłany do banku', null, { completed_at: process.application_submitted_at })
      : step('pending', 'Gotowy po walidacji ESIS', 'submit-application')
    const completenessStep = completenessConfirmed
      ? step('complete', 'Potwierdzona przez bank', null, { completed_at: process.completeness_confirmed_at })
      : decisionReceived
        ? step('pending', 'Brak historycznego potwierdzenia', null)
      : stage === 'additional_information_requested'
        ? step('missing', 'Bank oczekuje uzupełnienia', 'resume-review', {
            completed_at: process.additional_information_requested_at,
          })
        : submitted
          ? step('pending', 'Oczekuje na potwierdzenie banku', 'confirm-completeness')
          : step('pending', 'Po wysłaniu wniosku', null)
    const decisionStep = decision.artifact
      ? decision.fullyDelivered
        ? step('complete', outcome === 'negative' ? 'Negatywna · przekazana' : 'Pozytywna · przekazana', null, {
            artifact_id: String(decision.artifact.id),
            completed_at: decision.deliveredAt,
            valid_until: decision.artifact.valid_until ?? null,
          })
        : step('pending', `Otrzymana · przekazano ${decision.deliveredRecipientCount}/${decision.requiredRecipientCount}`, 'deliver-decision', {
            artifact_id: String(decision.artifact.id),
            valid_until: decision.artifact.valid_until ?? null,
            delivered_recipient_count: decision.deliveredRecipientCount,
            required_recipient_count: decision.requiredRecipientCount,
          })
      : decisionReceived
        ? step('missing', 'Brak dokumentu decyzji', 'upload-decision', { due_at: process.decision_due_at ?? null })
        : completenessConfirmed
          ? step(decisionOverdue ? 'missing' : 'pending', decisionOverdue ? 'Termin przekroczony' : 'Oczekiwanie na bank', decisionOverdue ? 'upload-decision' : 'wait-bank', {
              due_at: process.decision_due_at ?? null,
            })
          : step('pending', 'Po potwierdzeniu kompletności', null)
    const agreementStep = outcome === 'negative'
      ? step('not_applicable', 'Decyzja negatywna', null)
      : !decision.fullyDelivered
        ? step('pending', 'Po przekazaniu decyzji', null)
        : !agreement.artifact
          ? step('missing', 'Brak projektu umowy', 'upload-agreement')
          : agreement.fullyDelivered
            ? step('complete', 'Projekt przekazany wszystkim', 'review-agreement', {
                artifact_id: String(agreement.artifact.id),
                completed_at: agreement.deliveredAt,
              })
            : step('pending', `Przekazano ${agreement.deliveredRecipientCount}/${agreement.requiredRecipientCount}`, 'deliver-agreement', {
                artifact_id: String(agreement.artifact.id),
                delivered_recipient_count: agreement.deliveredRecipientCount,
                required_recipient_count: agreement.requiredRecipientCount,
              })

    let action: Record<string, any>
    if (stage === 'closed' || stage === 'completed') {
      action = nextAction(application.id, application.bankName, 'wait-bank', `${application.bankName}: proces zakończony`, 'Ta ścieżka nie wymaga teraz działania eksperta.', 'bank', 'waiting')
    }
    else if (stage === 'ready_for_contract' && positiveDecisionExpired) {
      action = nextAction(application.id, application.bankName, 'upload-decision', `Odśwież decyzję z ${application.bankName}`, 'Okres związania banku ofertą wygasł. Dodaj odnowioną decyzję przed wyborem umowy.', 'expert', 'critical', { blocking: true })
    }
    else if (stage === 'ready_for_contract') {
      action = nextAction(application.id, application.bankName, 'review-agreement', `Wybierz umowę ${application.bankName}`, 'Walidacja jest zakończona. Przejdź do wyboru finalnej umowy.', 'expert', 'normal')
    }
    else if (!submitted && (!esis.artifact || !esisValid)) {
      action = nextAction(application.id, application.bankName, 'upload-esis', `Załącz ESIS dla ${application.bankName}`, 'Przed wysłaniem wniosku potrzebny jest aktualny formularz informacyjny otrzymany z banku.', 'expert', esis.artifact ? 'critical' : 'normal', { blocking: true })
    }
    else if (!submitted && !esis.fullyDelivered) {
      action = nextAction(application.id, application.bankName, 'deliver-esis', `Przekaż ESIS dla ${application.bankName}`, 'Zapisz dowód przekazania aktualnego ESIS każdemu wnioskodawcy.', 'expert', 'warning', { blocking: true })
    }
    else if (!submitted) {
      action = nextAction(application.id, application.bankName, 'submit-application', `Wyślij wniosek do ${application.bankName}`, 'System ponownie sprawdzi ważność i doręczenie ESIS przed zapisaniem wysłania.', 'expert', 'normal', { blocking: true })
    }
    else if (stage === 'additional_information_requested') {
      action = nextAction(application.id, application.bankName, 'resume-review', `Wznów analizę w ${application.bankName}`, 'Potwierdź, że wymagane informacje lub dokumenty zostały uzupełnione.', 'expert', 'warning', { blocking: true })
    }
    else if (decisionReadinessRequired && !decision.fullyDelivered && (!esis.artifact || !esisValid)) {
      action = nextAction(
        application.id,
        application.bankName,
        'upload-esis',
        `Załącz aktualny ESIS dla ${application.bankName}`,
        decisionReceived
          ? 'Przed przekazaniem decyzji klientom potrzebny jest aktualny formularz informacyjny z banku.'
          : 'Przygotuj aktualny formularz informacyjny, aby decyzja mogła zostać poprawnie zarejestrowana i przekazana.',
        'expert',
        decisionReceived || Boolean(esis.artifact) ? 'critical' : 'warning',
        { blocking: true },
      )
    }
    else if (decisionReadinessRequired && !decision.fullyDelivered && !esis.fullyDelivered) {
      action = nextAction(
        application.id,
        application.bankName,
        'deliver-esis',
        `Przekaż aktualny ESIS dla ${application.bankName}`,
        'Zapisz dowód przekazania aktualnego ESIS każdemu wnioskodawcy przed przekazaniem decyzji.',
        'expert',
        decisionReceived ? 'critical' : 'warning',
        { blocking: true },
      )
    }
    else if (decisionReceived && !decision.artifact) {
      action = nextAction(application.id, application.bankName, 'upload-decision', `Załącz decyzję z ${application.bankName}`, 'Decyzja jest odnotowana historycznie, ale brakuje jej źródłowego dokumentu PDF.', 'expert', 'critical', { blocking: true, due_at: process.decision_due_at ?? null })
    }
    else if (!completenessConfirmed) {
      action = nextAction(application.id, application.bankName, 'confirm-completeness', `Potwierdź kompletność w ${application.bankName}`, 'Zapisz datę kompletności potwierdzoną przez bank. Od niej zostanie wyliczony termin decyzji.', 'expert', 'normal', { blocking: true })
    }
    else if (!decision.artifact) {
      action = nextAction(
        application.id,
        application.bankName,
        decisionOverdue ? 'upload-decision' : 'wait-bank',
        decisionOverdue ? `Załącz decyzję z ${application.bankName}` : `Oczekiwanie na decyzję ${application.bankName}`,
        decisionOverdue ? 'Termin minął. Sprawdź odpowiedź banku i dodaj otrzymany dokument.' : 'Bank analizuje kompletny wniosek.',
        decisionOverdue ? 'expert' : 'bank',
        decisionOverdue ? 'critical' : decisionDueSoon ? 'warning' : 'waiting',
        { due_at: process.decision_due_at ?? null, overdue: decisionOverdue },
      )
    }
    else if (!decision.fullyDelivered) {
      action = decisionDue !== null && decisionDue > nowTime && !earlyConsentComplete
        ? nextAction(
            application.id,
            application.bankName,
            'wait-bank',
            `Decyzja ${application.bankName} czeka na termin przekazania`,
            'Możesz przekazać ją wcześniej dopiero po zapisaniu zgody każdego wnioskodawcy.',
            'bank',
            'waiting',
            { due_at: process.decision_due_at ?? null },
          )
        : nextAction(application.id, application.bankName, 'deliver-decision', `Przekaż decyzję z ${application.bankName}`, 'Decyzja jest w sprawie, ale nie ma pełnego potwierdzenia przekazania wnioskodawcom.', 'expert', 'critical', { blocking: true })
    }
    else if (outcome === 'negative') {
      action = nextAction(application.id, application.bankName, 'complete-application', `Zakończ ścieżkę ${application.bankName}`, 'Decyzja negatywna została przekazana. Zamknij obsługę tego wniosku.', 'expert', 'normal')
    }
    else if (!agreement.artifact) {
      action = nextAction(application.id, application.bankName, 'upload-agreement', `Załącz projekt umowy z ${application.bankName}`, 'Dodaj projekt umowy odpowiadający warunkom decyzji i przekaż go wnioskodawcom.', 'expert', 'normal', { blocking: true })
    }
    else if (!agreement.fullyDelivered) {
      action = nextAction(application.id, application.bankName, 'deliver-agreement', `Przekaż projekt umowy z ${application.bankName}`, 'Brakuje potwierdzenia przekazania projektu umowy wszystkim wnioskodawcom.', 'expert', 'warning', { blocking: true })
    }
    else {
      action = nextAction(application.id, application.bankName, 'complete-application', `Potwierdź gotowość umowy ${application.bankName}`, 'Dokumenty zostały przekazane. Zakończ walidację ścieżki, aby umożliwić wybór umowy finalnej.', 'expert', 'normal')
    }

    result.set(application.id, {
      mortgage_process: {
        stage,
        revision: Number(process.revision ?? 0),
        application_submitted_at: process.application_submitted_at ?? null,
        application_acknowledged_at: process.application_acknowledged_at ?? null,
        completeness_confirmed_at: process.completeness_confirmed_at ?? null,
        decision_due_at: process.decision_due_at ?? null,
        deadline_policy_version: process.deadline_policy_version ?? null,
        additional_information_requested_at: process.additional_information_requested_at ?? null,
        decision_received_at: decision.artifact?.received_at ?? process.decision_received_at ?? null,
        decision_delivered_at: decision.deliveredAt,
        decision_outcome: outcome,
        early_decision_consent_granted_count: earlyConsentGrantedCount,
        early_decision_consent_required_count: requiredRecipientIds.length,
        early_decision_consent_complete: earlyConsentComplete,
        closed_at: process.closed_at ?? null,
        recipients: requiredRecipientIds.map(clientId => ({
          client_id: clientId,
          display_name: input.clientNames?.[clientId] ?? 'Wnioskodawca',
        })),
        steps: {
          esis: esisStep,
          application: applicationStep,
          completeness: completenessStep,
          decision: decisionStep,
          agreement: agreementStep,
        },
      },
      next_action: action,
    })
  }

  return result
}

export async function loadMortgageApplicationReadModels(
  session: CrmSession,
  caseId: string,
  applications: MortgageReadModelApplication[],
  currentCaseClientIds: string[],
  currentClientNames: Record<string, string> = {},
  contractApplicationId: string | null = null,
  now = new Date(),
): Promise<Map<string, MortgageApplicationReadModel>> {
  const { throwDbError } = await import('./crm')
  if (!applications.length) return new Map()
  const applicationIds = applications.map(application => application.id)
  const [processesResult, artifactsResult, partiesResult, consentsResult] = await Promise.all([
    session.dataApi
      .from('crm_mortgage_application_processes')
      .select(processSelect)
      .eq('organization_id', session.organizationId)
      .eq('case_id', caseId)
      .in('application_id', applicationIds),
    session.dataApi
      .from('crm_mortgage_application_artifacts')
      .select(artifactSelect)
      .eq('organization_id', session.organizationId)
      .eq('case_id', caseId)
      .in('application_id', applicationIds),
    session.dataApi
      .from('crm_mortgage_application_parties')
      .select('application_id, client_id')
      .eq('organization_id', session.organizationId)
      .eq('case_id', caseId)
      .in('application_id', applicationIds),
    session.dataApi
      .from('crm_mortgage_early_decision_consents')
      .select('id, application_id, client_id, decision, captured_at, created_at')
      .eq('organization_id', session.organizationId)
      .eq('case_id', caseId)
      .in('application_id', applicationIds),
  ])
  throwDbError(processesResult.error)
  throwDbError(artifactsResult.error)
  throwDbError(partiesResult.error)
  throwDbError(consentsResult.error)

  const artifacts = (artifactsResult.data ?? []) as Row[]
  const parties = (partiesResult.data ?? []) as Row[]
  const allRecipientIds = [...new Set([
    ...currentCaseClientIds,
    ...parties.map(party => String(party.client_id)),
  ])]
  const clientsResult = allRecipientIds.length
    ? await session.dataApi
        .from('crm_clients')
        .select('id, display_name')
        .eq('organization_id', session.organizationId)
        .in('id', allRecipientIds)
    : { data: [], error: null }
  throwDbError(clientsResult.error)
  const clientNames = {
    ...currentClientNames,
    ...Object.fromEntries(((clientsResult.data ?? []) as Row[]).map(client => [
      String(client.id),
      String(client.display_name || 'Wnioskodawca'),
    ])),
  }
  const artifactIds = artifacts.map(artifact => String(artifact.id))
  const deliveriesResult = artifactIds.length
    ? await session.dataApi
        .from('crm_mortgage_artifact_deliveries')
        .select('artifact_id, recipient_client_id, delivered_at')
        .eq('organization_id', session.organizationId)
        .eq('case_id', caseId)
        .in('artifact_id', artifactIds)
    : { data: [], error: null }
  throwDbError(deliveriesResult.error)

  return buildMortgageApplicationReadModels({
    applications,
    processes: (processesResult.data ?? []) as Row[],
    artifacts,
    parties,
    deliveries: (deliveriesResult.data ?? []) as Row[],
    consents: (consentsResult.data ?? []) as Row[],
    currentCaseClientIds,
    clientNames,
    contractApplicationId,
    now,
  })
}
