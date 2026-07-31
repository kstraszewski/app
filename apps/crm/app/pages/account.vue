<script setup lang="ts">
import type { AccountContexts } from '~/types/account'

definePageMeta({ middleware: 'auth', layout: false })

const authenticatedUser = useAuthUser()
const accountCacheScope = String(authenticatedUser.value?.sub ?? 'anonymous')
const { data: contexts, status, error, refresh } = await useFetch<AccountContexts>(
  '/api/me/contexts',
  {
    key: `account-contexts:${accountCacheScope}`,
  },
)

useHead({
  title: 'Wybierz widok — OpenExpert',
  meta: [{ name: 'robots', content: 'noindex, nofollow' }],
})
</script>

<template>
  <ClientPortalShell
    compact
    :show-navigation="false"
    eyebrow="Twoje konto"
    title="Wybierz widok"
    :description="contexts?.identity.email || 'Przejdź do obszaru, w którym chcesz teraz pracować.'"
  >
    <div v-if="status === 'pending'" class="context-list">
      <USkeleton class="h-36 w-full" />
      <USkeleton class="h-36 w-full" />
    </div>

    <UAlert
      v-else-if="error"
      color="error"
      variant="subtle"
      icon="i-lucide-circle-alert"
      title="Nie udało się pobrać dostępnych widoków"
    >
      <template #actions>
        <UButton color="error" variant="soft" @click="refresh()">
          Spróbuj ponownie
        </UButton>
      </template>
    </UAlert>

    <div v-else class="context-list">
      <NuxtLink
        v-if="contexts?.hasClient"
        to="/client"
        class="context-card"
      >
        <span class="context-card__icon"><UIcon name="i-lucide-calendar-heart" /></span>
        <span>
          <small>Klient</small>
          <strong>Moje konsultacje</strong>
          <em>{{ contexts.clientLinkCount }} {{ contexts.clientLinkCount === 1 ? 'powiązany profil' : 'powiązane profile' }}</em>
        </span>
        <UIcon name="i-lucide-arrow-right" />
      </NuxtLink>

      <NuxtLink
        v-for="organization in contexts?.staffOrganizations ?? []"
        :key="organization.id"
        :to="`/org/${encodeURIComponent(organization.slug)}/dashboard`"
        class="context-card"
      >
        <span class="context-card__icon context-card__icon--staff">
          <UIcon name="i-lucide-briefcase-business" />
        </span>
        <span>
          <small>Panel organizacji · {{ organization.role }}</small>
          <strong>{{ organization.name }}</strong>
          <em>CRM, placówki i konsultacje</em>
        </span>
        <UIcon name="i-lucide-arrow-right" />
      </NuxtLink>

      <NuxtLink
        v-if="!contexts?.hasStaff"
        to="/onboarding"
        class="context-card"
      >
        <span class="context-card__icon context-card__icon--staff">
          <UIcon name="i-lucide-building-2" />
        </span>
        <span>
          <small>Panel profesjonalisty</small>
          <strong>Utwórz organizację</strong>
          <em>Oddzielny obszar pracy dla ekspertów i zespołu</em>
        </span>
        <UIcon name="i-lucide-arrow-right" />
      </NuxtLink>
    </div>
  </ClientPortalShell>
</template>

<style scoped>
.context-list {
  display: grid;
  gap: 14px;
}

.context-card {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 16px;
  border: 1px solid var(--ui-border);
  border-radius: 16px;
  padding: 20px;
  background: var(--ui-bg);
  color: var(--ui-text-highlighted);
  box-shadow: 0 14px 38px rgb(0 0 0 / 4%);
  text-decoration: none;
  transition: border-color .18s ease, transform .18s ease;
}

.context-card:hover {
  border-color: var(--ui-border-accented);
  transform: translateY(-2px);
}

.context-card__icon {
  display: grid;
  width: 46px;
  height: 46px;
  place-items: center;
  border-radius: 14px;
  background: color-mix(in srgb, var(--ui-primary) 13%, var(--ui-bg-elevated));
  color: var(--ui-primary);
  font-size: 21px;
}

.context-card__icon--staff {
  background: var(--ui-bg-elevated);
  color: var(--ui-text-highlighted);
}

.context-card > span:nth-child(2) {
  display: grid;
  gap: 3px;
}

.context-card small,
.context-card em {
  color: var(--ui-text-muted);
  font-size: 12px;
  font-style: normal;
}

.context-card strong {
  font-size: 17px;
}

</style>
