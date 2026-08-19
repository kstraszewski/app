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

type CaseView = 'updates' | 'documents' | 'details'

const route = useRoute()
const casePath = computed(() => props.preview
  ? `/preview/cases/${encodeURIComponent(props.caseData.id)}`
  : `/cases/${encodeURIComponent(props.caseData.id)}`)
const hasDocuments = computed(() => hasPortalCaseDocuments(props.caseData.documents))
const activeView = computed<CaseView>(() => {
  if (route.query.view === 'documents' && hasDocuments.value) return 'documents'
  if (route.query.view === 'details') return 'details'
  return 'updates'
})
const viewTabs = computed(() => {
  const tabs: Array<{
    value: CaseView
    label: string
    icon: string
    to: string | { path: string, query: { view: CaseView } }
  }> = [{
    value: 'updates',
    label: 'Aktualności',
    icon: 'i-lucide-list-tree',
    to: casePath.value,
  }]
  if (hasDocuments.value) {
    tabs.push({
      value: 'documents',
      label: 'Dokumenty',
      icon: 'i-lucide-files',
      to: { path: casePath.value, query: { view: 'documents' } },
    })
  }
  tabs.push({
    value: 'details',
    label: 'Szczegóły',
    icon: 'i-lucide-folder-open',
    to: { path: casePath.value, query: { view: 'details' } },
  })
  return tabs
})

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

const viewHeading = computed(() => {
  if (activeView.value === 'documents') return 'Dokumenty Twojej sprawy'
  if (activeView.value === 'details') return 'Szczegóły i postęp sprawy'
  return 'Co dzieje się w Twojej sprawie'
})

const viewDescription = computed(() => {
  if (activeView.value === 'documents') {
    return 'W jednym miejscu zobaczysz dokumenty wymagane i już przesłane.'
  }
  if (activeView.value === 'details') {
    return 'Zakres, postęp i najważniejsze informacje w jednym miejscu.'
  }
  return `Ostatnia aktualizacja: ${updatedLabel.value}`
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

      <main :class="['portal-case-main', `is-view-${activeView}`]">
        <NuxtLink
          :to="preview ? '/preview' : '/'"
          class="portal-case-main__back"
        >
          <UIcon name="i-lucide-arrow-left" />
          Wróć do „Co teraz”
        </NuxtLink>

        <header class="portal-case-main__title">
          <h1>{{ viewHeading }}</h1>
          <p>{{ viewDescription }}</p>
        </header>

        <nav
          :class="['portal-case-main__tabs', { 'has-documents': hasDocuments }]"
          aria-label="Widok sprawy"
        >
          <NuxtLink
            v-for="tab in viewTabs"
            :key="tab.value"
            :to="tab.to"
            :class="[
              `portal-case-main__tab--${tab.value}`,
              { 'is-active': activeView === tab.value },
            ]"
            :aria-current="activeView === tab.value ? 'page' : undefined"
          >
            <UIcon :name="tab.icon" />
            <span>{{ tab.label }}</span>
          </NuxtLink>
        </nav>

        <div class="portal-case-main__details">
          <PortalCaseSidebar
            mobile
            :case-data="caseData"
            :preview="preview"
          />
        </div>
        <div class="portal-case-main__updates">
          <PortalTimeline
            :case-data="caseData"
            :preview="preview"
          />
        </div>
        <div class="portal-case-main__documents">
          <PortalDocumentsPanel
            :case-data="caseData"
            :preview="preview"
          />
        </div>
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
  margin-bottom: 22px;
}

.portal-case-main__back {
  display: none;
  align-items: center;
  gap: 8px;
  width: fit-content;
  min-height: 44px;
  padding: 0 4px;
  margin-left: -4px;
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

.portal-case-main__tabs {
  display: none;
  grid-template-columns: repeat(2, minmax(0, 170px));
  gap: 6px;
  width: fit-content;
  margin-bottom: 24px;
  padding: 5px;
  border: 1px solid var(--portal-line);
  border-radius: 16px;
  background: var(--ui-bg-muted);
}

.portal-case-main__tabs a {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 42px;
  padding: 0 16px;
  border-radius: 11px;
  color: var(--ui-text-muted);
  font-size: 13px;
  font-weight: 600;
  text-decoration: none;
}

.portal-case-main__tabs a.is-active {
  background: var(--ui-bg);
  box-shadow: 0 2px 12px rgb(0 0 0 / 7%);
  color: var(--ui-text-highlighted);
}

.portal-case-main__tabs svg {
  width: 17px;
  height: 17px;
}

.portal-case-main__tabs.has-documents {
  display: grid;
}

.portal-case-main__tab--details {
  display: none !important;
}

.portal-case-main__details {
  display: none;
  max-width: 560px;
}

.portal-case-main__documents {
  display: none;
}

.portal-case-main.is-view-documents .portal-case-main__updates {
  display: none;
}

.portal-case-main.is-view-documents .portal-case-main__documents {
  display: block;
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
    padding: 28px 24px var(--portal-mobile-nav-clearance);
  }

  .portal-case-main__tabs {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    width: 100%;
  }

  .portal-case-main__tabs.has-documents {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .portal-case-main__tab--details {
    display: inline-flex !important;
  }

  .portal-case-main__updates,
  .portal-case-main__documents {
    display: none;
  }

  .portal-case-main.is-view-updates .portal-case-main__updates,
  .portal-case-main.is-view-documents .portal-case-main__documents,
  .portal-case-main.is-view-details .portal-case-main__details {
    display: block;
  }

  .portal-case-main__back {
    display: inline-flex;
  }
}

@media (max-width: 760px) {
  .portal-case-main__title {
    max-width: 440px;
    margin: 0 auto 20px;
    text-align: center;
  }

  .portal-case-main__title h1 {
    max-width: 360px;
    margin-inline: auto;
    letter-spacing: -0.035em;
    line-height: 1.14;
  }

  .portal-case-main__title p {
    max-width: 340px;
    margin: 8px auto 0;
    line-height: 1.45;
  }
}

@media (max-width: 540px) {
  .portal-case-main {
    padding: 22px 16px var(--portal-mobile-nav-clearance);
  }

  .portal-case-main__tabs {
    position: sticky;
    z-index: 15;
    top: 8px;
    gap: 3px;
    margin-bottom: 18px;
    padding: 4px;
    border-radius: 15px;
    background: rgb(250 250 250 / 94%);
    box-shadow: 0 8px 28px rgb(0 0 0 / 7%);
    backdrop-filter: blur(16px);
  }

  .portal-case-main__tabs a {
    gap: 5px;
    min-height: 43px;
    padding-inline: 8px;
    font-size: 11px;
  }

  .portal-case-main__tabs svg {
    width: 16px;
    height: 16px;
  }

  .portal-case-main__title h1 {
    font-size: 28px;
  }

  .portal-case-main__title p {
    font-size: 13px;
  }
}
</style>
