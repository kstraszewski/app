<script lang="ts">
/**
 * Vue adapter for metal-fx 1.0.4.
 *
 * Engine portions are vendored under app/utils/metal-fx from commit
 * be1bf89c63056521a4e8224f368768314c9006f7 and remain MIT licensed:
 * Copyright (c) 2026 Jakub Antalik.
 */
import type { GlowHandles } from '../utils/metal-fx/engine/glow/glow'
import { updateGlow } from '../utils/metal-fx/engine/glow/glow'
import type { MetalFxInstance as RuntimeMetalFxInstance } from '../utils/metal-fx/engine/renderer/core'
import { setGlowCallback } from '../utils/metal-fx/engine/renderer/loop'

type GlowEntry = {
  handles: GlowHandles
  theme: () => 'dark' | 'light'
}

const glowEntries = new Map<RuntimeMetalFxInstance, GlowEntry>()

const environmentQueries = [
  '(prefers-color-scheme: dark)',
  '(prefers-reduced-motion: reduce)',
  '(prefers-reduced-transparency: reduce)',
  '(forced-colors: active)',
  'print',
] as const
type EnvironmentQuery = typeof environmentQueries[number]

const environmentSubscribers = new Set<() => void>()
let sharedMediaQueries = new Map<EnvironmentQuery, MediaQueryList>()

function notifyEnvironmentSubscribers() {
  environmentSubscribers.forEach(subscriber => subscriber())
}

function subscribeToEnvironment(subscriber: () => void) {
  if (sharedMediaQueries.size === 0) {
    sharedMediaQueries = new Map(environmentQueries.map((query) => {
      const mediaQuery = window.matchMedia(query)
      mediaQuery.addEventListener('change', notifyEnvironmentSubscribers)
      return [query, mediaQuery]
    }))
  }

  environmentSubscribers.add(subscriber)

  return () => {
    environmentSubscribers.delete(subscriber)
    if (environmentSubscribers.size > 0) return

    sharedMediaQueries.forEach(mediaQuery => {
      mediaQuery.removeEventListener('change', notifyEnvironmentSubscribers)
    })
    sharedMediaQueries.clear()
  }
}

function environmentMatches(query: EnvironmentQuery) {
  return sharedMediaQueries.get(query)?.matches ?? window.matchMedia(query).matches
}

setGlowCallback((instance, nowMs) => {
  const entry = glowEntries.get(instance)
  if (!entry) return
  updateGlow(
    entry.handles,
    instance,
    nowMs,
    instance.opacityMul,
    entry.theme(),
  )
})
</script>

<script setup lang="ts">
import {
  injectGlow,
  type GlowOptions,
} from '../utils/metal-fx/engine/glow/glow'
import type { PresetName, PresetTheme } from '../utils/metal-fx/engine/presets'
import {
  addReflectionTarget,
  removeReflectionTarget,
} from '../utils/metal-fx/engine/reflection/paint'
import { scheduleReflectionPaint } from '../utils/metal-fx/engine/reflection/reflectionScheduler'
import {
  createInstance,
  destroyInstance,
  registerGlowInstance,
  setInstanceVisible,
  unregisterGlowInstance,
  updateInstance,
} from '../utils/metal-fx/engine/renderer/loop'

type MetalAccentVariant = 'button' | 'circle' | 'surface'
type MetalAccentTheme = 'inherit' | 'dark' | 'light'

const props = withDefaults(defineProps<{
  variant?: MetalAccentVariant
  preset?: PresetName
  theme?: MetalAccentTheme
  strength?: number
  paused?: boolean
  borderRadius?: number
  disableGlow?: boolean
  reflectionTargets?: ReadonlyArray<HTMLElement | null | undefined>
  disableReflections?: boolean
}>(), {
  variant: 'button',
  preset: 'chromatic',
  theme: 'inherit',
  strength: 1,
  paused: false,
  borderRadius: undefined,
  disableGlow: false,
  reflectionTargets: () => [],
  disableReflections: false,
})

const root = ref<HTMLElement | null>(null)
const canvas = ref<HTMLCanvasElement | null>(null)
const glowHost = ref<HTMLElement | null>(null)
const content = ref<HTMLElement | null>(null)
const clientReady = ref(false)
const effectsBlocked = ref(true)
const hiddenByTree = ref(true)
const reducedMotion = ref(false)
const resolvedTheme = ref<PresetTheme>('dark')
const webglReady = ref(false)

