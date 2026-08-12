<script setup lang="ts">
const props = withDefaults(defineProps<{
  userName?: string
  userEmail?: string
  preview?: boolean
}>(), {
  userName: 'Klient OpenExpert',
  userEmail: '',
  preview: false,
})

const toast = useToast()
const runtimeConfig = useRuntimeConfig()
const route = useRoute()
const loggingOut = ref(false)
const currentCaseId = computed(() => typeof route.params.caseId === 'string'
  ? route.params.caseId
  : '')
const messagesTo = computed(() => {
  const base = props.preview ? '/preview/messages' : '/messages'
  return currentCaseId.value
    ? `${base}?case=${encodeURIComponent(currentCaseId.value)}`
    : base
})

const accountMenuItems = computed(() => [[
  {
    label: props.userEmail || 'Konto klienta',
    icon: 'i-lucide-user-round',
    disabled: true,
  },
  {
    label: 'Ustawienia konta',
    icon: 'i-lucide-settings-2',
    to: props.preview ? undefined : '/account',
    disabled: props.preview,
  },
  {
    label: 'Wyloguj się',
    icon: 'i-lucide-log-out',
    onSelect: signOut,
  },
]])

const navigationItems = computed(() => [
  {
    label: 'Co teraz',
    icon: 'i-lucide-house',
    to: props.preview ? '/preview' : '/',
    active: props.preview
      ? route.path === '/preview'
      : route.path === '/',
  },
  {
    label: 'Wiadomości',
    icon: 'i-lucide-message-circle-more',
    to: messagesTo.value,
    active: props.preview
      ? route.path.startsWith('/preview/messages')
      : route.path.startsWith('/messages'),
  },
])

const initials = computed(() => {
  const parts = props.userName.trim().split(/\s+/u).filter(Boolean)
  return (parts.length > 1
    ? `${parts[0]?.[0] ?? ''}${parts.at(-1)?.[0] ?? ''}`
    : parts[0]?.slice(0, 2) || 'OE').toUpperCase()
})

async function signOut() {
  if (props.preview) {
    if (runtimeConfig.public.openexpert.demoEnabled) {
      loggingOut.value = true
      try {
        await $fetch('/api/demo/logout', { method: 'POST' })
        await navigateTo('/demo')
      }
      finally {
        loggingOut.value = false
      }
      return
    }
    toast.add({ title: 'To jest bezpieczny podgląd panelu', icon: 'i-lucide-eye' })
    return
  }
  loggingOut.value = true
  await signOutAuthenticatedUser()
  await navigateTo('/login')
}
</script>

<template>
  <header class="portal-header" :class="{ 'portal-header--preview': preview }">
    <div class="portal-header__brand-group">
      <NuxtLink :to="preview ? '/preview' : '/'" class="portal-header__brand">
        <OpenExpertLogo />
      </NuxtLink>
    </div>

    <nav class="portal-header__nav" aria-label="Główna nawigacja">
      <NuxtLink
        v-for="item in navigationItems"
        :key="item.label"
        :to="item.to"
        :class="{ 'is-active': item.active }"
        :aria-current="item.active ? 'page' : undefined"
      >
        <UIcon :name="item.icon" class="portal-header__nav-icon" />
        <span>{{ item.label }}</span>
      </NuxtLink>
    </nav>

    <div class="portal-header__account">
      <UPopover>
        <UButton
          icon="i-lucide-bell"
          color="neutral"
          variant="ghost"
          square
          aria-label="Powiadomienia"
          class="portal-header__bell"
        />
        <template #content>
          <div class="notifications-panel">
            <p class="notifications-panel__title">Powiadomienia</p>
            <div v-if="preview" class="notifications-panel__item">
              <span aria-hidden="true" />
              <div>
                <strong>Nowa prośba od eksperta</strong>
                <p>Sprawdź najnowszą aktualizację w swojej sprawie.</p>
              </div>
            </div>
            <p v-else class="notifications-panel__empty">
              Nie masz nowych powiadomień.
            </p>
          </div>
        </template>
      </UPopover>

      <span class="portal-header__divider" aria-hidden="true" />

      <UDropdownMenu
        :items="accountMenuItems"
      >
        <UButton
          color="neutral"
          variant="ghost"
          :loading="loggingOut"
          class="portal-header__user"
          aria-label="Otwórz menu konta"
        >
          <span class="portal-header__avatar" aria-hidden="true">{{ initials }}</span>
          <span class="portal-header__name">{{ userName }}</span>
          <UIcon name="i-lucide-chevron-down" class="portal-header__chevron" />
        </UButton>
      </UDropdownMenu>
    </div>
  </header>
  <PortalBottomNavigation :preview="preview" />
