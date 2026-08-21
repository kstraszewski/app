<script setup lang="ts">
import { isBillingAccessGranted } from '~~/shared/organization-billing'

definePageMeta({ middleware: 'auth' })
useHead({ title: 'Wybierz organizację — OpenExpert CRM' })

const route = useRoute()
const { data, pending, error, refresh } = await useOrganizations()

if (data.value.data.length === 1) {
  const organization = data.value.data[0]!
  const target = organization.kind === 'application'
    && !isBillingAccessGranted(organization.billingAccessState)
    ? 'settings/billing'
    : 'dashboard'
  await navigateTo(`/org/${encodeURIComponent(organization.slug)}/${target}`, { replace: true })
}

function organizationTarget(organization: typeof data.value.data[number]) {
  const target = organization.kind === 'application'
    && !isBillingAccessGranted(organization.billingAccessState)
    ? 'settings/billing'
    : 'dashboard'
  return `/org/${encodeURIComponent(organization.slug)}/${target}`
}
</script>

<template>
  <main class="organization-picker">
    <section class="organization-picker__panel">
      <div class="organization-picker__heading">
        <img src="/assets/logo-light.svg" alt="" class="organization-picker__logo">
        <div>
          <p>OpenExpert CRM</p>
          <h1>Wybierz organizację</h1>
          <span>Jedno konto może pracować w wielu niezależnych organizacjach.</span>
        </div>
        <UButton
          class="organization-picker__create"
          color="primary"
          icon="i-lucide-plus"
          to="/register?newOrganization=1"
        >
          Utwórz nową organizację
        </UButton>
      </div>

      <UAlert
        v-if="route.query.missing"
        color="warning"
        variant="subtle"
        icon="i-lucide-shield-alert"
        title="Brak dostępu do organizacji"
        description="Wybierz organizację, do której należysz."
      />

      <UAlert
        v-if="error"
        color="error"
        variant="subtle"
        icon="i-lucide-database"
        title="Nie udało się pobrać organizacji"
      >
        <template #actions>
          <UButton variant="ghost" icon="i-lucide-refresh-cw" @click="refresh()">Ponów</UButton>
        </template>
      </UAlert>

      <div v-if="pending" class="organization-picker__grid">
        <USkeleton v-for="index in 3" :key="index" class="h-32 w-full" />
      </div>

      <div v-else-if="data.data.length" class="organization-picker__grid">
        <NuxtLink
          v-for="organization in data.data"
          :key="organization.id"
          :to="organizationTarget(organization)"
          class="organization-card oe-hover-lift"
        >
          <div class="organization-card__icon"><UIcon name="i-lucide-building-2" /></div>
          <div>
            <strong>{{ organization.name }}</strong>
            <span>/org/{{ organization.slug }}</span>
          </div>
          <div class="organization-card__badges">
            <UBadge
              v-if="organization.kind === 'application' && !isBillingAccessGranted(organization.billingAccessState)"
              color="warning"
              variant="subtle"
            >
              Wymaga subskrypcji
            </UBadge>
            <UBadge :color="organization.role === 'admin' ? 'primary' : 'neutral'" variant="subtle">
              {{ organization.role }}
            </UBadge>
          </div>
          <UIcon name="i-lucide-arrow-right" />
        </NuxtLink>
      </div>

      <UCard v-else>
        <div class="organization-picker__empty">
          <UIcon name="i-lucide-building" />
          <h2>Brak organizacji</h2>
          <p>Utwórz własną organizację albo przyjmij zaproszenie od jej administratora.</p>
          <UButton to="/register?newOrganization=1" icon="i-lucide-building-2">
            Utwórz organizację
          </UButton>
        </div>
      </UCard>
    </section>
  </main>
</template>

<style scoped>
.organization-picker {
  min-height: 100vh;
  padding: clamp(24px, 6vw, 72px);
  background: var(--ui-bg-muted);
}

.organization-picker__panel {
  display: grid;
  gap: 24px;
  width: min(920px, 100%);
  margin: 0 auto;
}

.organization-picker__heading {
  display: flex;
  align-items: center;
  gap: 20px;
}

.organization-picker__heading > div {
  min-width: 0;
}

.organization-picker__create {
  margin-left: auto;
  flex: 0 0 auto;
}

.organization-picker__logo {
  width: 38px;
}

.organization-picker__heading p,
.organization-picker__heading span {
  margin: 0;
  color: var(--ui-text-muted);
}

.organization-picker__heading h1 {
  margin: 4px 0;
  font-size: clamp(34px, 5vw, 54px);
  font-weight: 300;
}

.organization-picker__grid {
  display: grid;
  gap: 14px;
}

.organization-card {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 16px;
  padding: 20px;
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius);
  background: var(--ui-bg);
  color: inherit;
  text-decoration: none;
}

.organization-card:hover {
  border-color: var(--ui-color-primary-500);
}

.organization-card__icon {
  display: grid;
  width: 44px;
  height: 44px;
  place-items: center;
  border-radius: var(--ui-radius);
  background: var(--ui-bg-muted);
  font-size: 20px;
}

.organization-card__badges {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 6px;
}

.organization-card strong,
.organization-card span {
  display: block;
}

.organization-card span {
  margin-top: 3px;
  color: var(--ui-text-muted);
  font-family: var(--font-mono);
  font-size: 12px;
}

.organization-picker__empty {
  display: grid;
  justify-items: center;
  gap: 12px;
  padding: 40px;
  text-align: center;
}

.organization-picker__empty h2,
.organization-picker__empty p {
  margin: 0;
}

.organization-picker__empty > .icon {
  font-size: 32px;
}

@media (max-width: 680px) {
  .organization-picker__heading {
    align-items: flex-start;
    flex-wrap: wrap;
  }

  .organization-picker__create {
    width: 100%;
    margin-left: 0;
    justify-content: center;
  }
}
</style>
