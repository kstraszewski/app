export type MortgageUrgentActionKind =
  | 'decision_overdue'
  | 'decision_due_soon'
  | 'decision_received_not_delivered'
  | 'esis_missing'
  | 'esis_delivery_missing'
  | 'offer_expiring'

export type MortgageUrgentActionSeverity = 'critical' | 'warning' | 'info'

export interface MortgageUrgentArtifact {
  id: string
  kind: 'esis' | 'credit_decision'
  receivedAt: string | null
  validUntil: string | null
  decisionOutcome: 'positive' | 'negative' | null
}

export interface MortgageUrgentActionSource {
  caseId: string
  caseTitle: string
  applicationId: string
  bankId: string | null
  bankName: string
  stage: string
  decisionDueAt: string | null
  decisionReceivedAt: string | null
  requiredRecipientCount: number
  esisDeliveryCount: number
  decisionDeliveryCount: number
  earlyDecisionConsentCount: number
  esisArtifact: MortgageUrgentArtifact | null
  decisionArtifact: MortgageUrgentArtifact | null
}

export interface MortgageUrgentAction {
  id: string
  kind: MortgageUrgentActionKind
  severity: MortgageUrgentActionSeverity
  caseId: string
  caseTitle: string
  applicationId: string
  bankId: string | null
  bankName: string
  title: string
  description: string
  dueAt: string | null
  daysRemaining: number | null
  action: {
    label: string
    href: string
  }
}

export interface MortgageUrgentActionsOptions {
  now?: Date
  organizationSlug: string
  decisionWarningDays?: number
  offerWarningDays?: number
}

const DAY_MS = 24 * 60 * 60 * 1_000
const terminalStages = new Set(['completed', 'closed'])
const severityRank: Record<MortgageUrgentActionSeverity, number> = {
  critical: 0,
  warning: 1,
  info: 2,
}
const kindRank: Record<MortgageUrgentActionKind, number> = {
  decision_received_not_delivered: 0,
  decision_overdue: 1,
  offer_expiring: 2,
  decision_due_soon: 3,
  esis_delivery_missing: 4,
  esis_missing: 5,
}

function parsedTime(value: string | null | undefined): number | null {
  if (!value) return null
  const time = new Date(value).getTime()
  return Number.isFinite(time) ? time : null
}

export function countDeliveredRecipients(
  requiredRecipientIds: Iterable<string>,
  deliveredRecipientIds: Iterable<string>,
): number {
  const required = new Set([...requiredRecipientIds].filter(Boolean))
  const delivered = new Set([...deliveredRecipientIds].filter(Boolean))
  let count = 0
  for (const recipientId of required) {
    if (delivered.has(recipientId)) count += 1
  }
  return count
}

export function requiredMortgageRecipientIds(
  stage: string,
  currentCaseClientIds: Iterable<string>,
  frozenApplicationPartyIds: Iterable<string>,
): string[] {
  const source = stage === 'pre_application'
    ? currentCaseClientIds
    : frozenApplicationPartyIds
  return [...new Set([...source].filter(Boolean))]
}

function daysFrom(nowTime: number, dueTime: number): number {
  const difference = (dueTime - nowTime) / DAY_MS
  return difference >= 0 ? Math.ceil(difference) : Math.floor(difference)
}

function caseActionHref(
  organizationSlug: string,
  source: MortgageUrgentActionSource,
  action: 'upload-decision' | 'upload-esis' | 'deliver-decision' | 'deliver-esis' | 'review-offer' | 'record-early-consent',
) {
  const query = new URLSearchParams({
    view: 'credit',
    application: source.applicationId,
    action,
  })
  return `/org/${encodeURIComponent(organizationSlug)}/cases/${encodeURIComponent(source.caseId)}?${query.toString()}`
}

