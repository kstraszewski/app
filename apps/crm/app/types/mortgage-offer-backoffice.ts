export type JsonObject = Record<string, unknown>

export type MortgageOfferLifecycleStatus = 'draft' | 'published' | 'archived'
export type MortgageProductKind = 'mortgage' | 'home_equity'

export interface MortgageOfferSummary {
  id: string
  bankId: string
  code: string
  name: string
  slug: string
  productKind: MortgageProductKind
  category: string
  /** @deprecated Use productKind. Kept while older UI consumers migrate. */
  productType: string
  currency: string
  /** Compatibility status for clients that can display only one lifecycle. */
  status: MortgageOfferLifecycleStatus
  publicationStatus: MortgageOfferLifecycleStatus
  hasPublishedVersion: boolean
  hasDraft: boolean
  draftRevision: number
  publishedRevision: number | null
  validFrom: string | null
  validTo: string | null
  updatedAt: string | null
  updatedBy: string | null
}

export interface MortgageOfferBankSummary {
  id: string
  slug: string
  name: string
  logoUrl: string | null
  isEnabled: boolean
  offers: MortgageOfferSummary[]
}

export interface MortgageOfferProductRecord {
  id: string
  bankId: string
  code: string
  name: string
  slug: string
  productKind: MortgageProductKind
  category: string
  /** @deprecated Use productKind. Kept while older UI consumers migrate. */
  productType: string
  currency: string
  status: MortgageOfferLifecycleStatus
  publicationStatus: MortgageOfferLifecycleStatus
  hasPublishedVersion: boolean
  hasDraft: boolean
  createdAt: string | null
  updatedAt: string | null
}

export interface MortgageOfferDraftRecord<TDraft = JsonObject> {
  id: string
  revision: number
  status: MortgageOfferLifecycleStatus
  draftData: TDraft
  updatedAt: string | null
  updatedBy: string | null
  /** True only for an unsaved editor seed converted from a legacy publication. */
  seededFromLegacy: boolean
  seedWarnings: string[]
}

export interface MortgageOfferVersionSummary {
  id: string
  revision: number
  status: string
  publishedAt: string | null
  validFrom: string | null
  validTo: string | null
}

export interface MortgageOfferTemplateSummary {
  id: string
  label: string
  revision: number
  sourceFileId: string
  sourceFileVersionId: string
}

export interface MortgageOfferDetail<TDraft = JsonObject> {
  product: MortgageOfferProductRecord
  draft: MortgageOfferDraftRecord<TDraft>
  versions: MortgageOfferVersionSummary[]
  templates: MortgageOfferTemplateSummary[]
  bank: Pick<MortgageOfferBankSummary, 'id' | 'slug' | 'name' | 'logoUrl'> | null
}

function record(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonObject
    : {}
}

