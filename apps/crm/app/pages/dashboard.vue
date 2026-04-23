<script setup lang="ts">
definePageMeta({ middleware: 'auth' })
const user = useSupabaseUser()
const openexpertConfig = useRuntimeConfig().public.openexpert as { hasSupabaseConfig?: boolean }
const hasSupabaseConfig = Boolean(openexpertConfig.hasSupabaseConfig)
const supabase = hasSupabaseConfig ? useSupabaseClient() : null

useHead({ title: 'Dashboard — OpenExpert CRM' })

const metrics = [
  { label: 'Aktywne sprawy', value: '24', icon: 'i-lucide-briefcase-business' },
  { label: 'Follow-up dziś', value: '8', icon: 'i-lucide-calendar-check' },
  { label: 'Dokumenty', value: '13', icon: 'i-lucide-file-check-2' },
]

async function signOut() {
  if (supabase) await supabase.auth.signOut()
  await navigateTo('/login')
}
</script>

<template>
  <main class="dashboard-page">
    <aside class="dashboard-nav">
      <NuxtLink to="/dashboard" class="dashboard-brand">
        <img src="/assets/logo-light.svg" alt="" class="dashboard-brand__mark">
        <span>OpenExpert</span>
      </NuxtLink>
      <nav class="dashboard-links" aria-label="CRM navigation">
        <a class="dashboard-link dashboard-link--active" href="#">
          <UIcon name="i-lucide-layout-dashboard" />
          Dashboard
        </a>
        <NuxtLink class="dashboard-link" to="/design">
          <UIcon name="i-lucide-component" />
          Design
        </NuxtLink>
      </nav>
    </aside>

    <section class="dashboard-content">
      <header class="dashboard-header">
        <div>
          <UBadge color="neutral" variant="outline" icon="i-lucide-user">
            {{ user?.email }}
          </UBadge>
          <h1>Dashboard</h1>
        </div>
        <UButton icon="i-lucide-log-out" variant="outline" @click="signOut">
          Wyloguj
        </UButton>
      </header>

      <UAlert
        v-if="!hasSupabaseConfig"
        role="alert"
        class="dashboard-alert"
        color="warning"
        variant="subtle"
        icon="i-lucide-alert-triangle"
        title="Brakuje konfiguracji Supabase"
        description="Uzupełnij plik .env, żeby połączyć CRM z projektem."
      />

      <div class="dashboard-metrics">
        <UCard v-for="metric in metrics" :key="metric.label" class="oe-hover-lift">
          <div class="metric-icon">
            <UIcon :name="metric.icon" />
          </div>
          <strong>{{ metric.value }}</strong>
          <span>{{ metric.label }}</span>
        </UCard>
      </div>

      <UCard>
        <template #header>
          <div class="panel-header">
            <div>
              <h2>Kolejka pracy</h2>
              <p>Startowy widok CRM po wdrożeniu Nuxt UI.</p>
            </div>
            <UButton icon="i-lucide-plus" variant="solid">
              Dodaj sprawę
            </UButton>
          </div>
        </template>

        <div class="empty-state">
          <UIcon name="i-lucide-inbox" />
          <h3>Gotowe na dane CRM</h3>
          <p>Logika auth została bez zmian, a dashboard korzysta teraz z globalnego design systemu.</p>
        </div>
      </UCard>
    </section>
  </main>
</template>

<style scoped>
.dashboard-page {
  display: grid;
  grid-template-columns: 240px 1fr;
  min-height: 100vh;
  background: var(--ui-bg-muted);
}

.dashboard-nav {
  display: flex;
  flex-direction: column;
  gap: 28px;
  padding: 24px;
  background: var(--ui-bg-inverted);
  color: var(--ui-text-inverted);
}

.dashboard-brand,
.dashboard-link {
  display: flex;
  align-items: center;
  gap: 10px;
  text-decoration: none;
}

.dashboard-brand {
  color: var(--ui-text-inverted);
  font-weight: 600;
}

.dashboard-brand__mark {
  height: 20px;
  filter: invert(1);
}

.dashboard-links {
  display: grid;
  gap: 6px;
}

.dashboard-link {
  min-height: 38px;
  padding: 0 10px;
  border: 1px solid transparent;
  border-radius: var(--ui-radius);
  color: color-mix(in srgb, var(--ui-text-inverted) 64%, transparent);
  font-size: 14px;
}

.dashboard-link--active,
.dashboard-link:hover {
  border-color: color-mix(in srgb, var(--ui-text-inverted) 16%, transparent);
  color: var(--ui-text-inverted);
}

.dashboard-content {
  width: min(100%, 1160px);
  padding: 32px;
}

.dashboard-header,
.panel-header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 20px;
}

.dashboard-header h1 {
  margin-top: 12px;
  color: var(--ui-text-highlighted);
  font-size: 44px;
  font-weight: 300;
  line-height: 1.1;
}

.dashboard-alert {
  margin-top: 24px;
}

.dashboard-metrics {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 1px;
  margin: 28px 0;
  overflow: hidden;
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius);
  background: var(--ui-border);
}

.dashboard-metrics :deep(.rounded-sm) {
  border-radius: 0;
}

.metric-icon {
  display: grid;
  width: 34px;
  height: 34px;
  place-items: center;
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius);
  color: var(--ui-text-muted);
}

.dashboard-metrics strong {
  display: block;
  margin-top: 22px;
  color: var(--ui-text-highlighted);
  font-size: 34px;
  font-weight: 300;
}

.dashboard-metrics span,
.panel-header p,
.empty-state p {
  color: var(--ui-text-muted);
}

.panel-header h2 {
  color: var(--ui-text-highlighted);
  font-size: 20px;
  font-weight: 600;
}

.empty-state {
  display: grid;
  justify-items: center;
  gap: 12px;
  padding: 56px 20px;
  text-align: center;
}

.empty-state svg {
  width: 34px;
  height: 34px;
  color: var(--ui-text-muted);
}

.empty-state h3 {
  color: var(--ui-text-highlighted);
  font-size: 22px;
  font-weight: 500;
}

@media (max-width: 800px) {
  .dashboard-page {
    grid-template-columns: 1fr;
  }

  .dashboard-nav {
    display: none;
  }

  .dashboard-content {
    padding: 20px;
  }

  .dashboard-header,
  .panel-header {
    align-items: flex-start;
    flex-direction: column;
  }

  .dashboard-metrics {
    grid-template-columns: 1fr;
  }
}
</style>
