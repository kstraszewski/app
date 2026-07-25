<script setup lang="ts">
const props = withDefaults(defineProps<{
  assistantPage?: boolean
  workspacePage?: boolean
}>(), {
  assistantPage: false,
  workspacePage: false,
})

const sidebarCollapsed = useCookie<boolean>('openexpert-crm-nav-collapsed', {
  default: () => false,
  sameSite: 'lax',
})
const mobileNavigationOpen = ref(false)
const mobileViewport = ref(false)
let viewportMedia: MediaQueryList | null = null
const organizationDesign = useOrganizationDesignState()
const user = useSupabaseUser()
const supabase = useHasSupabaseConfig() ? useSupabaseClient() : null
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
const isOrganizationAdmin = computed(() => (
  activeOrganization.value?.role === 'admin'
  || activeOrganization.value?.capabilities?.organizationAdmin === true
))
const canUseTeamAdministration = computed(() => (
  isOrganizationAdmin.value
  || activeOrganization.value?.capabilities?.teamAdmin === true
  || activeOrganization.value?.capabilities?.facilityAdmin === true
  || activeOrganization.value?.capabilities?.canManageTeams === true
))
const canViewTeams = computed(() => (
  isOrganizationAdmin.value
  || activeOrganization.value?.capabilities?.teamAdmin === true
  || activeOrganization.value?.capabilities?.canManageTeams === true
))
const canViewFacilities = computed(() => (
  isOrganizationAdmin.value
  || activeOrganization.value?.capabilities?.teamAdmin === true
  || activeOrganization.value?.capabilities?.facilityAdmin === true
))
const isSuperAdmin = computed(() => organizations.value.access.superAdmin)
const sidebarToggleLabel = computed(() => {
  if (mobileViewport.value) return mobileNavigationOpen.value ? 'Zamknij nawigację' : 'Otwórz nawigację'
  return sidebarCollapsed.value ? 'Rozwiń nawigację' : 'Zwiń nawigację'
})
const sidebarToggleIcon = computed(() => {
  if (mobileViewport.value) return mobileNavigationOpen.value ? 'i-lucide-x' : 'i-lucide-menu'
  return sidebarCollapsed.value ? 'i-lucide-panel-left-open' : 'i-lucide-panel-left-close'
})

watch(() => route.fullPath, () => {
  mobileNavigationOpen.value = false
})

function updateViewport() {
  mobileViewport.value = viewportMedia?.matches ?? false
  if (!mobileViewport.value) mobileNavigationOpen.value = false
}

onMounted(() => {
  viewportMedia = window.matchMedia('(max-width: 900px)')
  updateViewport()
  viewportMedia.addEventListener('change', updateViewport)
})

onBeforeUnmount(() => {
  viewportMedia?.removeEventListener('change', updateViewport)
})

function toggleSidebar() {
  if (import.meta.client && window.matchMedia('(max-width: 900px)').matches) {
    mobileNavigationOpen.value = !mobileNavigationOpen.value
    return
  }
  sidebarCollapsed.value = !sidebarCollapsed.value
}

function expandSidebar() {
  sidebarCollapsed.value = false
}

type NavigationItem = {
  label: string
  to: string
  icon: string
  activePaths?: string[]
  exact?: boolean
}

type NavigationGroup = {
  key: string
  label: string
  items: NavigationItem[]
}

function isNavigationActive(item: NavigationItem) {
  const paths = item.activePaths ?? [item.to]

  return paths.some(path => (
    route.path === path
    || route.path === `${path}/`
    || (!item.exact && route.path.startsWith(`${path}/`))
  ))
}

