export const INTERMEDIARY_SETTINGS_VERSION = 2 as const

export const intermediaryProviderRoles = ['intermediary', 'agent'] as const
export type IntermediaryProviderRole = typeof intermediaryProviderRoles[number]

export interface IntermediaryEntitySettings {
  legalName: string
  registeredOffice: string
  addressLine: string
  postalCode: string
  city: string
  country: string
  email: string
  phone: string
  website: string
  mortgageRegisterNumber: string
  mortgageRegisterUrl: string
}

export interface OrganizationIntermediarySettings {
  version: typeof INTERMEDIARY_SETTINGS_VERSION
  providerRole: IntermediaryProviderRole
  intermediary: IntermediaryEntitySettings
  agent: {
    legalName: string
    registerNumber: string
    roleDescription: string
    addressLine: string
    postalCode: string
    city: string
    country: string
    email: string
    phone: string
  }
  relationship: {
    isTiedMortgageIntermediary: boolean
    cooperatingLenderBankIds: string[]
    cooperatingLenderNames: string[]
    lenderBankIds: string[]
    lenderNames: string[]
    offersAdvisoryServices: boolean
    authorizationScope: string
    generalMortgageInformationUrl: string
  }
  complaints: {
    internalProcedure: string
    email: string
    phone: string
    postalAddress: string
    externalProcedure: string
    externalProcedureUrl: string
  }
  remuneration: {
    receivesFromLenders: boolean
    lenderRemunerationDescription: string
    lenderRemunerationAmountKnown: boolean
    lenderRemunerationAmountDescription: string
    chargesClientFees: boolean
    clientFeeDescription: string
  }
  privacy: {
    controllerName: string
    controllerAddress: string
    controllerEmail: string
    controllerPhone: string
    dpoAppointed: boolean
    dpoName: string
    dpoEmail: string
    dpoPhone: string
    privacyNoticeUrl: string
    purposesAndLegalBases: string
    usesLegitimateInterests: boolean
    legitimateInterestsDescription: string
    recipientCategories: string
    transfersOutsideEea: boolean
    transferSafeguardsDescription: string
    retentionPolicy: string
    dataSubjectRights: string
    complaintAuthority: string
    dataProvisionRequirements: string
    usesAutomatedDecisionMaking: boolean
    automatedDecisionMakingDescription: string
    obtainsDataIndirectly: boolean
    indirectDataCategories: string
    indirectDataSources: string
  }
}

export interface IntermediarySettingsReadinessSection {
  ready: boolean
  missing: string[]
}

export interface IntermediarySettingsReadiness {
  ofi: IntermediarySettingsReadinessSection
  rodo: IntermediarySettingsReadinessSection
  recommendations: string[]
  percentage: number
}

export const DEFAULT_MORTGAGE_REGISTER_URL = 'https://www.knf.gov.pl/podmioty/posrednictwo_kredytowe/dzial_I'

