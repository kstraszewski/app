export interface MortgageConsentBatchIdentity {
  baseRevision: number
  commandIdsByClientId: Record<string, string>
}

export interface MortgageConsentBatchStep {
  clientId: string
  commandId: string
  expectedRevision: number
}

export function sortedMortgageConsentClientIds(clientIds: readonly string[]): string[] {
  return [...new Set(clientIds)].sort((left, right) => left.localeCompare(right))
}

export function createMortgageConsentBatchIdentity(
  clientIds: readonly string[],
  baseRevision: number,
  createCommandId: () => string,
): MortgageConsentBatchIdentity {
  if (!Number.isSafeInteger(baseRevision) || baseRevision < 0) {
    throw new Error('Mortgage consent batch requires a non-negative base revision.')
  }
  const sortedClientIds = sortedMortgageConsentClientIds(clientIds)
  if (!Number.isSafeInteger(baseRevision + sortedClientIds.length)) {
    throw new Error('Mortgage consent batch revision range is invalid.')
  }
  return {
    baseRevision,
    commandIdsByClientId: Object.fromEntries(
      sortedClientIds.map(clientId => [clientId, createCommandId()]),
    ),
  }
}

export function mortgageConsentBatchSteps(
  clientIds: readonly string[],
  identity: MortgageConsentBatchIdentity,
): MortgageConsentBatchStep[] {
  const sortedClientIds = sortedMortgageConsentClientIds(clientIds)
  if (sortedClientIds.length !== clientIds.length) {
    throw new Error('Mortgage consent batch contains a duplicate client.')
  }
  if (!Number.isSafeInteger(identity.baseRevision) || identity.baseRevision < 0
    || !Number.isSafeInteger(identity.baseRevision + sortedClientIds.length)) {
    throw new Error('Mortgage consent batch revision range is invalid.')
  }
  const identityClientIds = Object.keys(identity.commandIdsByClientId)
    .sort((left, right) => left.localeCompare(right))
  if (identityClientIds.length !== sortedClientIds.length
    || identityClientIds.some((clientId, index) => clientId !== sortedClientIds[index])) {
    throw new Error('Mortgage consent batch identity does not match its clients.')
  }

  return sortedClientIds.map((clientId, index) => {
    const commandId = identity.commandIdsByClientId[clientId]
    if (!commandId) throw new Error('Mortgage consent batch command identity is incomplete.')
    return {
      clientId,
      commandId,
      expectedRevision: identity.baseRevision + index,
    }
  })
}
