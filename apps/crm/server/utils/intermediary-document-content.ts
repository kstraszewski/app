import {
  intermediarySettingsReadiness,
  normalizeIntermediarySettings,
  type OrganizationIntermediarySettings,
} from '../../shared/intermediary-settings.ts'

export const INTERMEDIARY_DOCUMENT_GENERATOR_VERSION = 2 as const
export const intermediaryDocumentKinds = ['ofi', 'rodo'] as const
export type IntermediaryDocumentKind = typeof intermediaryDocumentKinds[number]

export interface IntermediaryDocumentSection {
  title: string
  paragraphs?: string[]
  items?: Array<{
    label: string
    value: string
    values?: string[]
    presentation?: 'lender-list'
  }>
}

export interface IntermediaryDocumentContent {
  kind: IntermediaryDocumentKind
  title: string
  subtitle: string
  legalReference: string
  organizationName: string
  revision: number
  generatedAt: string
  draft: boolean
  missing: string[]
  sections: IntermediaryDocumentSection[]
}

function value(value: string, fallback = 'Nie dotyczy'): string {
  return value.trim() || fallback
}

function yesNo(input: boolean): string {
  return input ? 'Tak' : 'Nie'
}

function normalizedNameSet(names: string[]): Set<string> {
  return new Set(names.map(name => name.normalize('NFKC').toLocaleLowerCase('pl-PL')))
}

function sameNames(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false
  const rightNames = normalizedNameSet(right)
  return left.every(name => rightNames.has(name.normalize('NFKC').toLocaleLowerCase('pl-PL')))
}

function joinedAddress(parts: Array<string | undefined>): string {
  return parts.map(part => part?.trim()).filter(Boolean).join(', ')
}

function intermediaryAddress(settings: OrganizationIntermediarySettings): string {
  return joinedAddress([
    settings.intermediary.addressLine,
    [settings.intermediary.postalCode, settings.intermediary.city].filter(Boolean).join(' '),
    settings.intermediary.country,
  ])
}

function agentAddress(settings: OrganizationIntermediarySettings): string {
  return joinedAddress([
    settings.agent.addressLine,
    [settings.agent.postalCode, settings.agent.city].filter(Boolean).join(' '),
    settings.agent.country,
  ])
}