const DEFAULT_INTERMEDIARY_SETTINGS: OrganizationIntermediarySettings = {
  version: INTERMEDIARY_SETTINGS_VERSION,
  providerRole: 'intermediary',
  intermediary: {
    legalName: '',
    registeredOffice: '',
    addressLine: '',
    postalCode: '',
    city: '',
    country: 'Polska',
    email: '',
    phone: '',
    website: '',
    mortgageRegisterNumber: '',
    mortgageRegisterUrl: DEFAULT_MORTGAGE_REGISTER_URL,
  },
  agent: {
    legalName: '',
    registerNumber: '',
    roleDescription: 'Agent pośrednika kredytu hipotecznego',
    addressLine: '',
    postalCode: '',
    city: '',
    country: 'Polska',
    email: '',
    phone: '',
  },
  relationship: {
    isTiedMortgageIntermediary: false,
    cooperatingLenderBankIds: [],
    cooperatingLenderNames: [],
    lenderBankIds: [],
    lenderNames: [],
    offersAdvisoryServices: false,
    authorizationScope: '',
    generalMortgageInformationUrl: '',
  },
  complaints: {
    internalProcedure: '',
    email: '',
    phone: '',
    postalAddress: '',
    externalProcedure: '',
    externalProcedureUrl: '',
  },
  remuneration: {
    receivesFromLenders: true,
    lenderRemunerationDescription: '',
    lenderRemunerationAmountKnown: false,
    lenderRemunerationAmountDescription: '',
    chargesClientFees: false,
    clientFeeDescription: '',
  },
  privacy: {
    controllerName: '',
    controllerAddress: '',
    controllerEmail: '',
    controllerPhone: '',
    dpoAppointed: false,
    dpoName: '',
    dpoEmail: '',
    dpoPhone: '',
    privacyNoticeUrl: '',
    purposesAndLegalBases: '',
    usesLegitimateInterests: false,
    legitimateInterestsDescription: '',
    recipientCategories: '',
    transfersOutsideEea: false,
    transferSafeguardsDescription: '',
    retentionPolicy: '',
    dataSubjectRights: '',
    complaintAuthority: 'Prezes Urzędu Ochrony Danych Osobowych',
    dataProvisionRequirements: '',
    usesAutomatedDecisionMaking: false,
    automatedDecisionMakingDescription: '',
    obtainsDataIndirectly: false,
    indirectDataCategories: '',
    indirectDataSources: '',
  },
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function text(value: unknown, fallback = '', maxLength = 500): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : fallback
}

function boolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function uniqueLines(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return [...fallback]
  return [...new Set(
    value
      .filter(item => typeof item === 'string')
      .map(item => item.trim().slice(0, 200))
      .filter(Boolean),
  )].slice(0, 100)
}

function normalizeEntity(value: unknown): IntermediaryEntitySettings {
  const input = asRecord(value)
  return {
    legalName: text(input.legalName, '', 240),
    registeredOffice: text(input.registeredOffice, '', 160),
    addressLine: text(input.addressLine, '', 240),
    postalCode: text(input.postalCode, '', 20),
    city: text(input.city, '', 120),
    country: text(input.country, 'Polska', 80) || 'Polska',
    email: text(input.email, '', 254),
    phone: text(input.phone, '', 50),
    website: text(input.website, '', 1000),
    mortgageRegisterNumber: text(input.mortgageRegisterNumber, '', 80),
    mortgageRegisterUrl: text(
      input.mortgageRegisterUrl,
      DEFAULT_MORTGAGE_REGISTER_URL,
      1000,
    ) || DEFAULT_MORTGAGE_REGISTER_URL,
  }
}

export function createEmptyIntermediarySettings(
  seed: Partial<OrganizationIntermediarySettings> = {},
): OrganizationIntermediarySettings {
  return normalizeIntermediarySettings({ ...DEFAULT_INTERMEDIARY_SETTINGS, ...seed })
}

