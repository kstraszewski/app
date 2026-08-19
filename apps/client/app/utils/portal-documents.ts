import type { PortalCase } from '../types/portal.ts'

export function hasPortalCaseDocuments(
  documents: PortalCase['documents'],
): boolean {
  return (documents?.items?.length ?? 0) > 0
    || (documents?.total ?? 0) > 0
}
