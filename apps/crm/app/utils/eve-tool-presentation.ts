import type { EveDynamicToolPart } from 'eve/vue'

export type EveToolTone = 'neutral' | 'success' | 'warning' | 'error'

interface EveToolDefinition {
  activeLabel: string
  completeLabel: string
  icon: string
  label: string
  source: string
}

export interface EveToolStatusPresentation {
  icon: string
  label: string
  tone: EveToolTone
}

const toolDefinitions: Record<string, EveToolDefinition> = {
  list_user_cases: {
    label: 'Znajdź sprawy w CRM',
    activeLabel: 'Szukam spraw w CRM',
    completeLabel: 'Znaleziono sprawy w CRM',
    icon: 'i-lucide-database',
    source: 'CRM OpenExpert',
  },
  crm_search: {
    label: 'Wyszukaj dane w CRM',
    activeLabel: 'Przeszukuję CRM',
    completeLabel: 'Przeszukano CRM',
    icon: 'i-lucide-search',
    source: 'CRM OpenExpert',
  },
  check_case_documents: {
    label: 'Sprawdź dokumenty',
    activeLabel: 'Sprawdzam dokumenty',
    completeLabel: 'Sprawdzono dokumenty',
    icon: 'i-lucide-folder-check',
    source: 'Repozytorium dokumentów',
  },
  compare_mortgage_offers: {
    label: 'Porównaj oferty',
    activeLabel: 'Porównuję oferty',
    completeLabel: 'Porównano oferty',
    icon: 'i-lucide-landmark',
    source: 'Silnik ofert banków',
  },
  add_case_note: {
    label: 'Dodaj podsumowanie',
    activeLabel: 'Przygotowuję podsumowanie',
    completeLabel: 'Dodano podsumowanie',
    icon: 'i-lucide-notebook-pen',
    source: 'CRM OpenExpert',
  },
  crm_add_note: {
    label: 'Dodaj notatkę do sprawy',
    activeLabel: 'Przygotowuję notatkę',
    completeLabel: 'Dodano notatkę do sprawy',
    icon: 'i-lucide-notebook-pen',
    source: 'CRM OpenExpert',
  },
  crm_create_case: {
    label: 'Utwórz sprawę',
    activeLabel: 'Przygotowuję nową sprawę',
    completeLabel: 'Utworzono sprawę',
    icon: 'i-lucide-briefcase-business',
    source: 'CRM OpenExpert',
  },
  crm_update_status: {
    label: 'Zmień status sprawy',
    activeLabel: 'Przygotowuję zmianę statusu',
    completeLabel: 'Zmieniono status sprawy',
    icon: 'i-lucide-refresh-cw',
    source: 'CRM OpenExpert',
  },
}

function normalizedToolName(toolName: string) {
  return toolName.trim().toLowerCase().replace(/[.\-]/g, '_')
}

export function eveToolDefinition(toolName: string): EveToolDefinition {
  const normalized = normalizedToolName(toolName)
  return toolDefinitions[normalized] ?? {
    label: 'Wykonaj działanie',
    activeLabel: 'Wykonuję działanie',
    completeLabel: 'Zakończono działanie',
    icon: 'i-lucide-wand-sparkles',
    source: 'Agent AI',
  }
}

export function eveToolStatus(part: EveDynamicToolPart): EveToolStatusPresentation {
  if (part.state === 'output-available') {
    return { label: 'Ukończono', tone: 'success', icon: 'i-lucide-check' }
  }
  if (part.state === 'output-error') {
    return { label: 'Nie udało się', tone: 'error', icon: 'i-lucide-x' }
  }
  if (part.state === 'output-denied') {
    return { label: 'Odrzucono', tone: 'neutral', icon: 'i-lucide-ban' }
  }
  if (part.state === 'approval-requested') {
    return { label: 'Oczekuje na Twoją zgodę', tone: 'warning', icon: 'i-lucide-circle-alert' }
  }
  if (part.state === 'approval-responded') {
    return part.approval.approved === false
      ? { label: 'Odrzucono', tone: 'neutral', icon: 'i-lucide-ban' }
      : { label: 'Zatwierdzono · uruchamiam', tone: 'success', icon: 'i-lucide-check' }
  }
  if (part.state === 'input-available') {
    return { label: 'W trakcie', tone: 'success', icon: 'i-lucide-loader-circle' }
  }
  return { label: 'Przygotowuję', tone: 'neutral', icon: 'i-lucide-loader-circle' }
}

