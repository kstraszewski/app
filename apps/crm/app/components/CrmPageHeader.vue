<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router'

type PageHeaderTab = {
  label: string
  to: RouteLocationRaw
  icon?: string
  count?: number
  exact?: boolean
  active?: boolean
}

const props = withDefaults(defineProps<{
  title: string
  eyebrow?: string
  description?: string
  backTo?: string
  backLabel?: string
  tabs?: PageHeaderTab[]
}>(), {
  eyebrow: '',
  description: '',
  backTo: '',
  backLabel: 'Wróć',
  tabs: () => [],
})

const route = useRoute()
const router = useRouter()
const tabsElement = ref<HTMLElement | null>(null)
let tabsResizeObserver: ResizeObserver | null = null
let tabScrollFrame: number | null = null

function tabIsActive(tab: PageHeaderTab) {
  if (tab.active !== undefined) return tab.active
  const target = router.resolve(tab.to)
  if (tab.exact !== false) {
    return route.path === target.path
      && JSON.stringify(route.query) === JSON.stringify(target.query)
  }
  return route.path === target.path || route.path.startsWith(`${target.path}/`)
}

const tabSignature = computed(() => props.tabs.map((tab) => {
  const target = router.resolve(tab.to)
  return `${tab.label}:${target.fullPath}:${String(tab.active)}`
}).join('|'))

async function revealActiveTab(smooth = false) {
  if (!import.meta.client) return
  await nextTick()

  if (tabScrollFrame !== null) window.cancelAnimationFrame(tabScrollFrame)
  tabScrollFrame = window.requestAnimationFrame(() => {
    tabScrollFrame = null
    const container = tabsElement.value
    const activeTab = container?.querySelector<HTMLElement>('[aria-current="page"]')
    if (!container || !activeTab) return

    const containerRect = container.getBoundingClientRect()
    const activeTabRect = activeTab.getBoundingClientRect()
    const edgePadding = 8
    const hiddenAtStart = activeTabRect.left < containerRect.left + edgePadding
    const hiddenAtEnd = activeTabRect.right > containerRect.right - edgePadding
    if (!hiddenAtStart && !hiddenAtEnd) return

    const offset = hiddenAtStart
      ? activeTabRect.left - containerRect.left - edgePadding
      : activeTabRect.right - containerRect.right + edgePadding
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    container.scrollBy({
      left: offset,
      behavior: smooth && !prefersReducedMotion ? 'smooth' : 'auto',
    })
  })
}

watch(
  [() => route.fullPath, tabSignature],
  () => {
    void revealActiveTab(true)
  },
  { flush: 'post' },
)

watch(tabsElement, (element, previousElement) => {
  if (previousElement) tabsResizeObserver?.unobserve(previousElement)
  if (element) tabsResizeObserver?.observe(element)
})

onMounted(() => {
  if ('ResizeObserver' in window) {
    tabsResizeObserver = new ResizeObserver(() => {
      void revealActiveTab()
    })
    if (tabsElement.value) tabsResizeObserver.observe(tabsElement.value)
  }
  void revealActiveTab()
})

onBeforeUnmount(() => {
  tabsResizeObserver?.disconnect()
  if (tabScrollFrame !== null) window.cancelAnimationFrame(tabScrollFrame)
})
</script>

<template>
  <header
    class="crm-page-header"
    :class="{
      'crm-page-header--without-tabs': !props.tabs.length,
      'crm-page-header--with-tabs': props.tabs.length,
    }"
  >
    <div class="crm-page-header__copy">
      <UButton
        v-if="props.backTo"
        class="crm-page-header__back"
        :to="props.backTo"
        color="neutral"
        variant="link"
        icon="i-lucide-arrow-left"
      >
        {{ props.backLabel }}
      </UButton>

      <p v-if="props.eyebrow" class="crm-page-header__eyebrow">{{ props.eyebrow }}</p>
      <h1>{{ props.title }}</h1>
      <p v-if="props.description" class="crm-page-header__description">{{ props.description }}</p>

      <div v-if="$slots.meta" class="crm-page-header__meta">
        <slot name="meta" />
      </div>
    </div>

    <nav
      v-if="props.tabs.length"
      ref="tabsElement"
      class="crm-page-header__tabs"
      aria-label="Nawigacja strony"
    >
      <NuxtLink
        v-for="tab in props.tabs"
        :key="tab.label"
        :to="tab.to"
        class="crm-page-header__tab"
        :class="{ 'crm-page-header__tab--active': tabIsActive(tab) }"
        :aria-current="tabIsActive(tab) ? 'page' : undefined"
      >
        <UIcon v-if="tab.icon" :name="tab.icon" />
        <span>{{ tab.label }}</span>
        <span v-if="tab.count !== undefined" class="crm-page-header__tab-count">
          {{ tab.count }}
        </span>
      </NuxtLink>
    </nav>

    <div v-if="$slots.actions" class="crm-page-header__actions">
      <slot name="actions" />
    </div>
  </header>