let instance: RuntimeMetalFxInstance | null = null
let glowHandles: GlowHandles | null = null
let resizeObserver: ResizeObserver | null = null
let intersectionObserver: IntersectionObserver | null = null
let environmentObserver: MutationObserver | null = null
let unsubscribeEnvironment: (() => void) | null = null
let resizeFrame = 0
let resetFrame = 0
const registeredReflectionTargets = new Set<HTMLElement>()

const normalizedStrength = computed(() => (
  Number.isFinite(props.strength)
    ? Math.min(1, Math.max(0, props.strength))
    : 1
))

const normalizedPreset = computed<PresetName>(() => {
  if (props.preset === 'silver' || props.preset === 'gold') return props.preset
  return 'chromatic'
})

const kind = computed<'pill' | 'circle'>(() => (
  props.variant === 'circle' ? 'circle' : 'pill'
))

const ringCssPx = computed(() => props.variant === 'circle' ? 2 : 1)
const shaderScale = computed(() => props.variant === 'circle' ? 1.3 : 1.6)
const glowEnabled = computed(() => !props.disableGlow && props.variant !== 'surface')
const engineEnabled = computed(() => (
  clientReady.value
  && !effectsBlocked.value
  && !hiddenByTree.value
  && normalizedStrength.value > 0
))
const effectivePaused = computed(() => props.paused || reducedMotion.value)

const rootStyle = computed<Record<string, string>>(() => ({
  '--oe-metal-strength': String(normalizedStrength.value),
  '--oe-metal-ring': `${ringCssPx.value}px`,
  ...(props.variant !== 'circle' && Number.isFinite(props.borderRadius)
    ? { '--oe-metal-radius': `${Math.max(0, props.borderRadius as number)}px` }
    : {}),
}))

function isElementVisible() {
  return !root.value?.closest('[hidden], [aria-hidden="true"]')
}

function usesSolidEffects() {
  return Boolean(root.value?.closest('[data-oe-effects="solid"]'))
}

function resolveTheme(): PresetTheme {
  if (props.theme === 'dark' || props.theme === 'light') return props.theme

  const documentRoot = document.documentElement
  if (documentRoot.classList.contains('dark')) return 'dark'
  if (documentRoot.classList.contains('light')) return 'light'

  return environmentMatches('(prefers-color-scheme: dark)')
    ? 'dark'
    : 'light'
}

function refreshEnvironment() {
  if (!import.meta.client) return

  resolvedTheme.value = resolveTheme()
  hiddenByTree.value = !isElementVisible()
  reducedMotion.value = environmentMatches('(prefers-reduced-motion: reduce)')
  effectsBlocked.value = (
    usesSolidEffects()
    || environmentMatches('(prefers-reduced-transparency: reduce)')
    || environmentMatches('(forced-colors: active)')
    || environmentMatches('print')
  )
}

function resolveRadius(width: number, height: number) {
  if (props.variant === 'circle') return Math.min(width, height) / 2

  if (Number.isFinite(props.borderRadius)) {
    return Math.min(
      Math.max(0, props.borderRadius as number),
      Math.min(width, height) / 2,
    )
  }

  const child = content.value?.firstElementChild
  if (child instanceof HTMLElement) {
    const parsed = Number.parseFloat(getComputedStyle(child).borderTopLeftRadius)
    if (Number.isFinite(parsed)) {
      return Math.min(
        Math.max(0, parsed + ringCssPx.value),
        Math.min(width, height) / 2,
      )
    }
  }

  const fallback = Number.parseFloat(
    getComputedStyle(root.value as HTMLElement).borderTopLeftRadius,
  )
  return Number.isFinite(fallback)
    ? Math.min(fallback, Math.min(width, height) / 2)
    : 0
}

function measure(): GlowOptions {
  const rect = root.value?.getBoundingClientRect()
  const width = Math.max(1, Math.round(rect?.width ?? 1))
  const height = Math.max(1, Math.round(rect?.height ?? 1))

  return {
    width,
    height,
    cornerRadius: resolveRadius(width, height),
    kind: kind.value,
    scale: 1,
  }
}

function clearGlow() {
  if (instance) {
    glowEntries.delete(instance)
    unregisterGlowInstance(instance)
  }
  glowHost.value?.replaceChildren()
  glowHandles = null
}

function clearReflectionTargets(owner = instance) {
  if (!owner) {
    registeredReflectionTargets.clear()
    return
  }

  owner.onAfterFrame = undefined
  for (const target of registeredReflectionTargets) {
    removeReflectionTarget(target, owner)
  }
  registeredReflectionTargets.clear()
}

