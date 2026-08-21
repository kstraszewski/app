<script setup lang="ts">
import type {
  MailBankAgentContext,
  MailBankAgentResult,
  MailBankAgentStatus,
  MailContextDescriptor,
} from '#shared/types/mail'

const props = withDefaults(defineProps<{
  status: MailBankAgentStatus
  fallbackContext?: MailContextDescriptor | null
  reanalysisPending?: boolean
}>(), {
  fallbackContext: null,
  reanalysisPending: false,
})

const emit = defineEmits<{
  reanalyze: [messageId: string]
}>()

const { orgPath } = useOrganizationContext()

const headingId = computed(() => (
  `eve-analysis-${props.status.messageId.replace(/[^A-Za-z0-9_-]/gu, '-').slice(-80)}`
))
const rerunHintId = computed(() => `${headingId.value}-rerun-hint`)

const context = computed<MailBankAgentContext | null>(() => {
  if (props.status.context) return props.status.context
  const fallback = props.fallbackContext
  if (!fallback) return null
  if (fallback.type === 'case') {
    return {
      case: { id: fallback.id, label: fallback.label },
      clients: (fallback.relatedClients ?? []).map(client => ({
        id: client.id,
        label: client.label,
        isPrimary: client.isPrimary,
      })),
    }
  }
  return {
    case: null,
    clients: [{ id: fallback.id, label: fallback.label, isPrimary: true }],
  }
})

const reanalysisProcessing = computed(() => (
  props.reanalysisPending || props.status.reanalysis.state === 'processing'
))
const initialAnalysisProcessing = computed(() => props.status.state === 'processing')
const analysisProcessing = computed(() => (
  initialAnalysisProcessing.value || reanalysisProcessing.value
))
const reanalysisFailed = computed(() => props.status.reanalysis.state === 'failed')
const currentResult = computed(() => (
  props.status.reanalysis.state === 'completed' && props.status.reanalysis.result
    ? props.status.reanalysis.result
    : props.status.result
))
const reanalysisCaseConflict = computed(() => {
  const advisory = props.status.reanalysis.result
  const linkedCaseId = props.status.link?.state === 'linked'
    ? props.status.link.caseId
    : context.value?.case?.id
  return Boolean(
    advisory?.code === 'proposal_created'
    && advisory.caseId
    && linkedCaseId
    && advisory.caseId !== linkedCaseId,
  )
})
const canonicalLinkConflict = computed(() => (
  props.status.link?.state === 'conflict'
  || props.status.link?.resolutionCode === 'thread_linked_to_other_context'
))
const canRequestReanalysis = computed(() => (
  !analysisProcessing.value
  && props.status.reanalysis.canRerun
))
const resultSignals = computed(() => {
  const result = currentResult.value
  if (!result) return { items: [], remaining: 0 }
  const labels = [...new Set([
    ...result.contradictionCodes.map(code => signalLabel(code)),
    ...result.evidenceCodes.map(code => signalLabel(code)),
    ...result.reasonCodes.map(code => signalLabel(code)),
  ].filter(Boolean))]
  return {
    items: labels.slice(0, 8),
    remaining: Math.max(0, labels.length - 8),
  }
})

const statusPresentation = computed(() => {
  if (reanalysisProcessing.value) {
    return {
      color: 'info' as const,
      icon: 'i-lucide-loader-circle',
      label: 'Analizuje ponownie',
    }
  }
  if (initialAnalysisProcessing.value) {
    return {
      color: 'info' as const,
      icon: 'i-lucide-loader-circle',
      label: 'Eve analizuje',
    }
  }
  if (reanalysisFailed.value) {
    return {
      color: 'error' as const,
      icon: 'i-lucide-circle-alert',
      label: 'Ponowna analiza nieudana',
    }
  }
  if (currentResult.value?.code === 'security_rejected') {
    return {
      color: 'error' as const,
      icon: 'i-lucide-shield-alert',
      label: 'Nadawca odrzucony',
    }
  }
  if (
    currentResult.value?.code === 'processing_failed'
    || (
      props.status.reanalysis.state !== 'completed'
      && props.status.state === 'failed'
    )
  ) {
    return {
      color: 'error' as const,
      icon: 'i-lucide-circle-alert',
      label: 'Analiza nieudana',
    }
  }
  if (props.status.reanalysis.state === 'completed') {
    return {
      color: 'success' as const,
      icon: 'i-lucide-circle-check',
      label: 'Ponowna analiza zakończona',
    }
  }
  if (props.status.state === 'review_required') {
    return {
      color: 'warning' as const,
      icon: 'i-lucide-user-check',
      label: 'Wymaga weryfikacji',
    }
  }
  return {
    color: 'success' as const,
    icon: 'i-lucide-circle-check',
    label: 'Analiza zakończona',
  }
})

