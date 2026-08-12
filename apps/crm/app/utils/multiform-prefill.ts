export interface MultiformApplicantPrefillSource {
  label: string
  firstName?: string | null
  lastName?: string | null
  pesel: string | null
  email?: string | null
  phone?: string | null
  birthDate?: string | null
}

export interface MultiformClientContactSource {
  primary_email?: string | null
  primary_phone?: string | null
}

export interface MultiformPropertyAddressParts {
  street: string
  houseNumber: string
  unitNumber: string
}

export function splitPolishStreetAddress(value: string | null | undefined): MultiformPropertyAddressParts {
  const firstLine = String(value ?? '').split(',')[0]?.trim() ?? ''
  const normalized = firstLine.replace(/^(?:ul\.?|al\.?|aleja|os\.?|osiedle|pl\.?|plac)\s+/iu, '')
  const match = /^(.*?)\s+(\d+[a-z]?(?:-\d+[a-z]?)?)(?:\/(\d+[a-z]?))?$/iu.exec(normalized)
  if (!match) return { street: normalized, houseNumber: '', unitNumber: '' }
  return {
    street: match[1]?.trim() ?? '',
    houseNumber: match[2]?.trim() ?? '',
    unitNumber: match[3]?.trim() ?? '',
  }
}

export function multiformApplicantDefaults(
  applicant: MultiformApplicantPrefillSource,
  client?: MultiformClientContactSource,
) {
  const nameParts = applicant.label.trim().split(/\s+/).filter(Boolean)
  const fallbackFirstName = nameParts.shift() ?? ''
  const fallbackLastName = nameParts.join(' ')

  return {
    firstName: applicant.firstName?.trim() || fallbackFirstName,
    lastName: applicant.lastName?.trim() || fallbackLastName,
    pesel: applicant.pesel?.trim() ?? '',
    email: applicant.email?.trim() || client?.primary_email || '',
    phone: applicant.phone?.trim() || client?.primary_phone || '',
    birthDate: applicant.birthDate?.trim() ?? '',
  }
}

export function canonicalLoanPurposeFromIntake(value: string | null | undefined) {
  if (value === 'refinance') return 'refinancing'
  if (['purchase_primary', 'purchase_secondary', 'construction', 'renovation'].includes(value ?? '')) {
    return value!
  }
  return undefined
}

export function canonicalDisbursementTypeFromIntake(value: boolean | null | undefined) {
  if (value === true) return 'tranches'
  if (value === false) return 'single'
  return undefined
}