function syncReflectionTargets() {
  const owner = instance
  const host = root.value
  if (!owner || !host) return

  const desired = new Set<HTMLElement>()
  if (!props.disableReflections && engineEnabled.value) {
    for (const target of props.reflectionTargets) {
      if (!(target instanceof HTMLElement) || !target.isConnected) continue
      if (
        target === host
        || host.contains(target)
        || target.contains(host)
      ) continue
      desired.add(target)
    }
  }

  for (const target of registeredReflectionTargets) {
    if (desired.has(target)) continue
    removeReflectionTarget(target, owner)
    registeredReflectionTargets.delete(target)
  }

  for (const target of desired) {
    if (registeredReflectionTargets.has(target)) continue
    const registered = addReflectionTarget(
      target,
      owner,
      host,
      scheduleReflectionPaint,
    )
    if (registered?.anchor === owner) registeredReflectionTargets.add(target)
  }

  owner.onAfterFrame = registeredReflectionTargets.size > 0
    ? scheduleReflectionPaint
    : undefined
  if (registeredReflectionTargets.size > 0) scheduleReflectionPaint()
}

function rebuildGlow(geometry = measure()) {
  clearGlow()
  if (!instance || !glowHost.value || !glowEnabled.value) return

  glowHandles = injectGlow(glowHost.value, geometry)
  glowEntries.set(instance, {
    handles: glowHandles,
    theme: () => resolvedTheme.value,
  })
  registerGlowInstance(instance)
}

function syncGeometry() {
  if (!instance || !root.value) return

  const geometry = measure()
  updateInstance(instance, {
    cssWidth: geometry.width,
    cssHeight: geometry.height,
    cornerRadius: geometry.cornerRadius,
  })
  rebuildGlow(geometry)
}

function queueGeometrySync() {
  if (!instance || resizeFrame) return
  resizeFrame = requestAnimationFrame(() => {
    resizeFrame = 0
    syncGeometry()
  })
}

function destroyEngine() {
  cancelAnimationFrame(resizeFrame)
  resizeFrame = 0
  resizeObserver?.disconnect()
  resizeObserver = null
  intersectionObserver?.disconnect()
  intersectionObserver = null
  clearReflectionTargets()
  clearGlow()

  if (instance) {
    destroyInstance(instance)
    instance = null
  }

  const context = canvas.value?.getContext('2d')
  if (context && canvas.value) {
    context.clearRect(0, 0, canvas.value.width, canvas.value.height)
  }
  webglReady.value = false
}

function createEngine() {
  const host = root.value
  const targetCanvas = canvas.value
  if (!host || !targetCanvas || !engineEnabled.value || !isElementVisible()) return

  destroyEngine()
  const geometry = measure()

  try {
    instance = createInstance({
      hostCanvas: targetCanvas,
      cssWidth: geometry.width,
      cssHeight: geometry.height,
      cornerRadius: geometry.cornerRadius,
      kind: geometry.kind,
      shaderScale: shaderScale.value,
      ringCssPx: ringCssPx.value,
      opacityMul: normalizedStrength.value,
      paused: effectivePaused.value,
      scale: 1,
      presetName: normalizedPreset.value,
      presetTheme: resolvedTheme.value,
      onFirstCopy: () => {
        webglReady.value = true
      },
    })

    rebuildGlow(geometry)

    resizeObserver = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(queueGeometrySync)
    resizeObserver?.observe(host)

    intersectionObserver = typeof IntersectionObserver === 'undefined'
      ? null
      : new IntersectionObserver(([entry]) => {
          if (instance) setInstanceVisible(instance, entry?.isIntersecting ?? true)
        }, { rootMargin: '64px' })
    intersectionObserver?.observe(host)
    syncReflectionTargets()
  }
  catch (error) {
    destroyEngine()
    if (import.meta.dev) {
      console.warn('OeMetalAccent: WebGL unavailable; using the CSS fallback.', error)
    }
  }
}

function queueEngineReset() {
  if (!import.meta.client) return
  cancelAnimationFrame(resetFrame)
  resetFrame = requestAnimationFrame(() => {
    resetFrame = 0
    if (engineEnabled.value) createEngine()
    else destroyEngine()
  })
}

watch(
  [engineEnabled, kind],
  queueEngineReset,
  { flush: 'post' },
)

