<script setup lang="ts">
import type {
  MortgageCostBasisV2,
  MortgageCostFormulaV2,
} from '@openexpert/mortgage'

defineOptions({ name: 'MortgageCostFormulaEditor' })

const props = withDefaults(defineProps<{
  modelValue: MortgageCostFormulaV2
  namePrefix: string
  depth?: number
  maxDepth?: number
  label?: string
  removable?: boolean
}>(), {
  depth: 0,
  maxDepth: 4,
  label: 'Formuła kosztu',
  removable: false,
})

const emit = defineEmits<{
  'update:modelValue': [value: MortgageCostFormulaV2]
  remove: []
}>()

const baseFormulaKindItems = [
  { label: 'Stała kwota', value: 'fixed' },
  { label: 'Procent podstawy', value: 'percentage' },
  { label: 'Suma składników', value: 'sum' },
]
const formulaKindItems = computed(() => baseFormulaKindItems.map(item => ({
  ...item,
  disabled: item.value === 'sum' && props.depth >= props.maxDepth && props.modelValue.kind !== 'sum',
})))
const costBasisItems: Array<{ label: string, value: MortgageCostBasisV2 }> = [
  { label: 'Kwota netto', value: 'net_loan_amount' },
  { label: 'Kapitał brutto', value: 'gross_loan_amount' },
  { label: 'Limit kredytowy', value: 'facility_limit' },
  { label: 'Wartość nieruchomości', value: 'property_value' },
  { label: 'Pierwotny kapitał brutto', value: 'original_gross_principal' },
  { label: 'Saldo po wypłacie', value: 'opening_balance_after_draw' },
  { label: 'Saldo na koniec miesiąca', value: 'closing_balance' },
  { label: 'Bieżąca transza', value: 'current_disbursement' },
]
const ratePeriodItems = [
  { label: 'Za każde naliczenie', value: 'per_occurrence' },
  { label: 'Stawka roczna — proporcjonalnie', value: 'annualized' },
]

const canAddNestedSum = computed(() => props.depth < props.maxDepth)

function fixedFormula(): MortgageCostFormulaV2 {
  return { kind: 'fixed', amount: '' }
}

function percentageFormula(): MortgageCostFormulaV2 {
  return {
    kind: 'percentage',
    ratePct: '',
    basis: 'net_loan_amount',
    ratePeriod: 'per_occurrence',
  }
}

function sumFormula(): MortgageCostFormulaV2 {
  return { kind: 'sum', terms: [] }
}

function formulaForKind(kind: MortgageCostFormulaV2['kind']): MortgageCostFormulaV2 {
  if (kind === 'percentage') return percentageFormula()
  if (kind === 'sum') return sumFormula()
  return fixedFormula()
}

function setKind(value: string) {
  const kind = value as MortgageCostFormulaV2['kind']
  if (kind === props.modelValue.kind) return
  if (kind === 'sum' && !canAddNestedSum.value) return
  emit('update:modelValue', formulaForKind(kind))
}

