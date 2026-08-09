interface CrmApplicantClient {
  display_name?: unknown
}

export interface CrmApplicantPerson {
  client_id: unknown
  display_name?: unknown
  pesel?: unknown
  role?: unknown
}

function nonEmptyText(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

export function resolveCrmApplicantProfile(
  client: CrmApplicantClient | undefined,
  people: readonly CrmApplicantPerson[],
  fallbackLabel: string,
) {
  const person = people.find(item => String(item.role) === 'primary') ?? people[0]

  return {
    label: nonEmptyText(person?.display_name)
      ?? nonEmptyText(client?.display_name)
      ?? fallbackLabel,
    pesel: nonEmptyText(person?.pesel) ?? null,
  }
}