const reanalysisTitle = computed(() => {
  if (canRequestReanalysis.value) return 'Uruchom nową, doradczą analizę tej wiadomości'
  if (reanalysisProcessing.value) return 'Eve analizuje teraz tę wiadomość.'
  const seconds = props.status.reanalysis.retryAfterSeconds
  if (seconds > 0) return `Ponowna analiza będzie dostępna za ${seconds} s.`
  return 'Ponowna analiza jest chwilowo niedostępna.'
})
const reanalysisAvailabilityHint = computed(() => {
  const seconds = props.status.reanalysis.retryAfterSeconds
  if (seconds > 0) return `Ponowna analiza będzie dostępna za ${seconds} s.`
  if (initialAnalysisProcessing.value) {
    return 'Ponowna analiza będzie dostępna po zakończeniu pierwszej analizy.'
  }
  return 'Ponowna analiza jest chwilowo niedostępna.'
})

function resultSummary(result: MailBankAgentResult | null, advisory = false): string {
  if (!result) {
    return analysisProcessing.value
      ? reanalysisProcessing.value
        ? 'Eve ponownie sprawdza wiadomość i porównuje ją z danymi spraw.'
        : 'Eve sprawdza wiadomość i porównuje ją z danymi spraw.'
      : 'Szczegółowy wynik nie jest jeszcze dostępny.'
  }
  const linkedCase = context.value?.case
  const caseLabel = result.caseId && linkedCase?.id === result.caseId
    ? linkedCase.label
    : null
  if (result.code === 'proposal_created') {
    const target = caseLabel ? ` ze sprawą „${caseLabel}”` : ' ze sprawą w CRM'
    if (advisory) {
      return result.classification === 'strong_candidate'
        ? `Doradczy wynik Eve wskazuje jednoznaczne dopasowanie${target}. Istniejące powiązania nie zostały zmienione; wynik wymaga ręcznej weryfikacji.`
        : `Doradczy wynik Eve wskazuje możliwe dopasowanie${target}, ale sygnały wymagają ręcznej oceny. Istniejące powiązania nie zostały zmienione.`
    }
    return result.classification === 'strong_candidate'
      ? `Eve znalazła jednoznaczne dopasowanie${target}. Wątek pozostaje oznaczony do weryfikacji przez człowieka.`
      : `Eve znalazła możliwe dopasowanie${target}, ale sygnały wymagają ręcznej oceny.`
  }
  if (result.code === 'no_match') {
    return 'Eve nie znalazła sprawy, którą można bezpiecznie wskazać na podstawie tej wiadomości.'
  }
  if (result.code === 'needs_human_selection') {
    return 'Eve znalazła kilka możliwych dopasowań albo niejednoznaczne sygnały. Wybór sprawy wymaga człowieka.'
  }
  if (result.code === 'not_bank_mail') {
    return 'Eve oceniła, że ta wiadomość nie jest korespondencją bankową obsługiwaną przez ten mechanizm.'
  }
  if (result.code === 'security_rejected') {
    return 'Eve przerwała analizę, ponieważ zaufana warstwa bezpieczeństwa nie potwierdziła nadawcy.'
  }
  return 'Eve nie ukończyła analizy. Istniejące powiązania nie zostały zmienione.'
}

function signalLabel(code: string): string {
  const labels: Record<string, string> = {
    trusted_bank_identity: 'Zaufany nadawca bankowy',
    unknown_bank_identity: 'Nieznany nadawca bankowy',
    bank_identity_mismatch: 'Niezgodna tożsamość banku',
    bank_application_reference: 'Zgodny numer wniosku',
    applicant_identity: 'Zgodni wnioskodawcy',
    expert_identity: 'Zgodny ekspert',
    bank_identity: 'Zgodny bank',
    case_context: 'Zgodny kontekst sprawy',
    application_status: 'Właściwy status wniosku',
    attachment_metadata: 'Zgodne dane załącznika',
    multiple_candidates: 'Kilka możliwych spraw',
    bank_mismatch: 'Inny bank',
    reference_mismatch: 'Inny numer wniosku',
    owner_mismatch: 'Niezgodny właściciel sprawy',
    stale_application: 'Nieaktualny wniosek',
    weak_evidence: 'Za mało jednoznacznych danych',
    attachment_unavailable: 'Załącznik niedostępny',
    prompt_injection_suspected: 'Podejrzane instrukcje w treści',
    no_candidate: 'Brak pasującej sprawy',
    no_matching_signal: 'Brak sygnałów dopasowania',
    not_bank_message: 'To nie jest wiadomość bankowa',
    human_review_required: 'Weryfikacja człowieka',
    policy_requires_review: 'Polityka wymaga weryfikacji',
    authentication_failed: 'Nadawca niepotwierdzony',
    authentication_indeterminate: 'Niepełne uwierzytelnienie',
    authentication_policy_invalid: 'Nieprawidłowa polityka uwierzytelnienia',
    dmarc_not_aligned: 'Brak zgodności DMARC',
    dkim_not_aligned: 'Brak zgodności DKIM',
    reply_to_mismatch: 'Inny adres odpowiedzi',
    unsafe_attachment: 'Niebezpieczny załącznik',
    processing_error: 'Błąd przetwarzania',
  }
  return labels[code] ?? ''
}

