export interface PortalGrantScopeLike {
  link: {
    organizationId: string
    clientId: string
    clientPersonId: string
    person: { role: string }
  }
}

export function selectPreferredPortalGrantScope<T extends PortalGrantScopeLike>(
  scopes: T[],
): T | null {
  return [...scopes].sort((left, right) => {
    const leftPrimary = left.link.person.role === 'primary' ? 0 : 1
    const rightPrimary = right.link.person.role === 'primary' ? 0 : 1
    return leftPrimary - rightPrimary
      || left.link.clientPersonId.localeCompare(right.link.clientPersonId)
      || left.link.clientId.localeCompare(right.link.clientId)
      || left.link.organizationId.localeCompare(right.link.organizationId)
  })[0] ?? null
}
