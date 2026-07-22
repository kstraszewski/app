<script setup lang="ts">
import type {
  MortgageConditionFieldV2,
  MortgageConditionV2,
  MortgageFeatureV2,
} from '@openexpert/mortgage'

defineOptions({ name: 'MortgageConditionEditor' })

const props = withDefaults(defineProps<{
  modelValue: MortgageConditionV2
  namePrefix: string
  features: MortgageFeatureV2[]
  depth?: number
  maxDepth?: number
  label?: string
  removable?: boolean
}>(), {
  depth: 0,
  maxDepth: 4,
  label: 'Warunek',
  removable: false,
})

const emit = defineEmits<{
  'update:modelValue': [value: MortgageConditionV2]
  remove: []
}>()

type ConditionOperator = MortgageConditionV2['op']
type CompareCondition = Extract<MortgageConditionV2, { op: 'compare' }>
type SelectionCondition = Extract<MortgageConditionV2, { op: 'selection_is' }>

const operatorLabels: Record<ConditionOperator, string> = {
  selection_is: 'Wybrano opcję',
  compare: 'Porównanie wartości',
  all: 'Wszystkie warunki (AND)',
  any: 'Dowolny warunek (OR)',
  not: 'Negacja (NOT)',
}

const operatorDescriptions: Record<ConditionOperator, string> = {
  selection_is: 'Warunek jest spełniony, gdy w scenariuszu wybrano wskazaną opcję produktu.',
  compare: 'Porównaj parametry scenariusza, np. LTV, okres albo kwotę kredytu, z podanym progiem.',
  all: 'Reguła zadziała tylko wtedy, gdy wszystkie zagnieżdżone warunki są spełnione.',
  any: 'Reguła zadziała, gdy co najmniej jeden zagnieżdżony warunek jest spełniony.',
  not: 'Odwraca wynik zagnieżdżonego warunku.',
}

const conditionFieldItems: Array<{ label: string, value: MortgageConditionFieldV2 }> = [
  { label: 'Kwota kredytu netto', value: 'net_loan_amount' },
  { label: 'Kapitał brutto z kosztami', value: 'gross_loan_amount' },
  { label: 'Okres kredytu (miesiące)', value: 'term_months' },
  { label: 'LTV (%)', value: 'ltv_pct' },
  { label: 'Wartość nieruchomości', value: 'property_value' },
]

const comparatorItems: Array<{ label: string, value: CompareCondition['comparator'] }> = [
  { label: 'mniejsze niż (<)', value: 'lt' },
  { label: 'mniejsze lub równe (≤)', value: 'lte' },
  { label: 'równe (=)', value: 'eq' },
  { label: 'większe lub równe (≥)', value: 'gte' },
  { label: 'większe niż (>)', value: 'gt' },
]

const isComposite = (op: ConditionOperator) => op === 'all' || op === 'any' || op === 'not'
const isCurrentGroup = computed(() => props.modelValue.op === 'all' || props.modelValue.op === 'any')
const canAddChild = computed(() => props.depth < props.maxDepth)
const canAddCompositeChild = computed(() => props.depth + 1 < props.maxDepth)

const operatorItems = computed(() => (Object.keys(operatorLabels) as ConditionOperator[]).map((value) => {
  let disabled = false
  if (isComposite(value) && props.depth >= props.maxDepth && value !== props.modelValue.op) {
    disabled = !(isCurrentGroup.value && (value === 'all' || value === 'any'))
  }
  return { label: operatorLabels[value], value, disabled }
}))

const featureItems = computed(() => {
  const items = props.features.map(feature => ({ label: feature.label, value: feature.id }))
  const condition = props.modelValue
  if (condition.op === 'selection_is' && !items.some(item => item.value === condition.featureId)) {
    items.push({ label: `Nieznany warunek (${condition.featureId || 'brak kodu'})`, value: condition.featureId })
  }
  return items
})

const selectionOptionItems = computed(() => {
  const condition = props.modelValue
  if (condition.op !== 'selection_is') return []
  const feature = props.features.find(candidate => candidate.id === condition.featureId)
  const items = (feature?.options ?? []).map(option => ({ label: option.label, value: option.id }))
  if (!items.some(item => item.value === condition.optionId)) {
    items.push({ label: `Nieznana opcja (${condition.optionId || 'brak kodu'})`, value: condition.optionId })
  }
  return items
})

const currentDescription = computed(() => operatorDescriptions[props.modelValue.op])
const compareStep = computed(() => (
  props.modelValue.op === 'compare' && props.modelValue.field === 'ltv_pct' ? 0.01 : 1
))

function defaultSelectionCondition(): SelectionCondition {
  const feature = props.features[0]
  return {
    op: 'selection_is',
    featureId: feature?.id ?? '',
    optionId: feature?.options[0]?.id ?? '',
  }
}

function defaultCompareCondition(): CompareCondition {
  return {
    op: 'compare',
    field: 'net_loan_amount',
    comparator: 'gte',
    value: '',
  }
}

