<script setup lang="ts">
import type {
  BrandMaterialContent,
  BrandMaterialType,
  BrandPalette,
  ExpertBrandProfile,
} from '#shared/brand'
import {
  brandInitials,
  contrastingTextColor,
} from '#shared/brand'

const props = defineProps<{
  profile: ExpertBrandProfile
  palette: BrandPalette
  type: BrandMaterialType
  content: BrandMaterialContent
}>()

const logoFailed = ref(false)
const portraitFailed = ref(false)
const initials = computed(() => brandInitials(props.profile))
const primaryText = computed(() => contrastingTextColor(props.palette.primary))
const secondaryText = computed(() => contrastingTextColor(props.palette.secondary))
const previewStyle = computed(() => ({
  '--brand-primary': props.palette.primary,
  '--brand-secondary': props.palette.secondary,
  '--brand-bg': props.palette.background,
  '--brand-surface': props.palette.surface,
  '--brand-fg': props.palette.foreground,
  '--brand-muted': props.palette.muted,
  '--brand-on-primary': primaryText.value,
  '--brand-on-secondary': secondaryText.value,
}))
const contactLine = computed(() => (
  [props.profile.phone, props.profile.email, props.profile.website].filter(Boolean).join(' · ')
))

watch(() => props.profile.logoUrl, () => {
  logoFailed.value = false
})
watch(() => props.profile.portraitUrl, () => {
  portraitFailed.value = false
})
</script>

