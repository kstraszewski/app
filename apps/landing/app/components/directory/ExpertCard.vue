<script setup lang="ts">
import type { DirectoryAvailabilityDate, DirectoryExpert } from '#shared/types/directory'
import { directoryExpertPath } from '#shared/utils/directory-expert'
import { directoryBookingDateUrl } from '~/utils/directory'

const props = defineProps<{
  expert: DirectoryExpert
  bookingHref: string
}>()

const initials = computed(() => props.expert.name
  .split(/\s+/u)
  .filter(Boolean)
  .slice(0, 2)
  .map(part => part.charAt(0))
  .join('')
  .toLocaleUpperCase('pl-PL'),
)
const profileHref = computed(() => directoryExpertPath(props.expert.slug))

const availableDates = computed(() => (
  props.expert.availability?.status === 'available'
    ? props.expert.availability.dates
    : []
))

const shortDateFormatter = new Intl.DateTimeFormat('pl-PL', {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
})
const fullDateFormatter = new Intl.DateTimeFormat('pl-PL', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
})

function dateFromIso(value: string): Date {
  return new Date(`${value}T12:00:00.000Z`)
}

function shortDate(value: string): string {
  return shortDateFormatter.format(dateFromIso(value)).replace(/\.$/u, '')
}

function fullDate(value: string): string {
  return fullDateFormatter.format(dateFromIso(value))
}

function dateBookingHref(date: DirectoryAvailabilityDate): string {
  return directoryBookingDateUrl(
    props.bookingHref,
    date.serviceId,
    date.localDate,
  )
}
</script>

<template>
  <article :id="`ekspert-${expert.expertId}`" class="expert-card">
    <NuxtLink
      class="expert-card__profile-link"
      :to="profileHref"
      :aria-label="`Otwórz wizytówkę eksperta ${expert.name}`"
    />

    <header class="expert-card__header">
      <span class="expert-card__avatar" aria-hidden="true">
        <img
          v-if="expert.avatarUrl"
          :src="expert.avatarUrl"
          alt=""
          width="54"
          height="54"
        >
        <template v-else>{{ initials || 'OE' }}</template>
      </span>
      <div>
        <p>Ekspert OpenExpert</p>
        <h3>{{ expert.name }}</h3>
      </div>
    </header>

    <div class="expert-card__body">
      <div class="expert-card__location">
        <Icon name="lucide:landmark" aria-hidden="true" />
        <span>
          <strong>{{ expert.facilities[0]?.name || 'Konsultacja online' }}</strong>
          <small v-if="expert.facilities[0]?.address">{{ expert.facilities[0].address }}</small>
          <small v-else-if="expert.facilities.length > 1">
            {{ expert.facilities.length }} placówki
          </small>
        </span>
      </div>

      <div>
        <p class="expert-card__label">Zakres konsultacji</p>
        <ul v-if="expert.services.length" class="expert-card__services">
          <li v-for="service in expert.services.slice(0, 4)" :key="`${service.name}-${service.durationMinutes}`">
            {{ service.name }}
            <span v-if="service.durationMinutes">· {{ service.durationMinutes }} min</span>
          </li>
          <li v-if="expert.services.length > 4">+{{ expert.services.length - 4 }} więcej</li>
        </ul>
        <p v-else class="expert-card__fallback">Konsultacja dopasowana do Twojej sprawy.</p>
      </div>
    </div>

    <footer class="expert-card__footer">
      <div class="expert-card__availability">
        <Icon name="lucide:calendar-days" aria-hidden="true" />
        <span v-if="availableDates.length" class="expert-card__availability-copy">
          <small :id="`ekspert-${expert.expertId}-availability-label`">Najbliższe terminy</small>
          <ul
            class="expert-card__dates"
            :aria-labelledby="`ekspert-${expert.expertId}-availability-label`"
          >
            <li v-for="date in availableDates" :key="date.localDate">
              <a
                :href="dateBookingHref(date)"
                :aria-label="`Zobacz godziny u eksperta ${expert.name}: ${fullDate(date.localDate)}`"
                :title="fullDate(date.localDate)"
              >
                <time :datetime="date.localDate">{{ shortDate(date.localDate) }}</time>
              </a>
            </li>
          </ul>
        </span>
        <span v-else>Wybierz dogodny termin</span>
      </div>
      <a
        class="expert-card__cta"
        :href="bookingHref"
        :aria-label="`Umów konsultację z ekspertem ${expert.name}`"
      >
        Umów konsultację
        <Icon name="lucide:arrow-right" aria-hidden="true" />
      </a>
    </footer>
  </article>
</template>

<style scoped>
.expert-card {
  position: relative;
  display: grid;
  min-width: 0;
  grid-template-rows: auto 1fr auto;
  border: 1px solid #cfcfca;
  border-radius: 6px;
  background: #fff;
  color: #111;
  transition:
    border-color var(--transition-fast),
    transform var(--transition-fast);
}

.expert-card__profile-link {
  position: absolute;
  z-index: 1;
  border-radius: inherit;
  cursor: pointer;
  inset: 0;
}

