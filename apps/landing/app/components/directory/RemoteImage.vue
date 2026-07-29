<script setup lang="ts">
defineOptions({
  inheritAttrs: false,
})

const props = defineProps<{
  src: string
  fallbackSrc?: string | null
  alt: string
}>()

const emit = defineEmits<{
  exhausted: [failedSource: string]
}>()

const activeSource = ref<string | null>(props.src)
const fallbackAttempted = ref(false)

watch(
  () => [props.src, props.fallbackSrc] as const,
  ([src]) => {
    activeSource.value = src
    fallbackAttempted.value = false
  },
)

function handleError() {
  const failedSource = activeSource.value ?? props.src
  const fallbackSource = props.fallbackSrc?.trim()

  if (
    !fallbackAttempted.value
    && fallbackSource
    && fallbackSource !== activeSource.value
  ) {
    fallbackAttempted.value = true
    activeSource.value = fallbackSource
    return
  }

  activeSource.value = null
  emit('exhausted', failedSource)
}
</script>

<template>
  <img
    v-if="activeSource"
    v-bind="$attrs"
    :src="activeSource"
    :alt="alt"
    @error="handleError"
  >
  <slot v-else name="fallback" />
</template>
