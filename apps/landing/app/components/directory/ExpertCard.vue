<script setup lang="ts">
import type { DirectoryExpert } from '#shared/types/directory'

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
</script>

<template>
  <article :id="`ekspert-${expert.expertId}`" class="expert-card">
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
      <span>
        <Icon name="lucide:calendar-days" aria-hidden="true" />
        Wybierz dogodny termin
      </span>
      <a
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

.expert-card__footer > span {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  color: #666;
  font-size: 11px;
}

.expert-card__footer > span :deep(svg) {
  width: 15px;
  height: 15px;
}

.expert-card__footer a {
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

.expert-card__footer a:hover {
  background: #353535;
}

.expert-card__footer a :deep(svg) {
  width: 15px;
  height: 15px;
}

.expert-card__footer a:focus-visible {
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

  .expert-card__footer a {
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
