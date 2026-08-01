export interface PortalCaseCompletionInput {
  statusCode?: unknown
  closedAt?: unknown
  progressPercent?: unknown
}

const terminalStatusCodes = new Set([
  'cancelled',
  'closed',
  'completed',
  'complete',
  'done',
  'finished',
  'archived',
  'archiwum',
  'utracona',
  'zakonczona',
  'zakończona',
])

export function isTerminalPortalCase(input: PortalCaseCompletionInput): boolean {
  const statusCode = typeof input.statusCode === 'string'
    ? input.statusCode.trim().toLocaleLowerCase('pl-PL')
    : ''
  return Boolean(input.closedAt)
    || Number(input.progressPercent) >= 100
    || terminalStatusCodes.has(statusCode)
}
