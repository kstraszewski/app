import type { OrganizationIntermediarySettings } from '../../shared/intermediary-settings.ts'

export interface IntermediaryLender {
  id: string
  name: string
}

export interface IntermediaryLenderSelection {
  settings: OrganizationIntermediarySettings
  invalidIds: string[]
}

type LenderBankIdsKey = 'lenderBankIds' | 'cooperatingLenderBankIds'
type LenderNamesKey = 'lenderNames' | 'cooperatingLenderNames'

interface MortgageBankRow {
  id: unknown
  name: unknown
}

interface MortgageBankAliasRow {
  bank_id: unknown
  value: unknown
  valid_from: unknown
  valid_to: unknown
}

interface QueryResult<T> {
  data: T[] | null
  error: { message?: string } | null
}

interface IntermediaryLenderDataApi {
  from: (relation: string) => any
}

const lenderCollator = new Intl.Collator('pl', {
  numeric: true,
  sensitivity: 'base',
})

function normalizedText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizedNameKey(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('pl-PL')
}

function isActiveAlias(alias: MortgageBankAliasRow, onDate: string): boolean {
  const validFrom = normalizedText(alias.valid_from)
  const validTo = normalizedText(alias.valid_to)
  return (!validFrom || validFrom <= onDate) && (!validTo || validTo >= onDate)
}

function compareAliases(left: MortgageBankAliasRow, right: MortgageBankAliasRow): number {
  const leftValidFrom = normalizedText(left.valid_from)
  const rightValidFrom = normalizedText(right.valid_from)
  return rightValidFrom.localeCompare(leftValidFrom)
    || lenderCollator.compare(normalizedText(left.value), normalizedText(right.value))
}

function throwQueryError(
  source: 'mortgage_banks' | 'mortgage_bank_aliases',
  error: QueryResult<unknown>['error'],
): void {
  if (!error) return
  throw new Error(`Nie udało się pobrać listy instytucji (${source}): ${error.message ?? 'błąd bazy danych'}`)
}

/**
 * Builds the lender option catalogue from global banks. An active `legal_name`
 * alias takes precedence over the product-facing bank name. Duplicate rows are
 * collapsed by bank id, never by display name, because separate legal entities
 * may legitimately have the same or similar name.
 */
export function buildIntermediaryLenders(
  banks: readonly MortgageBankRow[],
  legalNameAliases: readonly MortgageBankAliasRow[] = [],
  onDate = new Date().toISOString().slice(0, 10),
): IntermediaryLender[] {
  const aliasesByBankId = new Map<string, MortgageBankAliasRow[]>()
  for (const alias of legalNameAliases) {
    const bankId = normalizedText(alias.bank_id)
    const name = normalizedText(alias.value)
    if (!bankId || !name || !isActiveAlias(alias, onDate)) continue
    const bankAliases = aliasesByBankId.get(bankId) ?? []
    bankAliases.push(alias)
    aliasesByBankId.set(bankId, bankAliases)
  }
  for (const aliases of aliasesByBankId.values()) aliases.sort(compareAliases)

  const lenderById = new Map<string, IntermediaryLender>()
  for (const bank of banks) {
    const id = normalizedText(bank.id)
    const baseName = normalizedText(bank.name)
    if (!id || !baseName || lenderById.has(id)) continue

    const legalName = normalizedText(aliasesByBankId.get(id)?.[0]?.value)
    lenderById.set(id, { id, name: legalName || baseName })
  }

  return [...lenderById.values()].sort((left, right) => (
    lenderCollator.compare(left.name, right.name)
    || lenderCollator.compare(left.id, right.id)
  ))
}

/**
 * Resolves an explicit bank-id selection to a deterministic legal-name
 * snapshot. The snapshot is persisted with settings and used by PDF previews,
 * so a future catalogue rename does not silently alter an existing revision.
 */
function applyLenderSelection(
  settings: OrganizationIntermediarySettings,
  lenders: readonly IntermediaryLender[],
  bankIdsKey: LenderBankIdsKey,
  namesKey: LenderNamesKey,
): IntermediaryLenderSelection {
  const lenderById = new Map(lenders.map(lender => [lender.id, lender]))
  const requestedIds = [...new Set(
    settings.relationship[bankIdsKey]
      .map(normalizedText)
      .filter(Boolean),
  )]
  const requestedIdSet = new Set(requestedIds)
  const invalidIds = requestedIds.filter(id => !lenderById.has(id))
  const selectedLenders = lenders.filter(lender => requestedIdSet.has(lender.id))
  const lenderNames: string[] = []
  const seenNames = new Set<string>()

  for (const lender of selectedLenders) {
    const name = normalizedText(lender.name)
    if (!name) continue
    const key = normalizedNameKey(name)
    if (seenNames.has(key)) continue
    seenNames.add(key)
    lenderNames.push(name)
  }

  return {
    invalidIds,
    settings: {
      ...settings,
      relationship: {
        ...settings.relationship,
        [bankIdsKey]: selectedLenders.map(lender => lender.id),
        [namesKey]: lenderNames,
      },
    },
  }
}

export function applyIntermediaryLenderSelection(
  settings: OrganizationIntermediarySettings,
  lenders: readonly IntermediaryLender[],
): IntermediaryLenderSelection {
  return applyLenderSelection(settings, lenders, 'lenderBankIds', 'lenderNames')
}

/**
 * Resolves the organization's operational cooperation list independently from
 * the statutory list of lenders represented by a tied intermediary.
 */
export function applyIntermediaryCooperatingLenderSelection(
  settings: OrganizationIntermediarySettings,
  lenders: readonly IntermediaryLender[],
): IntermediaryLenderSelection {
  return applyLenderSelection(
    settings,
    lenders,
    'cooperatingLenderBankIds',
    'cooperatingLenderNames',
  )
}

export async function resolveIntermediaryLenders(
  dataApi: IntermediaryLenderDataApi,
  onDate = new Date().toISOString().slice(0, 10),
): Promise<IntermediaryLender[]> {
  const [banksResult, aliasesResult] = await Promise.all([
    dataApi
      .from('mortgage_banks')
      .select('id, name') as Promise<QueryResult<MortgageBankRow>>,
    dataApi
      .from('mortgage_bank_aliases')
      .select('bank_id, value, valid_from, valid_to')
      .eq('alias_type', 'legal_name') as Promise<QueryResult<MortgageBankAliasRow>>,
  ])

  throwQueryError('mortgage_banks', banksResult.error)
  throwQueryError('mortgage_bank_aliases', aliasesResult.error)

  return buildIntermediaryLenders(
    banksResult.data ?? [],
    aliasesResult.data ?? [],
    onDate,
  )
}
