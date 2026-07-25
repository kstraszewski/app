<script setup lang="ts">
import type { AccountContexts } from '~/types/account'

definePageMeta({ middleware: 'auth', layout: false })

const supabase = useSupabaseClient() as any
const authenticatedUser = useSupabaseUser()
const accountCacheScope = String(authenticatedUser.value?.sub ?? 'anonymous')
const { data: contexts, refresh: refreshContexts } = await useFetch<AccountContexts>(
  '/api/me/contexts',
  {
    key: `account-contexts:${accountCacheScope}`,
  },
)
const fullName = ref(contexts.value?.identity.fullName ?? '')
const organizationName = ref('')
const loading = ref(false)
const error = ref<string | null>(null)

useHead({
  title: 'Utwórz organizację — OpenExpert',
  meta: [{ name: 'robots', content: 'noindex, nofollow' }],
})

onMounted(async () => {
  const { data } = await supabase.auth.getUser()
  const metadata = data?.user?.user_metadata
  if (!fullName.value && typeof metadata?.full_name === 'string') {
    fullName.value = metadata.full_name
  }
  if (typeof metadata?.organization_name === 'string') {
    organizationName.value = metadata.organization_name
  }
})

async function createOrganization() {
  error.value = null
  if (!organizationName.value.trim()) {
    error.value = 'Podaj nazwę organizacji.'
    return
  }

  loading.value = true
  const { data, error: rpcError } = await supabase.rpc('create_organization_with_admin', {
    organization_name: organizationName.value.trim(),
    full_name: fullName.value.trim() || null,
  })
  loading.value = false

  if (rpcError) {
    const message = String(rpcError.message ?? '')
    error.value = /already has a staff profile/i.test(message)
      ? 'To konto ma już utworzony profil pracownika.'
      : message || 'Nie udało się utworzyć organizacji.'
    return
  }

  await refreshContexts()
  const organization = data as { slug?: string } | null
  if (organization?.slug) {
    await navigateTo(`/org/${encodeURIComponent(organization.slug)}/dashboard`)
    return
  }
  await navigateTo('/account')
}
</script>

<template>
  <ClientPortalShell
    compact
    :show-navigation="false"
    eyebrow="Panel profesjonalisty"
    title="Utwórz organizację"
    description="To osobny kontekst pracy dla ekspertów i zespołów. Twoje ewentualne konsultacje klienta pozostaną w oddzielnym widoku."
  >
    <UAlert
      v-if="contexts?.hasStaff"
      color="info"
      variant="subtle"
      icon="i-lucide-building-2"
      title="Masz już profil pracownika"
      description="Przejdź do wyboru widoku, aby otworzyć właściwą organizację."
    >
      <template #actions>
        <UButton to="/account" color="info" variant="soft">
          Wybierz widok
        </UButton>
      </template>
    </UAlert>

    <UCard v-else class="onboarding-card">
      <form class="onboarding-form" @submit.prevent="createOrganization">
        <UFormField label="Imię i nazwisko" required>
          <UInput
            v-model="fullName"
            autocomplete="name"
            required
            icon="i-lucide-user"
            class="w-full"
          />
        </UFormField>

        <UFormField label="Nazwa organizacji" required>
          <UInput
            v-model="organizationName"
            autocomplete="organization"
            required
            icon="i-lucide-building-2"
            class="w-full"
          />
        </UFormField>

        <UAlert
          v-if="error"
          role="alert"
          color="error"
          variant="subtle"
          icon="i-lucide-circle-alert"
          :description="error"
        />

        <UButton
          type="submit"
          block
          size="lg"
          icon="i-lucide-arrow-right"
          :loading="loading"
        >
          Utwórz organizację i przejdź do CRM
        </UButton>
      </form>
    </UCard>
  </ClientPortalShell>
</template>

<style scoped>
.onboarding-card {
  box-shadow: 0 28px 80px rgb(0 0 0 / 7%);
}

.onboarding-form {
  display: grid;
  gap: 18px;
}
</style>
