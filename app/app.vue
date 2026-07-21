<script setup lang="ts">
const MIN_VISIBLE_MS = 350
const LOAD_TIMEOUT_MS = 8000

const router = useRouter()
const isLoading = ref(true)
const isDark = ref(false)
let animationReady = false
let pageReady = false
let shownAt = Date.now()
let hideTimer: ReturnType<typeof setTimeout> | undefined
let safetyTimer: ReturnType<typeof setTimeout> | undefined
let mediaQuery: MediaQueryList | undefined
const updateTheme = () => { isDark.value = mediaQuery?.matches ?? false }

const loaderSrc = computed(() => isDark.value
  ? '/rive/openexpert-loader-darkmode.riv'
  : '/rive/openexpert-loader-lightmode.riv',
)

function showLoader() {
  clearTimeout(hideTimer)
  isLoading.value = true
  pageReady = false
  shownAt = Date.now()
}

function hideLoaderWhenReady() {
  pageReady = true
  if (!animationReady) return

  const delay = Math.max(0, MIN_VISIBLE_MS - (Date.now() - shownAt))
  clearTimeout(hideTimer)
  hideTimer = setTimeout(() => {
    isLoading.value = false
  }, delay)
}

function onAnimationSettled() {
  animationReady = true
  if (pageReady) hideLoaderWhenReady()
}

const removeBeforeEach = router.beforeEach(() => showLoader())
const removeAfterEach = router.afterEach(() => hideLoaderWhenReady())

onMounted(() => {
  mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
  updateTheme()
  mediaQuery.addEventListener('change', updateTheme)

  // The first route is already resolved by the time the root component mounts.
  hideLoaderWhenReady()
  safetyTimer = setTimeout(onAnimationSettled, LOAD_TIMEOUT_MS)
})

onBeforeUnmount(() => {
  clearTimeout(hideTimer)
  clearTimeout(safetyTimer)
  mediaQuery?.removeEventListener('change', updateTheme)
  removeBeforeEach()
  removeAfterEach()
})
</script>

<template>
  <div>
    <NuxtRouteAnnouncer />
    <NuxtPage />

    <Transition name="app-loader">
      <div v-if="isLoading" class="app-loader" role="status" aria-live="polite">
        <ClientOnly>
          <RiveAnimation
            class="app-loader__animation"
            :src="loaderSrc"
            :auto-bind="false"
            fit="contain"
            label="Ładowanie aplikacji"
            @load="onAnimationSettled"
            @error="onAnimationSettled"
          />
          <template #fallback>
            <span class="app-loader__fallback">Ładowanie…</span>
          </template>
        </ClientOnly>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.app-loader {
  position: fixed;
  z-index: 9999;
  inset: 0;
  display: grid;
  place-items: center;
  background: var(--bg-default);
}

.app-loader__animation {
  width: min(42vw, 180px);
  height: min(42vw, 180px);
}

.app-loader__fallback {
  color: var(--fg-secondary);
  font: var(--weight-medium) var(--text-sm) / var(--leading-normal) var(--font-sans);
}

.app-loader-enter-active,
.app-loader-leave-active {
  transition: opacity var(--transition-base);
}

.app-loader-enter-from,
.app-loader-leave-to {
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .app-loader-enter-active,
  .app-loader-leave-active {
    transition: none;
  }
}
</style>
