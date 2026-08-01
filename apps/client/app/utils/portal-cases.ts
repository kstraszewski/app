import type { PortalCase } from '~/types/portal'
import { isTerminalPortalCase } from '~~/shared/utils/portal-case-status'

export function isCompletedPortalCase(caseData: PortalCase): boolean {
  return isTerminalPortalCase(caseData)
}