<template>
  <div
    class="brand-material-preview"
    :class="[`brand-material-preview--${type}`, `brand-material-preview--${profile.visualStyle}`]"
    :style="previewStyle"
    :aria-label="`Podgląd materiału: ${type}`"
  >
    <template v-if="type === 'linkedin'">
      <article class="social-card social-card--linkedin">
        <div class="social-card__accent" />
        <header class="material-brand">
          <div class="material-brand__logo">
            <img
              v-if="profile.logoUrl && !logoFailed"
              :src="profile.logoUrl"
              :alt="`Logo ${profile.brandName || profile.expertName}`"
              @error="logoFailed = true"
            >
            <span v-else aria-hidden="true">{{ initials }}</span>
          </div>
          <div>
            <strong>{{ profile.brandName || profile.expertName || 'Twoja marka' }}</strong>
            <small>{{ content.eyebrow }}</small>
          </div>
        </header>
        <div class="social-card__copy">
          <p>{{ content.eyebrow }}</p>
          <h2>{{ content.headline }}</h2>
          <div class="social-card__rule" />
          <p class="social-card__body">{{ content.body }}</p>
        </div>
        <footer class="social-card__footer">
          <span>{{ profile.expertName || profile.brandName || 'Twój ekspert' }}</span>
          <strong>{{ content.callToAction }}</strong>
        </footer>
      </article>
    </template>

    <template v-else-if="type === 'instagram'">
      <article class="social-card social-card--instagram">
        <div class="instagram-orbit instagram-orbit--one" />
        <div class="instagram-orbit instagram-orbit--two" />
        <header class="material-brand material-brand--inverse">
          <div class="material-brand__logo">
            <img
              v-if="profile.logoUrl && !logoFailed"
              :src="profile.logoUrl"
              :alt="`Logo ${profile.brandName || profile.expertName}`"
              @error="logoFailed = true"
            >
            <span v-else aria-hidden="true">{{ initials }}</span>
          </div>
          <strong>{{ profile.brandName || profile.expertName || 'Twoja marka' }}</strong>
        </header>
        <div class="instagram-copy">
          <p>{{ content.eyebrow }}</p>
          <h2>{{ content.headline }}</h2>
          <span>{{ content.body }}</span>
        </div>
        <footer>
          <span>{{ profile.website || profile.email || 'Porozmawiajmy o Twoim planie' }}</span>
          <span class="instagram-arrow"><UIcon name="i-lucide-arrow-up-right" /></span>
        </footer>
      </article>
    </template>

    <template v-else-if="type === 'story'">
      <article class="story-card">
        <img
          v-if="profile.portraitUrl && !portraitFailed"
          class="story-card__portrait"
          :src="profile.portraitUrl"
          :alt="`Portret: ${profile.expertName}`"
          @error="portraitFailed = true"
        >
        <div v-else class="story-card__portrait-placeholder">
          <UIcon name="i-lucide-user-round" />
          <span>Miejsce na portret</span>
        </div>
        <div class="story-card__overlay" />
        <header class="story-card__header">
          <div class="material-brand__logo">
            <img
              v-if="profile.logoUrl && !logoFailed"
              :src="profile.logoUrl"
              :alt="`Logo ${profile.brandName || profile.expertName}`"
              @error="logoFailed = true"
            >
            <span v-else aria-hidden="true">{{ initials }}</span>
          </div>
          <span>{{ profile.brandName || profile.expertName || 'Twoja marka' }}</span>
        </header>
        <div class="story-card__copy">
          <p>{{ content.eyebrow }}</p>
          <h2>{{ content.headline }}</h2>
          <span>{{ content.body }}</span>
          <strong>{{ content.callToAction }} <UIcon name="i-lucide-arrow-right" /></strong>
        </div>
      </article>
    </template>

    <template v-else-if="type === 'business-card'">
      <div class="business-card-stack">
        <article class="business-card business-card--front">
          <div class="material-brand__logo material-brand__logo--large">
            <img
              v-if="profile.logoUrl && !logoFailed"
              :src="profile.logoUrl"
              :alt="`Logo ${profile.brandName || profile.expertName}`"
              @error="logoFailed = true"
            >
            <span v-else aria-hidden="true">{{ initials }}</span>
          </div>
          <div>
            <strong>{{ profile.brandName || profile.expertName || 'Twoja marka' }}</strong>
            <span>{{ profile.tagline || 'Finansowanie dopasowane do Twojego planu.' }}</span>
          </div>
        </article>
        <article class="business-card business-card--back">
          <div class="business-card__identity">
            <h2>{{ content.headline }}</h2>
            <p>{{ content.eyebrow }}</p>
          </div>
          <div class="business-card__contact">
            <span v-if="profile.phone"><UIcon name="i-lucide-phone" />{{ profile.phone }}</span>
            <span v-if="profile.email"><UIcon name="i-lucide-mail" />{{ profile.email }}</span>
            <span v-if="profile.website"><UIcon name="i-lucide-globe-2" />{{ profile.website }}</span>
            <span v-if="!contactLine"><UIcon name="i-lucide-message-circle" />Uzupełnij dane kontaktowe</span>
          </div>
          <span class="business-card__specialties">{{ content.body }}</span>
        </article>
      </div>
    </template>

    <template v-else>
      <article class="one-pager">
        <header class="one-pager__header">
          <div class="one-pager__brand">
            <div class="material-brand__logo">
              <img
                v-if="profile.logoUrl && !logoFailed"
                :src="profile.logoUrl"
                :alt="`Logo ${profile.brandName || profile.expertName}`"
                @error="logoFailed = true"
              >
              <span v-else aria-hidden="true">{{ initials }}</span>
            </div>
            <span>{{ profile.brandName || profile.expertName || 'Twoja marka' }}</span>
          </div>
          <p>{{ content.eyebrow }}</p>
          <h2>{{ content.headline }}</h2>
          <span>{{ content.body }}</span>
        </header>
        <div class="one-pager__body">
          <ol>
            <li><span>01</span><div><strong>Poznaję sytuację</strong><p>Cel, budżet i priorytety są punktem wyjścia.</p></div></li>
            <li><span>02</span><div><strong>Porównuję scenariusze</strong><p>Pokazuję koszty, ryzyka i realne różnice.</p></div></li>
            <li><span>03</span><div><strong>Prowadzę proces</strong><p>Dokumenty, wniosek i kontakt z instytucją.</p></div></li>
          </ol>
          <aside>
            <img
              v-if="profile.portraitUrl && !portraitFailed"
              :src="profile.portraitUrl"
              :alt="`Portret: ${profile.expertName}`"
              @error="portraitFailed = true"
            >
            <div v-else class="one-pager__portrait-placeholder">
              <UIcon name="i-lucide-user-round" />
            </div>
            <strong>{{ profile.expertName || 'Twój ekspert' }}</strong>
            <span>{{ profile.professionalTitle }}</span>
            <p>{{ content.callToAction }}</p>
          </aside>
        </div>
        <footer>
          <span v-if="profile.phone">{{ profile.phone }}</span>
          <span v-if="profile.email">{{ profile.email }}</span>
          <span v-if="profile.website">{{ profile.website }}</span>
          <span v-if="!contactLine">Uzupełnij dane kontaktowe w Brand Core</span>
        </footer>
      </article>
    </template>
  </div>
