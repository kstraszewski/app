<script setup lang="ts">
const props = defineProps<{
  title: string
  eyebrow?: string
}>()

const user = useSupabaseUser()
const openexpertConfig = useRuntimeConfig().public.openexpert as { hasSupabaseConfig?: boolean }
const hasSupabaseConfig = Boolean(openexpertConfig.hasSupabaseConfig)
const supabase = hasSupabaseConfig ? useSupabaseClient() : null

const navItems = [
  { label: 'Dashboard', to: '/dashboard', icon: 'i-lucide-layout-dashboard' },
  { label: 'Klienci', to: '/clients', icon: 'i-lucide-users' },
  { label: 'Sprawy', to: '/cases', icon: 'i-lucide-briefcase-business' },
  { label: 'Ustawienia', to: '/settings', icon: 'i-lucide-settings' },
  { label: 'Design', to: '/design', icon: 'i-lucide-component' },
]

async function signOut() {
  if (supabase) await supabase.auth.signOut()
  await navigateTo('/login')
}
</script>

<template>
  <main class="crm-shell">
    <aside class="crm-nav">
      <NuxtLink to="/dashboard" class="crm-brand">
        <img src="/assets/logo-light.svg" alt="" class="crm-brand__mark">
        <span>OpenExpert</span>
      </NuxtLink>

      <nav class="crm-links" aria-label="CRM navigation">
        <NuxtLink
          v-for="item in navItems"
          :key="item.to"
          class="crm-link"
          active-class="crm-link--active"
          :to="item.to"
        >
          <UIcon :name="item.icon" />
          {{ item.label }}
        </NuxtLink>
      </nav>
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
          <UButton icon="i-lucide-log-out" variant="outline" @click="signOut">
            Wyloguj
          </UButton>
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
  display: grid;
  grid-template-columns: 248px minmax(0, 1fr);
  min-height: 100vh;
  background: var(--ui-bg-muted);
}

.crm-nav {
  position: sticky;
  top: 0;
  display: flex;
  flex-direction: column;
  gap: 28px;
  height: 100vh;
  padding: 24px;
  background: var(--ui-bg-inverted);
  color: var(--ui-text-inverted);
}

.crm-brand,
.crm-link {
  display: flex;
  align-items: center;
  gap: 10px;
  text-decoration: none;
}

.crm-brand {
  color: var(--ui-text-inverted);
  font-weight: 700;
}

.crm-brand__mark {
  height: 20px;
  filter: invert(1);
}

.crm-links {
  display: grid;
  gap: 6px;
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

.crm-content {
  width: min(100%, 1240px);
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
  font-weight: 300;
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
  .crm-shell {
    grid-template-columns: 1fr;
  }

  .crm-nav {
    position: static;
    height: auto;
    padding: 16px;
  }

  .crm-links {
    grid-template-columns: repeat(2, minmax(0, 1fr));
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

