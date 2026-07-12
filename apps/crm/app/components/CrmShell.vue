<script setup lang="ts">
const props = defineProps<{
  title: string
  eyebrow?: string
}>()

const sidebarCollapsed = useCookie<boolean>('openexpert-crm-nav-collapsed', {
  default: () => false,
  sameSite: 'lax',
})
const organizationDesign = useOrganizationDesignState()
const user = useSupabaseUser()
const hasSupabaseConfig = useHasSupabaseConfig()
const supabase = hasSupabaseConfig ? useSupabaseClient() : null
const route = useRoute()
const organizationSlug = computed(() => {
  const raw = route.params.organizationSlug
  return Array.isArray(raw) ? String(raw[0] ?? '') : String(raw ?? '')
})
const organizationBase = computed(() => organizationSlug.value ? `/org/${organizationSlug.value}` : '')
const { data: organizations } = await useOrganizations()
const organizationItems = computed(() => organizations.value.data.map((organization) => ({
  label: organization.name,
  value: organization.slug,
})))
const selectedOrganizationSlug = computed({
  get: () => organizationSlug.value,
  set: (slug: string) => {
    if (slug && slug !== organizationSlug.value) navigateTo(`/org/${encodeURIComponent(slug)}/dashboard`)
  },
})
const selectedOrganizationLabel = computed(() => (
  organizationItems.value.find(organization => organization.value === selectedOrganizationSlug.value)?.label
  ?? 'Aktywna organizacja'
))
const activeOrganization = computed(() => (
  organizations.value.data.find(organization => organization.slug === organizationSlug.value)
))
const isOrganizationAdmin = computed(() => activeOrganization.value?.role === 'admin')
const sidebarToggleLabel = computed(() => sidebarCollapsed.value ? 'Rozwiń nawigację' : 'Zwiń nawigację')

function toggleSidebar() {
  sidebarCollapsed.value = !sidebarCollapsed.value
}

function expandSidebar() {
  sidebarCollapsed.value = false
}

const navGroups = computed(() => {
  const groups = [{
    key: 'expert',
    label: 'Ekspert',
    items: [
      { label: 'Dashboard', to: `${organizationBase.value}/dashboard`, icon: 'i-lucide-layout-dashboard' },
      { label: 'Klienci', to: `${organizationBase.value}/clients`, icon: 'i-lucide-users' },
      { label: 'Sprawy', to: `${organizationBase.value}/cases`, icon: 'i-lucide-briefcase-business' },
      { label: 'Placówki', to: `${organizationBase.value}/facilities`, icon: 'i-lucide-map-pinned' },
      { label: 'Hipoteki', to: `${organizationBase.value}/mortgages`, icon: 'i-lucide-house' },
      { label: 'Zdolność', to: `${organizationBase.value}/mortgages/capacity`, icon: 'i-lucide-calculator' },
    ],
  }]

  if (isOrganizationAdmin.value) {
    groups.push({
      key: 'admin',
      label: 'Administracja organizacji',
      items: [
        { label: 'Zespoły', to: `${organizationBase.value}/teams`, icon: 'i-lucide-network' },
        { label: 'Zgody', to: `${organizationBase.value}/consents`, icon: 'i-lucide-shield-check' },
        { label: 'Ustawienia', to: `${organizationBase.value}/settings`, icon: 'i-lucide-settings' },
        { label: 'Design', to: `${organizationBase.value}/design`, icon: 'i-lucide-component' },
      ],
    })
  }

  return groups
})

async function signOut() {
  try {
    if (supabase) await supabase.auth.signOut({ scope: 'local' })
  } finally {
    user.value = null
    clearNuxtData('openexpert-organizations')
    await navigateTo('/login')
  }
}
</script>