.expert-card__profile-link:focus-visible {
  outline: 2px solid #111;
  outline-offset: 3px;
}

.expert-card:hover {
  border-color: #999;
  transform: translateY(-2px);
}

.expert-card__header {
  display: grid;
  grid-template-columns: 54px minmax(0, 1fr);
  align-items: center;
  gap: 16px;
  border-bottom: 1px solid #e2e2de;
  padding: 22px;
}

.expert-card__avatar {
  display: grid;
  width: 54px;
  height: 54px;
  place-items: center;
  border-radius: 50%;
  background: #111;
  color: #fff;
  font-size: 15px;
  font-weight: 600;
  letter-spacing: 0.05em;
}

.expert-card__avatar img {
  width: 100%;
  height: 100%;
  border-radius: inherit;
  object-fit: cover;
}

.expert-card__header p,
.expert-card__label {
  color: #666;
  font-family: var(--font-mono);
  font-size: 9px;
  letter-spacing: 0.09em;
  text-transform: uppercase;
}

.expert-card__header h3 {
  margin-top: 4px;
  font-size: 21px;
  font-weight: 500;
  letter-spacing: -0.025em;
  line-height: 1.2;
}

.expert-card__body {
  display: grid;
  align-content: start;
  gap: 24px;
  padding: 22px;
}

.expert-card__location {
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr);
  align-items: start;
  gap: 12px;
}

.expert-card__location > :deep(svg) {
  width: 34px;
  height: 34px;
  border: 1px solid #d4d4cf;
  border-radius: 4px;
  padding: 8px;
}

.expert-card__location span,
.expert-card__location strong,
.expert-card__location small {
  display: block;
}

.expert-card__location strong {
  font-size: 14px;
  font-weight: 600;
}

.expert-card__location small {
  margin-top: 4px;
  color: #666;
  font-size: 12px;
  line-height: 1.4;
}

.expert-card__label {
  margin-bottom: 10px;
}

.expert-card__services {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
  list-style: none;
}

.expert-card__services li {
  border: 1px solid #d6d6d1;
  border-radius: 999px;
  padding: 6px 9px;
  background: #f7f7f5;
  color: #444;
  font-size: 11px;
}

.expert-card__services span {
  color: #666;
}

.expert-card__fallback {
  color: #666;
  font-size: 13px;
  line-height: 1.5;
}

.expert-card__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  border-top: 1px solid #e2e2de;
  padding: 16px 22px;
}

.expert-card__availability {
  display: grid;
  min-width: 0;
  grid-template-columns: 15px minmax(0, 1fr);
  align-items: center;
  gap: 7px;
  color: #666;
  font-size: 11px;
}

.expert-card__availability :deep(svg) {
  width: 15px;
  height: 15px;
}

.expert-card__availability-copy {
  display: grid;
  min-width: 0;
  gap: 2px;
}

.expert-card__availability-copy small {
  color: #777;
  font-family: var(--font-mono);
  font-size: 8px;
  letter-spacing: 0.07em;
  line-height: 1.2;
  text-transform: uppercase;
}

.expert-card__dates {
  display: flex;
  min-width: 0;
  flex-wrap: wrap;
  align-items: center;
  gap: 0 6px;
  margin: 0;
  padding: 0;
  color: #222;
  font-size: 11px;
  font-weight: 600;
  line-height: 1.35;
  list-style: none;
}

.expert-card__dates li {
  white-space: nowrap;
}

.expert-card__dates li + li::before {
  margin-right: 6px;
  color: #aaa;
  content: '·';
}

.expert-card__dates a {
  position: relative;
  z-index: 2;
  display: inline-flex;
  align-items: center;
  border-radius: 3px;
  margin: -2px -3px;
  padding: 2px 3px;
  color: inherit;
  text-decoration: none;
  transition:
    background-color var(--transition-fast),
    color var(--transition-fast);
}

.expert-card__dates a:hover {
  background: #ecece8;
  color: #000;
}

.expert-card__dates a:focus-visible {
  outline: 2px solid #111;
  outline-offset: 2px;
}

.expert-card__cta {
  position: relative;
  z-index: 2;
  display: inline-flex;
  min-height: 42px;
  align-items: center;
  gap: 9px;
  border-radius: 4px;
  padding: 10px 13px;
  background: #111;
  color: #fff;
  font-size: 12px;
  font-weight: 600;
  text-decoration: none;
  transition: background-color var(--transition-fast);
}

.expert-card__cta:hover {
  background: #353535;
}

.expert-card__cta :deep(svg) {
  width: 15px;
  height: 15px;
}

.expert-card__cta:focus-visible {
  outline: 2px solid #111;
  outline-offset: 3px;
}

@media (max-width: 480px) {
  .expert-card__header,
  .expert-card__body {
    padding: 18px;
  }

  .expert-card__footer {
    align-items: stretch;
    padding: 16px 18px;
    flex-direction: column;
  }

  .expert-card__cta {
    justify-content: center;
  }
}

@media (prefers-reduced-motion: reduce) {
  .expert-card {
    transition: none;
  }

  .expert-card:hover {
    transform: none;
  }
}
</style>
