<script setup lang="ts">
import { pl } from '@nuxt/ui/locale'
import {
  buildOrganizationDesignCss,
  cloneDefaultOrganizationDesign,
  normalizeOrganizationDesign,
  type OrganizationDesignSettings,
} from '#shared/design'

const route = useRoute()
const organizationDesign = useOrganizationDesignState()
const organizationSlug = computed(() => {
  const value = route.params.organizationSlug
  return Array.isArray(value) ? String(value[0] ?? '') : String(value ?? '')
})

const { data: loadedDesign } = await useAsyncData(
  'openexpert-active-organization-design',
  async () => {
    if (!organizationSlug.value) return cloneDefaultOrganizationDesign()

    try {
      const response = await $fetch<{ data: OrganizationDesignSettings }>(
        `/api/org/${encodeURIComponent(organizationSlug.value)}/design`,
      )
      return normalizeOrganizationDesign(response.data)
    } catch {
      return cloneDefaultOrganizationDesign()
    }
  },
  {
    watch: [organizationSlug],
    default: cloneDefaultOrganizationDesign,
  },
)

watchEffect(() => {
  organizationDesign.value = normalizeOrganizationDesign(loadedDesign.value)
})

useHead(() => ({
  style: [{
    key: 'openexpert-organization-design',
    textContent: buildOrganizationDesignCss(organizationDesign.value),
  }],
}))
</script>

<template>
  <UApp :locale="pl">
    <NuxtRouteAnnouncer />
    <NuxtLoadingIndicator
      color="var(--ui-primary)"
      :height="2"
      :throttle="120"
    />
    <NuxtPage />
  </UApp>
</template>
