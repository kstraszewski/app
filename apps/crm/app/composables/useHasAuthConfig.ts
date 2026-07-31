export function useHasAuthConfig(): boolean {
  return useRuntimeConfig().public.openexpert.hasAuthConfig !== false
}
