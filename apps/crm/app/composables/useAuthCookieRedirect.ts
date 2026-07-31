export function useAuthCookieRedirect() {
  const redirect = useCookie<string | null>('openexpert-auth-redirect', {
    sameSite: 'lax',
    secure: import.meta.env.PROD,
  })

  return {
    pluck() {
      const value = redirect.value
      redirect.value = null
      return value
    },
    set(value: string) {
      redirect.value = value
    },
  }
}