function baseAction(
  source: MortgageUrgentActionSource,
  kind: MortgageUrgentActionKind,
  severity: MortgageUrgentActionSeverity,
  title: string,
  description: string,
  dueAt: string | null,
  daysRemaining: number | null,
  action: MortgageUrgentAction['action'],
): MortgageUrgentAction {
  return {
    id: `${source.applicationId}:${kind}`,
    kind,
    severity,
    caseId: source.caseId,
    caseTitle: source.caseTitle,
    applicationId: source.applicationId,
    bankId: source.bankId,
    bankName: source.bankName,
    title,
    description,
    dueAt,
    daysRemaining,
    action,
  }
}

export function resolveMortgageUrgentActions(
  sources: MortgageUrgentActionSource[],
  options: MortgageUrgentActionsOptions,
): MortgageUrgentAction[] {
  const now = options.now ?? new Date()
  const nowTime = now.getTime()
  const decisionWarningMs = (options.decisionWarningDays ?? 7) * DAY_MS
  const offerWarningMs = (options.offerWarningDays ?? 3) * DAY_MS
  const actions: MortgageUrgentAction[] = []

  for (const source of sources) {
    if (terminalStages.has(source.stage)) continue

    const beforeSubmission = source.stage === 'pre_application'
    const currentEsisRequired = beforeSubmission
      || source.stage === 'under_review'
      || source.stage === 'decision_received'

    if (currentEsisRequired) {
      const esisValidUntil = parsedTime(source.esisArtifact?.validUntil)
      const hasValidEsis = Boolean(
        source.esisArtifact
        && esisValidUntil !== null
        && esisValidUntil > nowTime,
      )

      if (!hasValidEsis) {
        const expired = esisValidUntil !== null && esisValidUntil <= nowTime
        const blocksDecisionDelivery = source.stage === 'decision_received'
        actions.push(baseAction(
          source,
          'esis_missing',
          expired || blocksDecisionDelivery ? 'critical' : beforeSubmission ? 'info' : 'warning',
          expired ? 'ESIS stracił ważność' : blocksDecisionDelivery ? 'ESIS blokuje przekazanie decyzji' : 'Załącz ważny ESIS',
          beforeSubmission
            ? expired
              ? 'Przed złożeniem wniosku potrzebny jest aktualny formularz z banku.'
              : 'Brakuje aktualnego formularza informacyjnego otrzymanego z banku.'
            : blocksDecisionDelivery
              ? 'Dodaj aktualny formularz z banku i przekaż go klientom przed przekazaniem decyzji.'
              : 'Formularz musi być aktualny i przekazany klientom, zanim zostanie zarejestrowana decyzja banku.',
          expired ? source.esisArtifact?.validUntil ?? null : null,
          expired && esisValidUntil !== null ? daysFrom(nowTime, esisValidUntil) : null,
          {
            label: 'Załącz ESIS',
            href: caseActionHref(options.organizationSlug, source, 'upload-esis'),
          },
        ))
      } else if (
        source.requiredRecipientCount > 0
        && source.esisDeliveryCount < source.requiredRecipientCount
      ) {
        const missingRecipients = source.requiredRecipientCount - source.esisDeliveryCount
        actions.push(baseAction(
          source,
          'esis_delivery_missing',
          source.stage === 'decision_received' ? 'critical' : 'warning',
          source.stage === 'decision_received'
            ? 'Przekaż ESIS przed decyzją'
            : 'Przekaż ESIS wszystkim klientom',
          `Brakuje potwierdzenia przekazania dla ${missingRecipients} ${missingRecipients === 1 ? 'wnioskodawcy' : 'wnioskodawców'}.`,
          null,
          null,
          {
            label: 'Przekaż ESIS',
            href: caseActionHref(options.organizationSlug, source, 'deliver-esis'),
          },
        ))
      }
    }

    const decisionDueTime = parsedTime(source.decisionDueAt)
    if (
      !source.decisionArtifact
      && decisionDueTime !== null
      && decisionDueTime <= nowTime + decisionWarningMs
    ) {
      const overdue = decisionDueTime < nowTime
      actions.push(baseAction(
        source,
        overdue ? 'decision_overdue' : 'decision_due_soon',
        overdue ? 'critical' : 'warning',
        overdue ? 'Termin decyzji został przekroczony' : 'Zbliża się termin decyzji',
        overdue
          ? 'Sprawdź odpowiedź banku i załącz otrzymaną decyzję.'
          : 'Monitoruj odpowiedź banku i przygotuj się do przekazania decyzji klientom.',
        source.decisionDueAt,
        daysFrom(nowTime, decisionDueTime),
        {
          label: overdue ? 'Sprawdź decyzję' : 'Otwórz wniosek',
          href: caseActionHref(options.organizationSlug, source, 'upload-decision'),
        },
      ))
    }

    if (
      source.decisionArtifact
      && source.requiredRecipientCount > 0
      && source.decisionDeliveryCount < source.requiredRecipientCount
    ) {
      const missingRecipients = source.requiredRecipientCount - source.decisionDeliveryCount
      const decisionDueTime = parsedTime(source.decisionDueAt)
      const waitingForStatutoryDate = decisionDueTime !== null
        && decisionDueTime > nowTime
        && source.earlyDecisionConsentCount < source.requiredRecipientCount
      actions.push(baseAction(
        source,
        'decision_received_not_delivered',
        waitingForStatutoryDate ? 'warning' : 'critical',
        waitingForStatutoryDate ? 'Decyzja czeka na termin przekazania' : 'Przekaż klientom decyzję kredytową',
        waitingForStatutoryDate
          ? 'Bez zgód wszystkich wnioskodawców decyzję przekaż w ustawowym terminie.'
          : `Decyzja jest w sprawie, ale brakuje potwierdzenia przekazania dla ${missingRecipients} ${missingRecipients === 1 ? 'wnioskodawcy' : 'wnioskodawców'}.`,
        waitingForStatutoryDate ? source.decisionDueAt : null,
        waitingForStatutoryDate && decisionDueTime !== null ? daysFrom(nowTime, decisionDueTime) : null,
        {
          label: waitingForStatutoryDate ? 'Zapisz decyzje klientów' : 'Przekaż decyzję',
          href: caseActionHref(
            options.organizationSlug,
            source,
            waitingForStatutoryDate ? 'record-early-consent' : 'deliver-decision',
          ),
        },
      ))
    }

    const offerValidUntil = parsedTime(source.decisionArtifact?.validUntil)
    if (
      source.decisionArtifact?.decisionOutcome === 'positive'
      && offerValidUntil !== null
      && offerValidUntil <= nowTime + offerWarningMs
    ) {
      const remainingDays = daysFrom(nowTime, offerValidUntil)
      const expired = offerValidUntil <= nowTime
      actions.push(baseAction(
        source,
        'offer_expiring',
        expired || remainingDays <= 1 ? 'critical' : 'warning',
        expired ? 'Oferta banku wygasła' : 'Kończy się ważność oferty banku',
        expired
          ? 'Sprawdź z bankiem, czy warunki decyzji mogą zostać odnowione.'
          : 'Klient powinien mieć czas na porównanie decyzji i projektu umowy.',
        source.decisionArtifact.validUntil,
        remainingDays,
        {
          label: expired ? 'Załącz odnowioną decyzję' : 'Sprawdź ofertę',
          href: caseActionHref(
            options.organizationSlug,
            source,
            expired ? 'upload-decision' : 'review-offer',
          ),
        },
      ))
    }
  }

  return actions.sort((left, right) => {
    const severity = severityRank[left.severity] - severityRank[right.severity]
    if (severity !== 0) return severity
    const dueLeft = parsedTime(left.dueAt) ?? Number.POSITIVE_INFINITY
    const dueRight = parsedTime(right.dueAt) ?? Number.POSITIVE_INFINITY
    if (dueLeft !== dueRight) return dueLeft - dueRight
    const kind = kindRank[left.kind] - kindRank[right.kind]
    if (kind !== 0) return kind
    return left.id.localeCompare(right.id)
  })
}

export function mortgageUrgentActionCounts(actions: MortgageUrgentAction[]) {
  return actions.reduce((counts, action) => {
    counts.total += 1
    counts[action.severity] += 1
    return counts
  }, { total: 0, critical: 0, warning: 0, info: 0 })
}
