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
const loggingOut = ref(false)

const initials = computed(() => {
  const parts = props.userName.trim().split(/\s+/u).filter(Boolean)
  return (parts.length > 1
    ? `${parts[0]?.[0] ?? ''}${parts.at(-1)?.[0] ?? ''}`
    : parts[0]?.slice(0, 2) || 'OE').toUpperCase()
})

async function signOut() {
  if (props.preview) {
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
      <span v-if="preview" class="portal-header__preview-label">
        Podgląd · dane demonstracyjne
      </span>
    </div>

    <nav class="portal-header__nav" aria-label="Główna nawigacja">
      <NuxtLink
        :to="preview ? '/preview' : '/'"
        class="is-active"
      >
        <UIcon name="i-lucide-house" class="portal-header__nav-icon" />
        <span>Co teraz</span>
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
        :items="[[
          { label: userEmail || 'Konto klienta', icon: 'i-lucide-user-round', disabled: true },
          { label: 'Wyloguj się', icon: 'i-lucide-log-out', onSelect: signOut },
        ]]"
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
  width: fit-content;
  text-decoration: none;
}

.portal-header__preview-label {
  display: inline-flex;
  align-items: center;
  min-height: 27px;
  padding: 4px 9px;
  border: 1px solid var(--ui-border-accented);
  border-radius: 999px;
  background: var(--ui-bg-muted);
  color: var(--ui-text-toned);
  font-size: 10px;
  font-weight: 650;
  letter-spacing: 0.035em;
  line-height: 1.2;
  white-space: nowrap;
}

.portal-header__nav {
  display: flex;
  align-items: center;
  gap: 46px;
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

  .portal-header__preview-label {
    font-size: 9px;
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

  .portal-header--preview .portal-header__brand-group {
    gap: 10px;
  }

  .portal-header__preview-label {
    max-width: 150px;
    white-space: normal;
  }
}
</style>
