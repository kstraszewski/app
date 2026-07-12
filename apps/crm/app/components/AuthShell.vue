<script setup lang="ts">
defineProps<{
  badge: string
  icon?: string
  title: string
  description: string
}>()

const openexpertConfig = useRuntimeConfig().public.openexpert as { hasSupabaseConfig?: boolean }
const hasSupabaseConfig = Boolean(openexpertConfig.hasSupabaseConfig)
</script>

<template>
  <main class="auth-page oe-grid-bg">
    <NuxtLink to="/design" class="auth-logo">
      <picture>
        <source srcset="/assets/logo-dark.svg" media="(prefers-color-scheme: dark)">
        <img src="/assets/logo-light.svg" alt="" class="auth-logo__mark">
      </picture>
      <span>OpenExpert CRM</span>
    </NuxtLink>

    <UCard class="auth-card oe-animate-in">
      <template #header>
        <div class="auth-header">
          <UBadge color="neutral" variant="outline" :icon="icon ?? 'i-lucide-shield-check'">
            {{ badge }}
          </UBadge>
          <h1>{{ title }}</h1>
          <p>{{ description }}</p>
        </div>
      </template>

      <UAlert
        v-if="!hasSupabaseConfig"
        role="alert"
        color="warning"
        variant="subtle"
        icon="i-lucide-alert-triangle"
        title="Brakuje konfiguracji Supabase"
        description="Uruchom pnpm db:setup, aby przygotować lokalne środowisko."
      />

      <slot v-else />

      <template v-if="$slots.footer" #footer>
        <div class="auth-footer">
          <slot name="footer" />
        </div>
      </template>
    </UCard>
  </main>
</template>

<style scoped>
.auth-page {
  display: grid;
  min-height: 100vh;
  place-items: center;
  padding: 80px 20px;
}

.auth-logo {
  position: absolute;
  top: 24px;
  left: 24px;
  display: inline-flex;
  align-items: center;
  gap: 10px;
  color: var(--ui-text-highlighted);
  font-weight: 600;
  text-decoration: none;
}

.auth-logo__mark {
  height: 22px;
  filter: var(--oe-logo-filter);
}

.auth-card {
  width: min(100%, 460px);
}

.auth-header {
  display: grid;
  gap: 12px;
}

.auth-header h1 {
  color: var(--ui-text-highlighted);
  font-size: 34px;
  font-weight: 300;
  line-height: 1.1;
}

.auth-header p {
  color: var(--ui-text-toned);
  line-height: 1.6;
}

.auth-footer {
  color: var(--ui-text-toned);
  font-size: 14px;
  text-align: center;
}

@media (max-width: 560px) {
  .auth-logo {
    left: 20px;
  }
}
</style>
