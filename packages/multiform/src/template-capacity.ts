import type { DocumentTemplate, TemplateBinding } from './types.ts'

const applicantKeyPattern = /^applicants\.(\d+)\./u

function applicantIndexes(binding: TemplateBinding) {
  if (binding.target.kind === 'unmapped') return []
  return [binding.canonicalKey, ...(binding.valueFrom ?? [])].flatMap((key) => {
    const match = applicantKeyPattern.exec(key)
    return match ? [Number(match[1])] : []
  })
}

/**
 * Returns the largest continuous applicant prefix supported by a template.
 * `null` means that the document does not contain applicant-scoped fields and
 * therefore should not constrain the collection.
 */
export function templateApplicantCapacity(template: DocumentTemplate): number | null {
  const indexes = new Set(template.bindings.flatMap(applicantIndexes))
  if (indexes.size === 0) return null
  let capacity = 0
  while (indexes.has(capacity)) capacity += 1
  return capacity
}

export interface TemplateApplicantCapacityIssue {
  templateId: string
  templateLabel: string
  requestedCount: number
  supportedCount: number
}

export function templateApplicantCapacityIssues(
  templates: readonly DocumentTemplate[],
  requestedCount: number,
): TemplateApplicantCapacityIssue[] {
  if (!Number.isSafeInteger(requestedCount) || requestedCount < 0) {
    throw new Error('Liczba wnioskodawców jest nieprawidłowa.')
  }
  return templates.flatMap((template) => {
    const supportedCount = templateApplicantCapacity(template)
    return supportedCount !== null && requestedCount > supportedCount
      ? [{
          templateId: template.id,
          templateLabel: template.label,
          requestedCount,
          supportedCount,
        }]
      : []
  })
}
