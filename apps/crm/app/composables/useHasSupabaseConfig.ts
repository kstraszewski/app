export function useHasSupabaseConfig(): boolean {
  const config = useRuntimeConfig().public.supabase as { url?: string; key?: string }
  return Boolean(
    config.url
    && config.key
    && config.key !== 'local-development-placeholder',
  )
}