function ofiContent(
  settings: OrganizationIntermediarySettings,
  input: Omit<IntermediaryDocumentContent, 'kind' | 'title' | 'subtitle' | 'legalReference' | 'sections'>,
): IntermediaryDocumentContent {
  const representedLenders = settings.relationship.lenderNames
  const cooperatingLenders = settings.relationship.cooperatingLenderNames
  const cooperationMatchesRepresentation = settings.relationship.isTiedMortgageIntermediary
    && representedLenders.length > 0
    && sameNames(representedLenders, cooperatingLenders)
  const hasAgentAddress = Boolean(
    settings.agent.addressLine
    || settings.agent.postalCode
    || settings.agent.city,
  )
  const sections: IntermediaryDocumentSection[] = [
    {
      title: '1. Tożsamość pośrednika kredytu hipotecznego',
      items: [
        { label: 'Firma', value: value(settings.intermediary.legalName, 'Nie uzupełniono') },
        { label: 'Siedziba / miejsce zamieszkania', value: value(settings.intermediary.registeredOffice, 'Nie uzupełniono') },
        { label: 'Adres', value: value(intermediaryAddress(settings), 'Nie uzupełniono') },
        ...(settings.intermediary.email
          ? [{ label: 'E-mail', value: settings.intermediary.email }]
          : []),
        ...(settings.intermediary.phone
          ? [{ label: 'Telefon', value: settings.intermediary.phone }]
          : []),
        ...(settings.intermediary.website
          ? [{ label: 'Strona internetowa', value: settings.intermediary.website }]
          : []),
      ],
    },
    {
      title: '2. Rejestr pośredników kredytowych',
      items: [
        { label: 'Numer wpisu RPH', value: value(settings.intermediary.mortgageRegisterNumber, 'Nie uzupełniono') },
        { label: 'Publiczny rejestr KNF', value: value(settings.intermediary.mortgageRegisterUrl, 'Nie uzupełniono') },
      ],
    },
    {
      title: '3. Status, doradztwo i współpraca z kredytodawcami',
      items: [
        { label: 'Powiązany pośrednik kredytu hipotecznego', value: yesNo(settings.relationship.isTiedMortgageIntermediary) },
        ...(settings.relationship.isTiedMortgageIntermediary
          ? [{
              label: 'Kredytodawcy, w imieniu i na rzecz których działa (art. 17 ust. 1 pkt 3)',
              value: value(representedLenders.join(', '), 'Nie uzupełniono'),
              values: representedLenders,
              presentation: 'lender-list' as const,
            }]
          : []),
        {
          label: 'Kredytodawcy z aktywną umową współpracy (informacja dodatkowa)',
          value: cooperationMatchesRepresentation
            ? 'Lista jest tożsama z kredytodawcami wskazanymi powyżej.'
            : value(cooperatingLenders.join(', '), 'Nie wskazano aktywnych współprac.'),
          values: cooperationMatchesRepresentation ? [] : cooperatingLenders,
          presentation: 'lender-list',
        },
        { label: 'Oferuje usługi doradcze', value: yesNo(settings.relationship.offersAdvisoryServices) },
        ...(settings.relationship.authorizationScope
          ? [{ label: 'Zakres umocowania', value: settings.relationship.authorizationScope }]
          : []),
        ...(settings.relationship.generalMortgageInformationUrl
          ? [{ label: 'Informacje ogólne z art. 10 ustawy', value: settings.relationship.generalMortgageInformationUrl }]
          : []),
      ],
    },
  ]

  if (settings.providerRole === 'agent') {
    sections.push({
      title: '4. Agent obsługujący konsumenta',
      items: [
        { label: 'Firma / nazwa agenta', value: value(settings.agent.legalName, 'Nie uzupełniono') },
        { label: 'Funkcja', value: value(settings.agent.roleDescription, 'Nie uzupełniono') },
        { label: 'Reprezentowany pośrednik', value: value(settings.intermediary.legalName, 'Nie uzupełniono') },
        ...(settings.agent.registerNumber
          ? [{ label: 'Numer wpisu RHA', value: settings.agent.registerNumber }]
          : []),
        ...(hasAgentAddress
          ? [{ label: 'Adres', value: agentAddress(settings) }]
          : []),
        ...(settings.agent.email
          ? [{ label: 'E-mail', value: settings.agent.email }]
          : []),
        ...(settings.agent.phone
          ? [{ label: 'Telefon', value: settings.agent.phone }]
          : []),
      ],
    })
  }

  sections.push(
    {
      title: `${settings.providerRole === 'agent' ? '5' : '4'}. Skargi, reklamacje i odwołania`,
      items: [
        { label: 'Procedura wewnętrzna', value: value(settings.complaints.internalProcedure, 'Nie uzupełniono') },
        ...(settings.complaints.email
          ? [{ label: 'E-mail', value: settings.complaints.email }]
          : []),
        ...(settings.complaints.phone
          ? [{ label: 'Telefon', value: settings.complaints.phone }]
          : []),
        ...(settings.complaints.postalAddress
          ? [{ label: 'Adres korespondencyjny', value: settings.complaints.postalAddress }]
          : []),
        { label: 'Pozasądowe procedury skarg i odwołań', value: value(settings.complaints.externalProcedure, 'Nie uzupełniono') },
        ...(settings.complaints.externalProcedureUrl
          ? [{ label: 'Informacje online', value: settings.complaints.externalProcedureUrl }]
          : []),
      ],
    },
    {
      title: `${settings.providerRole === 'agent' ? '6' : '5'}. Wynagrodzenie i opłaty`,
      items: [
        {
          label: 'Prowizje lub inne korzyści od kredytodawców albo innych podmiotów',
          value: settings.remuneration.receivesFromLenders
            ? value(settings.remuneration.lenderRemunerationDescription, 'Nie uzupełniono')
            : 'Nie są otrzymywane',
        },
        ...(settings.remuneration.receivesFromLenders
          ? [{
              label: 'Wysokość wynagrodzenia',
              value: settings.remuneration.lenderRemunerationAmountKnown
                ? value(settings.remuneration.lenderRemunerationAmountDescription, 'Nie uzupełniono')
                : 'Nie jest znana w chwili przekazania niniejszej informacji. Kwota zostanie podana w formularzu informacyjnym dotyczącym kredytu hipotecznego.',
            }]
          : []),
        {
          label: 'Opłaty ponoszone bezpośrednio przez konsumenta',
          value: settings.remuneration.chargesClientFees
            ? value(settings.remuneration.clientFeeDescription, 'Nie uzupełniono')
            : 'Brak opłat',
        },
      ],
    },
  )

  return {
    ...input,
    kind: 'ofi',
    title: 'Informacja o pośredniku kredytu hipotecznego (OFI)',
    subtitle: 'Informacja przekazywana konsumentowi przed rozpoczęciem świadczenia usług',
    legalReference: 'Art. 17 ustawy z dnia 23 marca 2017 r. o kredycie hipotecznym oraz o nadzorze nad pośrednikami kredytu hipotecznego i agentami.',
    sections,
  }
}

