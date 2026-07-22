<script setup lang="ts">
import type { ActivePeriodV2, TimelineAnchorV2 } from '@openexpert/mortgage'
import MortgageTimelineAnchorEditor from '~/components/mortgages/MortgageTimelineAnchorEditor.vue'
import { monthAnchor } from '~/utils/mortgage-offer-draft'

const props = defineProps<{
  modelValue: ActivePeriodV2
  namePrefix: string
  fromLabel?: string
  endLabel?: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: ActivePeriodV2]
}>()

function defaultEndExclusive(): TimelineAnchorV2 {
  const from = props.modelValue.from
  if (from.kind === 'month') return monthAnchor(from.month + 60)
  return {
    kind: 'event',
    event: from.event,
    offsetMonths: (from.offsetMonths ?? 0) + 60,
    edge: 'start',
  }
}

const hasEnd = computed({
  get: () => Boolean(props.modelValue.endExclusive),
  set: (enabled: boolean) => {
    emit('update:modelValue', {
      ...props.modelValue,
      endExclusive: enabled ? props.modelValue.endExclusive ?? defaultEndExclusive() : undefined,
    })
  },
})

function updateFrom(from: TimelineAnchorV2) {
  emit('update:modelValue', { ...props.modelValue, from })
}

function updateEnd(endExclusive: TimelineAnchorV2) {
  emit('update:modelValue', { ...props.modelValue, endExclusive })
}
</script>

<template>
  <div class="period-editor">
    <MortgageTimelineAnchorEditor
      :model-value="modelValue.from"
      :name-prefix="`${namePrefix}.from`"
      :label="fromLabel ?? 'Początek okresu'"
      @update:model-value="updateFrom"
    />
    <div class="period-editor__end-switch">
      <USwitch v-model="hasEnd" label="Okres ma określony koniec" />
    </div>
    <MortgageTimelineAnchorEditor
      v-if="modelValue.endExclusive"
      :model-value="modelValue.endExclusive"
      :name-prefix="`${namePrefix}.endExclusive`"
      :label="endLabel ?? 'Koniec okresu (bez tego punktu)'"
      @update:model-value="updateEnd"
    />
  </div>
</template>

<style scoped>
.period-editor { display: grid; gap: 10px; }
.period-editor__end-switch { padding-inline: 4px; }
</style>