watch(
  [normalizedPreset, resolvedTheme],
  ([presetName, presetTheme]) => {
    if (!instance) return
    updateInstance(instance, { presetName, presetTheme })
    if (registeredReflectionTargets.size > 0) scheduleReflectionPaint()
  },
)

watch(
  [normalizedStrength, effectivePaused],
  ([opacityMul, paused]) => {
    if (!instance) return
    updateInstance(instance, { opacityMul, paused })
    if (registeredReflectionTargets.size > 0) scheduleReflectionPaint()
  },
)

watch(
  [() => props.borderRadius, ringCssPx, shaderScale],
  () => {
    if (!instance) return
    updateInstance(instance, {
      ringCssPx: ringCssPx.value,
      shaderScale: shaderScale.value,
    })
    syncGeometry()
  },
)

watch(glowEnabled, () => {
  if (instance) rebuildGlow()
})

watch(
  [
    () => props.disableReflections,
    () => [...props.reflectionTargets],
  ],
  syncReflectionTargets,
  { flush: 'post' },
)

watch(() => props.theme, refreshEnvironment)

onMounted(() => {
  unsubscribeEnvironment = subscribeToEnvironment(refreshEnvironment)

  environmentObserver = new MutationObserver(() => {
    refreshEnvironment()
    if (!hiddenByTree.value) queueGeometrySync()
  })
  for (
    let element: HTMLElement | null = root.value;
    element;
    element = element.parentElement
  ) {
    environmentObserver.observe(element, {
      attributes: true,
      attributeFilter: [
        'class',
        'style',
        'data-oe-effects',
        'hidden',
        'aria-hidden',
      ],
    })
  }

  refreshEnvironment()
  clientReady.value = true
  queueEngineReset()
})

onBeforeUnmount(() => {
  clientReady.value = false
  cancelAnimationFrame(resetFrame)
  resetFrame = 0
  destroyEngine()
  environmentObserver?.disconnect()
  environmentObserver = null
  unsubscribeEnvironment?.()
  unsubscribeEnvironment = null
})
</script>

<template>
  <div
    ref="root"
    class="oe-metal-accent"
    :class="`oe-metal-accent--${variant}`"
    :data-preset="normalizedPreset"
    :data-theme="resolvedTheme"
    :data-webgl="webglReady || undefined"
    data-oe-source="metal-fx-vue"
    data-oe-surface="spectrum"
    :style="rootStyle"
  >
    <span class="oe-metal-accent__inner" aria-hidden="true" />
    <canvas
      ref="canvas"
      class="oe-metal-accent__canvas"
      aria-hidden="true"
    />
    <span
      ref="glowHost"
      class="oe-metal-accent__glow"
      aria-hidden="true"
    />
    <div ref="content" class="oe-metal-accent__content">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.oe-metal-accent {
  --oe-metal-radius: calc(var(--oe-radius-control) + var(--oe-metal-ring));
  --oe-metal-fallback: var(--oe-prism-gradient);

  position: relative;
  display: inline-flex;
  max-width: 100%;
  min-width: 0;
  align-items: stretch;
  justify-content: stretch;
  box-sizing: border-box;
  padding: max(0px, calc(var(--oe-metal-ring) - 1px));
  overflow: visible;
  border: 1px solid var(--ui-border-accented);
  border-radius: var(--oe-metal-radius);
  isolation: isolate;
  vertical-align: middle;
}

.oe-metal-accent[data-preset="silver"] {
  --oe-metal-fallback: linear-gradient(
    112deg,
    var(--ui-border-accented),
    var(--ui-text-highlighted),
    var(--ui-border),
    var(--ui-text-toned)
  );
}

.oe-metal-accent[data-preset="gold"] {
  --oe-metal-fallback: linear-gradient(
    112deg,
    var(--ui-warning),
    var(--ui-text-highlighted),
    var(--ui-warning),
    var(--ui-border-accented)
  );
}

.oe-metal-accent--circle {
  --oe-metal-radius: 50%;

  aspect-ratio: 1;
}

.oe-metal-accent--surface {
  --oe-metal-radius: var(--oe-radius-surface);

  display: flex;
  width: 100%;
}

.oe-metal-accent::before {
  position: absolute;
  z-index: 6;
  inset: -1px;
  padding: var(--oe-metal-ring);
  border-radius: inherit;
  background: var(--oe-metal-fallback);
  content: "";
  opacity: calc(var(--oe-metal-strength) * var(--oe-prism-opacity));
  pointer-events: none;
  transition: opacity var(--oe-motion-base);
  -webkit-mask:
    linear-gradient(rgb(0 0 0) 0 0) content-box,
    linear-gradient(rgb(0 0 0) 0 0);
  mask:
    linear-gradient(rgb(0 0 0) 0 0) content-box,
    linear-gradient(rgb(0 0 0) 0 0);
  -webkit-mask-composite: xor;
  mask-composite: exclude;
}

