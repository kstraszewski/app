<script setup lang="ts">
import { apiErrorMessage } from '~/utils/api-error'

type TemplateSummary = {
  pages: number
  fillMode: string
  fieldCount: number
  mappedFieldCount: number
  manualUserActionCount: number
  coverageStatus: string
  activationReady: boolean
  errors: number
  warnings: number
}

type TemplateReference = {
  productId: string
  productName: string
  requirementCode: string
  requirementLabel: string
  source: 'published' | 'draft'
}

type InstitutionTemplate = {
  id: string
  label: string
  bank: string
  registered: boolean
  editable: boolean
  source: null | {
    fileName: string
    sha256: string
    pageCount: number
  }
  active: {
    origin: 'catalog' | 'registry' | 'missing'
    revision: number
    publishedAt: string | null
    summary: TemplateSummary | null
  }
  draft: null | {
    revision: number
    updatedAt: string | null
    summary: TemplateSummary
  }
  references: TemplateReference[]
  referencedProductCount: number
  updatedAt: string | null
}

type TemplatesResponse = {
  schemaVersion: 1
  templates: InstitutionTemplate[]
  summary: {
    total: number
    withDraft: number
    activationReady: number
    referenced: number
  }
}

const props = defineProps<{
  organizationSlug: string
  bankId: string
}>()

const apiPath = computed(() => (
  `/api/org/${encodeURIComponent(props.organizationSlug)}/mortgages/banks/${encodeURIComponent(props.bankId)}/templates`
))
const { data, status, error, refresh } = await useFetch<TemplatesResponse>(apiPath, {
  key: `institution-pdf-templates:${props.organizationSlug}:${props.bankId}`,
})

const templates = computed(() => data.value?.templates ?? [])
const summary = computed(() => data.value?.summary ?? {
  total: 0,
  withDraft: 0,
  activationReady: 0,
  referenced: 0,
})

function editorPath(templateId: string) {
  return `/org/${encodeURIComponent(props.organizationSlug)}/settings/institutions/${encodeURIComponent(props.bankId)}/pdf-templates/${encodeURIComponent(templateId)}`
}

function coveragePercent(template: InstitutionTemplate) {
  const item = template.draft?.summary ?? template.active.summary
  if (!item?.fieldCount) return 0
  return Math.round((item.mappedFieldCount / item.fieldCount) * 100)
}

function activeLabel(template: InstitutionTemplate) {
  if (template.active.origin === 'catalog') return `Opublikowany · r${template.active.revision}`
  if (template.active.origin === 'registry') return 'Aktywny z rejestru'
  return 'Brak aktywnej wersji'
}

function activeColor(template: InstitutionTemplate): 'success' | 'neutral' | 'error' {
  if (template.active.origin === 'catalog') return 'success'
  if (template.active.origin === 'registry') return 'neutral'
  return 'error'
}

function formatDate(value: string | null) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('pl-PL', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}
</script>