const navGroups = computed<NavigationGroup[]>(() => {
  const groups = [{
    key: 'calculators',
    label: 'Kalkulatory',
    items: [
      { label: 'Zdolność', to: `${organizationBase.value}/mortgages/capacity`, icon: 'i-lucide-calculator' },
      { label: 'Hipoteki', to: `${organizationBase.value}/mortgages`, icon: 'i-lucide-house' },
    ],
  }, {
    key: 'expert',
    label: 'Ekspert',
    items: [
      { label: 'Dashboard', to: `${organizationBase.value}/dashboard`, icon: 'i-lucide-layout-dashboard' },
      { label: 'Moja sprzedaż', to: `${organizationBase.value}/sales`, icon: 'i-lucide-chart-no-axes-combined' },
      { label: 'Agent AI', to: `${organizationBase.value}/assistant`, icon: 'i-lucide-sparkles' },
      { label: 'Sprawy', to: `${organizationBase.value}/cases`, icon: 'i-lucide-briefcase-business' },
      { label: 'Kalendarz', to: `${organizationBase.value}/calendar`, icon: 'i-lucide-calendar-days' },
      { label: 'Klienci', to: `${organizationBase.value}/clients`, icon: 'i-lucide-users' },
      { label: 'Widgety', to: `${organizationBase.value}/widgets`, icon: 'i-lucide-code-xml' },
    ],
  }]

  if (canUseTeamAdministration.value) {
    const limitedScope = !isOrganizationAdmin.value
    const teamAdminItems: NavigationItem[] = []

    if (canViewTeams.value) {
      teamAdminItems.push({
        label: limitedScope ? 'Moje zespoły' : 'Zespoły',
        to: `${organizationBase.value}/teams`,
        icon: 'i-lucide-users-round',
      })
    }

    if (canViewFacilities.value) {
      teamAdminItems.push({
        label: limitedScope ? 'Moje placówki' : 'Placówki',
        to: `${organizationBase.value}/facilities`,
        icon: 'i-lucide-building-2',
      })
    }

    groups.push({
      key: 'team-admin',
      label: 'Administracja zespołu',
      items: teamAdminItems,
    })
  }

  if (isOrganizationAdmin.value || isSuperAdmin.value) {
    const adminItems: NavigationItem[] = []

    if (isOrganizationAdmin.value) {
      adminItems.push(
        { label: 'Zgody', to: `${organizationBase.value}/consents`, icon: 'i-lucide-shield-check' },
        {
          label: 'Konfiguracja CRM',
          to: `${organizationBase.value}/settings`,
          icon: 'i-lucide-sliders-horizontal',
          exact: true,
        },
      )
    }

    if (isSuperAdmin.value) {
      adminItems.push({
        label: 'Instytucje',
        to: `${organizationBase.value}/settings/institutions`,
        icon: 'i-lucide-landmark',
        activePaths: [
          `${organizationBase.value}/settings/institutions`,
          `${organizationBase.value}/settings/products`,
        ],
      })
    }

    if (isOrganizationAdmin.value) {
      adminItems.push(
        {
          label: 'Zdolność',
          to: `${organizationBase.value}/settings/capacity`,
          icon: 'i-lucide-calculator',
        },
        {
          label: 'Design',
          to: `${organizationBase.value}/settings/design`,
          icon: 'i-lucide-component',
        },
      )
    }

    groups.push({
      key: 'admin',
      label: 'Administracja organizacji',
      items: adminItems,
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
  <main
    class="crm-shell"
    :class="{
      'crm-shell--collapsed': sidebarCollapsed,
      'crm-shell--mobile-open': mobileNavigationOpen,
    }"
  >
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
          :icon="sidebarToggleIcon"
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
              :class="{ 'crm-link--active': isNavigationActive(item) }"
              :to="item.to"
              :aria-label="item.label"
              :aria-current="isNavigationActive(item) ? 'page' : undefined"
              :title="sidebarCollapsed ? item.label : undefined"
              @click="mobileNavigationOpen = false"
            >
              <UIcon :name="item.icon" />
              <span class="crm-link__label">{{ item.label }}</span>
            </NuxtLink>
          </div>
        </div>
      </nav>

      <div class="crm-nav__footer">
        <div
          v-if="user?.email"
          class="crm-nav__account"
          :title="user.email"
        >
          <span class="crm-nav__account-icon" aria-hidden="true">
            <UIcon name="i-lucide-user-round" />
          </span>
          <span class="crm-nav__account-copy">
            <span class="crm-nav__account-label">Zalogowano jako</span>
            <span class="crm-nav__account-email">{{ user.email }}</span>
          </span>
        </div>

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
              leading: 'static ps-0',
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

    <section
      class="crm-content"
      :class="{
        'crm-content--assistant': props.assistantPage,
        'crm-content--workspace': props.workspacePage,
      }"
    >
      <slot />
    </section>

    <CrmEveAssistant
      v-if="!props.assistantPage"
      :key="organizationSlug"
    />
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
  flex: 1 1 auto;
  gap: 20px;
  min-height: 0;
  margin-right: -4px;
  padding-right: 4px;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-width: thin;
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

.crm-nav__account {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  padding: 10px;
  border: 1px solid color-mix(in srgb, var(--ui-text-inverted) 14%, transparent);
  border-radius: var(--ui-radius);
  color: var(--ui-text-inverted);
}

.crm-nav__account-icon {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  color: color-mix(in srgb, var(--ui-text-inverted) 72%, transparent);
}

.crm-nav__account-copy {
  display: grid;
  min-width: 0;
}

.crm-nav__account-label {
  color: color-mix(in srgb, var(--ui-text-inverted) 42%, transparent);
  font-family: var(--font-mono);
  font-size: 9px;
  font-weight: 650;
  letter-spacing: 0.06em;
  line-height: 1.4;
  text-transform: uppercase;
}

.crm-nav__account-email {
  overflow: hidden;
  font-size: 12px;
  line-height: 1.5;
  text-overflow: ellipsis;
  white-space: nowrap;
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

.crm-shell--collapsed .crm-nav__account {
  justify-content: center;
  width: 40px;
  height: 40px;
  padding: 0;
}

.crm-shell--collapsed .crm-nav__account-copy {
  display: none;
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
  min-width: 0;
  width: min(100%, var(--ui-container));
  padding: 32px;
}

.crm-content--assistant {
  display: flex;
  flex-direction: column;
  height: 100dvh;
  overflow: hidden;
  padding: 24px 32px 0;
}

.crm-content--workspace {
  width: 100%;
  height: 100dvh;
  min-height: 0;
  overflow: hidden;
  padding: 0;
}

@media (max-width: 900px) {
  .crm-shell,
  .crm-shell--collapsed {
    grid-template-columns: 1fr;
  }

  .crm-nav,
  .crm-shell--collapsed .crm-nav {
    position: static;
    gap: 12px;
    height: auto;
    overflow: visible;
    padding: 14px 16px;
    border-bottom: 1px solid color-mix(in srgb, var(--ui-text-inverted) 12%, transparent);
  }

  .crm-nav__head :deep(.crm-nav__toggle) {
    display: inline-flex;
  }

  .crm-shell--collapsed .crm-nav__head {
    flex-direction: row;
  }

  .crm-shell--collapsed .crm-brand {
    justify-content: flex-start;
    width: auto;
  }

  .crm-brand__label,
  .crm-shell--collapsed .crm-brand__label,
  .crm-shell--collapsed .crm-link__label,
  .crm-shell--collapsed .crm-nav__logout-label {
    display: inline;
  }

  .crm-organization-select,
  .crm-organization-mini,
  .crm-links,
  .crm-nav__footer,
  .crm-shell--collapsed .crm-organization-select,
  .crm-shell--collapsed .crm-links,
  .crm-shell--collapsed .crm-nav__footer {
    display: none;
  }

  .crm-shell--mobile-open .crm-organization-select {
    display: flex;
  }

  .crm-shell--mobile-open .crm-links,
  .crm-shell--mobile-open .crm-nav__footer {
    display: grid;
  }

  .crm-shell--collapsed .crm-link-group__label {
    display: block;
  }

  .crm-shell--collapsed .crm-nav :deep(.crm-organization-mini) {
    display: none;
  }

  .crm-links {
    flex: none;
    grid-template-columns: 1fr;
    gap: 16px;
    min-height: auto;
    margin-right: 0;
    padding-right: 0;
    overflow: visible;
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

  .crm-shell--collapsed .crm-nav__account {
    justify-content: flex-start;
    width: 100%;
    height: auto;
    padding: 10px;
  }

  .crm-shell--collapsed .crm-nav__account-copy {
    display: grid;
  }

  .crm-shell--collapsed .crm-color-mode {
    display: grid;
  }

  .crm-shell--collapsed .crm-color-mode-mini {
    display: none;
  }

  .crm-content {
    padding: 18px 16px 28px;
  }

  .crm-content--assistant {
    height: calc(100dvh - 76px);
    min-height: 0;
    overflow: hidden;
    padding: 18px 16px 0;
  }

  .crm-content--workspace {
    width: 100%;
    height: calc(100dvh - 76px);
    min-height: 720px;
    overflow: auto;
    padding: 0;
  }

}
</style>