function decimalNumber(value: string | undefined): number | undefined {
  if (value == null || value.trim() === '') return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function decimalString(value: number | undefined): string {
  return value == null || !Number.isFinite(value) ? '' : String(value)
}

function updateFixedAmount(value: number | undefined) {
  if (props.modelValue.kind !== 'fixed') return
  emit('update:modelValue', { ...props.modelValue, amount: decimalString(value) })
}

function updatePercentage(patch: Partial<Extract<MortgageCostFormulaV2, { kind: 'percentage' }>>) {
  if (props.modelValue.kind !== 'percentage') return
  emit('update:modelValue', { ...props.modelValue, ...patch })
}

function updateBasis(value: string) {
  updatePercentage({ basis: value as MortgageCostBasisV2 })
}

function updateRatePeriod(value: string) {
  updatePercentage({ ratePeriod: value as 'per_occurrence' | 'annualized' })
}

function updateOptionalAmount(key: 'minimum' | 'maximum', value: number | undefined) {
  if (props.modelValue.kind !== 'percentage') return
  const next = { ...props.modelValue }
  if (value == null || !Number.isFinite(value)) delete next[key]
  else next[key] = decimalString(value)
  emit('update:modelValue', next)
}

function addTerm(kind: MortgageCostFormulaV2['kind']) {
  if (props.modelValue.kind !== 'sum') return
  if (kind === 'sum' && !canAddNestedSum.value) return
  emit('update:modelValue', {
    ...props.modelValue,
    terms: [...props.modelValue.terms, formulaForKind(kind)],
  })
}

function updateTerm(index: number, formula: MortgageCostFormulaV2) {
  if (props.modelValue.kind !== 'sum') return
  emit('update:modelValue', {
    ...props.modelValue,
    terms: props.modelValue.terms.map((term, current) => current === index ? formula : term),
  })
}

function removeTerm(index: number) {
  if (props.modelValue.kind !== 'sum') return
  emit('update:modelValue', {
    ...props.modelValue,
    terms: props.modelValue.terms.filter((_, current) => current !== index),
  })
}
</script>

<template>
  <section class="formula-editor" :class="{ 'formula-editor--nested': depth > 0 }">
    <header class="formula-editor__header">
      <div>
        <span>{{ label }}</span>
        <small v-if="modelValue.kind === 'sum'">
          {{ modelValue.terms.length }} {{ modelValue.terms.length === 1 ? 'składnik' : 'składników' }}
        </small>
      </div>
      <UButton
        v-if="removable"
        icon="i-lucide-trash-2"
        color="error"
        variant="ghost"
        size="sm"
        square
        :aria-label="`Usuń: ${label}`"
        @click="emit('remove')"
      />
    </header>

    <UFormField :name="`${namePrefix}.kind`" label="Sposób naliczania">
      <USelect
        :model-value="modelValue.kind"
        :items="formulaKindItems"
        class="w-full"
        @update:model-value="setKind(String($event ?? 'fixed'))"
      />
    </UFormField>

    <UFormField v-if="modelValue.kind === 'fixed'" :name="`${namePrefix}.amount`" label="Kwota">
      <UInputNumber
        :model-value="decimalNumber(modelValue.amount)"
        :min="0"
        :step="1"
        :format-options="{ style: 'currency', currency: 'PLN' }"
        class="w-full"
        @update:model-value="updateFixedAmount"
      />
    </UFormField>

    <div v-else-if="modelValue.kind === 'percentage'" class="formula-editor__percentage">
      <UFormField :name="`${namePrefix}.ratePct`" label="Stawka (%)">
        <UInputNumber
          :model-value="decimalNumber(modelValue.ratePct)"
          :min="0"
          :step="0.001"
          class="w-full"
          @update:model-value="updatePercentage({ ratePct: decimalString($event) })"
        />
      </UFormField>
      <UFormField :name="`${namePrefix}.basis`" label="Podstawa">
        <USelect
          :model-value="modelValue.basis"
          :items="costBasisItems"
          class="w-full"
          @update:model-value="updateBasis(String($event ?? 'net_loan_amount'))"
        />
      </UFormField>
      <UFormField :name="`${namePrefix}.ratePeriod`" label="Interpretacja stawki">
        <USelect
          :model-value="modelValue.ratePeriod"
          :items="ratePeriodItems"
          class="w-full"
          @update:model-value="updateRatePeriod(String($event ?? 'per_occurrence'))"
        />
      </UFormField>
      <UFormField :name="`${namePrefix}.minimum`" label="Minimum" hint="Opcjonalnie">
        <UInputNumber
          :model-value="decimalNumber(modelValue.minimum)"
          :min="0"
          :format-options="{ style: 'currency', currency: 'PLN' }"
          class="w-full"
          @update:model-value="updateOptionalAmount('minimum', $event)"
        />
      </UFormField>
      <UFormField :name="`${namePrefix}.maximum`" label="Maksimum" hint="Opcjonalnie">
        <UInputNumber
          :model-value="decimalNumber(modelValue.maximum)"
          :min="0"
          :format-options="{ style: 'currency', currency: 'PLN' }"
          class="w-full"
          @update:model-value="updateOptionalAmount('maximum', $event)"
        />
      </UFormField>
    </div>

    <div v-else class="formula-editor__sum">
      <UAlert
        v-if="!modelValue.terms.length"
        color="warning"
        variant="subtle"
        icon="i-lucide-circle-help"
        title="Suma nie ma jeszcze składników"
        description="Dodaj co najmniej jedną kwotę, stawkę procentową albo kolejną sumę."
      />
      <div class="formula-editor__terms">
        <MortgageCostFormulaEditor
          v-for="(term, index) in modelValue.terms"
          :key="`${namePrefix}.terms.${index}`"
          :model-value="term"
          :name-prefix="`${namePrefix}.terms.${index}`"
          :depth="depth + 1"
          :max-depth="maxDepth"
          :label="`Składnik ${index + 1}`"
          removable
          @update:model-value="updateTerm(index, $event)"
          @remove="removeTerm(index)"
        />
      </div>
      <div class="formula-editor__actions">
        <UButton icon="i-lucide-plus" color="neutral" variant="outline" size="sm" @click="addTerm('fixed')">
          Kwota
        </UButton>
        <UButton icon="i-lucide-percent" color="neutral" variant="outline" size="sm" @click="addTerm('percentage')">
          Procent
        </UButton>
        <UButton
          icon="i-lucide-sigma"
          color="neutral"
          variant="outline"
          size="sm"
          :disabled="!canAddNestedSum"
          @click="addTerm('sum')"
        >
          Suma zagnieżdżona
        </UButton>
        <small v-if="!canAddNestedSum">Osiągnięto limit {{ maxDepth }} poziomów.</small>
      </div>
    </div>
  </section>
</template>

<style scoped>
.formula-editor { display: grid; grid-template-columns: minmax(180px, .65fr) minmax(220px, 1fr); gap: 14px; padding: 14px; border: 1px solid var(--ui-border); border-radius: var(--ui-radius); background: var(--ui-bg); }
.formula-editor--nested { border-style: dashed; background: var(--ui-bg-muted); }
.formula-editor__header { grid-column: 1 / -1; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding-bottom: 9px; border-bottom: 1px solid var(--ui-border); }
.formula-editor__header div { display: flex; align-items: baseline; gap: 8px; }
.formula-editor__header span { color: var(--ui-text-highlighted); font-size: 13px; font-weight: 700; }
.formula-editor__header small, .formula-editor__actions small { color: var(--ui-text-muted); font-size: 11px; }
.formula-editor__percentage, .formula-editor__sum { grid-column: 1 / -1; }
.formula-editor__percentage { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }
.formula-editor__sum, .formula-editor__terms { display: grid; gap: 12px; }
.formula-editor__actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
@media (max-width: 900px) {
  .formula-editor, .formula-editor__percentage { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 640px) {
  .formula-editor, .formula-editor__percentage { grid-template-columns: 1fr; }
}
</style>
