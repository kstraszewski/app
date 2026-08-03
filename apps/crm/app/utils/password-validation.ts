export type PasswordRequirements = {
  minimumLength: boolean
  acceptableLength: boolean
  lowercase: boolean
  uppercase: boolean
  number: boolean
}

export function getPasswordRequirements(password: string): PasswordRequirements {
  return {
    minimumLength: password.length >= 10,
    acceptableLength: password.length <= 128 && new TextEncoder().encode(password).length <= 72,
    lowercase: /[a-z]/.test(password),
    uppercase: /[A-Z]/.test(password),
    number: /[0-9]/.test(password),
  }
}

export function getPasswordIssue(password: string): string | null {
  const requirements = getPasswordRequirements(password)
  if (!requirements.minimumLength) return 'Hasło musi mieć co najmniej 10 znaków.'
  if (!requirements.acceptableLength) {
    return 'Hasło jest za długie. Skróć je, szczególnie jeśli zawiera polskie znaki lub symbole.'
  }
  if (!requirements.lowercase) return 'Dodaj do hasła małą literę.'
  if (!requirements.uppercase) return 'Dodaj do hasła wielką literę.'
  if (!requirements.number) return 'Dodaj do hasła cyfrę.'
  return null
}
