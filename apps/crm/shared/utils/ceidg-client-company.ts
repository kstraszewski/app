import type {
  CeidgCompanyData,
  CeidgCompanyLookupResponse,
} from '../types/ceidg-company'

const ceidgMetadataKeys = [
  'entity_type',
  'nip',
  'regon',
  'registry_name',
  'registry_number',
  'registry_source',
  'registry_status',
  'registry_api_version',
  'registry_retrieved_at',
  'legal_form',
  'business_address',
  'correspondence_address',
  'business_start_date',
  'business_suspension_date',
  'business_resume_date',
  'business_termination_date',
  'business_removal_date',
  'main_pkd_code',
  'main_pkd_name',
  'pkd_codes',
  'company_email',
  'company_phone',
  'company_website',
] as const

const ceidgProvenanceKeys = [
  'entity_type',
  'registry_source',
  'registry_status',
  'registry_api_version',
  'registry_retrieved_at',
  'legal_form',
  'business_address',
  'correspondence_address',
  'business_start_date',
  'business_suspension_date',
  'business_resume_date',
  'business_termination_date',
  'business_removal_date',
  'main_pkd_code',
  'main_pkd_name',
  'pkd_codes',
  'company_email',
  'company_phone',
  'company_website',
] as const

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? { ...value as Record<string, unknown> }
    : {}
}

function textValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function nonEmptyEntries(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => (
    Array.isArray(entry) ? entry.length > 0 : entry !== '' && entry !== null && entry !== undefined
  )))
}

/** Removes the entire CEIDG snapshot when a user explicitly detaches it. */
export function stripCeidgClientCompanyMetadata(metadata: unknown): Record<string, unknown> {
  const value = recordValue(metadata)
  for (const key of ceidgMetadataKeys) delete value[key]
  return value
}

/**
 * Removes an unverified CEIDG provenance claim while retaining generic company
 * identifiers. A client may legitimately carry NIP/REGON data from another
 * workflow without being presented as a server-verified CEIDG snapshot.
 */
export function sanitizeCeidgClientCompanyMetadataInput(
  metadata: unknown,
): Record<string, unknown> {
  const value = recordValue(metadata)
  if (textValue(value.registry_source).toLocaleUpperCase('pl-PL') !== 'CEIDG') {
    return value
  }
  for (const key of ceidgProvenanceKeys) delete value[key]
  return value
}

/**
 * Keeps an already persisted server-side CEIDG snapshot while accepting edits
 * to unrelated metadata. This prevents a caller from forging registry fields.
 */
export function preserveCeidgClientCompanyMetadata(
  candidateMetadata: unknown,
  persistedMetadata: unknown,
): Record<string, unknown> {
  const persisted = recordValue(persistedMetadata)
  const persistedIsCeidg = textValue(persisted.registry_source)
    .toLocaleUpperCase('pl-PL') === 'CEIDG'
  const candidate = persistedIsCeidg
    ? stripCeidgClientCompanyMetadata(candidateMetadata)
    : sanitizeCeidgClientCompanyMetadataInput(candidateMetadata)
  if (persistedIsCeidg) {
    delete candidate.tax_id
    delete candidate.krs
    for (const key of ceidgMetadataKeys) {
      if (key in persisted) candidate[key] = persisted[key]
    }
  }
  return candidate
}

export function mergeCeidgCompanyIntoClientMetadata(
  currentMetadata: unknown,
  company: CeidgCompanyData,
  source: CeidgCompanyLookupResponse['source'],
): Record<string, unknown> {
  const metadata = stripCeidgClientCompanyMetadata(currentMetadata)

  // CEIDG identifies a sole proprietorship. Old company identifiers must not
  // keep producing conflicting search hits after a verified lookup.
  delete metadata.tax_id
  delete metadata.krs

  return {
    ...metadata,
    ...nonEmptyEntries({
      client_type: 'company',
      nip: company.nip,
      regon: company.regon,
      registry_name: company.name,
      registry_number: company.ceidgId,
      registry_source: source.provider,
      registry_status: company.status,
      registry_api_version: source.apiVersion,
      registry_retrieved_at: source.retrievedAt,
      legal_form: company.legalForm,
      business_address: company.businessAddress,
      correspondence_address: company.correspondenceAddress,
      business_start_date: company.startDate,
      business_suspension_date: company.suspensionDate,
      business_resume_date: company.resumeDate,
      business_termination_date: company.terminationDate,
      business_removal_date: company.removalDate,
      main_pkd_code: company.mainPkd?.code ?? '',
      main_pkd_name: company.mainPkd?.name ?? '',
      pkd_codes: company.pkd.map(entry => ({ code: entry.code, name: entry.name })),
      company_email: company.email,
      company_phone: company.phone,
      company_website: company.website,
    }),
  }
}

export interface CeidgClientCompanySummary {
  address: string
  email: string
  legalForm: string
  mainPkdCode: string
  mainPkdName: string
  name: string
  nip: string
  phone: string
  regon: string
  registryNumber: string
  retrievedAt: string
  status: string
  website: string
}

export function ceidgClientCompanySummary(metadata: unknown): CeidgClientCompanySummary | null {
  const value = recordValue(metadata)
  const nip = textValue(value.nip)
  const registrySource = textValue(value.registry_source).toLocaleUpperCase('pl-PL')
  if (!nip || registrySource !== 'CEIDG') return null

  return {
    address: textValue(value.business_address),
    email: textValue(value.company_email),
    legalForm: textValue(value.legal_form),
    mainPkdCode: textValue(value.main_pkd_code),
    mainPkdName: textValue(value.main_pkd_name),
    name: textValue(value.registry_name),
    nip,
    phone: textValue(value.company_phone),
    regon: textValue(value.regon),
    registryNumber: textValue(value.registry_number),
    retrievedAt: textValue(value.registry_retrieved_at),
    status: textValue(value.registry_status),
    website: textValue(value.company_website),
  }
}
