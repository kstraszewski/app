import type { PortalDashboardNextStep } from '../../shared/types/portal-dashboard.ts'
import { isTerminalPortalCase } from '../../shared/utils/portal-case-status.ts'

export interface PortalCaseActionInput {
  caseId: string
  statusCode?: string | null
  closedAt?: string | null
  progressPercent?: number | null
  missingDocumentCount: number
  multiformEnabled: boolean
  multiformEligible: boolean
  multiformCompletedAt?: string | null
}

export interface PortalCaseActionSummary {
  kind: 'upload_document' | 'complete_multiform' | 'wait'
  title: string
  description: string
  label: string | null
  to: string | null
}

export interface PortalDashboardCaseCandidate {
  id: string
  action?: PortalCaseActionSummary | null
}

export interface PortalDashboardAppointmentCandidate {
  id: string
  status: string
  startsAt: string
  endsAt: string
  relationship?: 'first' | 'follow-up' | null
}

export interface PortalDocumentVisibilityInput {
  organizationId: unknown
  caseId: unknown
  clientId: unknown
  uploadedByClientPersonId: unknown
  statusCode: unknown
}

export interface PortalDocumentVisibilityScope {
  organizationId: string
  caseId: string
  clientId: string
  clientPersonId: string
  clientPersonRole: string
}

function normalizedStatus(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

/**
 * A client sees their own uploads. A primary person may additionally see the
 * names/statuses of case-level missing requirements created by the expert.
 * Callers must still select only summary columns (never storage or metadata).
 */
export function isSafePortalDocumentSummary(
  document: PortalDocumentVisibilityInput,
  scope: PortalDocumentVisibilityScope,
): boolean {
  if (
    String(document.organizationId) !== scope.organizationId
    || String(document.caseId) !== scope.caseId
    || (
      document.clientId != null
      && String(document.clientId) !== scope.clientId
    )
  ) return false

  const uploadedBy = document.uploadedByClientPersonId == null
    ? ''
    : String(document.uploadedByClientPersonId)
  if (uploadedBy === scope.clientPersonId) return true

  return !uploadedBy
    && normalizedStatus(document.statusCode) === 'missing'
    && scope.clientPersonRole === 'primary'
}

export function isCompletedPortalCase(input: PortalCaseActionInput): boolean {
  return isTerminalPortalCase(input)
}

export function buildPortalCaseAction(
  input: PortalCaseActionInput,
): PortalCaseActionSummary {
  if (isCompletedPortalCase(input)) {
    return {
      kind: 'wait',
      title: 'Sprawa została zakończona',
      description: 'Nie musisz teraz nic robić. Historia sprawy pozostaje dostępna w panelu.',
      label: null,
      to: null,
    }
  }

  if (input.missingDocumentCount > 0) {
    const suffix = input.missingDocumentCount === 1
      ? 'jednego dokumentu'
      : `${input.missingDocumentCount} dokumentów`
    return {
      kind: 'upload_document',
      title: 'Uzupełnij brakujące dokumenty',
      description: `Ekspert czeka na uzupełnienie ${suffix}.`,
      label: 'Dodaj dokumenty',
      to: `/cases/${input.caseId}?view=documents`,
    }
  }

  if (
    input.multiformEnabled
    && input.multiformEligible
    && !input.multiformCompletedAt
  ) {
    return {
      kind: 'complete_multiform',
      title: 'Uzupełnij formularz Multiwniosku',
      description: 'Ekspert udostępnił pytania potrzebne do przygotowania dokumentów.',
      label: 'Przejdź do formularza',
      to: `/cases/${input.caseId}/multiform`,
    }
  }

  return {
    kind: 'wait',
    title: 'Sprawa jest po stronie eksperta',
    description: 'Gdy będzie potrzebne Twoje działanie, zobaczysz je w tym miejscu.',
    label: null,
    to: null,
  }
}

export function selectNextPortalAppointment<
  T extends PortalDashboardAppointmentCandidate,
>(appointments: T[], now = Date.now()): T | null {
  return appointments
    .filter((appointment) => {
      const endsAt = Date.parse(appointment.endsAt)
      return appointment.status !== 'cancelled'
        && Number.isFinite(endsAt)
        && endsAt >= now
    })
    .sort((left, right) => left.startsAt.localeCompare(right.startsAt))[0] ?? null
}

export function buildPortalDashboardNextStep(
  cases: PortalDashboardCaseCandidate[],
  nextAppointment: PortalDashboardAppointmentCandidate | null,
  now = Date.now(),
): PortalDashboardNextStep {
  const actionableCase = cases.find(portalCase => (
    portalCase.action?.kind === 'upload_document'
  )) ?? cases.find(portalCase => (
    portalCase.action?.kind === 'complete_multiform'
  ))

  if (actionableCase?.action) {
    return {
      kind: actionableCase.action.kind,
      responsibility: 'client',
      title: actionableCase.action.kind === 'upload_document'
        ? 'Teraz załącz dokumenty'
        : 'Teraz uzupełnij formularz',
      description: actionableCase.action.description,
      caseId: actionableCase.id,
      appointmentId: null,
      label: actionableCase.action.label,
      to: actionableCase.action.to,
    }
  }

  const isFirstAppointment = nextAppointment?.relationship === 'first'

  if (nextAppointment && isFirstAppointment) {
    const startsAt = Date.parse(nextAppointment.startsAt)
    const startsWithinTwoDays = Number.isFinite(startsAt)
      && startsAt - now <= 48 * 60 * 60 * 1000
    return {
      kind: 'prepare_appointment',
      responsibility: 'client',
      title: 'Teraz przygotuj się do pierwszego spotkania',
      description: startsWithinTwoDays
        ? 'Spotkanie już niedługo. W kilka minut uporządkujesz swoją sytuację i wybierzesz pytania do eksperta.'
        : 'W kilka minut uporządkujesz swoją sytuację, poznasz najważniejsze pojęcia i wybierzesz pytania do eksperta.',
      caseId: null,
      appointmentId: nextAppointment.id,
      label: 'Przygotuj się do spotkania',
      to: `/prepare?appointmentId=${encodeURIComponent(nextAppointment.id)}`,
    }
  }

  if (!cases.length) {
    return {
      kind: 'wait',
      responsibility: 'expert',
      title: 'Teraz czekasz na udostępnienie sprawy',
      description: 'Ekspert udostępni sprawę, gdy będzie gotowa do prowadzenia w panelu.',
      caseId: null,
      appointmentId: null,
      label: null,
      to: null,
    }
  }

  const waitingCase = cases.find(portalCase => (
    portalCase.action?.title !== 'Sprawa została zakończona'
  )) ?? cases[0]
  return {
    kind: 'wait',
    responsibility: 'expert',
    title: waitingCase?.action?.title === 'Sprawa została zakończona'
      ? 'Nie musisz teraz nic robić'
      : 'Teraz sprawa jest po stronie eksperta',
    description: waitingCase?.action?.description
      ?? 'Gdy będzie potrzebne Twoje działanie, zobaczysz je w tym miejscu.',
    caseId: waitingCase?.id ?? null,
    appointmentId: null,
    label: null,
    to: waitingCase ? `/cases/${waitingCase.id}` : null,
  }
}