</template>

<style scoped>
.brand-material-preview {
  width: 100%;
  min-width: 0;
  color: var(--brand-fg);
  font-family: var(--font-sans);
}

.social-card,
.story-card,
.business-card,
.one-pager {
  position: relative;
  overflow: hidden;
  border-radius: clamp(12px, var(--oe-radius-surface), 24px);
  box-shadow: 0 28px 70px rgb(15 23 42 / 16%);
}

.social-card {
  width: min(100%, 720px);
  aspect-ratio: 1;
  display: flex;
  flex-direction: column;
  margin-inline: auto;
}

.material-brand {
  display: flex;
  align-items: center;
  gap: 14px;
}

.material-brand > div:last-child {
  display: grid;
  gap: 2px;
}

.material-brand strong {
  font-size: clamp(12px, 2vw, 18px);
}

.material-brand small {
  color: var(--brand-muted);
  font-size: clamp(9px, 1.4vw, 13px);
}

.material-brand__logo {
  width: clamp(36px, 6vw, 62px);
  height: clamp(36px, 6vw, 62px);
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, currentColor 16%, transparent);
  border-radius: 50%;
  background: color-mix(in srgb, var(--brand-bg) 86%, transparent);
}

.material-brand__logo img {
  width: 76%;
  height: 76%;
  object-fit: contain;
}

.material-brand__logo span {
  font-size: clamp(11px, 2.2vw, 20px);
  font-weight: 750;
}

.social-card--linkedin {
  padding: clamp(26px, 6vw, 68px);
  background: var(--brand-bg);
}

.social-card__accent {
  position: absolute;
  top: 0;
  right: 0;
  width: 28%;
  height: 10px;
  background: var(--brand-primary);
}

.social-card__copy {
  display: grid;
  align-content: center;
  flex: 1;
  padding-block: 6%;
}

.social-card__copy > p:first-child,
.instagram-copy > p,
.story-card__copy > p,
.one-pager__header > p {
  margin: 0 0 4%;
  color: var(--brand-primary);
  font-size: clamp(9px, 1.7vw, 15px);
  font-weight: 750;
  letter-spacing: .11em;
  text-transform: uppercase;
}

.social-card__copy h2,
.instagram-copy h2,
.story-card__copy h2,
.one-pager h2 {
  margin: 0;
  font-family: var(--font-display);
  font-size: clamp(28px, 6.8vw, 66px);
  font-weight: 650;
  letter-spacing: -.045em;
  line-height: .98;
}

.social-card__rule {
  width: 18%;
  height: 5px;
  margin-block: 6%;
  border-radius: 999px;
  background: var(--brand-secondary);
}

.social-card__body {
  max-width: 88%;
  margin: 0;
  color: var(--brand-muted);
  font-size: clamp(11px, 2vw, 18px);
  line-height: 1.5;
}

.social-card__footer {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 20px;
  padding-top: 4%;
  border-top: 1px solid color-mix(in srgb, var(--brand-fg) 14%, transparent);
  font-size: clamp(9px, 1.5vw, 14px);
}

.social-card__footer strong {
  max-width: 55%;
  color: var(--brand-primary);
  text-align: right;
}

.social-card--instagram {
  justify-content: space-between;
  padding: clamp(26px, 6vw, 68px);
  color: var(--brand-on-primary);
  background: var(--brand-primary);
}

.material-brand--inverse {
  position: relative;
  z-index: 2;
}

.material-brand--inverse .material-brand__logo {
  color: var(--brand-fg);
  background: var(--brand-bg);
}

