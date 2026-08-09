export interface MultiformApplicantPrefillSource {
  label: string
  pesel: string | null
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
    email: client?.primary_email ?? '',
    phone: client?.primary_phone ?? '',
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