export function normalizeIntermediarySettings(value: unknown): OrganizationIntermediarySettings {
  const input = asRecord(value)
  const agent = asRecord(input.agent)
  const relationship = asRecord(input.relationship)
  const complaints = asRecord(input.complaints)
  const remuneration = asRecord(input.remuneration)
  const privacy = asRecord(input.privacy)
  const providerRole = intermediaryProviderRoles.includes(input.providerRole as IntermediaryProviderRole)
    ? input.providerRole as IntermediaryProviderRole
    : DEFAULT_INTERMEDIARY_SETTINGS.providerRole
  const hasCooperatingLenders = Object.prototype.hasOwnProperty.call(
    relationship,
    'cooperatingLenderBankIds',
  ) || Object.prototype.hasOwnProperty.call(
    relationship,
    'cooperatingLenderNames',
  )
  const isTiedMortgageIntermediary = boolean(relationship.isTiedMortgageIntermediary, false)
  const isVersionOneSettings = input.version === 1 || typeof input.version === 'undefined'
  // Revisions created before the cooperation list existed used the statutory
  // tied-intermediary list as the only lender catalogue. Preserve those values
  // as a migration fallback, while an explicitly empty cooperation list stays empty.
  const legacyCooperatingBankIds = hasCooperatingLenders
    || !isVersionOneSettings
    || !isTiedMortgageIntermediary
    ? []
    : uniqueLines(relationship.lenderBankIds, [])
  const legacyCooperatingNames = hasCooperatingLenders
    || !isVersionOneSettings
    || !isTiedMortgageIntermediary
    ? []
    : uniqueLines(relationship.lenderNames, [])

  return {
    version: INTERMEDIARY_SETTINGS_VERSION,
    providerRole,
    intermediary: normalizeEntity(input.intermediary),
    agent: {
      legalName: text(agent.legalName, '', 240),
      registerNumber: text(agent.registerNumber, '', 80),
      roleDescription: text(
        agent.roleDescription,
        DEFAULT_INTERMEDIARY_SETTINGS.agent.roleDescription,
        500,
      ) || DEFAULT_INTERMEDIARY_SETTINGS.agent.roleDescription,
      addressLine: text(agent.addressLine, '', 240),
      postalCode: text(agent.postalCode, '', 20),
      city: text(agent.city, '', 120),
      country: text(agent.country, 'Polska', 80) || 'Polska',
      email: text(agent.email, '', 254),
      phone: text(agent.phone, '', 50),
    },
    relationship: {
      isTiedMortgageIntermediary,
      cooperatingLenderBankIds: uniqueLines(
        relationship.cooperatingLenderBankIds,
        legacyCooperatingBankIds,
      ),
      cooperatingLenderNames: uniqueLines(
        relationship.cooperatingLenderNames,
        legacyCooperatingNames,
      ),
      lenderBankIds: uniqueLines(relationship.lenderBankIds, []),
      lenderNames: uniqueLines(relationship.lenderNames, []),
      offersAdvisoryServices: boolean(relationship.offersAdvisoryServices, false),
      authorizationScope: text(relationship.authorizationScope, '', 4000),
      generalMortgageInformationUrl: text(relationship.generalMortgageInformationUrl, '', 1000),
    },
    complaints: {
      internalProcedure: text(complaints.internalProcedure, '', 6000),
      email: text(complaints.email, '', 254),
      phone: text(complaints.phone, '', 50),
      postalAddress: text(complaints.postalAddress, '', 500),
      externalProcedure: text(complaints.externalProcedure, '', 6000),
      externalProcedureUrl: text(complaints.externalProcedureUrl, '', 1000),
    },
    remuneration: {
      receivesFromLenders: boolean(remuneration.receivesFromLenders, true),
      lenderRemunerationDescription: text(remuneration.lenderRemunerationDescription, '', 4000),
      lenderRemunerationAmountKnown: boolean(remuneration.lenderRemunerationAmountKnown, false),
      lenderRemunerationAmountDescription: text(
        remuneration.lenderRemunerationAmountDescription,
        '',
        2000,
      ),
      chargesClientFees: boolean(remuneration.chargesClientFees, false),
      clientFeeDescription: text(remuneration.clientFeeDescription, '', 2000),
    },
    privacy: {
      controllerName: text(privacy.controllerName, '', 240),
      controllerAddress: text(privacy.controllerAddress, '', 500),
      controllerEmail: text(privacy.controllerEmail, '', 254),
      controllerPhone: text(privacy.controllerPhone, '', 50),
      dpoAppointed: boolean(privacy.dpoAppointed, false),
      dpoName: text(privacy.dpoName, '', 240),
      dpoEmail: text(privacy.dpoEmail, '', 254),
      dpoPhone: text(privacy.dpoPhone, '', 50),
      privacyNoticeUrl: text(privacy.privacyNoticeUrl, '', 1000),
      purposesAndLegalBases: text(privacy.purposesAndLegalBases, '', 12000),
      usesLegitimateInterests: boolean(privacy.usesLegitimateInterests, false),
      legitimateInterestsDescription: text(
        privacy.legitimateInterestsDescription,
        '',
        6000,
      ),
      recipientCategories: text(privacy.recipientCategories, '', 6000),
      transfersOutsideEea: boolean(privacy.transfersOutsideEea, false),
      transferSafeguardsDescription: text(
        privacy.transferSafeguardsDescription,
        '',
        6000,
      ),
      retentionPolicy: text(privacy.retentionPolicy, '', 6000),
      dataSubjectRights: text(privacy.dataSubjectRights, '', 8000),
      complaintAuthority: text(
        privacy.complaintAuthority,
        DEFAULT_INTERMEDIARY_SETTINGS.privacy.complaintAuthority,
        1000,
      ) || DEFAULT_INTERMEDIARY_SETTINGS.privacy.complaintAuthority,
      dataProvisionRequirements: text(privacy.dataProvisionRequirements, '', 6000),
      usesAutomatedDecisionMaking: boolean(privacy.usesAutomatedDecisionMaking, false),
      automatedDecisionMakingDescription: text(
        privacy.automatedDecisionMakingDescription,
        '',
        6000,
      ),
      obtainsDataIndirectly: boolean(privacy.obtainsDataIndirectly, false),
      indirectDataCategories: text(privacy.indirectDataCategories, '', 6000),
      indirectDataSources: text(privacy.indirectDataSources, '', 6000),
    },
  }
}