export function eveToolTitle(part: EveDynamicToolPart) {
  const definition = eveToolDefinition(part.toolName)
  if (part.state === 'output-available') return definition.completeLabel
  if (
    part.state === 'input-streaming'
    || part.state === 'input-available'
    || part.state === 'approval-responded'
  ) return definition.activeLabel
  return definition.label
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function shortText(value: unknown, maxLength = 120) {
  if (typeof value !== 'string') return null
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (!normalized) return null
  return normalized.length <= maxLength
    ? normalized
    : `${normalized.slice(0, maxLength - 1).trimEnd()}…`
}

export function eveToolInputSummary(part: EveDynamicToolPart) {
  const input = objectValue(part.input)
  if (!input) return 'Agent przygotował bezpieczny zakres działania.'

  const toolName = normalizedToolName(part.toolName)

  if (toolName === 'list_user_cases') {
    const scope = input.scope === 'organization' ? 'cała organizacja' : 'sprawy przypisane do Ciebie'
    return `Zakres: ${scope}`
  }

  if (toolName === 'add_case_note' || toolName === 'crm_add_note') {
    const summary = shortText(input.summary ?? input.note)
    if (summary) return `Treść notatki: ${summary}`
    return 'Agent przygotował notatkę do aktywnej sprawy.'
  }

  if (
    toolName === 'check_case_documents'
    || toolName === 'compare_mortgage_offers'
    || toolName === 'crm_search'
    || toolName === 'crm_create_case'
    || toolName === 'crm_update_status'
  ) {
    const client = shortText(input.clientName, 80)
    const caseTitle = shortText(input.caseTitle, 80)
    if (client || caseTitle) return `Kontekst: ${client ?? caseTitle}`
    return 'Zakres: aktywna organizacja i bieżąca sprawa.'
  }

  return 'Agent przygotował bezpieczny zakres działania.'
}

export function eveToolOutputSummary(part: EveDynamicToolPart) {
  if (part.state === 'output-error') return 'Narzędzie nie zwróciło wyniku. Możesz spróbować ponownie.'
  if (part.state === 'output-denied') return 'Działanie zostało odrzucone.'
  if (part.state !== 'output-available') return null

  const output = objectValue(part.output)
  if (!output) return 'Działanie zakończyło się powodzeniem.'

  const toolName = normalizedToolName(part.toolName)

  if (toolName === 'list_user_cases' && Array.isArray(output.cases)) {
    const count = typeof output.total === 'number' ? output.total : output.cases.length
    return count === 1 ? 'Znaleziono 1 sprawę.' : `Znaleziono ${count} spraw.`
  }
  if (toolName === 'check_case_documents' && Array.isArray(output.missingDocuments)) {
    const count = output.missingDocuments.length
    return count === 0 ? 'Dokumentacja jest kompletna.' : `Brakuje ${count} dokumentów.`
  }
  if (toolName === 'compare_mortgage_offers' && Array.isArray(output.offers)) {
    const count = output.offers.length
    return count === 1 ? 'Porównano 1 ofertę.' : `Porównano ${count} ofert.`
  }

  return 'Działanie zakończyło się powodzeniem.'
}

export function eveToolIsOpenByDefault(part: EveDynamicToolPart) {
  return part.state === 'input-available'
    || part.state === 'approval-requested'
    || part.state === 'approval-responded'
    || part.state === 'output-error'
}

export function eveToolIsLoading(part: EveDynamicToolPart) {
  return part.state === 'input-streaming'
    || part.state === 'input-available'
    || (part.state === 'approval-responded' && part.approval.approved !== false)
}