.instagram-orbit {
  position: absolute;
  border: 1px solid color-mix(in srgb, var(--brand-on-primary) 28%, transparent);
  border-radius: 50%;
}

.instagram-orbit--one {
  top: -20%;
  right: -18%;
  width: 68%;
  aspect-ratio: 1;
}

.instagram-orbit--two {
  right: -8%;
  bottom: -23%;
  width: 52%;
  aspect-ratio: 1;
  background: color-mix(in srgb, var(--brand-secondary) 65%, transparent);
}

.instagram-copy {
  position: relative;
  z-index: 2;
  display: grid;
  gap: 16px;
}

.instagram-copy > p {
  color: currentColor;
  opacity: .72;
}

.instagram-copy > span {
  max-width: 74%;
  font-size: clamp(12px, 2.4vw, 21px);
  line-height: 1.42;
}

.social-card--instagram footer {
  position: relative;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  font-size: clamp(9px, 1.6vw, 14px);
}

.instagram-arrow {
  width: clamp(34px, 5vw, 54px);
  height: clamp(34px, 5vw, 54px);
  display: grid;
  place-items: center;
  border-radius: 50%;
  color: var(--brand-on-secondary);
  background: var(--brand-secondary);
}

.story-card {
  width: min(100%, 430px);
  aspect-ratio: 9 / 16;
  margin-inline: auto;
  color: white;
  background: var(--brand-primary);
}

.story-card__portrait,
.story-card__portrait-placeholder,
.story-card__overlay {
  position: absolute;
  inset: 0;
}

