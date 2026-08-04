export const OPENEXPERT_PASSWORD_MIN_CHARACTERS = 10
export const OPENEXPERT_PASSWORD_MAX_CHARACTERS = 128
export const OPENEXPERT_BCRYPT_MAX_BYTES = 72

export type OpenExpertPasswordRequirements = {
  minimumLength: boolean
  acceptableLength: boolean
  lowercase: boolean
  uppercase: boolean
  number: boolean
}

export class OpenExpertPasswordPolicyError extends RangeError {
  readonly code = 'PASSWORD_POLICY_VIOLATION'

  constructor(message: string) {
    super(message)
    this.name = 'OpenExpertPasswordPolicyError'
  }
}

export function getOpenExpertPasswordRequirements(
  password: string,
): OpenExpertPasswordRequirements {
  const byteLength = new TextEncoder().encode(password).byteLength
  return {
    minimumLength: password.length >= OPENEXPERT_PASSWORD_MIN_CHARACTERS,
    acceptableLength: password.length <= OPENEXPERT_PASSWORD_MAX_CHARACTERS
      && byteLength <= OPENEXPERT_BCRYPT_MAX_BYTES,
    lowercase: /\p{Ll}/u.test(password),
    uppercase: /\p{Lu}/u.test(password),
    number: /[0-9]/u.test(password),
  }
}

export function getOpenExpertPasswordIssue(password: string): string | null {
  const requirements = getOpenExpertPasswordRequirements(password)
  if (!requirements.minimumLength) {
    return `Hasło musi mieć co najmniej ${OPENEXPERT_PASSWORD_MIN_CHARACTERS} znaków.`
  }
  if (!requirements.acceptableLength) {
    return 'Hasło jest za długie. Skróć je, szczególnie jeśli zawiera polskie znaki lub symbole.'
  }
  if (!requirements.lowercase) return 'Dodaj do hasła małą literę.'
  if (!requirements.uppercase) return 'Dodaj do hasła wielką literę.'
  if (!requirements.number) return 'Dodaj do hasła cyfrę.'
  return null
}

export function assertOpenExpertPassword(password: string): void {
  const issue = getOpenExpertPasswordIssue(password)
  if (issue) throw new OpenExpertPasswordPolicyError(issue)
}
