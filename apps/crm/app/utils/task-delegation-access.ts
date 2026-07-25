import type { CaseTaskDelegationAccessScope } from '../types/task-delegation-ui'

export const CASE_TASK_DELEGATION_ACCESS_SCOPE_ORDER = [
  'case_summary',
  'client_identity',
  'client_contact',
  'documents',
  'offers',
  'financial_data',
  'activities',
] as const satisfies readonly CaseTaskDelegationAccessScope[]

export const CASE_TASK_DELEGATION_APPOINTMENT_REQUIRED_ACCESS = [
  'client_identity',
  'client_contact',
] as const satisfies readonly CaseTaskDelegationAccessScope[]

export function caseTaskDelegationAccessScopeIsRequired(
  scope: CaseTaskDelegationAccessScope,
  hasAppointment: boolean,
): boolean {
  return scope === 'case_summary'
    || (
      hasAppointment
      && CASE_TASK_DELEGATION_APPOINTMENT_REQUIRED_ACCESS.some(required => required === scope)
    )
}

export function normalizeCaseTaskDelegationAccessScope(
  scopes: Iterable<CaseTaskDelegationAccessScope>,
  hasAppointment: boolean,
): CaseTaskDelegationAccessScope[] {
  const selected = new Set(scopes)
  selected.add('case_summary')
  if (hasAppointment) {
    for (const scope of CASE_TASK_DELEGATION_APPOINTMENT_REQUIRED_ACCESS) {
      selected.add(scope)
    }
  }
  return CASE_TASK_DELEGATION_ACCESS_SCOPE_ORDER.filter(scope => selected.has(scope))
}
