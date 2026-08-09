<script setup lang="ts">
import type { FieldOption, FieldValue, FormField } from '~/types/multiform-form'

const props = withDefaults(defineProps<{
  field: FormField
  modelValue?: FieldValue
  required?: boolean
  invalid?: boolean
  disabled?: boolean
  inputId?: string
}>(), {
  modelValue: '',
  required: false,
  invalid: false,
  disabled: false,
  inputId: undefined,
})

const emit = defineEmits<{
  'update:modelValue': [value: FieldValue]
}>()

const controlId = computed(() => props.inputId || `field-${props.field.key}`)
const fieldLabel = computed(() => (
  props.field.question
  || props.field.collection?.label
  || props.field.label
))
const fieldHelpText = computed(() => props.field.helpText || props.field.description)
const showError = computed(() => props.invalid && !props.disabled)
const describedBy = computed(() => {
  const ids = []
  if (fieldHelpText.value) ids.push(`description-${controlId.value}`)
  if (showError.value) ids.push(`error-${controlId.value}`)
  return ids.length ? ids.join(' ') : undefined
})

function optionLabel(option: FieldOption) {
  return typeof option === 'string' ? option : option.label
}

function optionValue(option: FieldOption) {
  return typeof option === 'string' ? option : option.value
}

function inputType(type: string) {
  const normalized = type.toLowerCase()
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

function updateTextValue(event: Event) {
  emit('update:modelValue', (event.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).value)
}

function updateCheckboxValue(event: Event) {
  emit('update:modelValue', (event.target as HTMLInputElement).checked)
}

function validationMessage() {
  const value = props.modelValue
  if (props.required && (value === undefined || value === null || String(value).trim() === '')) {
    return 'To pole jest wymagane.'
  }
  if (
    props.field.validation?.maxLength !== undefined
    && String(value ?? '').length > props.field.validation.maxLength
  ) {
    return `Wpisz maksymalnie ${props.field.validation.maxLength} znaków.`
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
  <div
    class="form-field"
    :class="{
      'form-field--wide': field.type === 'textarea',
      'form-field--checkbox': field.type === 'checkbox',
      'form-field--invalid': showError,
      'form-field--disabled': disabled,
    }"
  >
    <label v-if="field.type === 'checkbox'" class="checkbox-field">
      <input
        :id="controlId"
        type="checkbox"
        :checked="modelValue === true"
        :required="required"
        :disabled="disabled"
        :aria-invalid="showError || undefined"
        :aria-describedby="describedBy"
        @change="updateCheckboxValue"
      >
      <span class="checkbox-field__box" aria-hidden="true" />
      <span>
        <strong>{{ fieldLabel }}<em v-if="required"> *</em></strong>
        <small v-if="fieldHelpText" :id="`description-${controlId}`">{{ fieldHelpText }}</small>
        <small v-if="showError" :id="`error-${controlId}`" class="field-error">{{ validationMessage() }}</small>
      </span>
    </label>

    <template v-else>
      <label :for="controlId">
        {{ fieldLabel }}<span v-if="required" aria-hidden="true"> *</span>
      </label>
      <textarea
        v-if="field.type === 'textarea'"
        :id="controlId"
        rows="3"
        :value="String(modelValue ?? '')"
        :placeholder="field.placeholder"
        :maxlength="field.validation?.maxLength"
        :required="required"
        :disabled="disabled"
        :aria-invalid="showError || undefined"
        :aria-describedby="describedBy"
        @input="updateTextValue"
      />
      <select
        v-else-if="field.type === 'select' || field.type === 'radio' || field.options?.length"
        :id="controlId"
        :value="String(modelValue ?? '')"
        :required="required"
        :disabled="disabled"
        :aria-invalid="showError || undefined"
        :aria-describedby="describedBy"
        @change="updateTextValue"
      >
        <option value="" disabled>{{ field.placeholder || 'Wybierz opcję' }}</option>
        <option v-for="option in field.options" :key="optionValue(option)" :value="optionValue(option)">
          {{ optionLabel(option) }}
        </option>
      </select>
      <input
        v-else
        :id="controlId"
        :value="String(modelValue ?? '')"
        :type="inputType(field.type)"
        :placeholder="field.placeholder"
        :required="required"
        :disabled="disabled"
        :pattern="inputType(field.type) === 'text' ? field.validation?.pattern : undefined"
        :maxlength="inputType(field.type) === 'text' ? field.validation?.maxLength : undefined"
        :min="field.validation?.min"
        :max="field.validation?.max"
        :step="inputType(field.type) === 'number' ? inputStep() : undefined"
        :aria-invalid="showError || undefined"
        :aria-describedby="describedBy"
        @input="updateTextValue"
      >
      <small v-if="fieldHelpText" :id="`description-${controlId}`">{{ fieldHelpText }}</small>
      <small v-if="showError" :id="`error-${controlId}`" class="field-error">{{ validationMessage() }}</small>
    </template>
  </div>
</template>

<style scoped>
.form-field { min-width: 0; display: flex; flex-direction: column; gap: 7px; }
.form-field--wide,
.form-field--checkbox { grid-column: 1 / -1; }
.form-field > label { color: var(--fg-secondary); font-size: 12px; font-weight: 600; }
.form-field > label span { color: var(--mf-accent); }

.form-field input:not([type="checkbox"]),
.form-field select,
.form-field textarea {
  width: 100%;
  min-height: 42px;
  padding: 10px 12px;
  color: var(--fg-primary);
  background: var(--bg-default);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  outline: none;
  font: inherit;
  font-size: 14px;
  transition: border-color var(--transition-fast), box-shadow var(--transition-fast);
}

.form-field textarea { resize: vertical; line-height: 1.5; }
.form-field input:focus,
.form-field select:focus,
.form-field textarea:focus { border-color: var(--border-focus); box-shadow: 0 0 0 3px color-mix(in srgb, var(--mf-accent) 12%, transparent); }
.form-field > small { color: var(--fg-tertiary); font-size: 11px; line-height: 1.4; }
.form-field--invalid input,
.form-field--invalid select,
.form-field--invalid textarea { border-color: #dc2626; }
.form-field .field-error { color: #b91c1c; }
.form-field--disabled { opacity: .68; }
.form-field--disabled input,
.form-field--disabled select,
.form-field--disabled textarea { cursor: not-allowed; }

.checkbox-field { display: flex !important; align-items: flex-start; gap: 10px; padding: 12px; background: var(--bg-subtle); border: 1px solid var(--border-default); border-radius: var(--radius-md); cursor: pointer; }
.checkbox-field input { position: absolute; opacity: 0; pointer-events: none; }
.checkbox-field__box { width: 19px; height: 19px; flex: 0 0 auto; display: grid; place-items: center; background: var(--bg-default); border: 1px solid var(--border-strong); border-radius: 5px; }
.checkbox-field input:checked + .checkbox-field__box { background: var(--mf-accent); border-color: var(--mf-accent); box-shadow: inset 0 0 0 4px var(--mf-accent), inset 0 0 0 6px white; }
.checkbox-field input:focus-visible + .checkbox-field__box { outline: 2px solid var(--border-focus); outline-offset: 2px; }
.checkbox-field > span:last-child { display: grid; gap: 4px; }
.checkbox-field strong { font-size: 13px; }
.checkbox-field em { color: var(--mf-accent); font-style: normal; }
.checkbox-field small { color: var(--fg-tertiary); font-weight: 400; line-height: 1.45; }

@media (max-width: 640px) {
  .form-field--wide,
  .form-field--checkbox { grid-column: auto; }
}
</style>
