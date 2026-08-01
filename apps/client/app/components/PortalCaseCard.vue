<script setup lang="ts">
import type { PortalCase } from '~/types/portal'
import { isCompletedPortalCase } from '~/utils/portal-cases'
import { PORTAL_TIME_ZONE } from '~/utils/portal-date'

const props = withDefaults(defineProps<{
  caseData: PortalCase
  preview?: boolean
  compact?: boolean
}>(), {
  preview: false,
  compact: false,
})

const caseLink = computed(() => props.preview
  ? `/preview/cases/${encodeURIComponent(props.caseData.id)}`
  : `/cases/${encodeURIComponent(props.caseData.id)}`)

const currentStep = computed(() => props.caseData.steps?.find(step => step.status === 'current'))
const caseCompleted = computed(() => isCompletedPortalCase(props.caseData))

const actionLabel = computed(() => {
  if (caseCompleted.value) return 'Sprawa zakończona'
  if (props.caseData.action?.kind === 'upload_document') return 'Czeka na dokumenty'
  if (props.caseData.action?.kind === 'complete_multiform') return 'Czeka na formularz'
  if (props.caseData.action?.kind === 'wait') return 'Po stronie eksperta'
  return currentStep.value?.label || 'Sprawa w toku'
})

const updatedLabel = computed(() => {
  const date = new Date(props.caseData.updatedAt)
  if (Number.isNaN(date.getTime())) return props.caseData.updatedAt
  return new Intl.DateTimeFormat('pl-PL', {
    day: 'numeric',
    month: 'short',
    timeZone: PORTAL_TIME_ZONE,
  }).format(date)
})

const initials = computed(() => props.caseData.expert.initials
  || props.caseData.expert.name.split(/\s+/u).filter(Boolean).map(part => part[0]).slice(0, 2).join('').toUpperCase())
</script>

<template>
  <NuxtLink
    :to="caseLink"
    class="portal-case-card"
    :class="{ 'portal-case-card--compact': compact }"
  >
    <div class="portal-case-card__topline">
      <span class="portal-case-card__state">
        <i aria-hidden="true" />
        {{ actionLabel }}
      </span>
      <span>{{ caseData.progressPercent }}%</span>
    </div>

    <div class="portal-case-card__progress" aria-hidden="true">
      <span :style="{ width: `${Math.min(100, Math.max(0, caseData.progressPercent))}%` }" />
    </div>

    <div class="portal-case-card__heading">
      <div>
        <p v-if="caseData.caseNumber">{{ caseData.caseNumber }}</p>
        <h3>{{ caseData.title }}</h3>
      </div>
      <span class="portal-case-card__arrow" aria-hidden="true">
        <UIcon name="i-lucide-arrow-up-right" />
      </span>
    </div>

    <p v-if="!compact && caseData.action?.title" class="portal-case-card__action">
      {{ caseData.action.title }}
    </p>

    <div class="portal-case-card__footer">
      <span class="portal-case-card__expert">
        <i>{{ initials }}</i>
        <span>
          <small>Twój ekspert</small>
          <strong>{{ caseData.expert.name }}</strong>
        </span>
      </span>
      <span class="portal-case-card__updated">Aktualizacja {{ updatedLabel }}</span>
    </div>
  </NuxtLink>
</template>

<style scoped>
.portal-case-card {
  display: grid;
  gap: 17px;
  min-width: 0;
  padding: 24px;
  border: 1px solid var(--portal-line);
  border-radius: 18px;
  background: var(--ui-bg);
  color: inherit;
  text-decoration: none;
  transition: border-color 160ms ease, box-shadow 160ms ease, transform 160ms ease;
}

.portal-case-card:hover {
  border-color: var(--ui-border-inverted);
  box-shadow: 0 14px 38px rgb(0 0 0 / 7%);
  transform: translateY(-2px);
}

.portal-case-card__topline,
.portal-case-card__heading,
.portal-case-card__footer,
.portal-case-card__expert {
  display: flex;
  align-items: center;
}

.portal-case-card__topline {
  justify-content: space-between;
  color: var(--ui-text-muted);
  font-size: 11px;
  font-weight: 650;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.portal-case-card__state {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.portal-case-card__state i {
  width: 7px;
  height: 7px;
  border-radius: 999px;
  background: var(--ui-bg-inverted);
}

.portal-case-card__progress {
  height: 4px;
  overflow: hidden;
  border-radius: 999px;
  background: var(--ui-bg-accented);
}

.portal-case-card__progress span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--ui-bg-inverted);
}

.portal-case-card__heading {
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
}

.portal-case-card__heading p,
.portal-case-card__heading h3,
.portal-case-card__action {
  margin: 0;
}

.portal-case-card__heading p {
  margin-bottom: 5px;
  color: var(--ui-text-muted);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.08em;
}

.portal-case-card__heading h3 {
  font-size: 22px;
  line-height: 1.3;
}

.portal-case-card__arrow {
  display: grid;
  flex: 0 0 auto;
  width: 38px;
  height: 38px;
  place-items: center;
  border: 1px solid var(--portal-line);
  border-radius: 999px;
  transition: background 160ms ease, color 160ms ease;
}

.portal-case-card:hover .portal-case-card__arrow {
  background: var(--ui-bg-inverted);
  color: var(--ui-text-inverted);
}

.portal-case-card__arrow svg {
  width: 17px;
  height: 17px;
}

.portal-case-card__action {
  min-height: 42px;
  color: var(--ui-text-toned);
  font-size: 14px;
  line-height: 1.5;
}

.portal-case-card__footer {
  justify-content: space-between;
  gap: 18px;
  padding-top: 17px;
  border-top: 1px solid var(--portal-line);
}

.portal-case-card__expert {
  gap: 10px;
  min-width: 0;
}

.portal-case-card__expert > i {
  display: grid;
  flex: 0 0 auto;
  width: 34px;
  height: 34px;
  place-items: center;
  border-radius: 999px;
  background: var(--ui-bg-elevated);
  color: var(--ui-text-highlighted);
  font-size: 10px;
  font-style: normal;
  font-weight: 700;
}

.portal-case-card__expert > span {
  display: grid;
  min-width: 0;
}

.portal-case-card__expert small,
.portal-case-card__updated {
  color: var(--ui-text-muted);
  font-size: 11px;
}

.portal-case-card__expert strong {
  overflow: hidden;
  color: var(--ui-text-highlighted);
  font-size: 13px;
  font-weight: 550;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.portal-case-card__updated {
  flex: 0 0 auto;
}

.portal-case-card--compact {
  gap: 14px;
  padding: 21px;
}

.portal-case-card--compact .portal-case-card__heading h3 {
  font-size: 19px;
}

@media (max-width: 540px) {
  .portal-case-card {
    gap: 15px;
    padding: 20px;
  }

  .portal-case-card__heading h3 {
    font-size: 20px;
  }

  .portal-case-card__updated {
    display: none;
  }
}
</style>