function defaultLeafCondition(): MortgageConditionV2 {
  return props.features.some(feature => feature.options.length)
    ? defaultSelectionCondition()
    : defaultCompareCondition()
}

function newCondition(op: ConditionOperator): MortgageConditionV2 {
  if (op === 'selection_is') return defaultSelectionCondition()
  if (op === 'compare') return defaultCompareCondition()
  if (op === 'not') return { op: 'not', condition: defaultLeafCondition() }
  return { op, conditions: [defaultLeafCondition()] }
}

function setOperator(value: string) {
  const op = value as ConditionOperator
  if (op === props.modelValue.op) return
  if (isComposite(op) && props.depth >= props.maxDepth) {
    if (!(isCurrentGroup.value && (op === 'all' || op === 'any'))) return
  }

  if ((op === 'all' || op === 'any') && (props.modelValue.op === 'all' || props.modelValue.op === 'any')) {
    emit('update:modelValue', { op, conditions: props.modelValue.conditions })
    return
  }
  if ((op === 'all' || op === 'any') && props.modelValue.op === 'not') {
    emit('update:modelValue', { op, conditions: [props.modelValue.condition] })
    return
  }
  if ((op === 'all' || op === 'any') && !isComposite(props.modelValue.op)) {
    emit('update:modelValue', { op, conditions: [props.modelValue] })
    return
  }
  if (op === 'not') {
    emit('update:modelValue', { op: 'not', condition: props.modelValue })
    return
  }
  emit('update:modelValue', newCondition(op))
}

function updateSelectionFeature(featureId: string) {
  if (props.modelValue.op !== 'selection_is') return
  const feature = props.features.find(candidate => candidate.id === featureId)
  emit('update:modelValue', {
    ...props.modelValue,
    featureId,
    optionId: feature?.options[0]?.id ?? '',
  })
}

function updateSelectionOption(optionId: string) {
  if (props.modelValue.op !== 'selection_is') return
  emit('update:modelValue', { ...props.modelValue, optionId })
}

function updateComparison(patch: Partial<CompareCondition>) {
  if (props.modelValue.op !== 'compare') return
  emit('update:modelValue', { ...props.modelValue, ...patch })
}

