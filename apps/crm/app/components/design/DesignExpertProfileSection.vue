<script setup lang="ts">
import {
  brandProfileCompletion,
  type ExpertBrandProfile,
} from '#shared/brand'

const props = defineProps<{
  canEdit: boolean
  materialsTo: string
  uploadingPortrait: boolean
  deletingPortrait: boolean
}>()

const emit = defineEmits<{
  uploadPortrait: [event: Event]
  removePortrait: []
}>()

const profile = defineModel<ExpertBrandProfile>({ required: true })
const portraitInput = ref<HTMLInputElement | null>(null)

const completion = computed(() => brandProfileCompletion(profile.value))
const specializationsText = computed({
  get: () => profile.value.specializations.join(', '),
  set: (value: string) => {
    profile.value.specializations = value
      .split(',')
      .map(item => item.trim())
      .filter(Boolean)
      .slice(0, 8)
  },
})

const visualStyleItems = [
  {
    label: 'Minimalny',
    value: 'minimal',
    description: 'Dużo oddechu i mocna typografia.',
  },
  {
    label: 'Redakcyjny',
    value: 'editorial',
    description: 'Ekspercki ton i wyraźna hierarchia.',
  },
  {
    label: 'Ciepły',
    value: 'warm',
    description: 'Łagodniejsze formy i relacyjny charakter.',
  },
]

function choosePortrait() {
  if (props.canEdit) portraitInput.value?.click()
}
</script>

<template>
  <section class="expert-profile">
    <div class="expert-profile__head">
      <div>
        <p>Profil eksperta</p>
        <h2>Dane używane w materiałach</h2>
        <span>
          Uzupełnij osobę, która reprezentuje markę. Nazwa, logo, kolory i typografia
          pozostają wspólnymi ustawieniami Design powyżej.
        </span>
      </div>
      <UBadge color="neutral" variant="outline">
        {{ completion.percentage }}% gotowe
      </UBadge>
    </div>

    <fieldset :disabled="!canEdit">
      <div class="expert-profile__grid">
        <UFormField label="Imię i nazwisko eksperta" name="expertName">
          <UInput
            v-model="profile.expertName"
            class="w-full"
            placeholder="Anna Nowak"
          />
        </UFormField>
        <UFormField label="Tytuł zawodowy" name="professionalTitle">
          <UInput
            v-model="profile.professionalTitle"
            class="w-full"
            placeholder="Ekspertka kredytowa"
          />
        </UFormField>
        <UFormField label="E-mail" name="email">
          <UInput
            v-model="profile.email"
            class="w-full"
            type="email"
            icon="i-lucide-mail"
            placeholder="kontakt@twojamarka.pl"
          />
        </UFormField>
        <UFormField label="Telefon" name="phone">
          <UInput
            v-model="profile.phone"
            class="w-full"
            type="tel"
            icon="i-lucide-phone"
            placeholder="+48 500 000 000"
          />
        </UFormField>
        <UFormField label="Strona internetowa" name="website">
          <UInput
            v-model="profile.website"
            class="w-full"
            type="url"
            icon="i-lucide-globe-2"
            placeholder="https://twojamarka.pl"
          />
        </UFormField>
        <UFormField label="Lokalizacja" name="location">
          <UInput
            v-model="profile.location"
            class="w-full"
            icon="i-lucide-map-pin"
            placeholder="Warszawa i online"
          />
        </UFormField>
        <UFormField
          class="expert-profile__full"
          label="Hasło komunikacyjne"
          name="tagline"
          :hint="`${profile.tagline.length}/140`"
        >
          <UInput
            v-model="profile.tagline"
            class="w-full"
            maxlength="140"
            placeholder="Spokojnie przeprowadzę Cię przez finansowanie domu."
          />
        </UFormField>
        <UFormField
          class="expert-profile__full"
          label="Bio"
          name="bio"
          :hint="`${profile.bio.length}/800`"
        >
          <UTextarea
            v-model="profile.bio"
            class="w-full"
            :rows="4"
            autoresize
            :maxrows="7"
            maxlength="800"
            placeholder="Napisz krótko, komu pomagasz i jak wygląda współpraca."
          />
        </UFormField>
        <UFormField
          class="expert-profile__full"
          label="Specjalizacje"
          name="specializations"
          description="Oddziel przecinkami; w materiałach pokażemy maksymalnie 8."
        >
          <UInput
            v-model="specializationsText"
            class="w-full"
            placeholder="Kredyty hipoteczne, refinansowanie, pierwsze mieszkanie"
          />
        </UFormField>
      </div>

      <div class="expert-profile__media">
        <div>
          <div class="expert-profile__subhead">
            <h3>Charakter materiałów</h3>
            <span>Wpływa na kompozycję wszystkich szablonów.</span>
          </div>
          <URadioGroup
            v-model="profile.visualStyle"
            :items="visualStyleItems"
          />
        </div>

        <div>
          <div class="expert-profile__subhead expert-profile__subhead--inline">
            <div>
              <h3>Zdjęcie portretowe</h3>
              <span>Opcjonalne; bez zdjęcia użyjemy neutralnego pola.</span>
            </div>
            <UBadge
              :color="profile.portraitUrl ? 'success' : 'neutral'"
              variant="subtle"
            >
              {{ profile.portraitUrl ? 'Dodane' : 'Opcjonalne' }}
            </UBadge>
          </div>

          <div class="expert-profile__portrait">
            <img
              v-if="profile.portraitUrl"
              :src="profile.portraitUrl"
              :alt="`Portret: ${profile.expertName}`"
            >
            <div v-else>
              <UIcon name="i-lucide-user-round" />
              <span>Dodaj pionowy portret na neutralnym tle.</span>
            </div>
          </div>

          <input
            ref="portraitInput"
            class="sr-only"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            aria-label="Wybierz zdjęcie portretowe"
            @change="emit('uploadPortrait', $event)"
          >
          <div class="expert-profile__asset-actions">
            <UButton
              color="neutral"
              variant="outline"
              icon="i-lucide-upload"
              :loading="uploadingPortrait"
              @click="choosePortrait"
            >
              {{ profile.portraitUrl ? 'Zmień portret' : 'Dodaj portret' }}
            </UButton>
            <UButton
              v-if="profile.portraitUrl"
              color="error"
              variant="ghost"
              icon="i-lucide-trash-2"
              square
              aria-label="Usuń portret"
              :loading="deletingPortrait"
              @click="emit('removePortrait')"
            />
          </div>
        </div>
      </div>
    </fieldset>

    <div class="expert-profile__next">
      <div>
        <strong>Design gotowy do użycia</strong>
        <span v-if="completion.missing.length">
          Profil można uzupełnić później: {{ completion.missing.slice(0, 3).join(', ') }}.
        </span>
        <span v-else>
          Profil eksperta jest kompletny. Materiały pobiorą też wspólne logo, kolory i typografię.
        </span>
      </div>
      <UButton
        :to="materialsTo"
        color="neutral"
        variant="solid"
        trailing-icon="i-lucide-arrow-right"
      >
        Twórz materiały
      </UButton>
    </div>
  </section>