<template>
  <main class="crm-shell" :class="{ 'crm-shell--collapsed': sidebarCollapsed }">
    <aside class="crm-nav">
      <div class="crm-nav__head">
        <NuxtLink
          :to="organizationBase ? `${organizationBase}/dashboard` : '/'"
          class="crm-brand"
          :aria-label="organizationDesign.branding.productName"
          :title="sidebarCollapsed ? organizationDesign.branding.productName : undefined"
        >
          <img
            :src="organizationDesign.branding.logoOnDark"
            alt=""
            class="crm-brand__mark"
          >
          <span class="crm-brand__label">{{ organizationDesign.branding.productName }}</span>
        </NuxtLink>

        <UButton
          class="crm-nav__toggle"
          color="neutral"
          variant="ghost"
          square
          :icon="sidebarCollapsed ? 'i-lucide-panel-left-open' : 'i-lucide-panel-left-close'"
          :aria-label="sidebarToggleLabel"
          :title="sidebarToggleLabel"
          @click="toggleSidebar"
        />
      </div>

      <div class="crm-organization-select">
        <USelect
          v-model="selectedOrganizationSlug"
          class="w-full"
          :items="organizationItems"
          icon="i-lucide-building-2"
          aria-label="Aktywna organizacja"
        />
      </div>

      <UButton
        class="crm-organization-mini"
        color="neutral"
        variant="ghost"
        square
        icon="i-lucide-building-2"
        :aria-label="`Aktywna organizacja: ${selectedOrganizationLabel}`"
        :title="selectedOrganizationLabel"
        @click="expandSidebar"
      />

      <nav class="crm-links" aria-label="Nawigacja CRM">
        <div
          v-for="group in navGroups"
          :key="group.key"
          class="crm-link-group"
          role="group"
          :aria-label="group.label"
        >
          <p class="crm-link-group__label">{{ group.label }}</p>
          <div class="crm-link-group__items">
            <NuxtLink
              v-for="item in group.items"
              :key="item.to"
              class="crm-link"
              active-class="crm-link--active"
              :to="item.to"
              :aria-label="item.label"
              :title="sidebarCollapsed ? item.label : undefined"
            >
              <UIcon :name="item.icon" />
              <span class="crm-link__label">{{ item.label }}</span>
            </NuxtLink>
          </div>
        </div>
      </nav>

      <div class="crm-nav__footer">
        <div class="crm-color-mode">
          <label for="crm-color-mode" class="crm-color-mode__label">Motyw</label>
          <UColorModeSelect
            id="crm-color-mode"
            class="crm-color-mode__select"
            color="neutral"
            variant="ghost"
            size="md"
            aria-label="Motyw kolorystyczny"
            :ui="{
              leadingIcon: 'text-inverted',
              value: 'text-inverted',
              trailingIcon: 'text-inverted/60',
              content: 'min-w-44',
            }"
          />
        </div>

        <div class="crm-color-mode-mini">
          <UColorModeSelect
            id="crm-color-mode-mini"
            class="crm-color-mode__select"
            color="neutral"
            variant="ghost"
            size="md"
            aria-label="Motyw kolorystyczny"
            title="Motyw kolorystyczny"
            :ui="{
              base: 'size-10 justify-center p-0',
              leading: 'static',
              leadingIcon: 'size-5 text-inverted',
              value: 'hidden',
              trailing: 'hidden',
              content: 'min-w-44',
            }"
          />
        </div>

        <UButton
          class="crm-nav__logout"
          color="neutral"
          variant="ghost"
          icon="i-lucide-log-out"
          :square="sidebarCollapsed"
          aria-label="Wyloguj"
          :title="sidebarCollapsed ? 'Wyloguj' : undefined"
          @click="signOut"
        >
          <span class="crm-nav__logout-label">Wyloguj</span>
        </UButton>
      </div>
    </aside>

    <section class="crm-content">
      <header class="crm-header">
        <div>
          <p v-if="props.eyebrow" class="crm-eyebrow">{{ props.eyebrow }}</p>
          <h1>{{ props.title }}</h1>
          <UBadge color="neutral" variant="outline" icon="i-lucide-user">
            {{ user?.email }}
          </UBadge>
        </div>
        <div class="crm-header__actions">
          <slot name="actions" />
        </div>
      </header>

      <UAlert
        v-if="!hasSupabaseConfig"
        class="crm-alert"
        color="warning"
        variant="subtle"
        icon="i-lucide-alert-triangle"
        title="Brakuje konfiguracji Supabase"
        description="Uzupełnij .env, żeby API CRM mogło czytać i zapisywać dane."
      />

      <slot />
    </section>
  </main>
</template>

<style scoped>
.crm-shell {
  --crm-nav-width: var(--oe-sidebar-width);

  display: grid;
  grid-template-columns: var(--crm-nav-width) minmax(0, 1fr);
  min-height: 100vh;
  background: var(--ui-bg-muted);
  transition: grid-template-columns var(--oe-motion-base);
}

