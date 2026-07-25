<script setup lang="ts">
import type { DirectoryFacility } from '#shared/types/directory'

const props = defineProps<{
  facility: DirectoryFacility
  bookingHref: string
}>()

const coverImageSource = ref<string | null>(
  props.facility.coverImage?.thumbnailUrl ?? null,
)
const fallbackAttempted = ref(false)

watch(
  () => props.facility.coverImage,
  (coverImage) => {
    coverImageSource.value = coverImage?.thumbnailUrl ?? null
    fallbackAttempted.value = false
  },
)

function handleCoverImageError() {
  const fallbackUrl = props.facility.coverImage?.fallbackUrl
  if (
    !fallbackAttempted.value
    && fallbackUrl
    && fallbackUrl !== coverImageSource.value
  ) {
    fallbackAttempted.value = true
    coverImageSource.value = fallbackUrl
    return
  }

  coverImageSource.value = null
}
</script>

<template>
  <article :id="`placowka-${facility.facilityId}`" class="facility-card">
    <div class="facility-card__media">
      <img
        v-if="coverImageSource && facility.coverImage"
        :src="coverImageSource"
        :alt="facility.coverImage.alt"
        width="720"
        height="405"
        loading="lazy"
        decoding="async"
        @error="handleCoverImageError"
      >
      <span v-else class="facility-card__media-placeholder" aria-hidden="true">
        <Icon name="lucide:landmark" />
      </span>
    </div>

    <header class="facility-card__header">
      <div>
        <p>Placówka OpenExpert</p>
        <h3>{{ facility.name }}</h3>
      </div>
    </header>

    <div class="facility-card__body">
      <dl class="facility-card__details">
        <div>
          <dt>Adres</dt>
          <dd>{{ facility.address || 'Konsultacje online i po wcześniejszym umówieniu' }}</dd>
        </div>
        <div>
          <dt>Eksperci</dt>
          <dd>
            <template v-if="facility.experts.length">
              {{ facility.experts.slice(0, 3).map(expert => expert.name).join(', ') }}
              <span v-if="facility.experts.length > 3">
                +{{ facility.experts.length - 3 }}
              </span>
            </template>
            <template v-else>Najbliższy dostępny ekspert</template>
          </dd>
        </div>
      </dl>

      <div>
        <p class="facility-card__label">Dostępne konsultacje</p>
        <ul v-if="facility.services.length" class="facility-card__services">
          <li v-for="service in facility.services.slice(0, 4)" :key="`${service.name}-${service.durationMinutes}`">
            {{ service.name }}
            <span v-if="service.durationMinutes">· {{ service.durationMinutes }} min</span>
          </li>
          <li v-if="facility.services.length > 4">+{{ facility.services.length - 4 }} więcej</li>
        </ul>
        <p v-else class="facility-card__fallback">Zakres konsultacji zobaczysz podczas rezerwacji.</p>
      </div>
    </div>

    <footer class="facility-card__footer">
      <span>
        <Icon name="lucide:users-round" aria-hidden="true" />
        {{ facility.experts.length }}
        {{ facility.experts.length === 1 ? 'ekspert' : 'ekspertów' }}
      </span>
      <a
        :href="bookingHref"
        :aria-label="`Umów konsultację w placówce ${facility.name}`"
      >
        Zobacz terminy
        <Icon name="lucide:arrow-right" aria-hidden="true" />
      </a>
    </footer>
  </article>
</template>

<style scoped>
.facility-card {
  display: grid;
  overflow: hidden;
  min-width: 0;
  grid-template-rows: auto auto 1fr auto;
  border: 1px solid #cfcfca;
  border-radius: 6px;
  background: #fff;
  color: #111;
  transition:
    border-color var(--transition-fast),
    transform var(--transition-fast);
}

.facility-card:hover {
  border-color: #999;
  transform: translateY(-2px);
}

.facility-card__media {
  position: relative;
  display: grid;
  overflow: hidden;
  aspect-ratio: 16 / 9;
  place-items: center;
  border-bottom: 1px solid #e2e2de;
  background: #efefec;
}

.facility-card__media img {
  position: absolute;
  inset: 0;
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.facility-card__media-placeholder {
  display: grid;
  width: 54px;
  height: 54px;
  place-items: center;
  border-radius: 5px;
  background: #111;
  color: #fff;
}

.facility-card__media-placeholder :deep(svg) {
  width: 22px;
  height: 22px;
}

.facility-card__header {
  border-bottom: 1px solid #e2e2de;
  padding: 22px;
}

.facility-card__header p,
.facility-card__label,
.facility-card dt {
  color: #666;
  font-family: var(--font-mono);
  font-size: 9px;
  letter-spacing: 0.09em;
  text-transform: uppercase;
}

.facility-card__header h3 {
  margin-top: 4px;
  font-size: 21px;
  font-weight: 500;
  letter-spacing: -0.025em;
  line-height: 1.2;
}

.facility-card__body {
  display: grid;
  align-content: start;
  gap: 24px;
  padding: 22px;
}

.facility-card__details {
  display: grid;
  gap: 14px;
}

.facility-card__details div {
  display: grid;
  gap: 5px;
}

.facility-card dd {
  color: #444;
  font-size: 13px;
  line-height: 1.5;
}

.facility-card dd span {
  color: #666;
  white-space: nowrap;
}

.facility-card__label {
  margin-bottom: 10px;
}

.facility-card__services {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
  list-style: none;
}

.facility-card__services li {
  border: 1px solid #d6d6d1;
  border-radius: 999px;
  padding: 6px 9px;
  background: #f7f7f5;
  color: #444;
  font-size: 11px;
}

.facility-card__services span {
  color: #666;
}

.facility-card__fallback {
  color: #666;
  font-size: 13px;
  line-height: 1.5;
}

.facility-card__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  border-top: 1px solid #e2e2de;
  padding: 16px 22px;
}

.facility-card__footer > span {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  color: #666;
  font-size: 11px;
}

.facility-card__footer > span :deep(svg) {
  width: 15px;
  height: 15px;
}

.facility-card__footer a {
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

.facility-card__footer a:hover {
  background: #353535;
}

.facility-card__footer a :deep(svg) {
  width: 15px;
  height: 15px;
}

.facility-card__footer a:focus-visible {
  outline: 2px solid #111;
  outline-offset: 3px;
}

@media (max-width: 480px) {
  .facility-card__header,
  .facility-card__body {
    padding: 18px;
  }

  .facility-card__footer {
    align-items: stretch;
    padding: 16px 18px;
    flex-direction: column;
  }

  .facility-card__footer a {
    justify-content: center;
  }
}

@media (prefers-reduced-motion: reduce) {
  .facility-card {
    transition: none;
  }

  .facility-card:hover {
    transform: none;
  }
}
</style>
