import type {
  CaseBankApplication,
  CaseDetail,
  MortgageApplicationProcess,
  MortgageNextAction,
  MortgageNextActionKind,
  MortgageProcessStepKey,
  MortgageProcessStepStatus,
  SavedCaseOffer,
} from '../types/cases'

export type MortgageProcessStepVisualStatus =
  | 'complete'
  | 'current'
  | 'attention'
  | 'pending'
  | 'unknown'
  | 'skipped'

export interface MortgageProcessStepPresentation {
  key: MortgageProcessStepKey
  label: string
  status: MortgageProcessStepVisualStatus
  statusLabel: string
  detail: string
  actionKind: MortgageNextActionKind | null
}

export interface MortgageActionTarget {
  applicationId: string | null
  kind: MortgageNextActionKind
}

const stepLabels: Record<MortgageProcessStepKey, string> = {
  esis: 'ESIS',
  application: 'Wniosek',
  completeness: 'Kompletność',
  decision: 'Decyzja',
  agreement: 'Umowa',
}

const actionLabels: Record<MortgageNextActionKind, string> = {
  'add-client': 'Dodaj wnioskodawców',
  'add-offer': 'Zbuduj shortlistę',
  'add-application': 'Dodaj bank do wniosków',
  'upload-esis': 'Załącz ESIS',
  'deliver-esis': 'Przekaż ESIS klientowi',
  'submit-application': 'Przejdź do wniosku',
  'confirm-completeness': 'Zapisz potwierdzenie kompletności',
  'record-early-consent': 'Zapisz decyzje klientów',
  'resume-review': 'Wznów analizę banku',
  'upload-decision': 'Załącz decyzję',
  'deliver-decision': 'Przekaż decyzję klientowi',
  'deliver-agreement': 'Przekaż projekt umowy',
  'review-offer': 'Sprawdź decyzję i ofertę',
  'upload-agreement': 'Załącz projekt umowy',
  'review-agreement': 'Wybierz umowę finalną',
  'complete-application': 'Zakończ walidację',
  'close-application': 'Wycofaj wniosek',
  'open-documents': 'Zarejestruj braki banku',
  'wait-bank': 'Zobacz przebieg',
}

const stageRank: Record<NonNullable<MortgageApplicationProcess['stage']>, number> = {
  pre_application: 0,
  submitted: 1,
  awaiting_completeness: 2,
  under_review: 3,
  additional_information_requested: 3,
  decision_received: 4,
  decision_delivered: 5,
  agreement_review: 6,
  ready_for_contract: 7,
  completed: 8,
  closed: 8,
}