function formatCompletedAt(value: string | null | undefined): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('pl-PL', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}
</script>

<template>
  <section
    class="mail-eve-analysis"
    :aria-labelledby="headingId"
    :aria-busy="analysisProcessing"
  >
    <header class="mail-eve-analysis__header">
      <div class="mail-eve-analysis__title">
        <span class="mail-eve-analysis__mark" aria-hidden="true">
          <UIcon name="i-lucide-sparkles" />
        </span>
        <div>
          <p>Analiza wiadomości</p>
          <h3 :id="headingId">Wynik analizy Eve</h3>
        </div>
      </div>
      <UBadge
        :color="statusPresentation.color"
        variant="subtle"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        <UIcon
          :name="statusPresentation.icon"
          :class="{ 'animate-spin': analysisProcessing }"
          aria-hidden="true"
        />
        {{ statusPresentation.label }}
      </UBadge>
    </header>

    <div class="mail-eve-analysis__body">
      <div class="mail-eve-analysis__answer">
        <span>Odpowiedź Eve</span>
        <p>{{ resultSummary(currentResult, status.reanalysis.state === 'completed') }}</p>
      </div>

      <p
        v-if="status.reanalysis.state === 'completed'"
        class="mail-eve-analysis__history-note"
      >
        To doradczy wynik ponownej analizy. Pierwotny wynik i istniejące powiązania pozostały bez zmian.
      </p>

      <UAlert
        v-if="reanalysisFailed"
        color="error"
        variant="subtle"
        icon="i-lucide-circle-alert"
        title="Ponowna analiza nie powiodła się"
        description="Poprzedni wynik oraz powiązanie ze sprawą pozostały bez zmian."
      />

      <UAlert
        v-else-if="reanalysisCaseConflict"
        color="warning"
        variant="subtle"
        icon="i-lucide-triangle-alert"
        title="Ponowna analiza wskazała inną sprawę"
        description="Eve nie zmieniła istniejącego powiązania. Rozbieżność wymaga ręcznej weryfikacji."
      />

      <UAlert
        v-if="canonicalLinkConflict"
        color="warning"
        variant="subtle"
        icon="i-lucide-triangle-alert"
        title="Eve wskazała inną sprawę"
        description="Wątek był już powiązany z innym kontekstem, dlatego Eve nie zmieniła istniejącego powiązania. Rozbieżność wymaga ręcznej weryfikacji."
      />

      <div v-if="context?.case || context?.clients.length" class="mail-eve-analysis__relations">
        <span>Powiązania</span>
        <div class="mail-eve-analysis__chips">
          <UButton
            v-if="context.case"
            :to="orgPath(`/cases/${context.case.id}`)"
            color="primary"
            variant="soft"
            size="xs"
            icon="i-lucide-briefcase-business"
            :aria-label="`Otwórz sprawę ${context.case.label}`"
          >
            Sprawa · {{ context.case.label }}
          </UButton>
          <UButton
            v-for="client in context.clients"
            :key="client.id"
            :to="orgPath(`/clients/${client.id}`)"
            color="neutral"
            variant="soft"
            size="xs"
            icon="i-lucide-user-round"
            :aria-label="`Otwórz klienta ${client.label}`"
          >
            Klient · {{ client.label }}
          </UButton>
        </div>
      </div>

      <div v-if="resultSignals.items.length" class="mail-eve-analysis__signals">
        <span>Dlaczego Eve tak uznała?</span>
        <div>
          <UBadge
            v-for="signal in resultSignals.items"
            :key="signal"
            color="neutral"
            variant="outline"
            size="xs"
          >
            <UIcon name="i-lucide-dot" aria-hidden="true" />
            {{ signal }}
          </UBadge>
          <UBadge
            v-if="resultSignals.remaining"
            color="neutral"
            variant="outline"
            size="xs"
            :aria-label="`${resultSignals.remaining} dodatkowych sygnałów zapisanych w wyniku`"
          >
            +{{ resultSignals.remaining }}
          </UBadge>
        </div>
      </div>
    </div>

    <footer class="mail-eve-analysis__footer">
      <span v-if="reanalysisFailed && currentResult">
        Poprzedni wynik z {{ formatCompletedAt(currentResult.completedAt) }}
      </span>
      <span v-else-if="currentResult">
        Zakończono {{ formatCompletedAt(currentResult.completedAt) }}
      </span>
      <span v-else-if="reanalysisProcessing" role="status" aria-live="polite">
        Eve analizuje wiadomość ponownie…
      </span>
      <span v-else />
      <div class="mail-eve-analysis__rerun">
        <span
          v-if="!canRequestReanalysis && !reanalysisProcessing"
          :id="rerunHintId"
          class="mail-eve-analysis__rerun-hint"
        >
          {{ reanalysisAvailabilityHint }}
        </span>
        <UButton
          color="neutral"
          variant="outline"
          size="sm"
          icon="i-lucide-rotate-ccw"
          :loading="reanalysisProcessing"
          :disabled="!canRequestReanalysis"
          :title="reanalysisTitle"
          :aria-describedby="!canRequestReanalysis && !reanalysisProcessing ? rerunHintId : undefined"
          @click="emit('reanalyze', status.messageId)"
        >
          Przeanalizuj ponownie
        </UButton>
      </div>
    </footer>
  </section>
