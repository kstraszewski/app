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

const hasAuthConfig = useHasAuthConfig()
const runtimeConfig = useRuntimeConfig()
const landingBaseUrl = String(
  runtimeConfig.public.openexpert.landingBaseUrl || 'http://127.0.0.1:3003',
).replace(/\/+$/u, '')
const signingOut = ref(false)

async function signOut() {
  if (!hasAuthConfig) return
  signingOut.value = true
  await signOutAuthenticatedUser()
  clearNuxtData(key => (
    key.startsWith('client-appointments:')
    || key.startsWith('client-multiform:')
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
        <NuxtLink
          v-if="showNavigation"
          to="/client#konsultacje"
          class="client-shell__nav-link client-shell__nav-link--appointments"
          aria-label="Moje konsultacje"
          title="Moje konsultacje"
        >
          <UIcon class="client-shell__appointments-icon" name="i-lucide-calendar-days" aria-hidden="true" />
          <span class="client-shell__appointments-label">Moje konsultacje</span>
        </NuxtLink>
        <NuxtLink
          v-if="showNavigation"
          to="/client#multiwnioski"
          class="client-shell__nav-link client-shell__nav-link--multiform"
          aria-label="Multiwnioski"
          title="Multiwnioski"
        >
          <UIcon class="client-shell__multiform-icon" name="i-lucide-files" aria-hidden="true" />
          <span class="client-shell__multiform-label">Multiwnioski</span>
        </NuxtLink>
        <NuxtLink
          v-if="showNavigation && showAccountSwitcher"
          to="/account"
          class="client-shell__nav-link client-shell__nav-link--switcher"
          aria-label="Przełącz konto"
          title="Przełącz konto"
        >
          <UIcon class="client-shell__switch-icon" name="i-lucide-repeat-2" aria-hidden="true" />
          <span class="client-shell__switch-label">Przełącz konto</span>
        </NuxtLink>
        <UButton
          v-if="showLogout"
          class="client-shell__logout"
          type="button"
          color="neutral"
          variant="ghost"
          icon="i-lucide-log-out"
          :loading="signingOut"
          @click="signOut"
        >
          <span class="client-shell__logout-label">Wyloguj</span>
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
  display: inline-flex;
  align-items: center;
  border-radius: 8px;
  padding: 8px 10px;
  text-decoration: none;
}

.client-shell__nav a:hover {
  background: var(--ui-bg-elevated);
  color: var(--ui-text-highlighted);
}

.client-shell__appointments-icon,
.client-shell__multiform-icon,
.client-shell__switch-icon {
  display: none;
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
    align-items: center;
    gap: 12px;
  }

  .client-shell__nav {
    align-items: center;
    flex-direction: row;
  }

  .client-shell__nav a {
    min-height: 44px;
  }

  .client-shell__nav-link--appointments,
  .client-shell__nav-link--multiform,
  .client-shell__nav-link--switcher,
  .client-shell__nav :deep(.client-shell__logout) {
    display: inline-flex;
    width: 44px;
    min-width: 44px;
    min-height: 44px;
    justify-content: center;
    padding: 0;
  }

  .client-shell__appointments-icon,
  .client-shell__multiform-icon,
  .client-shell__switch-icon {
    display: block;
    width: 18px;
    height: 18px;
  }

  .client-shell__appointments-label,
  .client-shell__multiform-label,
  .client-shell__switch-label,
  .client-shell__logout-label {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    clip-path: inset(50%);
    white-space: nowrap;
  }
}

@media (max-width: 420px) {
  .client-shell__brand > span,
  .client-shell__brand > small {
    display: none;
  }
}
</style>
