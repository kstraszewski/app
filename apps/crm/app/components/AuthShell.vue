<script setup lang="ts">
defineProps<{
  badge: string
  icon?: string
  title: string
  description: string
}>()

const hasAuthConfig = useHasAuthConfig()
</script>

<template>
  <main class="auth-page oe-grid-bg">
    <div class="auth-page__glow" aria-hidden="true" />

    <header class="auth-brand">
      <NuxtLink to="/design" class="auth-logo">
        <picture>
          <source srcset="/assets/logo-dark.svg" media="(prefers-color-scheme: dark)">
          <img src="/assets/logo-light.svg" alt="" class="auth-logo__mark">
        </picture>
        <span>OpenExpert</span>
      </NuxtLink>
      <span class="auth-brand__product">CRM</span>
    </header>

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
        v-if="!hasAuthConfig"
        role="alert"
        color="warning"
        variant="subtle"
        icon="i-lucide-alert-triangle"
        title="Brakuje konfiguracji logowania"
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
  position: relative;
  display: grid;
  min-height: 100vh;
  place-items: center;
  overflow: hidden;
  padding: 96px 24px 56px;
  background-color: var(--ui-bg);
  isolation: isolate;
}

.auth-page::after {
  position: absolute;
  z-index: -1;
  inset: 0;
  background: linear-gradient(to bottom, transparent 55%, var(--ui-bg) 100%);
  content: '';
  pointer-events: none;
}

.auth-page__glow {
  position: absolute;
  z-index: -1;
  top: 50%;
  left: 50%;
  width: min(760px, 85vw);
  height: min(760px, 85vw);
  border-radius: 999px;
  background: color-mix(in srgb, var(--ui-bg-elevated) 72%, transparent);
  filter: blur(70px);
  opacity: 0.7;
  pointer-events: none;
  transform: translate(-50%, -50%);
}

.auth-brand {
  position: absolute;
  top: 24px;
  left: 24px;
  display: inline-flex;
  align-items: center;
  gap: 12px;
}

.auth-logo {
  display: inline-flex;
  align-items: center;
  gap: 9px;
  color: var(--ui-text-highlighted);
  font-weight: 600;
  text-decoration: none;
}

.auth-logo__mark {
  height: 22px;
  filter: var(--oe-logo-filter);
}

.auth-brand__product {
  border-left: 1px solid var(--ui-border-accented);
  padding-left: 12px;
  color: var(--ui-text-muted);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.12em;
}

.auth-card {
  width: min(100%, 440px);
  border-color: color-mix(in srgb, var(--ui-border-accented) 82%, transparent);
  background: color-mix(in srgb, var(--ui-bg) 94%, transparent);
  box-shadow:
    0 24px 80px rgb(0 0 0 / 8%),
    0 1px 0 rgb(255 255 255 / 5%) inset;
  backdrop-filter: blur(18px);
}

.auth-header {
  display: grid;
  gap: 10px;
}

.auth-header :deep(.inline-flex) {
  justify-self: start;
}

.auth-header h1 {
  color: var(--ui-text-highlighted);
  font-size: clamp(32px, 5vw, 40px);
  font-weight: 400;
  letter-spacing: -0.035em;
  line-height: 1.08;
}

.auth-header p {
  max-width: 38ch;
  color: var(--ui-text-toned);
  font-size: 15px;
  line-height: 1.55;
}

.auth-footer {
  color: var(--ui-text-toned);
  font-size: 14px;
  text-align: center;
}

@media (max-width: 560px) {
  .auth-page {
    align-items: start;
    padding: 92px 16px 32px;
  }

  .auth-brand {
    left: 20px;
  }

  .auth-card {
    width: 100%;
  }
}
</style>