.story-card__portrait {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.story-card__portrait-placeholder {
  display: grid;
  align-content: center;
  justify-items: center;
  gap: 12px;
  color: color-mix(in srgb, var(--brand-on-primary) 68%, transparent);
  background:
    radial-gradient(circle at 70% 18%, color-mix(in srgb, var(--brand-secondary) 74%, transparent), transparent 32%),
    var(--brand-primary);
}

.story-card__portrait-placeholder svg {
  width: 28%;
  height: auto;
}

.story-card__overlay {
  background: linear-gradient(180deg, rgb(0 0 0 / 12%), transparent 34%, rgb(0 0 0 / 86%));
}

.story-card__header,
.story-card__copy {
  position: absolute;
  right: 9%;
  left: 9%;
  z-index: 2;
}

.story-card__header {
  top: 5%;
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: clamp(11px, 2.4vw, 15px);
  font-weight: 700;
}

.story-card__header .material-brand__logo {
  width: 42px;
  height: 42px;
  color: var(--brand-fg);
  background: var(--brand-bg);
}

.story-card__copy {
  bottom: 7%;
}

.story-card__copy > p {
  color: white;
  opacity: .74;
}

.story-card__copy h2 {
  font-size: clamp(34px, 9vw, 58px);
}

.story-card__copy > span {
  display: block;
  margin-top: 7%;
  font-size: clamp(12px, 3vw, 17px);
  line-height: 1.5;
}

.story-card__copy > strong {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin-top: 8%;
  padding: 11px 17px;
  border-radius: 999px;
  color: var(--brand-on-secondary);
  background: var(--brand-secondary);
  font-size: 13px;
}

.business-card-stack {
  display: grid;
  gap: 24px;
  width: min(100%, 720px);
  margin-inline: auto;
}

.business-card {
  aspect-ratio: 1.545 / 1;
  padding: 8%;
}

.business-card--front {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 10%;
  color: var(--brand-on-primary);
  background: var(--brand-primary);
}

.material-brand__logo--large {
  width: clamp(58px, 12vw, 110px);
  height: clamp(58px, 12vw, 110px);
  color: var(--brand-fg);
  background: var(--brand-bg);
}

.business-card--front > div:last-child {
  display: grid;
  gap: 10px;
  text-align: right;
}

.business-card--front strong {
  font-size: clamp(18px, 4vw, 34px);
}

.business-card--front span {
  font-size: clamp(10px, 2vw, 16px);
  opacity: .72;
}

.business-card--back {
  display: grid;
  grid-template-columns: 1.1fr .9fr;
  grid-template-rows: 1fr auto;
  gap: 10%;
  color: var(--brand-fg);
  background: var(--brand-bg);
}

.business-card__identity h2 {
  margin: 0;
  font-size: clamp(22px, 4.8vw, 42px);
  line-height: 1;
}

.business-card__identity p {
  margin: 12px 0 0;
  color: var(--brand-primary);
  font-size: clamp(10px, 2vw, 16px);
}

.business-card__contact {
  display: grid;
  align-content: start;
  gap: 10px;
  font-size: clamp(9px, 1.7vw, 14px);
}

.business-card__contact span {
  display: flex;
  align-items: center;
  gap: 8px;
  overflow-wrap: anywhere;
}

.business-card__specialties {
  grid-column: 1 / -1;
  padding-top: 4%;
  border-top: 1px solid color-mix(in srgb, var(--brand-fg) 16%, transparent);
  color: var(--brand-muted);
  font-size: clamp(9px, 1.6vw, 13px);
}

.one-pager {
  width: min(100%, 800px);
  min-height: 1010px;
  display: flex;
  flex-direction: column;
  margin-inline: auto;
  color: var(--brand-fg);
  background: var(--brand-bg);
}

.one-pager__header {
  padding: 7% 8% 8%;
  border-bottom: 1px solid color-mix(in srgb, var(--brand-fg) 14%, transparent);
}

.one-pager__brand {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12%;
  font-weight: 700;
}

.one-pager__header > span {
  display: block;
  max-width: 76%;
  margin-top: 5%;
  color: var(--brand-muted);
  font-size: clamp(12px, 2vw, 17px);
  line-height: 1.55;
}

.one-pager__body {
  display: grid;
  grid-template-columns: 1.4fr .6fr;
  flex: 1;
  gap: 8%;
  padding: 8%;
}

.one-pager ol {
  display: grid;
  align-content: start;
  gap: 32px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.one-pager li {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 18px;
}

.one-pager li > span {
  color: var(--brand-primary);
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 800;
}

.one-pager li strong {
  font-size: clamp(15px, 2.5vw, 20px);
}

.one-pager li p {
  margin: 7px 0 0;
  color: var(--brand-muted);
  font-size: clamp(11px, 1.8vw, 14px);
  line-height: 1.5;
}

.one-pager aside {
  align-self: start;
  padding: 14px;
  border-radius: 16px;
  color: var(--brand-on-primary);
  background: var(--brand-primary);
}

.one-pager aside img,
.one-pager__portrait-placeholder {
  width: 100%;
  aspect-ratio: 4 / 5;
  display: grid;
  place-items: center;
  margin-bottom: 18px;
  border-radius: 10px;
  object-fit: cover;
  color: var(--brand-fg);
  background: var(--brand-bg);
}

.one-pager__portrait-placeholder svg {
  width: 35%;
  height: auto;
}

.one-pager aside strong,
.one-pager aside span {
  display: block;
}

.one-pager aside span,
.one-pager aside p {
  font-size: 11px;
  opacity: .72;
}

.one-pager footer {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 12px 24px;
  padding: 24px 8%;
  color: var(--brand-on-secondary);
  background: var(--brand-secondary);
  font-size: 12px;
}

.brand-material-preview--editorial h2 {
  font-family: var(--font-serif);
  font-weight: 500;
}

.brand-material-preview--warm .social-card,
.brand-material-preview--warm .story-card,
.brand-material-preview--warm .business-card,
.brand-material-preview--warm .one-pager {
  border-radius: clamp(22px, var(--oe-radius-emphasis), 40px);
}

@media (max-width: 620px) {
  .business-card--back {
    gap: 5%;
  }

  .one-pager {
    min-height: 760px;
  }

  .one-pager__body {
    grid-template-columns: 1fr;
  }

  .one-pager aside {
    display: grid;
    grid-template-columns: 80px 1fr;
    column-gap: 14px;
  }

  .one-pager aside img,
  .one-pager__portrait-placeholder {
    grid-row: 1 / 4;
    width: 80px;
    margin: 0;
  }
}
</style>
