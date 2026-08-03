<script setup lang="ts">
definePageMeta({ middleware: ['auth', 'organization'] })

const { organizationSlug, orgPath } = useOrganizationContext()
const { data: organizations } = await useOrganizations()
const activeOrganization = computed(() => (
  organizations.value.data.find(organization => organization.slug === organizationSlug.value)
))
const accountBase = computed(() => orgPath('/settings/account'))
const tabs = computed(() => [
  {
    label: 'Moja wizytówka',
    to: accountBase.value,
    icon: 'i-lucide-contact',
  },
  {
    label: 'Bezpieczeństwo',
    to: `${accountBase.value}/security`,
    icon: 'i-lucide-shield-check',
  },
  {
    label: 'Metody logowania',
    to: `${accountBase.value}/login-methods`,
    icon: 'i-lucide-key-round',
  },
])

useHead({ title: 'Ustawienia konta — OpenExpert CRM' })
</script>

<template>
  <CrmShell
    class="account-settings"
    title="Ustawienia konta"
    :eyebrow="activeOrganization?.name || 'Twoje konto'"
    description="Sprawdź, co widzą klienci, i zarządzaj bezpieczeństwem swojej tożsamości OpenExpert."
    :tabs="tabs"
  >
    <NuxtPage />
  </CrmShell>
</template>

<style scoped>
.account-settings :deep(.crm-page-header) {
  margin-bottom: 24px;
}
</style>