.crm-shell--collapsed {
  --crm-nav-width: var(--oe-sidebar-collapsed-width);
}

.crm-nav {
  --crm-nav-bg: var(--oe-sidebar-bg);
  --crm-nav-text: var(--oe-sidebar-fg);
  --ui-text-inverted: var(--crm-nav-text);

  position: sticky;
  top: 0;
  display: flex;
  flex-direction: column;
  gap: 28px;
  height: 100vh;
  min-width: 0;
  overflow: hidden;
  padding: 24px;
  background: var(--crm-nav-bg);
  color: var(--ui-text-inverted);
  transition:
    gap var(--oe-motion-base),
    padding var(--oe-motion-base);
}

.crm-nav__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.crm-brand,
.crm-link {
  display: flex;
  align-items: center;
  gap: 10px;
  text-decoration: none;
}

.crm-brand {
  min-width: 0;
  color: var(--ui-text-inverted);
  font-weight: 700;
}

.crm-brand :deep(.crm-brand__mark) {
  flex: 0 0 auto;
  height: 20px;
}

.crm-brand__label,
.crm-link__label,
.crm-nav__logout-label {
  overflow: hidden;
  white-space: nowrap;
}

.crm-nav__head :deep(.crm-nav__toggle),
.crm-nav :deep(.crm-organization-mini) {
  flex: 0 0 auto;
  color: color-mix(in srgb, var(--ui-text-inverted) 72%, transparent);
  background: transparent;
}

.crm-nav__head :deep(.crm-nav__toggle:hover),
.crm-nav :deep(.crm-organization-mini:hover) {
  color: var(--ui-text-inverted);
  background: color-mix(in srgb, var(--ui-text-inverted) 10%, transparent);
}

.crm-links {
  display: grid;
  gap: 20px;
}

.crm-link-group {
  display: grid;
  gap: 8px;
  min-width: 0;
}

.crm-link-group__label {
  margin: 0 10px;
  color: color-mix(in srgb, var(--ui-text-inverted) 42%, transparent);
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 650;
  letter-spacing: 0.08em;
  line-height: 1.4;
  text-transform: uppercase;
  white-space: nowrap;
}

.crm-link-group__items {
  display: grid;
  gap: 6px;
}

.crm-organization-select {
  width: 100%;
}

.crm-nav :deep(.crm-organization-mini) {
  display: none;
}

.crm-link {
  min-height: 38px;
  padding: 0 10px;
  border: 1px solid transparent;
  border-radius: var(--ui-radius);
  color: color-mix(in srgb, var(--ui-text-inverted) 64%, transparent);
  font-size: 14px;
}

.crm-link--active,
.crm-link:hover {
  border-color: color-mix(in srgb, var(--ui-text-inverted) 16%, transparent);
  color: var(--ui-text-inverted);
}

.crm-nav__footer {
  display: grid;
  gap: 10px;
  width: 100%;
  margin-top: auto;
}

.crm-color-mode {
  display: grid;
  gap: 7px;
}

.crm-color-mode__label {
  margin-inline: 10px;
  color: color-mix(in srgb, var(--ui-text-inverted) 42%, transparent);
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 650;
  letter-spacing: 0.08em;
  line-height: 1.4;
  text-transform: uppercase;
}

.crm-color-mode-mini {
  display: none;
}

.crm-color-mode :deep(.crm-color-mode__select),
.crm-color-mode-mini :deep(.crm-color-mode__select) {
  width: 100%;
  color: var(--ui-text-inverted);
  background: transparent;
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--ui-text-inverted) 14%, transparent);
}

.crm-color-mode :deep(.crm-color-mode__select:hover),
.crm-color-mode-mini :deep(.crm-color-mode__select:hover) {
  background: color-mix(in srgb, var(--ui-text-inverted) 10%, transparent);
}

.crm-nav__footer :deep(.crm-nav__logout) {
  width: 100%;
  justify-content: flex-start;
  color: color-mix(in srgb, var(--ui-text-inverted) 72%, transparent);
  background: transparent;
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--ui-text-inverted) 14%, transparent);
}

.crm-nav__footer :deep(.crm-nav__logout:hover) {
  color: var(--ui-text-inverted);
  background: color-mix(in srgb, var(--ui-text-inverted) 10%, transparent);
}

