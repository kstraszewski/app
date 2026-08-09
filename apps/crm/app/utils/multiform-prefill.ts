export interface MultiformApplicantPrefillSource {
  label: string
  pesel: string | null
  email?: string | null
  phone?: string | null
  birthDate?: string | null
}

export interface MultiformClientContactSource {
  primary_email?: string | null
  primary_phone?: string | null
}

export function multiformApplicantDefaults(
  applicant: MultiformApplicantPrefillSource,
  client?: MultiformClientContactSource,
) {
  const nameParts = applicant.label.trim().split(/\s+/).filter(Boolean)

  return {
    firstName: nameParts.shift() ?? '',
    lastName: nameParts.join(' '),
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
