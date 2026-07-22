<script setup lang="ts">
import type { MortgageEvidenceReferenceV2 } from '@openexpert/mortgage'
import type { OfferSourceV2 } from '~/types/mortgage-offer-draft'

const props = defineProps<{
  modelValue?: MortgageEvidenceReferenceV2[]
  sources: OfferSourceV2[]
  namePrefix: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: MortgageEvidenceReferenceV2[]]
}>()

const references = computed(() => props.modelValue ?? [])
const sourceItems = computed(() => props.sources.flatMap(source => source.id
  ? [{ label: source.title || source.url || source.id, value: source.id }]
  : []))

function addReference() {
  const sourceId = sourceItems.value[0]?.value
  if (!sourceId) return
  emit('update:modelValue', [...references.value, { sourceId, locator: '', note: '' }])
}

function updateReference(index: number, patch: Partial<MortgageEvidenceReferenceV2>) {
  emit('update:modelValue', references.value.map((reference, current) => (
    current === index ? { ...reference, ...patch } : reference
  )))
}

function removeReference(index: number) {
  emit('update:modelValue', references.value.filter((_, current) => current !== index))
}
</script>

<template>
  <section class="evidence-editor">
    <div class="evidence-editor__heading">
      <div>
        <strong>Dowody źródłowe</strong>
        <small>Przypnij dokument oraz stronę, tabelę lub punkt regulaminu potwierdzający tę regułę.</small>
      </div>
      <UButton
        icon="i-lucide-link-2"
        color="neutral"
        variant="outline"
        size="sm"
        :disabled="!sourceItems.length"
        @click="addReference"
      >
        Przypnij źródło
      </UButton>
    </div>
    <UAlert
      v-if="!sourceItems.length"
      color="warning"
      variant="subtle"
      title="Najpierw dodaj źródło w sekcji Dokumenty"
    />
    <div v-for="(reference, index) in references" :key="`${reference.sourceId}-${index}`" class="evidence-editor__row">
      <UFormField :name="`${namePrefix}.${index}.sourceId`" label="Dokument">
        <USelect
          :model-value="reference.sourceId"
          :items="sourceItems"
          class="w-full"
          @update:model-value="updateReference(index, { sourceId: String($event ?? '') })"
        />
      </UFormField>
      <UFormField :name="`${namePrefix}.${index}.locator`" label="Strona / sekcja">
        <UInput
          :model-value="reference.locator"
          class="w-full"
          placeholder="np. s. 4, tabela 2"
          @update:model-value="updateReference(index, { locator: String($event ?? '') })"
        />
      </UFormField>
      <UFormField :name="`${namePrefix}.${index}.note`" label="Notatka">
        <UInput
          :model-value="reference.note"
          class="w-full"
          placeholder="Co dokładnie potwierdza"
          @update:model-value="updateReference(index, { note: String($event ?? '') })"
        />
      </UFormField>
      <UButton
        icon="i-lucide-unlink"
        square
        color="error"
        variant="ghost"
        aria-label="Usuń powiązanie ze źródłem"
        @click="removeReference(index)"
      />
    </div>
  </section>
</template>

<style scoped>
.evidence-editor { display: grid; gap: 10px; margin-top: 14px; padding-top: 14px; border-top: 1px dashed var(--ui-border); }
.evidence-editor__heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.evidence-editor__heading div { display: grid; gap: 2px; }
.evidence-editor__heading strong { font-size: 12px; }
.evidence-editor__heading small { color: var(--ui-text-muted); font-size: 11px; }
.evidence-editor__row { display: grid; grid-template-columns: minmax(180px, 1fr) minmax(130px, .7fr) minmax(180px, 1fr) auto; gap: 10px; align-items: end; }
@media (max-width: 900px) { .evidence-editor__row { grid-template-columns: 1fr; } }
</style>