function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

function isWebUrl(value: string): boolean {
  return /^https:\/\/[^\s]+$/i.test(value) || /^\/[a-z0-9/_\-.]+$/i.test(value)
}

function requireValue(missing: string[], value: string, label: string): void {
  if (!value) missing.push(label)
}

export function intermediarySettingsReadiness(value: unknown): IntermediarySettingsReadiness {
  const settings = normalizeIntermediarySettings(value)
  const ofiMissing: string[] = []
  const rodoMissing: string[] = []
  const recommendations: string[] = []

  requireValue(ofiMissing, settings.intermediary.legalName, 'firma pośrednika')
  requireValue(ofiMissing, settings.intermediary.registeredOffice, 'siedziba pośrednika')
  requireValue(ofiMissing, settings.intermediary.addressLine, 'adres pośrednika')
  requireValue(ofiMissing, settings.intermediary.postalCode, 'kod pocztowy pośrednika')
  requireValue(ofiMissing, settings.intermediary.city, 'miejscowość pośrednika')
  requireValue(ofiMissing, settings.intermediary.mortgageRegisterNumber, 'numer RPH pośrednika')
  if (!isWebUrl(settings.intermediary.mortgageRegisterUrl)) {
    ofiMissing.push('prawidłowy adres rejestru KNF')
  }
  if (settings.relationship.isTiedMortgageIntermediary && !settings.relationship.lenderNames.length) {
    ofiMissing.push('lista kredytodawców powiązanego pośrednika')
  }
  if (!settings.relationship.cooperatingLenderNames.length) {
    recommendations.push(
      'Potwierdź lub uzupełnij listę banków i kredytodawców, z którymi organizacja ma aktywne umowy współpracy.',
    )
  }
  requireValue(ofiMissing, settings.complaints.internalProcedure, 'wewnętrzna procedura reklamacji')
  requireValue(ofiMissing, settings.complaints.externalProcedure, 'pozasądowa procedura skarg i odwołań')
  if (settings.remuneration.receivesFromLenders) {
    requireValue(
      ofiMissing,
      settings.remuneration.lenderRemunerationDescription,
      'opis wynagrodzenia od kredytodawców lub innych podmiotów',
    )
  }
  if (
    settings.remuneration.receivesFromLenders
    && settings.remuneration.lenderRemunerationAmountKnown
  ) {
    requireValue(
      ofiMissing,
      settings.remuneration.lenderRemunerationAmountDescription,
      'wysokość znanego wynagrodzenia',
    )
  }
  if (settings.remuneration.chargesClientFees) {
    requireValue(ofiMissing, settings.remuneration.clientFeeDescription, 'wysokość lub sposób obliczania opłaty klienta')
  }
  if (settings.providerRole === 'agent') {
    requireValue(ofiMissing, settings.agent.legalName, 'firma lub nazwa agenta')
    requireValue(ofiMissing, settings.agent.roleDescription, 'opis funkcji agenta')
    if (!settings.agent.registerNumber) {
      recommendations.push('Uzupełnij numer RHA agenta widoczny w rejestrze KNF.')
    }
  }

  requireValue(rodoMissing, settings.privacy.controllerName, 'nazwa administratora danych')
  requireValue(rodoMissing, settings.privacy.controllerAddress, 'adres administratora danych')
  if (!isEmail(settings.privacy.controllerEmail)) {
    rodoMissing.push('prawidłowy e-mail administratora danych')
  }
  if (settings.privacy.dpoAppointed && !(
    isEmail(settings.privacy.dpoEmail) || settings.privacy.dpoPhone
  )) {
    rodoMissing.push('kontakt do inspektora ochrony danych')
  }
  requireValue(rodoMissing, settings.privacy.purposesAndLegalBases, 'cele i podstawy prawne przetwarzania')
  requireValue(rodoMissing, settings.privacy.recipientCategories, 'odbiorcy lub kategorie odbiorców danych')
  requireValue(rodoMissing, settings.privacy.retentionPolicy, 'okres przechowywania lub kryteria jego ustalania')
  requireValue(rodoMissing, settings.privacy.dataSubjectRights, 'prawa osób, których dane dotyczą')
  requireValue(rodoMissing, settings.privacy.complaintAuthority, 'organ nadzorczy właściwy do wniesienia skargi')
  requireValue(rodoMissing, settings.privacy.dataProvisionRequirements, 'obowiązek podania danych i skutki ich niepodania')
  if (settings.privacy.usesLegitimateInterests) {
    requireValue(
      rodoMissing,
      settings.privacy.legitimateInterestsDescription,
      'opis prawnie uzasadnionych interesów',
    )
  }
  if (settings.privacy.transfersOutsideEea) {
    requireValue(
      rodoMissing,
      settings.privacy.transferSafeguardsDescription,
      'państwa trzecie i zabezpieczenia transferu danych',
    )
  }
  if (settings.privacy.usesAutomatedDecisionMaking) {
    requireValue(
      rodoMissing,
      settings.privacy.automatedDecisionMakingDescription,
      'zasady i skutki zautomatyzowanego podejmowania decyzji',
    )
  }
  if (settings.privacy.obtainsDataIndirectly) {
    requireValue(rodoMissing, settings.privacy.indirectDataCategories, 'kategorie danych pozyskiwanych pośrednio')
    requireValue(rodoMissing, settings.privacy.indirectDataSources, 'źródła danych pozyskiwanych pośrednio')
  }

  if (!settings.relationship.authorizationScope) {
    recommendations.push('Uzupełnij zakres umocowania do czynności faktycznych i prawnych.')
  }
  if (!isWebUrl(settings.relationship.generalMortgageInformationUrl)) {
    recommendations.push('Wskaż stronę z informacjami ogólnymi z art. 10 ustawy hipotecznej.')
  }
  if (!isWebUrl(settings.privacy.privacyNoticeUrl)) {
    recommendations.push('Wskaż opublikowaną klauzulę informacyjną RODO.')
  }

  const complete = (ofiMissing.length ? 0 : 1) + (rodoMissing.length ? 0 : 1)

  return {
    ofi: { ready: ofiMissing.length === 0, missing: ofiMissing },
    rodo: { ready: rodoMissing.length === 0, missing: rodoMissing },
    recommendations,
    percentage: complete * 50,
  }
}