function rodoContent(
  settings: OrganizationIntermediarySettings,
  input: Omit<IntermediaryDocumentContent, 'kind' | 'title' | 'subtitle' | 'legalReference' | 'sections'>,
): IntermediaryDocumentContent {
  const privacy = settings.privacy
  const sections: IntermediaryDocumentSection[] = [
    {
      title: '1. Administrator danych osobowych',
      items: [
        { label: 'Administrator', value: value(privacy.controllerName, 'Nie uzupełniono') },
        { label: 'Adres', value: value(privacy.controllerAddress, 'Nie uzupełniono') },
        { label: 'E-mail', value: value(privacy.controllerEmail, 'Nie uzupełniono') },
        { label: 'Telefon', value: value(privacy.controllerPhone) },
      ],
    },
    {
      title: '2. Inspektor ochrony danych',
      items: privacy.dpoAppointed
        ? [
            { label: 'Imię, nazwisko lub funkcja', value: value(privacy.dpoName) },
            { label: 'E-mail', value: value(privacy.dpoEmail) },
            { label: 'Telefon', value: value(privacy.dpoPhone) },
          ]
        : [{ label: 'Status', value: 'Administrator nie wskazał wyznaczonego inspektora ochrony danych.' }],
    },
    {
      title: '3. Cele i podstawy prawne przetwarzania',
      paragraphs: [value(privacy.purposesAndLegalBases, 'Nie uzupełniono')],
      ...(privacy.usesLegitimateInterests
        ? { items: [{ label: 'Prawnie uzasadnione interesy', value: value(privacy.legitimateInterestsDescription, 'Nie uzupełniono') }] }
        : {}),
    },
    {
      title: '4. Odbiorcy danych',
      paragraphs: [value(privacy.recipientCategories, 'Nie uzupełniono')],
    },
    {
      title: '5. Przekazywanie danych poza Europejski Obszar Gospodarczy',
      paragraphs: [privacy.transfersOutsideEea
        ? value(privacy.transferSafeguardsDescription, 'Nie uzupełniono')
        : 'Administrator nie deklaruje przekazywania danych poza Europejski Obszar Gospodarczy.'],
    },
    {
      title: '6. Okres przechowywania danych',
      paragraphs: [value(privacy.retentionPolicy, 'Nie uzupełniono')],
    },
    {
      title: '7. Prawa osoby, której dane dotyczą',
      paragraphs: [value(privacy.dataSubjectRights, 'Nie uzupełniono')],
    },
    {
      title: '8. Prawo wniesienia skargi',
      paragraphs: [`Skargę dotyczącą przetwarzania danych osobowych można wnieść do: ${value(privacy.complaintAuthority, 'Nie uzupełniono')}.`],
    },
    {
      title: '9. Podanie danych',
      paragraphs: [value(privacy.dataProvisionRequirements, 'Nie uzupełniono')],
    },
    {
      title: '10. Zautomatyzowane podejmowanie decyzji i profilowanie',
      paragraphs: [privacy.usesAutomatedDecisionMaking
        ? value(privacy.automatedDecisionMakingDescription, 'Nie uzupełniono')
        : 'Administrator nie deklaruje podejmowania wobec klienta decyzji opartych wyłącznie na zautomatyzowanym przetwarzaniu, w tym profilowaniu, wywołujących skutki prawne lub w podobny sposób istotnie na niego wpływających.'],
    },
  ]

  if (privacy.obtainsDataIndirectly) {
    sections.push({
      title: '11. Dane pozyskiwane z innych źródeł',
      items: [
        { label: 'Kategorie danych', value: value(privacy.indirectDataCategories, 'Nie uzupełniono') },
        { label: 'Źródła danych', value: value(privacy.indirectDataSources, 'Nie uzupełniono') },
      ],
    })
  }

  if (privacy.privacyNoticeUrl) {
    sections.push({
      title: `${privacy.obtainsDataIndirectly ? '12' : '11'}. Aktualna wersja online`,
      paragraphs: [privacy.privacyNoticeUrl],
    })
  }

  return {
    ...input,
    kind: 'rodo',
    title: 'Informacja o przetwarzaniu danych osobowych',
    subtitle: 'Klauzula informacyjna dla klienta',
    legalReference: privacy.obtainsDataIndirectly
      ? 'Art. 13 i art. 14 rozporządzenia Parlamentu Europejskiego i Rady (UE) 2016/679 (RODO).'
      : 'Art. 13 rozporządzenia Parlamentu Europejskiego i Rady (UE) 2016/679 (RODO).',
    sections,
  }
}

export function buildIntermediaryDocumentContent(input: {
  kind: IntermediaryDocumentKind
  settings: unknown
  organizationName: string
  revision: number
  generatedAt: string
}): IntermediaryDocumentContent {
  const settings = normalizeIntermediarySettings(input.settings)
  const readiness = intermediarySettingsReadiness(settings)
  const missing = input.kind === 'ofi' ? readiness.ofi.missing : readiness.rodo.missing
  const common = {
    organizationName: input.organizationName.trim() || settings.intermediary.legalName || 'Organizacja',
    revision: Math.max(0, Math.trunc(input.revision)),
    generatedAt: input.generatedAt,
    draft: missing.length > 0,
    missing: [...missing],
  }
  return input.kind === 'ofi'
    ? ofiContent(settings, common)
    : rodoContent(settings, common)
}
