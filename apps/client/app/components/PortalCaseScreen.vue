<script setup lang="ts">
import type { PortalCase, PortalUser } from '~/types/portal'
import { PORTAL_TIME_ZONE } from '~/utils/portal-date'

const props = withDefaults(defineProps<{
  caseData: PortalCase
  user: PortalUser
  preview?: boolean
}>(), {
  preview: false,
})

const mobileSummaryOpen = ref(false)

const updatedLabel = computed(() => {
  const date = new Date(props.caseData.updatedAt)
  const datePart = new Intl.DateTimeFormat('pl-PL', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: PORTAL_TIME_ZONE,
  }).format(date)
  const timePart = new Intl.DateTimeFormat('pl-PL', {
    hour: '2-digit', minute: '2-digit', timeZone: PORTAL_TIME_ZONE,
  }).format(date)
  return `${datePart}, ${timePart}`
})
</script>

<template>
  <div class="portal-case-screen">
    <PortalHeader
      :user-name="user.name"
      :user-email="user.email"
      :preview="preview"
    />

    <div class="portal-case-layout">
      <PortalCaseSidebar class="portal-case-layout__sidebar" :case-data="caseData" :preview="preview" />

      <main class="portal-case-main">
        <NuxtLink
          :to="preview ? '/preview' : '/'"
          class="portal-case-main__back"
        >
          <UIcon name="i-lucide-arrow-left" />
          Wróć do „Co teraz”
        </NuxtLink>

        <div class="portal-case-main__mobile-summary">
          <UButton
            color="neutral"
            variant="outline"
            block
            :icon="mobileSummaryOpen ? 'i-lucide-x' : 'i-lucide-folder-open'"
            @click="mobileSummaryOpen = !mobileSummaryOpen"
          >
            {{ mobileSummaryOpen ? 'Zamknij szczegóły sprawy' : 'Szczegóły i postęp sprawy' }}
          </UButton>
          <PortalCaseSidebar
            v-if="mobileSummaryOpen"
            mobile
            :case-data="caseData"
            :preview="preview"
          />
        </div>

        <header class="portal-case-main__title">
          <h1>Co dzieje się w Twojej sprawie</h1>
          <p>Ostatnia aktualizacja: {{ updatedLabel }}</p>
        </header>

        <PortalTimeline :case-data="caseData" :preview="preview" />
      </main>
    </div>
  </div>
</template>

<style scoped>
.portal-case-screen {
  min-height: 100dvh;
  background: #fff;
}

.portal-case-layout {
  display: grid;
  grid-template-columns: var(--portal-sidebar-width) minmax(0, 1fr);
  min-height: calc(100dvh - var(--portal-header-height));
}

.portal-case-layout__sidebar {
  position: sticky;
  top: 0;
  align-self: start;
}

.portal-case-main {
  width: 100%;
  max-width: 1094px;
  padding: 40px var(--portal-page-pad) 28px;
}

.portal-case-main__title {
  margin-bottom: 28px;
}

.portal-case-main__back {
  display: none;
  align-items: center;
  gap: 8px;
  width: fit-content;
  margin-bottom: 18px;
  color: var(--ui-text-muted);
  font-size: 13px;
  text-decoration: none;
}

.portal-case-main__back:hover {
  color: var(--ui-text-highlighted);
}

.portal-case-main__back svg {
  width: 17px;
  height: 17px;
}

.portal-case-main__title h1 {
  margin: 0;
  font-size: clamp(30px, 2.4vw, 38px);
  font-weight: 400;
  line-height: 1.2;
}

.portal-case-main__title p {
  margin: 6px 0 0;
  color: var(--ui-text-muted);
  font-size: 14px;
}

.portal-case-main__mobile-summary {
  display: none;
}

@media (max-width: 1100px) {
  .portal-case-layout {
    grid-template-columns: 330px minmax(0, 1fr);
  }
}

@media (max-width: 900px) {
  .portal-case-layout {
    display: block;
  }

  .portal-case-layout__sidebar {
    display: none;
  }

  .portal-case-main {
    max-width: 820px;
    margin: 0 auto;
    padding: 28px 24px calc(56px + env(safe-area-inset-bottom));
  }

  .portal-case-main__mobile-summary {
    display: grid;
    gap: 14px;
    margin-bottom: 28px;
  }

  .portal-case-main__back {
    display: inline-flex;
  }
}

@media (max-width: 540px) {
  .portal-case-main {
    padding: 22px 16px calc(56px + env(safe-area-inset-bottom));
  }

  .portal-case-main__title {
    margin-bottom: 22px;
  }

  .portal-case-main__title h1 {
    font-size: 28px;
  }

  .portal-case-main__title p {
    max-width: 290px;
    font-size: 13px;
  }
}
</style>
