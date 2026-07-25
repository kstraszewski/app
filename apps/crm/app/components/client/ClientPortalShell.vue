<script setup lang="ts">
withDefaults(defineProps<{
  eyebrow?: string
  title: string
  description?: string
  compact?: boolean
  showNavigation?: boolean
  showAccountSwitcher?: boolean
  showLogout?: boolean
}>(), {
  eyebrow: 'Panel klienta',
  description: '',
  compact: false,
  showNavigation: true,
  showAccountSwitcher: false,
  showLogout: true,
})

const hasSupabaseConfig = useHasSupabaseConfig()
const supabase = hasSupabaseConfig ? useSupabaseClient() : null
const runtimeConfig = useRuntimeConfig()
const landingBaseUrl = String(
  runtimeConfig.public.openexpert.landingBaseUrl || 'http://127.0.0.1:3003',
).replace(/\/+$/u, '')
const signingOut = ref(false)

async function signOut() {
  if (!supabase) return
  signingOut.value = true
  await supabase.auth.signOut({ scope: 'local' })
  clearNuxtData(key => (
    key.startsWith('client-appointments:')
    || key.startsWith('account-contexts:')
  ))
  await navigateTo('/client/login')
}
</script>

<template>
  <main class="client-shell" :class="{ 'client-shell--compact': compact }">
    <header class="client-shell__bar">
      <a :href="landingBaseUrl" class="client-shell__brand" aria-label="OpenExpert — strona główna">
        <picture>
          <source srcset="/assets/logo-dark.svg" media="(prefers-color-scheme: dark)">
          <img src="/assets/logo-light.svg" alt="" class="client-shell__logo">
        </picture>
        <span>OpenExpert</span>
        <small>Klient</small>
      </a>

      <nav v-if="showNavigation || showLogout" class="client-shell__nav" aria-label="Panel klienta">
        <NuxtLink v-if="showNavigation" to="/client">
          Moje konsultacje
        </NuxtLink>
        <NuxtLink v-if="showNavigation && showAccountSwitcher" to="/account">
          Przełącz konto
        </NuxtLink>
        <UButton
          v-if="showLogout"
          type="button"
          color="neutral"
          variant="ghost"
          icon="i-lucide-log-out"
          :loading="signingOut"
          @click="signOut"
        >
          Wyloguj
        </UButton>
      </nav>
    </header>

    <div class="client-shell__body">
      <header class="client-shell__intro">
        <p>{{ eyebrow }}</p>
        <h1>{{ title }}</h1>
        <span v-if="description">{{ description }}</span>
      </header>

      <slot />
    </div>
  </main>
</template>

<style scoped>
.client-shell {
  min-height: 100vh;
  background:
    radial-gradient(circle at 12% -12%, color-mix(in srgb, var(--ui-primary) 13%, transparent), transparent 36rem),
    var(--ui-bg);
}

.client-shell__bar {
  display: flex;
  min-height: 72px;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  border-bottom: 1px solid var(--ui-border);
  padding: 12px max(20px, calc((100vw - 1120px) / 2));
  background: color-mix(in srgb, var(--ui-bg) 88%, transparent);
  backdrop-filter: blur(16px);
}

.client-shell__brand,
.client-shell__nav {
  display: flex;
  align-items: center;
}

.client-shell__brand {
  gap: 9px;
  color: var(--ui-text-highlighted);
  font-weight: 700;
  text-decoration: none;
}

.client-shell__logo {
  width: auto;
  height: 22px;
  filter: var(--oe-logo-filter);
}

.client-shell__brand small {
  border-left: 1px solid var(--ui-border-accented);
  margin-left: 3px;
  padding-left: 12px;
  color: var(--ui-text-muted);
  font-size: 11px;
  letter-spacing: .12em;
  text-transform: uppercase;
}

.client-shell__nav {
  gap: 8px;
  color: var(--ui-text-toned);
  font-size: 14px;
}

.client-shell__nav a {
  border-radius: 8px;
  padding: 8px 10px;
  text-decoration: none;
}

.client-shell__nav a:hover {
  background: var(--ui-bg-elevated);
  color: var(--ui-text-highlighted);
}

.client-shell__body {
  width: min(100% - 40px, 920px);
  margin: 0 auto;
  padding: clamp(48px, 8vw, 88px) 0 72px;
}

.client-shell--compact .client-shell__body {
  width: min(100% - 32px, 520px);
}

.client-shell__intro {
  display: grid;
  gap: 10px;
  margin-bottom: 30px;
}

.client-shell__intro p {
  margin: 0;
  color: var(--ui-primary);
  font-size: 12px;
  font-weight: 800;
  letter-spacing: .12em;
  text-transform: uppercase;
}

.client-shell__intro h1 {
  margin: 0;
  color: var(--ui-text-highlighted);
  font-size: clamp(34px, 7vw, 52px);
  font-weight: 450;
  letter-spacing: -.045em;
  line-height: 1.04;
}

.client-shell__intro span {
  max-width: 62ch;
  color: var(--ui-text-toned);
  font-size: 16px;
  line-height: 1.6;
}

@media (max-width: 720px) {
  .client-shell__bar {
    align-items: flex-start;
  }

  .client-shell__nav {
    align-items: flex-end;
    flex-direction: column;
  }

  .client-shell__nav a {
    display: none;
  }
}
</style>
