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
  search_mail: {
    label: 'Przeszukaj pocztę',
    activeLabel: 'Przeszukuję pocztę',
    completeLabel: 'Przeszukano pocztę',
    icon: 'i-lucide-mail-search',
    source: 'Poczta OpenExpert',
  },
  read_mail_threads: {
    label: 'Odczytaj korespondencję',
    activeLabel: 'Odczytuję korespondencję',
    completeLabel: 'Odczytano korespondencję',
    icon: 'i-lucide-mails',
    source: 'Poczta OpenExpert',
  },
  search_mail_attachments: {
    label: 'Wyszukaj pliki w poczcie',
    activeLabel: 'Szukam plików w poczcie',
    completeLabel: 'Przeszukano pocztę',
    icon: 'i-lucide-mail-search',
    source: 'Poczta OpenExpert',
  },
  read_mail_attachment: {
    label: 'Odczytaj załączniki',
    activeLabel: 'Odczytuję załączniki',
    completeLabel: 'Odczytano załączniki',
    icon: 'i-lucide-file-search-2',
    source: 'Poczta OpenExpert',
  },
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

  if (toolName === 'search_mail_attachments') {
    const query = shortText(input.query, 100)
    const participant = shortText(input.participantEmail, 100)
    const folder = input.folder === 'sent' ? 'wysłane' : 'odebrane'
    if (participant) return `Poczta ${folder} · uczestnik: ${participant}`
    if (query) return `Poczta ${folder} · zapytanie: ${query}`
    return `Poczta ${folder} · ostatnie wiadomości z plikami`
  }

  if (toolName === 'search_mail') {
    const query = shortText(input.query, 100)
    const participant = shortText(input.participantEmail, 100)
    const scope = objectValue(input.scope)
    const folder = input.folder === 'sent'
      ? 'wysłane'
      : input.folder === 'inbox' ? 'odebrane' : 'cała skrzynka'
    const continuation = typeof input.cursor === 'string' ? ' · kolejna strona' : ''
    if (scope?.type === 'case') return `Poczta sprawy · ${folder}${continuation}`
    if (scope?.type === 'client') return `Poczta klienta · ${folder}${continuation}`
    if (participant) return `${folder} · uczestnik: ${participant}${continuation}`
    if (query) return `${folder} · zapytanie: ${query}${continuation}`
    return `${folder} · ostatnia korespondencja${continuation}`
  }

  if (toolName === 'read_mail_threads') {
    const question = shortText(input.question, 120)
    const count = Array.isArray(input.references) ? input.references.length : 1
    const scope = count === 1 ? '1 wątek' : `${count} wątki`
    return question ? `${scope} · cel: ${question}` : `${scope} z poczty`
  }

  if (toolName === 'read_mail_attachment') {
    const question = shortText(input.question, 120)
    const count = Array.isArray(input.references) ? input.references.length : 1
    const scope = count === 1 ? '1 plik' : `${count} pliki`
    return question ? `${scope} · szukana informacja: ${question}` : `${scope} z poczty`
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
  if (toolName === 'search_mail_attachments' && Array.isArray(output.messages)) {
    const count = output.messages.length
    return count === 0
      ? 'Nie znaleziono wiadomości z pasującymi plikami.'
      : count === 1 ? 'Znaleziono 1 wiadomość z plikami.' : `Znaleziono ${count} wiadomości z plikami.`
  }
  if (toolName === 'search_mail' && Array.isArray(output.threads)) {
    const count = output.threads.length
    const coverage = objectValue(output.coverage)
    const suffix = coverage?.complete === false ? ' Zakres nie jest jeszcze kompletny.' : ''
    return count === 0
      ? `Nie znaleziono pasującej korespondencji.${suffix}`
      : count === 1
        ? `Znaleziono 1 wątek.${suffix}`
        : `Znaleziono ${count} wątków.${suffix}`
  }
  if (toolName === 'read_mail_threads' && Array.isArray(output.threads)) {
    const readCount = typeof output.readThreadCount === 'number'
      ? output.readThreadCount
      : output.threads.length
    const failureCount = typeof output.failureCount === 'number' ? output.failureCount : 0
    if (failureCount > 0) return `Odczytano ${readCount} wątków; ${failureCount} nie udało się odczytać.`
    const hasOlder = output.threads.some(value => objectValue(value)?.nextReference)
    const suffix = hasOlder ? ' Dostępne są starsze wiadomości.' : ''
    return readCount === 1 ? `Odczytano 1 wątek.${suffix}` : `Odczytano ${readCount} wątki.${suffix}`
  }
  if (toolName === 'read_mail_attachment') {
    if (Array.isArray(output.attachments)) {
      const readCount = typeof output.readAttachmentCount === 'number'
        ? output.readAttachmentCount
        : output.attachments.length
      const failureCount = typeof output.failureCount === 'number' ? output.failureCount : 0
      if (failureCount > 0) return `Odczytano ${readCount} plików; ${failureCount} nie udało się odczytać.`
      return readCount === 1 ? 'Odczytano 1 załącznik.' : `Odczytano ${readCount} załączniki.`
    }
    const extraction = objectValue(output.extraction)
    if (extraction?.status === 'extracted') return 'Wyodrębniono tekst z załącznika.'
    if (extraction?.status === 'no_text') return 'Załącznik nie zawiera tekstu możliwego do odczytania.'
    if (extraction?.status === 'unsupported') return 'Format załącznika nie jest jeszcze obsługiwany.'
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