.oe-metal-accent[data-webgl="true"]::before {
  opacity: 0;
}

.oe-metal-accent__inner {
  position: absolute;
  z-index: 1;
  inset: var(--oe-metal-ring);
  border-radius: max(0px, calc(var(--oe-metal-radius) - var(--oe-metal-ring)));
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--ui-text-highlighted) 8%, transparent);
  pointer-events: none;
}

.oe-metal-accent__canvas {
  position: absolute;
  z-index: 6;
  inset: 0;
  display: block;
  width: 100%;
  height: 100%;
  border-radius: inherit;
  opacity: 0;
  pointer-events: none;
  transition: opacity var(--oe-motion-base);
}

.oe-metal-accent[data-webgl="true"] .oe-metal-accent__canvas {
  opacity: 1;
}

.oe-metal-accent__glow {
  position: absolute;
  z-index: 7;
  inset: 0;
  border-radius: inherit;
  pointer-events: none;
}

.oe-metal-accent__glow :deep(.metal-fx-glow-svg) {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  overflow: visible;
  opacity: 0.7;
  pointer-events: none;
  mix-blend-mode: screen;
}

.oe-metal-accent[data-theme="light"] .oe-metal-accent__glow :deep(.metal-fx-glow-svg) {
  inset: -1px;
  width: calc(100% + 2px);
  height: calc(100% + 2px);
  opacity: 0.2746;
  filter: saturate(5.355) brightness(0.78);
  mix-blend-mode: multiply;
}

.oe-metal-accent--circle[data-theme="light"] .oe-metal-accent__glow :deep(.metal-fx-glow-svg) {
  filter: saturate(7.5) brightness(0.6);
}

.oe-metal-accent__content {
  position: relative;
  z-index: 5;
  display: inline-flex;
  width: auto;
  min-width: 0;
  align-items: stretch;
  justify-content: stretch;
  border-radius: max(0px, calc(var(--oe-metal-radius) - var(--oe-metal-ring)));
}

.oe-metal-accent:has(:focus-visible) {
  outline: 2px solid var(--oe-focus);
  outline-offset: 2px;
}

.oe-metal-accent--surface .oe-metal-accent__content {
  display: flex;
  width: 100%;
}

.oe-metal-accent--circle .oe-metal-accent__content {
  overflow: clip;
  border-radius: 50%;
}

.oe-metal-accent--button .oe-metal-accent__content :deep(button),
.oe-metal-accent--button .oe-metal-accent__content :deep(a),
.oe-metal-accent--circle .oe-metal-accent__content :deep(button),
.oe-metal-accent--circle .oe-metal-accent__content :deep(a) {
  min-block-size: 44px;
}

.oe-metal-accent--circle .oe-metal-accent__content :deep(button),
.oe-metal-accent--circle .oe-metal-accent__content :deep(a) {
  min-inline-size: 44px;
  border-radius: 50%;
}

[data-oe-effects="solid"] .oe-metal-accent__canvas,
[data-oe-effects="solid"] .oe-metal-accent__glow,
[data-oe-effects="solid"] .oe-metal-accent::before {
  display: none;
}

@media (prefers-reduced-transparency: reduce), print {
  .oe-metal-accent__canvas,
  .oe-metal-accent__glow,
  .oe-metal-accent::before {
    display: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .oe-metal-accent::before,
  .oe-metal-accent__canvas {
    transition: none;
  }

  .oe-metal-accent__glow :deep(*) {
    transition: none !important;
  }
}

@media (forced-colors: active) {
  .oe-metal-accent {
    border-color: CanvasText;
    background: Canvas;
    color: CanvasText;
    forced-color-adjust: auto;
  }

  .oe-metal-accent__canvas,
  .oe-metal-accent__glow,
  .oe-metal-accent::before {
    display: none;
  }
}

:global([data-oe-effects="solid"] [data-metal-fx-reflection]) {
  display: none !important;
}

@media (prefers-reduced-transparency: reduce), print {
  :global([data-metal-fx-reflection]) {
    display: none !important;
  }
}

@media (forced-colors: active) {
  :global([data-metal-fx-reflection]) {
    display: none !important;
  }
}
</style>