function decimalNumber(value: string): number | undefined {
  if (!value.trim()) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function decimalString(value: number | undefined): string {
  return value == null || !Number.isFinite(value) ? '' : String(value)
}

function addNestedCondition(op: ConditionOperator) {
  if (!canAddChild.value || props.modelValue.op === 'selection_is' || props.modelValue.op === 'compare' || props.modelValue.op === 'not') return
  if (isComposite(op) && !canAddCompositeChild.value) return
  emit('update:modelValue', {
    ...props.modelValue,
    conditions: [...props.modelValue.conditions, newCondition(op)],
  })
}

function updateNestedCondition(index: number, condition: MortgageConditionV2) {
  if (props.modelValue.op !== 'all' && props.modelValue.op !== 'any') return
  emit('update:modelValue', {
    ...props.modelValue,
    conditions: props.modelValue.conditions.map((current, currentIndex) => currentIndex === index ? condition : current),
  })
}

function removeNestedCondition(index: number) {
  if (props.modelValue.op !== 'all' && props.modelValue.op !== 'any') return
  emit('update:modelValue', {
    ...props.modelValue,
    conditions: props.modelValue.conditions.filter((_, currentIndex) => currentIndex !== index),
  })
}

function updateNegatedCondition(condition: MortgageConditionV2) {
  if (props.modelValue.op !== 'not') return
  emit('update:modelValue', { ...props.modelValue, condition })
}
</script>

<template>
  <section class="condition-editor" :class="{ 'condition-editor--nested': depth > 0 }">
    <header class="condition-editor__header">
      <div>
        <span>{{ label }}</span>
        <small>{{ currentDescription }}</small>
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

    <UFormField :name="`${namePrefix}.op`" label="Rodzaj warunku">
      <USelect
        :model-value="modelValue.op"
        :items="operatorItems"
        class="w-full"
        @update:model-value="setOperator(String($event ?? 'selection_is'))"
      />
    </UFormField>

    <div v-if="modelValue.op === 'selection_is'" class="condition-editor__fields condition-editor__fields--2">
      <UFormField :name="`${namePrefix}.featureId`" label="Warunek / produkt">
        <USelect
          :model-value="modelValue.featureId"
          :items="featureItems"
          placeholder="Wybierz warunek"
          class="w-full"
          @update:model-value="updateSelectionFeature(String($event ?? ''))"
        />
      </UFormField>
      <UFormField :name="`${namePrefix}.optionId`" label="Wybrana opcja">
        <USelect
          :model-value="modelValue.optionId"
          :items="selectionOptionItems"
          placeholder="Wybierz opcję"
          class="w-full"
          @update:model-value="updateSelectionOption(String($event ?? ''))"
        />
      </UFormField>
    </div>

    <div v-else-if="modelValue.op === 'compare'" class="condition-editor__fields condition-editor__fields--3">
      <UFormField :name="`${namePrefix}.field`" label="Parametr scenariusza">
        <USelect
          :model-value="modelValue.field"
          :items="conditionFieldItems"
          class="w-full"
          @update:model-value="updateComparison({ field: String($event ?? 'net_loan_amount') as MortgageConditionFieldV2 })"
        />
      </UFormField>
      <UFormField :name="`${namePrefix}.comparator`" label="Operator">
        <USelect
          :model-value="modelValue.comparator"
          :items="comparatorItems"
          class="w-full"
          @update:model-value="updateComparison({ comparator: String($event ?? 'gte') as CompareCondition['comparator'] })"
        />
      </UFormField>
      <UFormField :name="`${namePrefix}.value`" label="Wartość graniczna">
        <UInputNumber
          :model-value="decimalNumber(modelValue.value)"
          :min="0"
          :step="compareStep"
          class="w-full"
          @update:model-value="updateComparison({ value: decimalString($event) })"
        />
      </UFormField>
    </div>

    <div v-else-if="modelValue.op === 'all' || modelValue.op === 'any'" class="condition-editor__group">
      <UAlert
        v-if="!modelValue.conditions.length"
        color="warning"
        variant="subtle"
        icon="i-lucide-circle-help"
        title="Grupa nie ma warunków"
        description="Dodaj co najmniej jeden warunek, aby reguła była jednoznaczna."
      />
      <div class="condition-editor__children">
        <MortgageConditionEditor
          v-for="(condition, index) in modelValue.conditions"
          :key="`${namePrefix}.conditions.${index}`"
          :model-value="condition"
          :name-prefix="`${namePrefix}.conditions.${index}`"
          :features="features"
          :depth="depth + 1"
          :max-depth="maxDepth"
          :label="`Warunek ${index + 1}`"
          removable
          @update:model-value="updateNestedCondition(index, $event)"
          @remove="removeNestedCondition(index)"
        />
      </div>
      <div class="condition-editor__actions">
        <UButton icon="i-lucide-list-checks" color="neutral" variant="outline" size="sm" :disabled="!canAddChild" @click="addNestedCondition('selection_is')">
          Wybór opcji
        </UButton>
        <UButton icon="i-lucide-git-compare" color="neutral" variant="outline" size="sm" :disabled="!canAddChild" @click="addNestedCondition('compare')">
          Porównanie
        </UButton>
        <UButton icon="i-lucide-list-tree" color="neutral" variant="outline" size="sm" :disabled="!canAddCompositeChild" @click="addNestedCondition('all')">
          Grupa AND
        </UButton>
        <UButton icon="i-lucide-list-tree" color="neutral" variant="outline" size="sm" :disabled="!canAddCompositeChild" @click="addNestedCondition('any')">
          Grupa OR
        </UButton>
        <UButton icon="i-lucide-circle-slash-2" color="neutral" variant="outline" size="sm" :disabled="!canAddCompositeChild" @click="addNestedCondition('not')">
          Negacja
        </UButton>
        <small v-if="!canAddChild">Osiągnięto limit {{ maxDepth }} poziomów. Istniejące głębsze warunki pozostają edytowalne.</small>
      </div>
    </div>

    <div v-else-if="modelValue.op === 'not'" class="condition-editor__group">
      <MortgageConditionEditor
        :model-value="modelValue.condition"
        :name-prefix="`${namePrefix}.condition`"
        :features="features"
        :depth="depth + 1"
        :max-depth="maxDepth"
        label="Warunek odwracany"
        @update:model-value="updateNegatedCondition"
      />
    </div>
  </section>
</template>

<style scoped>
.condition-editor { display: grid; grid-template-columns: minmax(190px, .65fr) minmax(240px, 1fr); gap: 14px; padding: 14px; border: 1px solid var(--ui-border); border-radius: var(--ui-radius); background: var(--ui-bg); }
.condition-editor--nested { border-style: dashed; background: var(--ui-bg-muted); }
.condition-editor__header { grid-column: 1 / -1; display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding-bottom: 9px; border-bottom: 1px solid var(--ui-border); }
.condition-editor__header div { display: grid; gap: 3px; }
.condition-editor__header span { color: var(--ui-text-highlighted); font-size: 13px; font-weight: 700; }
.condition-editor__header small, .condition-editor__actions small { color: var(--ui-text-muted); font-size: 11px; }
.condition-editor__fields, .condition-editor__group { grid-column: 1 / -1; }
.condition-editor__fields { display: grid; gap: 14px; }
.condition-editor__fields--2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.condition-editor__fields--3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.condition-editor__group, .condition-editor__children { display: grid; gap: 12px; }
.condition-editor__actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
@media (max-width: 900px) {
  .condition-editor, .condition-editor__fields--3 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 640px) {
  .condition-editor, .condition-editor__fields--2, .condition-editor__fields--3 { grid-template-columns: 1fr; }
}
</style>