</template>

<style scoped>
.crm-page-header {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: end;
  column-gap: 28px;
  row-gap: 18px;
  min-width: 0;
  margin-bottom: 28px;
  padding-bottom: 18px;
  border-bottom: 1px solid var(--ui-border);
}

.crm-page-header--without-tabs {
  grid-template-columns: minmax(0, 1fr) auto;
}

.crm-page-header--with-tabs {
  padding-bottom: 0;
}

.crm-page-header--with-tabs .crm-page-header__tabs {
  grid-column: 1 / -1;
  grid-row: 2;
  min-height: 36px;
}

.crm-page-header__copy {
  min-width: 0;
}

.crm-page-header__back {
  min-height: 28px;
  margin: 0 0 12px -10px;
  padding-inline: 10px;
  color: var(--ui-text-muted);
  font-size: 13px;
}

.crm-page-header__back:hover {
  color: var(--ui-text-highlighted);
}

.crm-page-header__eyebrow {
  margin: 0;
  color: var(--ui-text-muted);
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 650;
  letter-spacing: .06em;
  line-height: 1.4;
  text-transform: uppercase;
}

.crm-page-header h1 {
  margin: 5px 0 0;
  color: var(--ui-text-highlighted);
  font-size: clamp(36px, 3.5vw, 48px);
  font-weight: var(--oe-heading-font-weight);
  line-height: 1.05;
}

.crm-page-header__description {
  max-width: 640px;
  margin: 9px 0 0;
  color: var(--ui-text-muted);
  font-size: 14px;
  line-height: 1.5;
}

.crm-page-header__meta {
  margin-top: 10px;
}

.crm-page-header__tabs {
  display: flex;
  align-items: flex-end;
  align-self: stretch;
  gap: 28px;
  max-width: 100%;
  min-width: 0;
  overflow-x: auto;
  overscroll-behavior-inline: contain;
  scroll-padding-inline: 8px;
  scrollbar-width: thin;
  -webkit-overflow-scrolling: touch;
}

.crm-page-header__tab {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  min-height: 36px;
  padding: 0 0 9px;
  color: var(--ui-text-muted);
  font-size: 14px;
  font-weight: 550;
  text-decoration: none;
  white-space: nowrap;
  transition: color var(--oe-motion-fast);
}

.crm-page-header__tab:focus-visible {
  border-radius: 4px;
  outline: 2px solid var(--ui-primary);
  outline-offset: 3px;
}

.crm-page-header__tab::after {
  position: absolute;
  right: 0;
  bottom: -1px;
  left: 0;
  height: 2px;
  background: transparent;
  content: "";
  transition: background-color var(--oe-motion-fast);
}

.crm-page-header__tab:hover,
.crm-page-header__tab--active {
  color: var(--ui-text-highlighted);
}

.crm-page-header__tab--active::after {
  background: var(--ui-primary);
}

.crm-page-header__tab-count {
  display: grid;
  place-items: center;
  min-width: 21px;
  height: 21px;
  padding-inline: 6px;
  border-radius: 999px;
  color: var(--ui-text-muted);
  background: var(--ui-bg-accented);
  font-family: var(--font-mono);
  font-size: 9px;
  line-height: 1;
}

.crm-page-header__tab--active .crm-page-header__tab-count {
  color: var(--ui-text-highlighted);
}

.crm-page-header__actions {
  display: flex;
  grid-column: 2;
  grid-row: 1;
  flex-wrap: nowrap;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  min-width: 0;
}

@media (max-width: 1120px) {
  .crm-page-header,
  .crm-page-header--without-tabs {
    grid-template-columns: 1fr;
  }

  .crm-page-header__actions {
    grid-column: 1;
    grid-row: 2;
    flex-wrap: wrap;
    justify-content: flex-start;
  }

  .crm-page-header--with-tabs .crm-page-header__tabs {
    grid-column: 1;
    grid-row: 3;
    min-height: 36px;
  }

  .crm-page-header__tab,
  .crm-page-header__actions :deep(button),
  .crm-page-header__actions :deep(a) {
    min-height: 44px;
  }

  .crm-page-header__tab:focus-visible {
    outline-offset: -2px;
  }
}

@media (max-width: 680px) {
  .crm-page-header,
  .crm-page-header--without-tabs {
    grid-template-columns: 1fr;
    gap: 18px;
  }

  .crm-page-header__actions {
    grid-column: 1;
    grid-row: 2;
    justify-content: flex-start;
  }

  .crm-page-header--with-tabs .crm-page-header__tabs {
    grid-column: 1;
    grid-row: 3;
    gap: 22px;
  }

}

@media (prefers-reduced-motion: reduce) {
  .crm-page-header__tabs {
    scroll-behavior: auto;
  }
}
</style>