function string(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

function number(value: unknown, fallback = 0): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function lifecycleStatus(value: unknown): MortgageOfferLifecycleStatus {
  return value === 'published' || value === 'archived' ? value : 'draft'
}

function productKind(value: unknown): MortgageProductKind {
  return value === 'home_equity' || value === 'secured_loan' ? 'home_equity' : 'mortgage'
}

function legacyCategory(source: JsonObject): string {
  const explicitCategory = string(source.category)
  if (explicitCategory) return explicitCategory
  const legacyProductType = string(source.productType ?? source.product_type)
  if (['housing', 'construction', 'refinance', 'eco', 'family'].includes(legacyProductType)) {
    return legacyProductType
  }
  return 'housing'
}

function unwrapData(value: unknown): unknown {
  const source = record(value)
  return 'data' in source ? source.data : value
}

function normalizeOffer(value: unknown, fallbackBankId: string): MortgageOfferSummary {
  const source = record(value)
  const draft = record(source.draft)
  const currentVersion = record(source.currentVersion ?? source.current_version)
  const validity = record(source.validity ?? currentVersion.validity)
  const status = lifecycleStatus(source.status ?? source.lifecycleStatus ?? source.lifecycle_status)
  const publishedRevisionValue = source.publishedRevision ?? source.published_revision
  const draftRevision = number(source.draftRevision ?? source.draft_revision ?? draft.revision)
  const hasPublishedVersion = typeof source.hasPublishedVersion === 'boolean'
    ? source.hasPublishedVersion
    : typeof source.has_published_version === 'boolean'
      ? source.has_published_version
      : publishedRevisionValue != null || status === 'published'
  const hasDraft = typeof source.hasDraft === 'boolean'
    ? source.hasDraft
    : typeof source.has_draft === 'boolean'
      ? source.has_draft
      : draftRevision > 0 || status === 'draft'
  const publicationStatus = lifecycleStatus(
    source.publicationStatus
      ?? source.publication_status
      ?? (status === 'archived' ? 'archived' : hasPublishedVersion ? 'published' : 'draft'),
  )
  const normalizedProductKind = productKind(
    source.productKind ?? source.product_kind ?? source.productType ?? source.product_type,
  )

  return {
    id: string(source.id ?? source.offerId ?? source.offer_id),
    bankId: string(source.bankId ?? source.bank_id, fallbackBankId),
    code: string(source.code ?? source.productCode ?? source.product_code),
    name: string(source.name ?? source.productName ?? source.product_name, 'Oferta hipoteczna'),
    slug: string(source.slug),
    productKind: normalizedProductKind,
    category: legacyCategory(source),
    productType: string(source.productType ?? source.product_type, legacyCategory(source)),
    currency: string(source.currency ?? currentVersion.currency, 'PLN'),
    status,
    publicationStatus,
    hasPublishedVersion,
    hasDraft,
    draftRevision,
    publishedRevision: publishedRevisionValue == null
      ? null
      : number(publishedRevisionValue),
    validFrom: nullableString(source.validFrom ?? source.valid_from ?? validity.validFrom ?? validity.valid_from),
    validTo: nullableString(source.validTo ?? source.valid_to ?? validity.validTo ?? validity.valid_to),
    updatedAt: nullableString(source.updatedAt ?? source.updated_at ?? draft.updatedAt ?? draft.updated_at),
    updatedBy: nullableString(source.updatedBy ?? source.updated_by ?? draft.updatedBy ?? draft.updated_by),
  }
}

function normalizeBank(value: unknown): MortgageOfferBankSummary {
  const source = record(value)
  const id = string(source.id ?? source.bankId ?? source.bank_id)
  const offers = Array.isArray(source.offers) ? source.offers.map(offer => normalizeOffer(offer, id)) : []

  return {
    id,
    slug: string(source.slug),
    name: string(source.name, 'Instytucja finansowa'),
    logoUrl: nullableString(source.logoUrl ?? source.logo_url),
    isEnabled: source.isEnabled !== false && source.is_enabled !== false,
    offers,
  }
}

export function normalizeMortgageOfferBanksPayload(value: unknown): MortgageOfferBankSummary[] {
  const unwrapped = unwrapData(value)
  const source = record(unwrapped)
  const banks = Array.isArray(unwrapped)
    ? unwrapped
    : Array.isArray(source.banks)
      ? source.banks
      : []

  return banks.map(normalizeBank).filter(bank => bank.id)
}

export function normalizeMortgageOfferDetail<TDraft = JsonObject>(value: unknown): MortgageOfferDetail<TDraft> | null {
  const source = record(unwrapData(value))
  const productSource = record(source.product ?? source.offer)
  const draftSource = record(source.draft)
  const bankSource = record(source.bank)
  const productId = string(productSource.id ?? source.id)
  if (!productId) return null

  const status = lifecycleStatus(productSource.status ?? source.status)
  const versionsSource = Array.isArray(source.versions) ? source.versions : []
  const hasPublishedVersion = typeof productSource.hasPublishedVersion === 'boolean'
    ? productSource.hasPublishedVersion
    : typeof productSource.has_published_version === 'boolean'
      ? productSource.has_published_version
      : versionsSource.some(entry => lifecycleStatus(record(entry).status) === 'published')
  const hasDraft = typeof productSource.hasDraft === 'boolean'
    ? productSource.hasDraft
    : typeof productSource.has_draft === 'boolean'
      ? productSource.has_draft
      : Boolean(string(draftSource.id))
  const publicationStatus = lifecycleStatus(
    productSource.publicationStatus
      ?? productSource.publication_status
      ?? (status === 'archived' ? 'archived' : hasPublishedVersion ? 'published' : 'draft'),
  )
  const normalizedProductKind = productKind(
    productSource.productKind
      ?? productSource.product_kind
      ?? productSource.productType
      ?? productSource.product_type,
  )
  const product: MortgageOfferProductRecord = {
    id: productId,
    bankId: string(productSource.bankId ?? productSource.bank_id),
    code: string(productSource.code ?? productSource.productCode ?? productSource.product_code),
    name: string(productSource.name, 'Oferta hipoteczna'),
    slug: string(productSource.slug),
    productKind: normalizedProductKind,
    category: legacyCategory(productSource),
    productType: string(productSource.productType ?? productSource.product_type, legacyCategory(productSource)),
    currency: string(productSource.currency ?? record(draftSource.draftData ?? draftSource.draft_data).currency, 'PLN'),
    status,
    publicationStatus,
    hasPublishedVersion,
    hasDraft,
    createdAt: nullableString(productSource.createdAt ?? productSource.created_at),
    updatedAt: nullableString(productSource.updatedAt ?? productSource.updated_at),
  }

  const rawDraftData = draftSource.draftData ?? draftSource.draft_data ?? source.draftData ?? source.draft_data
  const versions = versionsSource.map((entry) => {
    const version = record(entry)
    const validity = record(version.validity ?? record(version.data).validity)
    return {
      id: string(version.id),
      revision: number(version.revision ?? version.version),
      status: string(version.status, 'published'),
      publishedAt: nullableString(version.publishedAt ?? version.published_at),
      validFrom: nullableString(version.validFrom ?? version.valid_from ?? validity.validFrom ?? validity.valid_from),
      validTo: nullableString(version.validTo ?? version.valid_to ?? validity.validTo ?? validity.valid_to),
    }
  })
  const templates = (Array.isArray(source.templates) ? source.templates : []).flatMap((entry) => {
    const template = record(entry)
    const id = string(template.id ?? template.templateKey ?? template.template_key)
    if (!id) return []
    return [{
      id,
      label: string(template.label, id),
      revision: number(template.revision ?? template.activeRevision ?? template.active_revision),
      sourceFileId: string(template.sourceFileId ?? template.source_file_id),
      sourceFileVersionId: string(template.sourceFileVersionId ?? template.source_file_version_id),
    }]
  })

  return {
    product,
    draft: {
      id: string(draftSource.id),
      revision: number(draftSource.revision ?? source.revision),
      status: lifecycleStatus(draftSource.status ?? product.status),
      draftData: record(rawDraftData) as TDraft,
      updatedAt: nullableString(draftSource.updatedAt ?? draftSource.updated_at),
      updatedBy: nullableString(draftSource.updatedBy ?? draftSource.updated_by),
      seededFromLegacy: draftSource.seededFromLegacy === true || draftSource.seeded_from_legacy === true,
      seedWarnings: (Array.isArray(draftSource.seedWarnings)
        ? draftSource.seedWarnings
        : Array.isArray(draftSource.seed_warnings)
          ? draftSource.seed_warnings
          : []).filter((warning): warning is string => typeof warning === 'string'),
    },
    versions,
    templates,
    bank: Object.keys(bankSource).length
      ? {
          id: string(bankSource.id, product.bankId),
          slug: string(bankSource.slug),
          name: string(bankSource.name, 'Instytucja finansowa'),
          logoUrl: nullableString(bankSource.logoUrl ?? bankSource.logo_url),
        }
      : null,
  }
}

export function extractCreatedMortgageOfferId(value: unknown): string {
  const source = record(unwrapData(value))
  const product = record(source.product ?? source.offer)
  return string(source.id ?? source.offerId ?? source.offer_id ?? product.id)
}

export function mortgageBackofficeErrorStatus(error: unknown): number | null {
  const source = error as {
    status?: number
    statusCode?: number
    response?: { status?: number }
  }
  return source?.statusCode ?? source?.status ?? source?.response?.status ?? null
}