<template>
  <section class="template-workspace">
    <div class="template-heading">
      <div>
        <span>Formularze instytucji</span>
        <h2>Szablony PDF i mapowania danych</h2>
        <p>
          Tutaj administrator przygotowuje Template JSON, sprawdza pokrycie pól
          i otwiera źródłowy formularz banku.
        </p>
      </div>
      <div class="template-heading__metrics" aria-label="Podsumowanie szablonów">
        <span><strong>{{ summary.total }}</strong> formularzy</span>
        <span><strong>{{ summary.withDraft }}</strong> szkiców</span>
        <span><strong>{{ summary.referenced }}</strong> używanych</span>
      </div>
    </div>

    <UAlert
      color="info"
      variant="subtle"
      icon="i-lucide-shield-check"
      title="Globalna konfiguracja instytucji"
      description="Zmiany zapisują się po stronie serwera i są audytowane. Opublikować można wyłącznie szablon z kompletnym, zatwierdzonym mapowaniem PDF."
    />

    <UAlert
      v-if="error"
      color="error"
      variant="subtle"
      icon="i-lucide-circle-alert"
      title="Nie udało się pobrać szablonów PDF"
      :description="apiErrorMessage(error)"
      :actions="[{ label: 'Ponów', onClick: () => refresh() }]"
    />

    <div v-else-if="status === 'pending' || status === 'idle'" class="template-skeletons">
      <USkeleton v-for="index in 2" :key="index" class="h-64 w-full" />
    </div>

    <div v-else-if="templates.length" class="template-list">
      <article v-for="template in templates" :key="template.id" class="template-card">
        <header class="template-card__header">
          <span class="template-card__icon">
            <UIcon name="i-lucide-file-json-2" />
          </span>
          <div class="template-card__identity">
            <div class="template-card__title">
              <div>
                <h3>{{ template.label }}</h3>
                <code>{{ template.id }}</code>
              </div>
              <div class="template-card__badges">
                <UBadge :color="activeColor(template)" variant="subtle">
                  {{ activeLabel(template) }}
                </UBadge>
                <UBadge v-if="template.draft" color="warning" variant="subtle">
                  Szkic r{{ template.draft.revision }}
                </UBadge>
                <UBadge
                  :color="(template.draft?.summary ?? template.active.summary)?.activationReady ? 'success' : 'warning'"
                  variant="outline"
                >
                  {{ (template.draft?.summary ?? template.active.summary)?.activationReady ? 'Gotowy do aktywacji' : 'Wymaga uzupełnienia' }}
                </UBadge>
              </div>
            </div>

            <div v-if="template.source" class="template-card__source">
              <span><UIcon name="i-lucide-file-text" />{{ template.source.fileName }}</span>
              <span><UIcon name="i-lucide-copy-check" />{{ template.source.pageCount }} stron</span>
              <span><UIcon name="i-lucide-fingerprint" />SHA-256 potwierdzony</span>
            </div>
          </div>
        </header>

        <div v-if="template.active.summary" class="template-card__coverage">
          <div>
            <span>Pokrycie pól klienta</span>
            <strong>
              {{ (template.draft?.summary ?? template.active.summary).mappedFieldCount }}
              /
              {{ (template.draft?.summary ?? template.active.summary).fieldCount }}
            </strong>
          </div>
          <UProgress :model-value="coveragePercent(template)" color="primary" />
          <small>{{ coveragePercent(template) }}%</small>
          <div class="template-card__facts">
            <span>{{ (template.draft?.summary ?? template.active.summary).pages }} stron</span>
            <span>{{ (template.draft?.summary ?? template.active.summary).fillMode }}</span>
            <span>{{ (template.draft?.summary ?? template.active.summary).manualUserActionCount }} ręcznych działań</span>
            <span>{{ (template.draft?.summary ?? template.active.summary).warnings }} ostrzeżeń</span>
          </div>
        </div>

        <div class="template-card__references">
          <div class="template-card__references-head">
            <div>
              <span>Powiązania z produktami</span>
              <strong>{{ template.referencedProductCount }}</strong>
            </div>
            <small v-if="template.draft">
              Szkic zapisany {{ formatDate(template.draft.updatedAt) }}
            </small>
          </div>
          <ul v-if="template.references.length">
            <li
              v-for="reference in template.references"
              :key="`${reference.source}:${reference.productId}:${reference.requirementCode}`"
            >
              <span>
                <strong>{{ reference.productName }}</strong>
                <small>{{ reference.requirementLabel }}</small>
              </span>
              <UBadge :color="reference.source === 'published' ? 'success' : 'warning'" variant="subtle">
                {{ reference.source === 'published' ? 'Opublikowany produkt' : 'Szkic produktu' }}
              </UBadge>
            </li>
          </ul>
          <p v-else>Szablon nie jest jeszcze przypisany do produktu tej instytucji.</p>
        </div>

        <footer class="template-card__footer">
          <span v-if="!template.editable" class="template-card__missing">
            <UIcon name="i-lucide-triangle-alert" />
            Brak formularza w rejestrze Multiwniosku
          </span>
          <span v-else>
            Edycja wizualna i JSON · zapis serwerowy · historia zmian
          </span>
          <UButton
            :to="editorPath(template.id)"
            icon="i-lucide-panels-top-left"
            trailing-icon="i-lucide-arrow-right"
            :disabled="!template.editable"
          >
            Otwórz edytor
          </UButton>
        </footer>
      </article>
    </div>

    <div v-else class="template-empty">
      <UIcon name="i-lucide-file-x-2" />
      <h3>Brak formularzy PDF</h3>
      <p>Ta instytucja nie ma jeszcze zarejestrowanego szablonu Multiwniosku.</p>
    </div>
  </section>
</template>