.crm-shell--collapsed .crm-nav {
  gap: 20px;
  padding-inline: 12px;
}

.crm-shell--collapsed .crm-nav__head {
  flex-direction: column;
}

.crm-shell--collapsed .crm-brand {
  justify-content: center;
  width: 40px;
  min-height: 40px;
}

.crm-shell--collapsed .crm-brand__label,
.crm-shell--collapsed .crm-link__label,
.crm-shell--collapsed .crm-link-group__label,
.crm-shell--collapsed .crm-nav__logout-label,
.crm-shell--collapsed .crm-organization-select {
  display: none;
}

.crm-shell--collapsed .crm-nav :deep(.crm-organization-mini) {
  display: inline-flex;
  align-self: center;
}

.crm-shell--collapsed .crm-link {
  justify-content: center;
  padding-inline: 0;
}

.crm-shell--collapsed .crm-links {
  gap: 12px;
}

.crm-shell--collapsed .crm-link-group {
  gap: 0;
}

.crm-shell--collapsed .crm-link-group + .crm-link-group {
  padding-top: 12px;
  border-top: 1px solid color-mix(in srgb, var(--ui-text-inverted) 14%, transparent);
}

.crm-shell--collapsed .crm-nav__footer {
  justify-items: center;
}

.crm-shell--collapsed .crm-color-mode {
  display: none;
}

.crm-shell--collapsed .crm-color-mode-mini {
  display: block;
  width: 40px;
}

.crm-shell--collapsed .crm-nav__footer :deep(.crm-nav__logout) {
  align-self: center;
  justify-content: center;
  width: 40px;
}

.crm-content {
  width: min(100%, var(--ui-container));
  padding: 32px;
}

.crm-header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 20px;
  margin-bottom: 24px;
}

.crm-header h1 {
  margin: 4px 0 12px;
  color: var(--ui-text-highlighted);
  font-size: 42px;
  font-weight: var(--oe-heading-font-weight);
  line-height: 1.1;
}

.crm-eyebrow {
  margin: 0;
  color: var(--ui-text-muted);
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
}

.crm-header__actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.crm-alert {
  margin-bottom: 24px;
}

@media (max-width: 900px) {
  .crm-shell,
  .crm-shell--collapsed {
    grid-template-columns: 1fr;
  }

  .crm-nav,
  .crm-shell--collapsed .crm-nav {
    position: static;
    gap: 16px;
    height: auto;
    overflow: visible;
    padding: 16px;
  }

  .crm-nav__head :deep(.crm-nav__toggle) {
    display: none;
  }

  .crm-shell--collapsed .crm-nav__head {
    flex-direction: row;
  }

  .crm-shell--collapsed .crm-brand {
    justify-content: flex-start;
    width: auto;
  }

  .crm-shell--collapsed .crm-brand__label,
  .crm-shell--collapsed .crm-link__label,
  .crm-shell--collapsed .crm-nav__logout-label {
    display: inline;
  }

  .crm-shell--collapsed .crm-link-group__label {
    display: block;
  }

  .crm-shell--collapsed .crm-organization-select {
    display: flex;
  }

  .crm-shell--collapsed .crm-nav :deep(.crm-organization-mini) {
    display: none;
  }

  .crm-links {
    grid-template-columns: 1fr;
    gap: 16px;
  }

  .crm-link-group__items {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .crm-shell--collapsed .crm-link-group {
    gap: 8px;
  }

  .crm-shell--collapsed .crm-link-group + .crm-link-group {
    padding-top: 0;
    border-top: 0;
  }

  .crm-shell--collapsed .crm-link {
    justify-content: flex-start;
    padding-inline: 10px;
  }

  .crm-shell--collapsed .crm-nav__footer :deep(.crm-nav__logout) {
    align-self: stretch;
    justify-content: flex-start;
    width: 100%;
  }

  .crm-shell--collapsed .crm-nav__footer {
    justify-items: stretch;
  }

  .crm-shell--collapsed .crm-color-mode {
    display: grid;
  }

  .crm-shell--collapsed .crm-color-mode-mini {
    display: none;
  }

  .crm-content {
    padding: 20px;
  }

  .crm-header {
    align-items: stretch;
    flex-direction: column;
  }

  .crm-header h1 {
    font-size: 34px;
  }
}
</style>
