<script setup lang="ts">
import * as z from 'zod'
import type { FormSubmitEvent } from '@nuxt/ui'
import type { AccountContexts } from '~/types/account'
import { apiErrorMessage } from '~/utils/api-error'

definePageMeta({ middleware: 'auth', layout: false })

const authenticatedUser = useAuthUser()
const pendingOrganizationName = useCookie<string | null>('openexpert-pending-organization')
const accountCacheScope = String(authenticatedUser.value?.sub ?? 'anonymous')
const { data: contexts, refresh: refreshContexts } = await useFetch<AccountContexts>(
  '/api/me/contexts',
  {
    key: `account-contexts:${accountCacheScope}`,
  },
)

const onboardingSchema = z.object({
  fullName: z.string().trim()
    .min(1, 'Podaj imię i nazwisko.')
    .max(200, 'Imię i nazwisko może mieć maksymalnie 200 znaków.'),
  organizationName: z.string().trim()
    .min(1, 'Podaj nazwę organizacji.')
    .max(160, 'Nazwa organizacji może mieć maksymalnie 160 znaków.'),
})
type OnboardingSchema = z.output<typeof onboardingSchema>

const onboardingState = reactive<OnboardingSchema>({
  fullName: contexts.value?.identity.fullName ?? '',
  organizationName: '',
})
const loading = ref(false)
const error = ref<string | null>(null)

useHead({
  title: 'Utwórz organizację — OpenExpert',
  meta: [{ name: 'robots', content: 'noindex, nofollow' }],
})

onMounted(() => {
  const metadata = authenticatedUser.value?.user_metadata
  if (!onboardingState.fullName && typeof metadata?.full_name === 'string') {
    onboardingState.fullName = metadata.full_name
  }
  if (pendingOrganizationName.value) {
    onboardingState.organizationName = pendingOrganizationName.value
  }
})

async function createOrganization(event: FormSubmitEvent<OnboardingSchema>) {
  if (loading.value) return
  error.value = null
  loading.value = true
  try {
    const organization = await $fetch<{ slug?: string }>('/api/onboarding', {
      method: 'POST',
      body: {
        organizationName: event.data.organizationName,
        fullName: event.data.fullName,
      },
    })

    pendingOrganizationName.value = null
    await refreshContexts()
    await refreshNuxtData('openexpert-organizations')
    if (organization.slug) {
      await navigateTo(`/org/${encodeURIComponent(organization.slug)}/dashboard`)
      return
    }
    await navigateTo('/account')
  }
  catch (caught: unknown) {
    error.value = apiErrorMessage(caught) || 'Nie udało się utworzyć organizacji.'
  }
  finally {
    loading.value = false
  }
}
</script>

<template>
  <ClientPortalShell
    compact
    :show-navigation="false"
    eyebrow="Panel profesjonalisty"
    :title="contexts?.hasStaff ? 'Utwórz kolejny obszar pośrednika' : 'Rozpocznij rejestrację'"
    :description="contexts?.hasStaff
      ? 'Utwórz oddzielny, bezpłatny obszar pośrednika. Rejestracja aplikacji z płatnymi miejscami rozpoczyna się w cenniku.'
      : 'Wybierz liczbę płatnych miejsc w formularzu rejestracji aplikacji albo przyjmij zaproszenie otrzymane e-mailem.'"
  >
    <UAlert
      v-if="contexts?.hasStaff"
      color="info"
      variant="subtle"
      icon="i-lucide-building-2"
      title="Masz już organizację"
      description="Możesz utworzyć kolejną. Obecne organizacje i ich dane pozostaną bez zmian."
    >
      <template #actions>
        <UButton to="/account" color="info" variant="soft">
          Wybierz widok
        </UButton>
      </template>
    </UAlert>

    <UAlert
      v-if="!contexts?.hasStaff"
      color="info"
      variant="subtle"
      icon="i-lucide-users"
      title="Liczba miejsc musi być potwierdzona przed utworzeniem organizacji"
      description="Przejdź do rejestracji aplikacji, wybierz od 1 do 100 miejsc i potwierdź adres e-mail. Organizacja powstanie dopiero po przyjęciu tego zgłoszenia."
    >
      <template #actions>
        <UButton to="/register" color="primary">
          Przejdź do rejestracji
        </UButton>
        <UButton to="/login" color="neutral" variant="soft">
          Mam już konto
        </UButton>
      </template>
    </UAlert>

    <UCard v-else class="onboarding-card">
      <UForm
        :schema="onboardingSchema"
        :state="onboardingState"
        class="onboarding-form"
        @submit="createOrganization"
      >
        <UFormField name="fullName" label="Imię i nazwisko" required>
          <UInput
            v-model="onboardingState.fullName"
            autocomplete="name"
            required
            maxlength="200"
            icon="i-lucide-user"
            class="w-full"
            :disabled="loading"
          />
        </UFormField>

        <UAlert
          color="neutral"
          variant="subtle"
          icon="i-lucide-briefcase-business"
          title="Bezpłatny obszar pośrednika"
          description="Ta ścieżka nie tworzy aplikacji abonamentowej ani nie uruchamia płatności Stripe."
        />

        <UFormField name="organizationName" label="Nazwa organizacji" required>
          <UInput
            v-model="onboardingState.organizationName"
            autocomplete="organization"
            required
            maxlength="160"
            icon="i-lucide-building-2"
            class="w-full"
            :disabled="loading"
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
          Utwórz obszar pośrednika
        </UButton>
      </UForm>
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

.organization-kind {
  display: grid;
  gap: 10px;
  padding: 0;
  border: 0;
}

.organization-kind legend {
  margin-bottom: 8px;
  color: var(--ui-text-highlighted);
  font-size: 14px;
  font-weight: 600;
}

.organization-kind__option {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 14px;
  width: 100%;
  padding: 16px;
  border: 1px solid var(--ui-border);
  border-radius: 14px;
  color: var(--ui-text-highlighted);
  background: var(--ui-bg);
  text-align: left;
  cursor: pointer;
  transition: border-color .16s ease, background-color .16s ease, transform .16s ease;
}

.organization-kind__option:hover {
  border-color: var(--ui-border-accented);
  transform: translateY(-1px);
}

.organization-kind__option:focus-visible {
  outline: 2px solid var(--ui-primary);
  outline-offset: 3px;
}

.organization-kind__option--selected {
  border-color: var(--ui-primary);
  background: color-mix(in srgb, var(--ui-primary) 5%, var(--ui-bg));
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--ui-primary) 14%, transparent);
}

.organization-kind__icon {
  display: grid;
  width: 42px;
  height: 42px;
  place-items: center;
  border-radius: 12px;
  color: var(--ui-text-highlighted);
  background: var(--ui-bg-elevated);
  font-size: 19px;
}

.organization-kind__icon--application {
  color: var(--ui-primary);
  background: color-mix(in srgb, var(--ui-primary) 12%, var(--ui-bg));
}

.organization-kind__option > span:nth-child(2) {
  display: grid;
  gap: 4px;
}

.organization-kind__option small {
  color: var(--ui-text-muted);
  font-size: 12px;
  line-height: 1.45;
}

@media (max-width: 560px) {
  .organization-kind__option {
    grid-template-columns: auto minmax(0, 1fr);
  }

  .organization-kind__option :deep(.badge) {
    grid-column: 2;
    justify-self: start;
  }
}
</style>