const severityRank: Record<MortgageNextAction['severity'], number> = {
  critical: 0,
  warning: 1,
  normal: 2,
  waiting: 3,
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function validDate(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null
  return Number.isNaN(Date.parse(value)) ? null : value
}

function processFor(application: CaseBankApplication): MortgageApplicationProcess | null {
  if (application.mortgage_process) return application.mortgage_process
  const metadata = asRecord(application.metadata)
  const candidate = asRecord(metadata?.mortgage_process)
  return candidate && typeof candidate.stage === 'string'
    ? candidate as unknown as MortgageApplicationProcess
    : null
}

function explicitNextAction(application: CaseBankApplication): MortgageNextAction | null {
  if (application.next_action) return application.next_action
  const metadata = asRecord(application.metadata)
  const candidate = asRecord(metadata?.next_action)
  if (!candidate || typeof candidate.kind !== 'string' || typeof candidate.title !== 'string') return null
  return candidate as unknown as MortgageNextAction
}

function bankNameFor(application: CaseBankApplication, offers: SavedCaseOffer[]): string {
  return offers.find(offer => offer.id === application.offer_id)?.bank_name ?? 'Bank'
}

function dueAt(action: MortgageNextAction): string | null {
  return validDate(action.due_at) ?? validDate(action.due_on)
}

function isOverdue(value: string | null, now: Date): boolean {
  return Boolean(value && Date.parse(value) < now.getTime())
}

function normalizeAction(
  action: MortgageNextAction,
  application: CaseBankApplication,
  bankName: string,
  now: Date,
): MortgageNextAction {
  const kind = Object.hasOwn(actionLabels, action.kind) ? action.kind : 'open-documents'
  const severity = Object.hasOwn(severityRank, action.severity) ? action.severity : 'normal'
  const responsibility = ['expert', 'client', 'bank'].includes(action.responsibility)
    ? action.responsibility
    : 'expert'
  const deadline = dueAt(action)
  return {
    ...action,
    kind,
    title: typeof action.title === 'string' && action.title.trim() ? action.title : actionLabels[kind],
    responsibility,
    severity,
    application_id: action.application_id ?? application.id,
    bank_name: action.bank_name ?? bankName,
    overdue: action.overdue ?? isOverdue(deadline, now),
  }
}

function fallbackAction(
  application: CaseBankApplication,
  bankName: string,
  now: Date,
): MortgageNextAction {
  const process = processFor(application)
  const rank = process ? stageRank[process.stage] : null
  const esis = process?.steps?.esis
  const decision = process?.steps?.decision
  const agreement = process?.steps?.agreement
  const shared = { application_id: application.id, bank_name: bankName }

  if (application.status_code === 'wycofane' || process?.stage === 'completed' || process?.stage === 'closed') {
    return {
      ...shared,
      kind: 'wait-bank',
      title: application.status_code === 'wycofane' ? `${bankName}: wniosek wycofany` : `${bankName}: proces zakończony`,
      description: 'Ta ścieżka nie wymaga teraz działania eksperta.',
      responsibility: 'bank',
      severity: 'waiting',
    }
  }

  if (process?.stage === 'ready_for_contract') {
    return {
      ...shared,
      kind: 'review-agreement',
      title: `Wybierz umowę ${bankName}`,
      description: 'Walidacja dokumentów jest zakończona. Wskaż podpisaną umowę finalną.',
      responsibility: 'expert',
      severity: 'normal',
    }
  }

  if (application.status_code === 'braki' || process?.stage === 'additional_information_requested') {
    return {
      ...shared,
      kind: 'resume-review',
      title: `Wznów analizę w ${bankName}`,
      description: 'Potwierdź, że wymagane informacje lub dokumenty zostały uzupełnione.',
      responsibility: 'expert',
      severity: 'warning',
      blocking: true,
    }
  }

  if (process?.stage === 'decision_received' && !process.decision_delivered_at) {
    return {
      ...shared,
      kind: decision?.action_kind ?? 'deliver-decision',
      title: `Przekaż decyzję z ${bankName}`,
      description: 'Decyzja jest już w sprawie, ale nie ma potwierdzenia przekazania klientowi.',
      responsibility: 'expert',
      severity: 'critical',
      blocking: true,
    }
  }

  if (['zaakceptowane', 'odrzucone'].includes(application.status_code) && !process?.decision_received_at) {
    return {
      ...shared,
      kind: 'upload-decision',
      title: `Załącz decyzję z ${bankName}`,
      description: 'Status wskazuje na decyzję banku. Dodaj jej oryginalny dokument do sprawy.',
      responsibility: 'expert',
      severity: 'critical',
      blocking: true,
    }
  }

  if (rank != null && rank >= stageRank.decision_delivered && rank < stageRank.ready_for_contract) {
    const agreementAction = agreement?.status === 'complete'
      ? 'complete-application'
      : agreement?.action_kind ?? (agreement?.status === 'missing' ? 'upload-agreement' : 'review-agreement')
    return {
      ...shared,
      kind: agreementAction,
      title: agreement?.status === 'missing' ? `Załącz projekt umowy z ${bankName}` : `Sprawdź ofertę ${bankName}`,
      description: 'Decyzja została przekazana. Zweryfikuj okres związania ofertą i projekt umowy.',
      responsibility: 'expert',
      severity: 'normal',
    }
  }

  if (application.status_code === 'draft' || rank === stageRank.pre_application || rank == null) {
    const needsDelivery = esis?.status === 'pending' && esis.action_kind === 'deliver-esis'
    return {
      ...shared,
      kind: needsDelivery ? 'deliver-esis' : esis?.action_kind ?? 'upload-esis',
      title: needsDelivery ? `Przekaż ESIS dla ${bankName}` : `Załącz ESIS dla ${bankName}`,
      description: needsDelivery
        ? 'Dokument jest w sprawie, ale wymaga przekazania klientowi i zapisania potwierdzenia.'
        : 'Przed wysłaniem wniosku potrzebny jest aktualny formularz informacyjny banku.',
      responsibility: 'expert',
      severity: esis?.status === 'expired' ? 'critical' : 'normal',
      blocking: true,
    }
  }

  if (process?.stage === 'submitted' || process?.stage === 'awaiting_completeness') {
    return {
      ...shared,
      kind: 'confirm-completeness',
      title: `Potwierdź kompletność w ${bankName}`,
      description: 'Zapisz potwierdzoną przez bank datę otrzymania kompletnego wniosku.',
      responsibility: 'expert',
      severity: 'normal',
      blocking: true,
    }
  }

  if (process?.stage === 'under_review' || ['wyslane', 'w_analizie'].includes(application.status_code)) {
    const deadline = validDate(process?.decision_due_at)
    return {
      ...shared,
      kind: 'wait-bank',
      title: `Oczekiwanie na decyzję ${bankName}`,
      description: deadline ? 'Bank analizuje kompletny wniosek. Monitoruj ustawowy termin decyzji.' : 'Bank analizuje wniosek.',
      responsibility: 'bank',
      severity: isOverdue(deadline, now) ? 'critical' : 'waiting',
      due_at: deadline,
      overdue: isOverdue(deadline, now),
    }
  }

  return {
    ...shared,
    kind: 'wait-bank',
    title: `${bankName}: proces zakończony`,
    description: 'Ta ścieżka nie wymaga teraz działania eksperta.',
    responsibility: 'bank',
    severity: 'waiting',
  }
}

export function resolveMortgageApplicationNextAction(
  application: CaseBankApplication,
  offers: SavedCaseOffer[],
  now = new Date(),
): MortgageNextAction {
  const bankName = bankNameFor(application, offers)
  const process = processFor(application)
  if (application.status_code === 'wycofane' || process?.stage === 'completed' || process?.stage === 'closed') {
    return fallbackAction(application, bankName, now)
  }
  const explicit = explicitNextAction(application)
  return explicit
    ? normalizeAction(explicit, application, bankName, now)
    : fallbackAction(application, bankName, now)
}

export function resolveCaseMortgageNextAction(caseData: CaseDetail, now = new Date()): MortgageNextAction {
  if (!caseData.clients.length) {
    return {
      kind: 'add-client',
      title: 'Dodaj wnioskodawców',
      description: 'Uzupełnij osoby składające wniosek, aby rozpocząć proces hipoteczny.',
      responsibility: 'expert',
      severity: 'normal',
      blocking: true,
      application_id: null,
    }
  }
  if (!caseData.offers.length) {
    return {
      kind: 'add-offer',
      title: 'Zbuduj shortlistę banków',
      description: 'Porównaj oferty i wybierz banki, w których przygotujesz wnioski.',
      responsibility: 'expert',
      severity: 'normal',
      application_id: null,
    }
  }
  if (!caseData.bank_applications.length) {
    return {
      kind: 'add-application',
      title: 'Dodaj pierwszy bank do wniosków',
      description: 'Możesz prowadzić do trzech procesów bankowych równolegle.',
      responsibility: 'expert',
      severity: 'normal',
      application_id: null,
    }
  }

  const actions = caseData.bank_applications.map(application => (
    resolveMortgageApplicationNextAction(application, caseData.offers, now)
  ))
  actions.sort((left, right) => {
    const severityDifference = severityRank[left.severity] - severityRank[right.severity]
    if (severityDifference) return severityDifference
    if (Boolean(left.blocking) !== Boolean(right.blocking)) return left.blocking ? -1 : 1
    const leftDue = dueAt(left)
    const rightDue = dueAt(right)
    if (leftDue && rightDue) return Date.parse(leftDue) - Date.parse(rightDue)
    if (leftDue) return -1
    if (rightDue) return 1
    return String(left.application_id).localeCompare(String(right.application_id))
  })
  return actions[0]!
}

function explicitStepStatus(
  status: MortgageProcessStepStatus,
  isCurrent: boolean,
): MortgageProcessStepVisualStatus {
  if (status === 'complete') return 'complete'
  if (status === 'not_applicable') return 'skipped'
  if (status === 'missing' || status === 'expired') return isCurrent ? 'attention' : 'unknown'
  return isCurrent ? 'current' : 'pending'
}

function visualLabel(status: MortgageProcessStepVisualStatus): string {
  if (status === 'complete') return 'Gotowe'
  if (status === 'current') return 'W toku'
  if (status === 'attention') return 'Wymaga działania'
  if (status === 'unknown') return 'Do potwierdzenia'
  if (status === 'skipped') return 'Nie dotyczy'
  return 'Przed Tobą'
}

export function resolveMortgageProcessSteps(
  application: CaseBankApplication,
  isContract = false,
): MortgageProcessStepPresentation[] {
  const process = processFor(application)
  const rank = process ? stageRank[process.stage] : null
  const decisionReceived = Boolean(
    process?.decision_received_at
    || application.decision_at
    || ['zaakceptowane', 'odrzucone'].includes(application.status_code),
  )
  const decisionDelivered = Boolean(
    process?.decision_delivered_at
    || process?.steps?.decision?.status === 'complete'
    || (rank != null && rank >= stageRank.decision_delivered),
  )
  const completed: Record<MortgageProcessStepKey, boolean> = {
    esis: process?.steps?.esis?.status === 'complete',
    application: Boolean(process?.application_submitted_at || application.submitted_at || (rank != null && rank >= 1)),
    completeness: Boolean(process?.completeness_confirmed_at || (rank != null && rank >= stageRank.under_review)),
    decision: decisionReceived,
    agreement: isContract || process?.stage === 'completed',
  }
  const currentKey: MortgageProcessStepKey = isContract || process?.stage === 'completed'
    ? 'agreement'
    : decisionDelivered
      ? 'agreement'
      : rank != null && rank >= stageRank.under_review
        ? 'decision'
        : completed.application
          ? 'completeness'
          : 'esis'

  return (Object.keys(stepLabels) as MortgageProcessStepKey[]).map((key) => {
    const explicit = process?.steps?.[key]
    let status: MortgageProcessStepVisualStatus
    if (key === 'agreement' && process?.stage === 'ready_for_contract' && !isContract) status = 'current'
    else if (explicit) status = explicitStepStatus(explicit.status, currentKey === key)
    else if (key === 'esis' && (completed.application || currentKey !== 'esis')) status = 'unknown'
    else if (completed[key]) status = key === 'esis' ? 'unknown' : 'complete'
    else if (currentKey === key) status = key === 'esis' ? 'attention' : 'current'
    else status = 'pending'

    let detail = explicit?.detail ?? visualLabel(status)
    if (key === 'esis' && status === 'unknown') detail = 'Brak potwierdzenia'
    if (key === 'completeness' && process?.completeness_confirmed_at) detail = 'Potwierdzona przez bank'
    if (key === 'decision' && process?.decision_due_at && !decisionReceived) detail = 'Termin decyzji zapisany'
    if (key === 'decision' && decisionReceived) detail = process?.decision_outcome === 'negative' || application.status_code === 'odrzucone' ? 'Negatywna' : 'Otrzymana'
    if (key === 'agreement' && process?.stage === 'ready_for_contract' && !isContract) detail = 'Gotowa do wyboru'
    if (key === 'agreement' && isContract) detail = 'Podpisana'

    return {
      key,
      label: stepLabels[key],
      status,
      statusLabel: visualLabel(status),
      detail,
      actionKind: explicit?.action_kind ?? null,
    }
  })
}

export function mortgageActionLabel(kind: MortgageNextActionKind): string {
  return actionLabels[kind]
}

export function mortgageActionDeadline(action: MortgageNextAction): string | null {
  return dueAt(action)
}

export function mortgageApplicationProcess(application: CaseBankApplication): MortgageApplicationProcess | null {
  return processFor(application)
}
