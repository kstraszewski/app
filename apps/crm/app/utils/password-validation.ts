import {
  getOpenExpertPasswordIssue,
  getOpenExpertPasswordRequirements,
  type OpenExpertPasswordRequirements,
} from '@openexpert/auth'

export type PasswordRequirements = OpenExpertPasswordRequirements

export function getPasswordRequirements(password: string): PasswordRequirements {
  return getOpenExpertPasswordRequirements(password)
}

export function getPasswordIssue(password: string): string | null {
  return getOpenExpertPasswordIssue(password)
}
