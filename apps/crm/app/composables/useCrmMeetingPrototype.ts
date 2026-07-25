import type {
  CrmMeetingMortgageComparisonInput,
  CrmMeetingPrototypeState,
} from '../types/crm-meeting.ts'
import {
  createMortgageComparisonArtifact,
  mortgageProcessArtifact,
} from '../utils/crm-meeting-artifacts.ts'

function defaultPrototypeState(): CrmMeetingPrototypeState {
  return {
    active: false,
    displayMode: 'expanded',
    appointmentId: null,
    caseId: null,
    clientName: null,
    activeArtifactKind: 'mortgage-process',
    mortgageComparison: null,
    activeProcessStepId: mortgageProcessArtifact.steps[1]!.id,
    selectedOfferId: null,
    clientSignal: 'none',
    startedAt: null,
  }
}

export function useCrmMeetingPrototype() {
  const state = useState<CrmMeetingPrototypeState>(
    'openexpert-crm-meeting-prototype',
    defaultPrototypeState,
  )

  function openMeeting(context?: {
    appointmentId?: string
    caseId?: string
    clientName?: string
    startedAt?: string
  }) {
    state.value = {
      ...state.value,
      active: true,
      displayMode: 'expanded',
      appointmentId: context?.appointmentId ?? state.value.appointmentId,
      caseId: context?.caseId ?? state.value.caseId,
      clientName: context?.clientName ?? state.value.clientName,
      startedAt: context?.startedAt ?? state.value.startedAt ?? new Date().toISOString(),
    }
  }

  function minimizeMeeting() {
    if (!state.value.active) return
    state.value = { ...state.value, displayMode: 'minimized' }
  }

  function expandMeeting() {
    if (!state.value.active) return
    state.value = { ...state.value, displayMode: 'expanded' }
  }

  function endMeeting() {
    state.value = {
      ...state.value,
      active: false,
      displayMode: 'expanded',
      appointmentId: null,
      caseId: null,
      clientName: null,
      clientSignal: 'none',
      startedAt: null,
    }
  }

  function showMortgageProcess() {
    state.value = {
      ...state.value,
      activeArtifactKind: 'mortgage-process',
      clientSignal: 'none',
    }
    openMeeting()
  }

  function publishMortgageComparison(input: CrmMeetingMortgageComparisonInput) {
    const comparison = createMortgageComparisonArtifact(input)
    state.value = {
      ...state.value,
      active: true,
      displayMode: 'expanded',
      activeArtifactKind: 'mortgage-comparison',
      mortgageComparison: comparison,
      selectedOfferId: comparison.offers[0]?.id ?? null,
      clientSignal: 'none',
      startedAt: state.value.startedAt ?? new Date().toISOString(),
    }
  }

  return {
    state,
    mortgageProcessArtifact,
    openMeeting,
    minimizeMeeting,
    expandMeeting,
    endMeeting,
    showMortgageProcess,
    publishMortgageComparison,
  }
}
