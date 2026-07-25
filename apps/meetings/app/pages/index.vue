<script setup lang="ts">
const roomName = ref('demo-room')
const participantName = ref('')
const accessCode = ref('')
const formError = ref('')

useSeoMeta({
  title: 'OpenExpert Meet — spotkania po swojemu',
  description: 'Aplikacja spotkań LiveKit z całkowicie własnym interfejsem.',
})

onMounted(() => {
  participantName.value = sessionStorage.getItem('openexpert-meetings-name') || ''
  accessCode.value = sessionStorage.getItem('openexpert-meetings-access-code') || ''
})

async function openRoom(): Promise<void> {
  formError.value = ''
  const slug = toRoomSlug(roomName.value)
  const name = normalizeParticipantName(participantName.value)

  if (!slug) {
    formError.value = 'Nazwa pokoju powinna mieć od 3 do 48 znaków.'
    return
  }
  if (!name) {
    formError.value = 'Podaj imię lub nazwę widoczną dla uczestników.'
    return
  }

  sessionStorage.setItem('openexpert-meetings-name', name)
  sessionStorage.setItem('openexpert-meetings-access-code', accessCode.value)
  await navigateTo(`/room/${encodeURIComponent(slug)}`)
}
</script>

<template>
  <main class="landing-shell">
    <nav class="landing-nav">
      <NuxtLink to="/" class="landing-brand" aria-label="OpenExpert Meet">
        <span class="brand-mark">
          <UIcon name="i-lucide-sparkles" />
        </span>
        <span>
          <strong>OpenExpert</strong>
          <small>Meet</small>
        </span>
      </NuxtLink>

      <span class="landing-nav__badge">
        <span />
        Spotkania online
      </span>
    </nav>

    <section class="landing-hero">
      <div class="landing-hero__copy">
        <span class="eyebrow">
          <UIcon name="i-lucide-layout-grid" />
          Twój produkt, Twój interfejs
        </span>
        <h1>
          Spotkania online
          <em>bez cudzego brandingu.</em>
        </h1>
        <p>
          LiveKit obsługuje transmisję, a cały wygląd i doświadczenie użytkownika
          pozostają po Twojej stronie — od poczekalni po ostatni przycisk.
        </p>

        <div class="landing-proof">
          <span>
            <UIcon name="i-lucide-video" />
            Kamera i mikrofon
          </span>
          <span>
            <UIcon name="i-lucide-monitor-up" />
            Udostępnianie ekranu
          </span>
          <span>
            <UIcon name="i-lucide-link" />
            Link dla klienta
          </span>
        </div>
      </div>

      <form class="join-card" @submit.prevent="openRoom">
        <div class="join-card__heading">
          <span class="join-card__icon">
            <UIcon name="i-lucide-camera" />
          </span>
          <div>
            <span>Spotkanie online</span>
            <h2>Dołącz do pokoju</h2>
          </div>
        </div>

        <div class="join-card__fields">
          <UFormField label="Nazwa pokoju" hint="Musi odpowiadać konfiguracji serwera">
            <UInput
              v-model="roomName"
              class="w-full"
              autocomplete="off"
              icon="i-lucide-link"
              placeholder="demo-room"
              required
            />
          </UFormField>

          <UFormField label="Jak mamy Cię podpisać?">
            <UInput
              v-model="participantName"
              class="w-full"
              autocomplete="name"
              icon="i-lucide-users"
              placeholder="np. Konrad"
              required
            />
          </UFormField>

          <UFormField label="Kod dostępu" hint="Nie pojawi się w linku">
            <UInput
              v-model="accessCode"
              class="w-full"
              type="password"
              autocomplete="off"
              icon="i-lucide-lock-keyhole"
              placeholder="Kod ustawiony na serwerze"
            />
          </UFormField>
        </div>

        <UAlert
          v-if="formError"
          color="error"
          variant="subtle"
          icon="i-lucide-circle-alert"
          :description="formError"
        />

        <UButton
          type="submit"
          color="primary"
          size="lg"
          block
          trailing-icon="i-lucide-arrow-right"
        >
          Przejdź do poczekalni
        </UButton>

        <p class="join-card__privacy">
          <UIcon name="i-lucide-shield-check" />
          Sekrety LiveKit pozostają wyłącznie na serwerze.
        </p>
      </form>
    </section>

    <section class="landing-features" aria-label="Możliwości spotkania">
      <article>
        <span>01</span>
        <h3>Custom UI</h3>
        <p>Nie korzystamy z gotowego widoku konferencji. Każdy element można przebudować.</p>
      </article>
      <article>
        <span>02</span>
        <h3>Osobny link</h3>
        <p>Klient otwiera pokój w przeglądarce, bez konta i instalowania aplikacji.</p>
      </article>
      <article>
        <span>03</span>
        <h3>Gotowe do CRM</h3>
        <p>Ten sam ekran można osadzić jako iframe albo włączyć bezpośrednio do modułu CRM.</p>
      </article>
    </section>
  </main>
</template>
