<script setup lang="ts">
import type { TimelineAnchorV2 } from '@openexpert/mortgage'

const props = defineProps<{
  modelValue: TimelineAnchorV2
  namePrefix: string
  label?: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: TimelineAnchorV2]
}>()

const anchorKindItems = [
  { label: 'Konkretny miesiąc', value: 'month' },
  { label: 'Zdarzenie w harmonogramie', value: 'event' },
]
const eventItems = [
  { label: 'Pierwsza wypłata', value: 'first_disbursement' },
  { label: 'Ostatnia wypłata', value: 'last_disbursement' },
  { label: 'Wpis hipoteki', value: 'mortgage_registered' },
]
const edgeItems = [
  { label: 'Początek miesiąca', value: 'start' },
  { label: 'Koniec miesiąca', value: 'end' },
]

const kind = computed({
  get: () => props.modelValue.kind,
  set: (value: 'month' | 'event') => {
    emit('update:modelValue', value === 'month'
      ? { kind: 'month', month: 0, edge: 'start' }
      : { kind: 'event', event: 'first_disbursement', offsetMonths: 0, edge: 'start' })
  },
})

function updateMonth(month: number | undefined) {
  if (props.modelValue.kind !== 'month') return
  emit('update:modelValue', { ...props.modelValue, month: Number(month ?? 0) })
}

function updateEvent(value: string) {
  if (props.modelValue.kind !== 'event') return
  const event = value as 'first_disbursement' | 'last_disbursement' | 'mortgage_registered'
  emit('update:modelValue', { ...props.modelValue, event })
}

function updateOffset(offsetMonths: number | undefined) {
  if (props.modelValue.kind !== 'event') return
  emit('update:modelValue', { ...props.modelValue, offsetMonths: Number(offsetMonths ?? 0) })
}

function updateEdge(value: string) {
  const edge = value as 'start' | 'end'
  emit('update:modelValue', { ...props.modelValue, edge })
}
</script>

<template>
  <fieldset class="anchor-editor">
    <legend v-if="label">{{ label }}</legend>
    <UFormField :name="`${namePrefix}.kind`" label="Punkt odniesienia">
      <USelect v-model="kind" :items="anchorKindItems" class="w-full" />
    </UFormField>
    <UFormField v-if="modelValue.kind === 'month'" :name="`${namePrefix}.month`" label="Miesiąc">
      <UInputNumber :model-value="modelValue.month" :min="0" :step="1" class="w-full" @update:model-value="updateMonth" />
    </UFormField>
    <template v-else>
      <UFormField :name="`${namePrefix}.event`" label="Zdarzenie">
        <USelect :model-value="modelValue.event" :items="eventItems" class="w-full" @update:model-value="updateEvent" />
      </UFormField>
      <UFormField :name="`${namePrefix}.offsetMonths`" label="Przesunięcie (mies.)">
        <UInputNumber :model-value="modelValue.offsetMonths ?? 0" :min="-120" :max="600" :step="1" class="w-full" @update:model-value="updateOffset" />
      </UFormField>
    </template>
    <UFormField :name="`${namePrefix}.edge`" label="Krawędź miesiąca">
      <USelect :model-value="modelValue.edge" :items="edgeItems" class="w-full" @update:model-value="updateEdge" />
    </UFormField>
  </fieldset>
</template>

<style scoped>
.anchor-editor { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; padding: 14px; border: 1px solid var(--ui-border); border-radius: var(--ui-radius); }
.anchor-editor legend { padding-inline: 6px; color: var(--ui-text-toned); font-size: 12px; font-weight: 700; }
@media (max-width: 640px) {
  .anchor-editor { grid-template-columns: 1fr; }
}
</style>
