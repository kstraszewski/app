<script setup lang="ts">
import type {
  MultiformFieldOption,
  MultiformFieldValue,
  MultiformFormField,
} from '~/types/multiform'

const props = withDefaults(defineProps<{
  field: MultiformFormField
  modelValue?: MultiformFieldValue
  required?: boolean
  invalid?: boolean
}>(), {
  modelValue: '',
  required: false,
  invalid: false,
})

const emit = defineEmits<{
  'update:modelValue': [value: MultiformFieldValue]
}>()

const controlId = computed(() => `case-multiform-${props.field.key.replace(/[^a-zA-Z0-9_-]/g, '-')}`)
const fieldLabel = computed(() => props.field.collection?.label || props.field.label)
const selectItems = computed(() => (props.field.options ?? []).map(option => ({
  label: optionLabel(option),
  value: optionValue(option),
})))
const errorMessage = computed(() => props.invalid ? validationMessage() : undefined)

function optionLabel(option: MultiformFieldOption) {
  return typeof option === 'string' ? option : option.label
}

function optionValue(option: MultiformFieldOption) {
  return typeof option === 'string' ? option : option.value
}

function inputType() {
  const normalized = props.field.type.toLowerCase()
  if (['number', 'currency', 'integer', 'decimal'].includes(normalized)) return 'number'
  if (normalized === 'date') return 'date'
  if (normalized === 'email') return 'email'
  if (['phone', 'tel'].includes(normalized)) return 'tel'
  return 'text'
}

function inputStep() {
  if (props.field.type === 'currency') return '0.01'
  if (props.field.validation?.integer) return '1'
  return 'any'
}

function updateValue(value: unknown) {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    emit('update:modelValue', value)
  }
}

function validationMessage() {
  const value = props.modelValue
  if (props.required && (value === undefined || value === null || String(value).trim() === '')) {
    return 'To pole jest wymagane.'
  }
  if (props.field.validation?.pattern) return 'Sprawdź format tej wartości.'
  if (props.field.validation?.min !== undefined && props.field.validation?.max !== undefined) {
    return `Podaj wartość od ${props.field.validation.min} do ${props.field.validation.max}.`
  }
  if (props.field.validation?.min !== undefined) return `Minimalna wartość to ${props.field.validation.min}.`
  if (props.field.validation?.max !== undefined) return `Maksymalna wartość to ${props.field.validation.max}.`
  return 'Sprawdź podaną wartość.'
}
</script>

<template>
  <UFormField
    :name="field.key"
    :label="field.type === 'checkbox' ? undefined : fieldLabel"
    :description="field.type === 'checkbox' ? undefined : field.description"
    :required="required"
    :error="errorMessage"
    :class="{ 'case-multiform-field--wide': field.type === 'textarea' || field.type === 'checkbox' }"
  >
    <UCheckbox
      v-if="field.type === 'checkbox'"
      :id="controlId"
      :model-value="modelValue === true"
      :label="fieldLabel"
      :description="field.description"
      :aria-required="required"
      @update:model-value="updateValue(Boolean($event))"
    />
    <UTextarea
      v-else-if="field.type === 'textarea'"
      :id="controlId"
      :model-value="String(modelValue ?? '')"
      :placeholder="field.placeholder"
      :rows="3"
      autoresize
      :maxrows="8"
      class="w-full"
      @update:model-value="updateValue"
    />
    <USelect
      v-else-if="field.type === 'select' || field.type === 'radio' || field.options?.length"
      :id="controlId"
      :model-value="String(modelValue ?? '')"
      :items="selectItems"
      value-key="value"
      :placeholder="field.placeholder || 'Wybierz opcję'"
      class="w-full"
      @update:model-value="updateValue"
    />
    <UInput
      v-else
      :id="controlId"
      :model-value="String(modelValue ?? '')"
      :type="inputType()"
      :placeholder="field.placeholder"
      :min="field.validation?.min"
      :max="field.validation?.max"
      :step="inputType() === 'number' ? inputStep() : undefined"
      class="w-full"
      @update:model-value="updateValue"
    />
  </UFormField>
</template>

<style scoped>
.case-multiform-field--wide {
  grid-column: 1 / -1;
}

@media (max-width: 680px) {
  .case-multiform-field--wide {
    grid-column: auto;
  }
}
</style>