</template>

<style scoped>
.portal-header {
  position: relative;
  z-index: 20;
  display: grid;
  grid-template-columns: minmax(250px, 340px) 1fr auto;
  align-items: center;
  height: var(--portal-header-height);
  padding: 0 38px;
  border-bottom: 1px solid var(--portal-line);
  background: color-mix(in srgb, #fff 96%, transparent);
}

.portal-header__brand-group {
  display: flex;
  align-items: center;
  gap: 15px;
  min-width: 0;
}

.portal-header__brand {
  display: inline-flex;
  flex: 0 0 auto;
  width: fit-content;
  text-decoration: none;
}

.portal-header__nav {
  display: flex;
  align-items: center;
  gap: 36px;
  height: 100%;
}

.portal-header__nav a {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  height: 100%;
  color: var(--ui-text-muted);
  font-size: 16px;
  font-weight: 500;
  text-decoration: none;
  transition: color 160ms ease;
}

.portal-header__nav-icon {
  display: none;
  width: 17px;
  height: 17px;
}

.portal-header__nav a:hover,
.portal-header__nav a.is-active {
  color: var(--ui-text-highlighted);
}

.portal-header__nav a.is-active {
  font-weight: 650;
}

.portal-header__account {
  display: flex;
  align-items: center;
  gap: 15px;
}

.portal-header__bell {
  min-height: 42px;
  padding: 0;
  font-size: 21px;
}

.portal-header__divider {
  width: 1px;
  height: 29px;
  background: var(--portal-line);
}

.portal-header__user {
  min-height: 50px;
  padding: 4px 0 4px 10px;
  border-radius: 999px;
  border: 0;
  box-shadow: none;
}

.portal-header__avatar {
  display: grid;
  width: 40px;
  height: 40px;
  place-items: center;
  border-radius: 999px;
  background: var(--ui-bg-elevated);
  color: var(--ui-text-highlighted);
  font-size: 13px;
  font-weight: 600;
}

.portal-header__name {
  margin-left: 3px;
  color: var(--ui-text-highlighted);
  font-size: 15px;
  font-weight: 500;
}

.portal-header__chevron {
  width: 17px;
  height: 17px;
  margin-left: 2px;
}

.notifications-panel {
  width: min(340px, calc(100vw - 32px));
  padding: 17px;
}

.notifications-panel__title {
  margin: 0 0 13px;
  color: var(--ui-text-highlighted);
  font-size: 14px;
  font-weight: 650;
}

.notifications-panel__item {
  display: flex;
  gap: 11px;
  padding: 13px;
  border-radius: 12px;
  background: var(--ui-bg-muted);
}

.notifications-panel__item > span {
  width: 7px;
  height: 7px;
  margin-top: 7px;
  border-radius: 999px;
  background: #000;
}

.notifications-panel__item strong {
  color: var(--ui-text-highlighted);
  font-size: 13px;
}

.notifications-panel__item p {
  margin: 4px 0 0;
  color: var(--ui-text-muted);
  font-size: 12px;
}

.notifications-panel__empty {
  margin: 0;
  padding: 13px;
  border-radius: 12px;
  background: var(--ui-bg-muted);
  color: var(--ui-text-muted);
  font-size: 12px;
}

@media (max-width: 900px) {
  .portal-header {
    grid-template-columns: auto 1fr auto;
    height: 68px;
    padding: 0 20px;
  }

  .portal-header__nav {
    justify-content: center;
    gap: 24px;
  }

  .portal-header__nav a {
    font-size: 14px;
  }

  .portal-header__nav-icon {
    display: block;
  }

  .portal-header__name,
  .portal-header__divider {
    display: none;
  }

  .portal-header__account {
    gap: 2px;
  }
}

@media (max-width: 640px) {
  .portal-header {
    grid-template-columns: 1fr auto;
    padding: 0 16px;
  }

  .portal-header__nav {
    display: none;
  }

  .portal-header__bell {
    display: none;
  }

  .portal-header__avatar {
    width: 37px;
    height: 37px;
  }

  .portal-header--preview .portal-header__brand :deep(.brand-lockup > span) {
    display: none;
  }

}
</style>
