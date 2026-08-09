import type { CeidgCompanyData } from '#shared/types/ceidg-company'
import type { MultiformFieldValue } from '~/types/multiform'

function dateValue(value: string) {
  const match = value.match(/^\d{4}-\d{2}-\d{2}/u)
  return match?.[0] ?? value
}

function activeOrSuspended(status: string) {
  const normalized = status.trim().toLocaleUpperCase('pl-PL')
  return normalized.includes('AKTYWN') || normalized.includes('ZAWIESZ')
}

export function ceidgCompanyPrefillValues(
  company: CeidgCompanyData,
): Record<string, MultiformFieldValue> {
  return {
    businessName: company.name,
    businessNip: company.nip,
    businessRegon: company.regon,
    businessCeidgId: company.ceidgId,
    businessLegalForm: company.legalForm,
    businessStatus: company.status,
    businessAddress: company.businessAddress,
    businessCorrespondenceAddress: company.correspondenceAddress,
    businessStartDate: dateValue(company.startDate),
    businessSuspensionDate: dateValue(company.suspensionDate),
    businessResumeDate: dateValue(company.resumeDate),
    businessTerminationDate: dateValue(company.terminationDate),
    businessRemovalDate: dateValue(company.removalDate),
    pkdCode: company.mainPkd?.code ?? '',
    businessPkdCodes: company.pkd
      .map(item => [item.code, item.name].filter(Boolean).join(' — '))
      .join('\n'),
    businessEmail: company.email,
    businessPhone: company.phone,
    businessWebsite: company.website,
    businessActiveOrRecentlySuspended: company.status
      ? activeOrSuspended(company.status)
      : '',
  }
}

export function mergeCeidgCompanyIntoEmptyFields(
  currentValues: Readonly<Record<string, MultiformFieldValue>>,
  availableKeys: ReadonlySet<string>,
  applicantIndex: number,
  company: CeidgCompanyData,
) {
  const values = { ...currentValues }
  const prefill = ceidgCompanyPrefillValues(company)
  let filledCount = 0
  let preservedCount = 0

  for (const [relativeKey, nextValue] of Object.entries(prefill)) {
    if (nextValue === '' || nextValue === undefined || nextValue === null) continue
    const key = `applicants.${applicantIndex}.${relativeKey}`
    if (!availableKeys.has(key)) continue
    const currentValue = currentValues[key]
    if (currentValue === '' || currentValue === undefined || currentValue === null) {
      values[key] = nextValue
      filledCount += 1
    }
    else if (String(currentValue) !== String(nextValue)) {
      preservedCount += 1
    }
  }

  return { values, filledCount, preservedCount }
}
