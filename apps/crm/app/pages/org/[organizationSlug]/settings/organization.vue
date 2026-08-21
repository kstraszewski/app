<script setup lang="ts">
definePageMeta({ middleware: ['auth', 'organization'] })
useHead({ title: 'Ustawienia organizacji — OpenExpert CRM' })

const { orgPath } = useOrganizationContext()
const organizationSettingsTabs = useOrganizationSettingsTabs()
const route = useRoute()
const { data: organizations } = await useOrganizations()
const activeOrganization = computed(() => organizations.value.data.find(organization => (
  organization.slug === String(route.params.organizationSlug || '')
)))
const settingsAreas = computed(() => [
  ...(activeOrganization.value?.kind === 'application'
    ? [{
        title: 'Subskrypcja',
        description: 'Plan Aplikacja, stan dostępu, płatności i panel klienta Stripe.',
        details: '200 zł / opłacone miejsce / miesiąc · kupony · Stripe',
        to: orgPath('/settings/billing'),
        icon: 'i-lucide-credit-card',
      }]
    : []),
  ...(activeOrganization.value?.kind !== 'application'
    ? [{
        title: 'Dane pośrednika',
        description: 'Dane prawne i identyfikacyjne używane w OFI, informacjach RODO i dokumentach kredytowych.',
        details: 'OFI · RODO · dokumenty',
        to: orgPath('/settings/intermediary'),
        icon: 'i-lucide-landmark',
      }]
    : []),
  {
    title: 'Ustawienia zdolności',
    description: 'Założenia organizacji dla kalkulatora, parametry modelu oraz historia rewizji.',
    details: 'Polityka modelu · rewizje',
    to: orgPath('/settings/capacity'),
    icon: 'i-lucide-calculator',
  },
  {
    title: 'Marka i wygląd',
    description: 'Nazwa produktu, logo, kolory, typografia oraz profil eksperta używany w materiałach.',
    details: 'Aplikacja · profil eksperta · materiały',
    to: orgPath('/settings/design'),
    icon: 'i-lucide-palette',
  },
])
</script>

<template>
  <CrmShell
    class="organization-settings-overview"
    title="Ustawienia organizacji"
    eyebrow="Administracja organizacji"
    description="Wspólna konfiguracja używana przez zespół, kalkulatory, dokumenty i materiały organizacji."
    :tabs="organizationSettingsTabs"
  >
    <section class="settings-overview" aria-labelledby="organization-settings-heading">
      <header class="settings-overview__header">
        <span>Konfiguracja wspólna</span>
        <h2 id="organization-settings-heading">Wybierz obszar ustawień</h2>
        <p>
          Każdy obszar zachowuje własne uprawnienia. Jeżeli nie możesz edytować ustawień,
          zobaczysz ich aktualną konfigurację albo informację o wymaganej roli.
        </p>
      </header>

      <div class="settings-overview__grid">
        <NuxtLink
          v-for="area in settingsAreas"
          :key="area.title"
          :to="area.to"
          class="settings-area-card"
        >
          <span class="settings-area-card__icon" aria-hidden="true">
            <UIcon :name="area.icon" />
          </span>
          <span class="settings-area-card__copy">
            <strong>{{ area.title }}</strong>
            <span>{{ area.description }}</span>
            <small>{{ area.details }}</small>
          </span>
          <UIcon class="settings-area-card__arrow" name="i-lucide-arrow-up-right" aria-hidden="true" />
        </NuxtLink>
      </div>
    </section>
  </CrmShell>
</template>

<style scoped>
.settings-overview {
  display: grid;
  gap: 24px;
}

.settings-overview__header {
  max-width: 720px;
}

.settings-overview__header > span {
  color: var(--ui-text-muted);
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.settings-overview__header h2 {
  margin: 8px 0 0;
  color: var(--ui-text-highlighted);
  font-size: 24px;
  font-weight: 650;
  letter-spacing: -0.02em;
}

.settings-overview__header p {
  margin: 8px 0 0;
  color: var(--ui-text-muted);
  font-size: 14px;
  line-height: 1.6;
}

.settings-overview__grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
}

.settings-area-card {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: 14px;
  min-height: 190px;
  padding: 20px;
  border: 1px solid var(--ui-border);
  border-radius: var(--oe-radius-surface);
  color: inherit;
  background: var(--ui-bg);
  text-decoration: none;
  transition:
    border-color var(--oe-motion-fast),
    background-color var(--oe-motion-fast),
    transform var(--oe-motion-fast);
}

.settings-area-card:hover {
  border-color: var(--ui-border-accented);
  background: var(--ui-bg-elevated);
  transform: translateY(-2px);
}

.settings-area-card:focus-visible {
  outline: 2px solid var(--ui-primary);
  outline-offset: 3px;
}

.settings-area-card__icon {
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  border: 1px solid var(--ui-border-muted);
  border-radius: var(--oe-radius-control);
  color: var(--ui-text-highlighted);
  background: var(--ui-bg-muted);
}

.settings-area-card__icon :deep(svg) {
  width: 19px;
  height: 19px;
}

.settings-area-card__copy {
  display: flex;
  min-width: 0;
  flex-direction: column;
}

.settings-area-card__copy strong {
  color: var(--ui-text-highlighted);
  font-size: 16px;
  font-weight: 650;
}

.settings-area-card__copy > span {
  margin-top: 8px;
  color: var(--ui-text-muted);
  font-size: 13px;
  line-height: 1.55;
}

.settings-area-card__copy small {
  margin-top: auto;
  padding-top: 24px;
  color: var(--ui-text-dimmed);
  font-size: 11px;
}

.settings-area-card__arrow {
  width: 18px;
  height: 18px;
  color: var(--ui-text-dimmed);
  transition: color var(--oe-motion-fast);
}

.settings-area-card:hover .settings-area-card__arrow {
  color: var(--ui-text-highlighted);
}

@media (max-width: 1000px) {
  .settings-overview__grid {
    grid-template-columns: 1fr;
  }

  .settings-area-card {
    min-height: 160px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .settings-area-card,
  .settings-area-card__arrow {
    transition: none;
  }

  .settings-area-card:hover {
    transform: none;
  }
}
</style>
