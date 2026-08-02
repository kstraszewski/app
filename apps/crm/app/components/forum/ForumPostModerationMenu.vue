<script setup lang="ts">
const props = withDefaults(defineProps<{
  isHidden?: boolean
  busy?: boolean
  postLabel?: string
}>(), {
  isHidden: false,
  busy: false,
  postLabel: 'odpowiedzi',
})

const emit = defineEmits<{
  action: [action: 'hide' | 'restore']
}>()

interface ForumPostModerationMenuItem {
  label: string
  description: string
  icon: string
  color?: 'error' | 'success'
  disabled?: boolean
  onSelect: () => void
}

const items = computed<ForumPostModerationMenuItem[][]>(() => [[
  props.isHidden
    ? {
        label: 'Przywróć wpis',
        description: 'Ponownie pokaż go członkom organizacji',
        icon: 'i-lucide-eye',
        color: 'success',
        disabled: props.busy,
        onSelect: () => emit('action', 'restore'),
      }
    : {
        label: 'Ukryj wpis',
        description: 'Wymaga podania powodu moderacji',
        icon: 'i-lucide-eye-off',
        color: 'error',
        disabled: props.busy,
        onSelect: () => emit('action', 'hide'),
      },
]])
</script>

<template>
  <UDropdownMenu :items="items" :content="{ align: 'end' }">
    <UButton
      color="neutral"
      variant="ghost"
      size="xs"
      square
      icon="i-lucide-ellipsis"
      :loading="busy"
      :aria-label="`Działania moderatora dla ${postLabel}`"
    />
  </UDropdownMenu>
</template>