</template>

<style scoped>
.mail-eve-analysis {
  display: grid;
  margin: 12px 16px 0;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--ui-primary) 26%, var(--ui-border));
  border-radius: var(--oe-radius-surface);
  background:
    linear-gradient(135deg, color-mix(in srgb, var(--ui-primary) 7%, transparent), transparent 48%),
    var(--ui-bg);
}

.mail-eve-analysis__header,
.mail-eve-analysis__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 13px 14px;
}

.mail-eve-analysis__header {
  border-bottom: 1px solid var(--ui-border);
}

.mail-eve-analysis__title {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 10px;
}

.mail-eve-analysis__mark {
  display: grid;
  flex: 0 0 auto;
  width: 34px;
  height: 34px;
  place-items: center;
  border-radius: 10px;
  color: var(--ui-primary);
  background: color-mix(in srgb, var(--ui-primary) 12%, var(--ui-bg));
}

.mail-eve-analysis__mark :deep(svg) {
  width: 18px;
  height: 18px;
}

.mail-eve-analysis__title p,
.mail-eve-analysis__title h3,
.mail-eve-analysis__answer p {
  margin: 0;
}

.mail-eve-analysis__title p,
.mail-eve-analysis__answer > span,
.mail-eve-analysis__relations > span,
.mail-eve-analysis__signals > span {
  color: var(--ui-text-muted);
  font-size: 10px;
  font-weight: 650;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.mail-eve-analysis__title h3 {
  color: var(--ui-text-highlighted);
  font-size: 14px;
  font-weight: 720;
}

.mail-eve-analysis__body {
  display: grid;
  gap: 13px;
  padding: 14px;
}

.mail-eve-analysis__answer {
  display: grid;
  gap: 5px;
}

.mail-eve-analysis__answer p {
  max-width: 82ch;
  color: var(--ui-text);
  font-size: 13px;
  line-height: 1.62;
}

.mail-eve-analysis__history-note {
  margin: -4px 0 0;
  color: var(--ui-text-muted);
  font-size: 11px;
}

.mail-eve-analysis__relations,
.mail-eve-analysis__signals {
  display: grid;
  gap: 7px;
}

.mail-eve-analysis__chips,
.mail-eve-analysis__signals > div {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.mail-eve-analysis__chips :deep(a),
.mail-eve-analysis__chips :deep(button) {
  min-height: 30px;
  max-width: 100%;
}

.mail-eve-analysis__chips :deep(span) {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mail-eve-analysis__footer {
  border-top: 1px solid var(--ui-border);
  color: var(--ui-text-muted);
  font-family: var(--font-mono);
  font-size: 9px;
}

.mail-eve-analysis__rerun {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
}

.mail-eve-analysis__rerun-hint {
  max-width: 34ch;
  text-align: right;
}

@media (max-width: 640px) {
  .mail-eve-analysis {
    margin: 10px 13px 0;
  }

  .mail-eve-analysis__header,
  .mail-eve-analysis__footer {
    align-items: stretch;
  }

  .mail-eve-analysis__header {
    flex-direction: column;
  }

  .mail-eve-analysis__footer {
    flex-direction: column;
  }

  .mail-eve-analysis__rerun {
    align-items: stretch;
    flex-direction: column;
  }

  .mail-eve-analysis__rerun-hint {
    max-width: none;
    text-align: left;
  }

  .mail-eve-analysis__footer :deep(button) {
    min-height: 44px;
    width: 100%;
    justify-content: center;
  }
}
</style>