<style scoped>
.template-workspace, .template-list, .template-skeletons { display: grid; gap: 16px; min-width: 0; }
.template-heading { display: flex; align-items: flex-end; justify-content: space-between; gap: 24px; padding: 8px 2px 2px; }
.template-heading > div:first-child > span, .template-card__coverage span, .template-card__references-head > div > span { color: var(--ui-text-muted); font-family: var(--font-mono); font-size: 10px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
.template-heading h2 { margin: 5px 0 0; font-size: 25px; }
.template-heading p { max-width: 760px; margin: 5px 0 0; color: var(--ui-text-muted); font-size: 13px; }
.template-heading__metrics { display: flex; flex: 0 0 auto; gap: 8px; }
.template-heading__metrics span { display: grid; min-width: 76px; gap: 2px; padding: 10px 12px; border: 1px solid var(--ui-border); border-radius: var(--ui-radius); color: var(--ui-text-muted); background: var(--ui-bg); font-size: 10px; text-align: center; }
.template-heading__metrics strong { color: var(--ui-text-highlighted); font-size: 18px; }
.template-card { overflow: hidden; border: 1px solid var(--ui-border); border-radius: var(--ui-radius); background: var(--ui-bg); }
.template-card__header { display: flex; gap: 14px; padding: 18px; border-bottom: 1px solid var(--ui-border); }
.template-card__icon { display: grid; place-items: center; flex: 0 0 auto; width: 46px; height: 46px; border-radius: 13px; color: var(--ui-primary); background: var(--ui-bg-muted); }
.template-card__icon svg { width: 22px; height: 22px; }
.template-card__identity { flex: 1; min-width: 0; }
.template-card__title { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.template-card__title h3 { margin: 0 0 4px; font-size: 18px; }
.template-card__title code { color: var(--ui-text-muted); font-size: 11px; }
.template-card__badges, .template-card__source, .template-card__facts { display: flex; flex-wrap: wrap; gap: 7px; }
.template-card__badges { justify-content: flex-end; }
.template-card__source { margin-top: 12px; color: var(--ui-text-muted); font-size: 11px; }
.template-card__source span, .template-card__missing { display: inline-flex; align-items: center; gap: 5px; }
.template-card__coverage { display: grid; grid-template-columns: minmax(150px, .35fr) minmax(180px, 1fr) 46px; align-items: center; gap: 14px; padding: 16px 18px; border-bottom: 1px solid var(--ui-border); background: var(--ui-bg-muted); }
.template-card__coverage > div:first-child { display: grid; gap: 3px; }
.template-card__coverage > div:first-child strong { font-size: 20px; }
.template-card__coverage > small { color: var(--ui-text-muted); text-align: right; }
.template-card__facts { grid-column: 1 / -1; color: var(--ui-text-muted); font-size: 11px; }
.template-card__facts span { padding: 4px 7px; border: 1px solid var(--ui-border); border-radius: 7px; background: var(--ui-bg); font-family: inherit; font-weight: 500; letter-spacing: normal; text-transform: none; }
.template-card__references { display: grid; gap: 10px; padding: 16px 18px; }
.template-card__references-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.template-card__references-head > div { display: flex; align-items: center; gap: 8px; }
.template-card__references-head > small { color: var(--ui-text-muted); }
.template-card__references ul { display: grid; gap: 8px; margin: 0; padding: 0; list-style: none; }
.template-card__references li { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 9px 11px; border: 1px solid var(--ui-border); border-radius: calc(var(--ui-radius) * .75); }
.template-card__references li > span { display: grid; gap: 2px; min-width: 0; }
.template-card__references li strong { overflow: hidden; color: var(--ui-text-toned); font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.template-card__references li small, .template-card__references > p { color: var(--ui-text-muted); font-size: 11px; }
.template-card__references > p { margin: 0; }
.template-card__footer { display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 13px 18px; border-top: 1px solid var(--ui-border); color: var(--ui-text-muted); font-size: 11px; }
.template-card__missing { color: var(--ui-warning); }
.template-empty { display: grid; place-items: center; min-height: 260px; padding: 36px; border: 1px dashed var(--ui-border-accented); border-radius: var(--ui-radius); text-align: center; }
.template-empty > svg { width: 34px; height: 34px; margin-bottom: 10px; color: var(--ui-text-muted); }
.template-empty h3, .template-empty p { margin: 0; }
.template-empty p { margin-top: 5px; color: var(--ui-text-muted); }
@media (max-width: 900px) {
  .template-heading, .template-card__title { align-items: stretch; flex-direction: column; }
  .template-heading__metrics, .template-card__badges { justify-content: flex-start; }
  .template-card__coverage { grid-template-columns: 1fr auto; }
  .template-card__coverage > :nth-child(2) { grid-column: 1; }
  .template-card__coverage > :nth-child(3) { grid-column: 2; }
}
@media (max-width: 640px) {
  .template-heading__metrics { display: grid; grid-template-columns: repeat(3, 1fr); }
  .template-card__footer, .template-card__references li { align-items: stretch; flex-direction: column; }
  .template-card__footer :deep(.u-button) { width: 100%; justify-content: center; }
}
</style>
