interface ForumModerationContextPayload {
  canModerate: boolean
  canManageCategories: boolean
  roleLabel?: string
  isForumAdmin?: boolean
  isOrganizationAdmin?: boolean
}

const emptyForumModerationContext = (): ForumModerationContextPayload => ({
  canModerate: false,
  canManageCategories: false,
  roleLabel: '',
  isForumAdmin: false,
  isOrganizationAdmin: false,
})

export function useForumModerationContext() {
  const requestFetch = useRequestFetch()
  const { organizationSlug, orgApiPath } = useOrganizationContext()
  const context = ref<ForumModerationContextPayload>(emptyForumModerationContext())
  const status = ref<'idle' | 'pending' | 'success' | 'error'>('idle')
  let controller: AbortController | null = null

  const endpoint = computed(() => orgApiPath('/forum/moderation/context'))
  const canAccessModeration = computed(() => (
    context.value.canModerate || context.value.canManageCategories
  ))
  const roleLabel = computed(() => (
    context.value.roleLabel?.trim()
    || (context.value.isOrganizationAdmin ? 'Administrator organizacji' : '')
    || (context.value.isForumAdmin ? 'Administrator forum' : '')
    || (context.value.canModerate ? 'Moderator forum' : '')
    || (context.value.canManageCategories ? 'Administrator forum' : '')
  ))
  const access = computed(() => ({
    canModerate: context.value.canModerate,
    canManageCategories: context.value.canManageCategories,
    roleLabel: roleLabel.value,
  }))

  async function load(): Promise<boolean> {
    controller?.abort()
    const requestController = new AbortController()
    controller = requestController
    status.value = 'pending'

    try {
      const payload = await requestFetch<ForumModerationContextPayload>(endpoint.value, {
        signal: requestController.signal,
      })
      if (controller !== requestController) return false
      context.value = payload
      status.value = 'success'
      return true
    } catch (error) {
      if (requestController.signal.aborted) return false
      context.value = emptyForumModerationContext()
      status.value = 'error'
      return false
    } finally {
      if (controller === requestController) controller = null
    }
  }

  watch(organizationSlug, () => {
    context.value = emptyForumModerationContext()
    if (import.meta.client) void load()
  })

  onMounted(() => {
    void load()
  })

  onBeforeUnmount(() => controller?.abort())

  return {
    access,
    canAccessModeration,
    context,
    endpoint,
    load,
    roleLabel,
    status,
  }
}