</template>

<style scoped>
.expert-profile {
  display: grid;
  gap: 22px;
  padding-top: 24px;
  border-top: 1px solid var(--ui-border);
}

.expert-profile__head,
.expert-profile__subhead--inline,
.expert-profile__next,
.expert-profile__asset-actions {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.expert-profile__head > div,
.expert-profile__subhead > div,
.expert-profile__next > div {
  min-width: 0;
}

.expert-profile__head p {
  margin: 0;
  color: var(--ui-text-muted);
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: .08em;
  text-transform: uppercase;
}

.expert-profile__head h2 {
  margin: 0;
  color: var(--ui-text-highlighted);
  font-size: 22px;
}

.expert-profile__head span,
.expert-profile__subhead span,
.expert-profile__next span {
  color: var(--ui-text-muted);
  font-size: 12px;
  line-height: 1.5;
}

.expert-profile fieldset {
  display: grid;
  gap: 24px;
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
}

.expert-profile__grid,
.expert-profile__media {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}

.expert-profile__full {
  grid-column: 1 / -1;
}

.expert-profile__media > div {
  display: grid;
  align-content: start;
  gap: 14px;
  min-width: 0;
  padding: 16px;
  background: var(--ui-bg-muted);
  border: 1px solid var(--ui-border);
  border-radius: var(--oe-radius-surface);
}

.expert-profile__subhead {
  display: grid;
  gap: 3px;
}

.expert-profile__subhead h3 {
  margin: 0;
  color: var(--ui-text-highlighted);
  font-size: 14px;
}

.expert-profile__portrait {
  display: grid;
  place-items: center;
  min-height: 180px;
  overflow: hidden;
  background: var(--ui-bg);
  border: 1px dashed var(--ui-border-accented);
  border-radius: var(--oe-radius-control);
}

.expert-profile__portrait img {
  width: 100%;
  height: 220px;
  object-fit: cover;
}

.expert-profile__portrait > div {
  display: grid;
  justify-items: center;
  gap: 10px;
  padding: 20px;
  color: var(--ui-text-muted);
  text-align: center;
  font-size: 12px;
}

.expert-profile__portrait svg {
  width: 30px;
  height: 30px;
}

.expert-profile__next {
  align-items: center;
  padding: 16px;
  background: var(--ui-bg-elevated);
  border: 1px solid var(--ui-border);
  border-radius: var(--oe-radius-surface);
}

.expert-profile__next > div {
  display: grid;
  gap: 3px;
}

.expert-profile__next strong {
  color: var(--ui-text-highlighted);
  font-size: 13px;
}

@media (max-width: 720px) {
  .expert-profile__grid,
  .expert-profile__media {
    grid-template-columns: 1fr;
  }

  .expert-profile__full {
    grid-column: 1;
  }

  .expert-profile__head,
  .expert-profile__next {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
