<script setup lang="ts">
useHead({ title: 'OpenExpert CRM — Design System' })

const colorMode = useColorMode()
const selectedSegment = ref('pipeline')
const formEnabled = ref(true)
const priority = ref('normal')
const progress = ref(72)
const message = ref('Klient gotowy do weryfikacji dokumentów.')

const forcedTheme = computed({
  get: () => colorMode.preference === 'dark',
  set: (value: boolean) => {
    colorMode.preference = value ? 'dark' : 'light'
  },
})

const navItems = [
  { label: 'Tokeny', href: '#tokens' },
  { label: 'Komponenty', href: '#components' },
  { label: 'CRM', href: '#crm' },
  { label: 'Animacje', href: '#motion' },
]

const colorTokens = [
  { name: 'Black', value: '#000000', token: '--ui-primary' },
  { name: 'White', value: '#ffffff', token: '--ui-bg' },
  { name: 'Neutral 50', value: '#fafafa', token: '--color-neutral-50' },
  { name: 'Neutral 200', value: '#e8e8e8', token: '--color-neutral-200' },
  { name: 'Neutral 600', value: '#525252', token: '--color-neutral-600' },
  { name: 'Neutral 950', value: '#0a0a0a', token: '--color-neutral-950' },
]

const radii = [
  { label: 'XS', value: '2px' },
  { label: 'SM', value: '4px' },
  { label: 'MD', value: '6px' },
  { label: 'LG', value: '8px' },
]

const tabItems = [
  { label: 'Pipeline', value: 'pipeline', icon: 'i-lucide-kanban' },
  { label: 'Klienci', value: 'clients', icon: 'i-lucide-users' },
  { label: 'Zadania', value: 'tasks', icon: 'i-lucide-check-square' },
]

const selectItems = [
  { label: 'Niski priorytet', value: 'low' },
  { label: 'Normalny', value: 'normal' },
  { label: 'Wysoki priorytet', value: 'high' },
]

const metrics = [
  { label: 'Nowe leady', value: '42', delta: '+12%', icon: 'i-lucide-user-plus' },
  { label: 'Aktywne sprawy', value: '128', delta: '+8%', icon: 'i-lucide-briefcase-business' },
  { label: 'Dokumenty do weryfikacji', value: '17', delta: '-4%', icon: 'i-lucide-file-check-2' },
]

const clients = [
  { name: 'Anna Kowalska', segment: 'Kredyt hipoteczny', status: 'Scoring', value: '820 000 PLN' },
  { name: 'Marek Zielinski', segment: 'Refinansowanie', status: 'Dokumenty', value: '410 000 PLN' },
  { name: 'Julia Nowak', segment: 'Zakup mieszkania', status: 'Oferta', value: '590 000 PLN' },
]

const motionItems = [
  'fade-up page entry',
  'hover lift',
  'press feedback',
  'reduced motion fallback',
]
</script>

<template>
  <main class="design-page">
    <header class="design-nav">
      <NuxtLink to="/design" class="design-logo" aria-label="OpenExpert CRM design">
        <picture>
          <source srcset="/assets/logo-dark.svg" media="(prefers-color-scheme: dark)">
          <img src="/assets/logo-light.svg" alt="" class="design-logo__mark">
        </picture>
        <span>OpenExpert CRM</span>
      </NuxtLink>

      <nav class="design-nav__links" aria-label="Design sections">
        <a v-for="item in navItems" :key="item.href" :href="item.href">
          {{ item.label }}
        </a>
      </nav>

      <div class="design-nav__actions">
        <USwitch
          v-model="forcedTheme"
          checked-icon="i-lucide-moon"
          unchecked-icon="i-lucide-sun"
          size="sm"
          aria-label="Zmien tryb kolorystyczny"
        />
        <UButton to="/login" icon="i-lucide-log-in" variant="solid">
          Login
        </UButton>
      </div>
    </header>

    <section class="design-hero oe-grid-bg">
      <div class="design-hero__inner">
        <div class="design-kicker oe-animate-in">
          <span class="design-dot" />
          Design system v1
        </div>
        <h1 class="oe-animate-in" data-delay="1">
          Nuxt UI dla CRM, z charakterem landingu.
        </h1>
        <p class="oe-animate-in" data-delay="2">
          Kompaktowy system operacyjny dla pracy eksperta: neutralna paleta,
          typografia DM Sans i Imbue, cienkie obrysy, male radiusy i animacje,
          ktore wspieraja skanowanie interfejsu.
        </p>
        <div class="design-hero__actions oe-animate-in" data-delay="2">
          <UButton href="#components" icon="i-lucide-component" variant="solid" size="md">
            Komponenty
          </UButton>
          <UButton href="#crm" icon="i-lucide-layout-dashboard" variant="outline" size="md">
            CRM preview
          </UButton>
        </div>
      </div>
    </section>

    <section id="tokens" class="design-section">
      <div class="design-section__head">
        <div>
          <p class="design-eyebrow">Tokeny</p>
          <h2>Paleta i rytm UI</h2>
        </div>
        <UBadge color="neutral" variant="outline" icon="i-lucide-ruler">
          radius 4-6px
        </UBadge>
      </div>

      <div class="token-grid">
        <UCard v-for="token in colorTokens" :key="token.token" class="oe-hover-lift">
          <div class="swatch" :style="{ background: token.value }" />
          <div class="token-card__meta">
            <strong>{{ token.name }}</strong>
            <span>{{ token.value }}</span>
            <code>{{ token.token }}</code>
          </div>
        </UCard>
      </div>

      <div class="spec-grid">
        <UCard>
          <template #header>
            <div class="card-title">
              <UIcon name="i-lucide-type" />
              Typografia
            </div>
          </template>
          <div class="type-spec">
            <p class="type-spec__display">Ostatnie narzedzie dla eksperta</p>
            <p class="type-spec__serif">Imbue jako akcent editorial</p>
            <p class="type-spec__body">
              DM Sans jest baza dla aplikacji: czytelny, neutralny, szybki do skanowania.
            </p>
            <code>font-sans / font-serif / font-mono</code>
          </div>
        </UCard>

        <UCard>
          <template #header>
            <div class="card-title">
              <UIcon name="i-lucide-scan-line" />
              Radius i spacing
            </div>
          </template>
          <div class="radius-row">
            <div v-for="radius in radii" :key="radius.label" class="radius-item">
              <div class="radius-box" :style="{ borderRadius: radius.value }" />
              <strong>{{ radius.label }}</strong>
              <span>{{ radius.value }}</span>
            </div>
          </div>
        </UCard>
      </div>
    </section>

    <section id="components" class="design-section design-section--muted">
      <div class="design-section__head">
        <div>
          <p class="design-eyebrow">Nuxt UI</p>
          <h2>Komponenty bazowe</h2>
        </div>
        <UButton icon="i-lucide-copy" variant="ghost">
          Kopiuj tokeny
        </UButton>
      </div>

      <div class="component-grid">
        <UCard>
          <template #header>
            <div class="card-title">
              <UIcon name="i-lucide-square-mouse-pointer" />
              Buttons i badges
            </div>
          </template>
          <div class="component-stack">
            <div class="inline-row">
              <UButton icon="i-lucide-save" variant="solid">
                Zapisz
              </UButton>
              <UButton icon="i-lucide-filter" variant="outline">
                Filtr
              </UButton>
              <UButton icon="i-lucide-more-horizontal" variant="ghost" square aria-label="Wiecej" />
            </div>
            <div class="inline-row">
              <UBadge color="success" variant="subtle" icon="i-lucide-check">
                Gotowe
              </UBadge>
              <UBadge color="warning" variant="subtle" icon="i-lucide-clock">
                W toku
              </UBadge>
              <UBadge color="error" variant="subtle" icon="i-lucide-alert-triangle">
                Ryzyko
              </UBadge>
            </div>
          </div>
        </UCard>

        <UCard>
          <template #header>
            <div class="card-title">
              <UIcon name="i-lucide-list-checks" />
              Formularz
            </div>
          </template>
          <div class="component-stack">
            <UFormField label="Priorytet" description="Wplywa na sortowanie spraw w kolejce.">
              <USelect v-model="priority" :items="selectItems" class="w-full" />
            </UFormField>
            <UFormField label="Notatka operacyjna">
              <UTextarea v-model="message" :rows="3" autoresize />
            </UFormField>
            <USwitch v-model="formEnabled" label="Aktywny follow-up" description="Pokazuj zadanie w pipeline." />
          </div>
        </UCard>

        <UCard>
          <template #header>
            <div class="card-title">
              <UIcon name="i-lucide-info" />
              Alert i progress
            </div>
          </template>
          <div class="component-stack">
            <UAlert
              icon="i-lucide-sparkles"
              title="Nowy styl aktywny"
              description="Nuxt UI dziedziczy tokeny OpenExpert CRM globalnie."
              color="neutral"
              variant="subtle"
            />
            <UProgress :model-value="progress" status color="neutral" />
            <div class="skeleton-list">
              <USkeleton class="h-3 w-2/3" />
              <USkeleton class="h-3 w-full" />
              <USkeleton class="h-3 w-1/2" />
            </div>
          </div>
        </UCard>
      </div>
    </section>

    <section id="crm" class="design-section">
      <div class="design-section__head">
        <div>
          <p class="design-eyebrow">CRM preview</p>
          <h2>Operacyjny pulpit</h2>
        </div>
        <UTabs v-model="selectedSegment" :items="tabItems" class="design-tabs" />
      </div>

      <div class="dashboard-shell">
        <aside class="dashboard-sidebar">
          <div class="sidebar-brand">
            <img src="/assets/logo-light.svg" alt="" class="sidebar-brand__mark">
            <span>OpenExpert</span>
          </div>
          <a class="sidebar-link sidebar-link--active" href="#">
            <UIcon name="i-lucide-layout-dashboard" />
            Dashboard
          </a>
          <a class="sidebar-link" href="#">
            <UIcon name="i-lucide-users" />
            Klienci
          </a>
          <a class="sidebar-link" href="#">
            <UIcon name="i-lucide-file-text" />
            Dokumenty
          </a>
          <a class="sidebar-link" href="#">
            <UIcon name="i-lucide-settings" />
            Ustawienia
          </a>
        </aside>

        <div class="dashboard-main">
          <div class="dashboard-toolbar">
            <div>
              <p class="design-eyebrow">Pipeline</p>
              <h3>{{ selectedSegment }}</h3>
            </div>
            <div class="inline-row">
              <UInput icon="i-lucide-search" placeholder="Szukaj klienta" />
              <UButton icon="i-lucide-plus" variant="solid">
                Dodaj
              </UButton>
            </div>
          </div>

          <div class="metrics-grid">
            <UCard v-for="metric in metrics" :key="metric.label" class="metric-card oe-hover-lift">
              <div class="metric-top">
                <UIcon :name="metric.icon" />
                <UBadge color="neutral" variant="outline">{{ metric.delta }}</UBadge>
              </div>
              <strong>{{ metric.value }}</strong>
              <span>{{ metric.label }}</span>
            </UCard>
          </div>

          <UCard>
            <template #header>
              <div class="table-header">
                <div>
                  <h4>Aktywni klienci</h4>
                  <p>Przyklad gestego widoku CRM z neutralnymi statusami.</p>
                </div>
                <UButton icon="i-lucide-download" variant="ghost" square aria-label="Eksport" />
              </div>
            </template>
            <div class="client-table">
              <div class="client-row client-row--head">
                <span>Klient</span>
                <span>Segment</span>
                <span>Status</span>
                <span>Wartosc</span>
              </div>
              <div v-for="client in clients" :key="client.name" class="client-row">
                <strong>{{ client.name }}</strong>
                <span>{{ client.segment }}</span>
                <UBadge color="neutral" variant="subtle">{{ client.status }}</UBadge>
                <span>{{ client.value }}</span>
              </div>
            </div>
          </UCard>
        </div>
      </div>
    </section>

    <section id="motion" class="design-section design-section--dark">
      <div class="design-section__head">
        <div>
          <p class="design-eyebrow">Globalne animacje</p>
          <h2>Ruch jako sygnal stanu</h2>
        </div>
      </div>

      <div class="motion-grid">
        <div v-for="(item, index) in motionItems" :key="item" class="motion-card oe-hover-lift oe-animate-in" :data-delay="index % 3">
          <span>{{ index + 1 }}</span>
          <strong>{{ item }}</strong>
          <p>Subtelne przejscie bez zmiany wymiarow elementu i z fallbackiem dla reduced motion.</p>
        </div>
      </div>

      <div class="marquee">
        <div class="marquee__inner">
          <span v-for="item in [...motionItems, ...motionItems]" :key="`${item}-motion`">
            <span class="strip-dot" />{{ item }}
          </span>
        </div>
      </div>
    </section>
  </main>
</template>

<style scoped>
.design-page {
  min-height: 100vh;
  overflow-x: hidden;
  background: var(--ui-bg);
  color: var(--ui-text-highlighted);
}

.design-nav {
  position: sticky;
  top: 0;
  z-index: 50;
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: var(--oe-nav-height);
  padding: 0 32px;
  background: color-mix(in srgb, var(--ui-bg) 92%, transparent);
  border-bottom: 1px solid var(--ui-border);
  backdrop-filter: blur(12px);
}

.design-logo {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  color: var(--ui-text-highlighted);
  font-weight: 600;
  text-decoration: none;
}

.design-logo__mark {
  display: block;
  height: 22px;
  filter: var(--oe-logo-filter);
}

.design-nav__links,
.design-nav__actions,
.inline-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.design-nav__links {
  gap: 28px;
}

.design-nav__links a {
  color: var(--ui-text-muted);
  font-size: 14px;
  text-decoration: none;
  transition: color var(--oe-motion-fast);
}

.design-nav__links a:hover {
  color: var(--ui-text-highlighted);
}

.design-hero {
  border-bottom: 1px solid var(--ui-border);
}

.design-hero__inner {
  width: min(1180px, calc(100% - 40px));
  margin: 0 auto;
  padding: 112px 0 96px;
}

.design-kicker,
.design-eyebrow {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--ui-text-muted);
  font-family: var(--font-mono);
  font-size: 12px;
  text-transform: uppercase;
}

.design-dot {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: var(--ui-text-muted);
  animation: oe-pulse-dot 2s ease-in-out infinite;
}

.design-hero h1 {
  max-width: 840px;
  margin: 28px 0 28px;
  color: var(--ui-text-highlighted);
  font-size: clamp(46px, 8vw, 92px);
  font-weight: 300;
  line-height: 1.04;
}

.design-hero p {
  max-width: 660px;
  color: var(--ui-text-toned);
  font-size: 18px;
  line-height: 1.7;
}

.design-hero__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 36px;
}

.design-section {
  width: min(1180px, calc(100% - 40px));
  margin: 0 auto;
  padding: 86px 0;
}

.design-section--muted {
  width: 100%;
  max-width: none;
  padding-inline: max(20px, calc((100vw - 1180px) / 2));
  background: var(--ui-bg-muted);
  border-block: 1px solid var(--ui-border);
}

.design-section--dark {
  width: 100%;
  max-width: none;
  padding-inline: max(20px, calc((100vw - 1180px) / 2));
  background: var(--ui-bg-inverted);
  color: var(--ui-text-inverted);
}

.design-section__head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 24px;
  margin-bottom: 32px;
}

.design-section h2 {
  margin-top: 8px;
  color: inherit;
  font-size: clamp(30px, 4vw, 48px);
  font-weight: 300;
  line-height: 1.12;
}

.token-grid,
.component-grid,
.metrics-grid,
.motion-grid,
.spec-grid {
  display: grid;
  gap: 1px;
  background: var(--ui-border);
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius);
  overflow: hidden;
}

.token-grid {
  grid-template-columns: repeat(6, 1fr);
}

.token-grid :deep(.rounded-sm),
.component-grid :deep(.rounded-sm),
.metrics-grid :deep(.rounded-sm),
.spec-grid :deep(.rounded-sm) {
  border-radius: 0;
  box-shadow: none;
}

.swatch {
  height: 84px;
  margin: -20px -20px 18px;
  border-bottom: 1px solid var(--ui-border);
}

.token-card__meta,
.component-stack,
.type-spec,
.skeleton-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.token-card__meta span,
.token-card__meta code,
.type-spec code,
.radius-item span,
.metric-card span,
.table-header p {
  color: var(--ui-text-muted);
  font-family: var(--font-mono);
  font-size: 12px;
}

.spec-grid {
  grid-template-columns: 1fr 1fr;
  margin-top: 28px;
}

.card-title,
.table-header,
.metric-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.card-title {
  justify-content: flex-start;
  font-weight: 600;
}

.type-spec__display {
  color: var(--ui-text-highlighted);
  font-size: 30px;
  font-weight: 300;
  line-height: 1.15;
}

.type-spec__serif {
  font-family: var(--font-serif);
  font-size: 34px;
  line-height: 1;
}

.type-spec__body {
  color: var(--ui-text-toned);
  line-height: 1.65;
}

.radius-row {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
}

.radius-item {
  display: grid;
  gap: 8px;
}

.radius-box {
  aspect-ratio: 1;
  background: var(--ui-bg-muted);
  border: 1px solid var(--ui-border);
}

.component-grid {
  grid-template-columns: repeat(3, 1fr);
}

.dashboard-shell {
  display: grid;
  grid-template-columns: 220px 1fr;
  min-height: 640px;
  overflow: hidden;
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius);
  background: var(--ui-bg-muted);
}

.dashboard-sidebar {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 20px;
  background: var(--ui-bg-inverted);
  color: var(--ui-text-inverted);
}

.sidebar-brand,
.sidebar-link {
  display: flex;
  align-items: center;
  gap: 10px;
}

.sidebar-brand {
  margin-bottom: 22px;
  font-weight: 600;
}

.sidebar-brand__mark {
  height: 20px;
  filter: invert(1);
}

.sidebar-link {
  min-height: 36px;
  padding: 0 10px;
  border: 1px solid transparent;
  border-radius: var(--ui-radius);
  color: color-mix(in srgb, var(--ui-text-inverted) 64%, transparent);
  font-size: 14px;
  text-decoration: none;
}

.sidebar-link--active,
.sidebar-link:hover {
  border-color: color-mix(in srgb, var(--ui-text-inverted) 16%, transparent);
  color: var(--ui-text-inverted);
}

.dashboard-main {
  min-width: 0;
  padding: 24px;
}

.dashboard-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 20px;
}

.dashboard-toolbar h3 {
  margin-top: 4px;
  text-transform: capitalize;
}

.metrics-grid {
  grid-template-columns: repeat(3, 1fr);
  margin-bottom: 20px;
}

.metric-card strong {
  display: block;
  margin: 18px 0 4px;
  color: var(--ui-text-highlighted);
  font-size: 34px;
  font-weight: 300;
}

.client-table {
  display: grid;
}

.client-row {
  display: grid;
  grid-template-columns: 1.1fr 1fr 120px 130px;
  gap: 16px;
  align-items: center;
  min-height: 54px;
  border-top: 1px solid var(--ui-border);
  color: var(--ui-text-toned);
  font-size: 14px;
}

.client-row:first-child {
  border-top: 0;
}

.client-row--head {
  min-height: 38px;
  color: var(--ui-text-muted);
  font-family: var(--font-mono);
  font-size: 12px;
  text-transform: uppercase;
}

.motion-grid {
  grid-template-columns: repeat(4, 1fr);
  background: color-mix(in srgb, var(--ui-text-inverted) 18%, transparent);
  border-color: color-mix(in srgb, var(--ui-text-inverted) 18%, transparent);
}

.motion-card {
  min-height: 180px;
  padding: 24px;
  background: var(--ui-bg-inverted);
  border: 1px solid color-mix(in srgb, var(--ui-text-inverted) 12%, transparent);
  color: var(--ui-text-inverted);
}

.motion-card span {
  color: color-mix(in srgb, var(--ui-text-inverted) 44%, transparent);
  font-family: var(--font-mono);
  font-size: 12px;
}

.motion-card strong {
  display: block;
  margin: 30px 0 12px;
  font-size: 20px;
  font-weight: 500;
}

.motion-card p {
  color: color-mix(in srgb, var(--ui-text-inverted) 62%, transparent);
  font-size: 14px;
  line-height: 1.55;
}

.marquee {
  margin-top: 34px;
  overflow: hidden;
  border-block: 1px solid color-mix(in srgb, var(--ui-text-inverted) 18%, transparent);
  padding: 14px 0;
}

.marquee__inner {
  display: flex;
  width: max-content;
  gap: 56px;
  animation: oe-marquee 24s linear infinite;
}

.marquee__inner span {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  color: color-mix(in srgb, var(--ui-text-inverted) 62%, transparent);
  font-family: var(--font-mono);
  font-size: 12px;
  white-space: nowrap;
}

.strip-dot {
  width: 4px;
  height: 4px;
  border-radius: 999px;
  background: currentColor;
}

@media (max-width: 1040px) {
  .design-nav__links {
    display: none;
  }

  .token-grid,
  .component-grid,
  .metrics-grid,
  .motion-grid {
    grid-template-columns: repeat(2, 1fr);
  }

  .dashboard-shell {
    grid-template-columns: 1fr;
  }

  .dashboard-sidebar {
    display: none;
  }
}

@media (max-width: 760px) {
  .design-nav {
    padding: 0 18px;
  }

  .design-nav__actions :deep(.u-button) {
    display: none;
  }

  .design-hero__inner,
  .design-section {
    width: min(100% - 32px, 1180px);
  }

  .design-hero__inner {
    padding: 72px 0 64px;
  }

  .design-section,
  .design-section--muted,
  .design-section--dark {
    padding-block: 64px;
  }

  .design-section__head,
  .dashboard-toolbar {
    align-items: flex-start;
    flex-direction: column;
  }

  .token-grid,
  .component-grid,
  .metrics-grid,
  .motion-grid,
  .spec-grid,
  .radius-row {
    grid-template-columns: 1fr;
  }

  .design-tabs {
    width: 100%;
  }

  .dashboard-main {
    padding: 16px;
  }

  .dashboard-toolbar .inline-row {
    width: 100%;
    align-items: stretch;
    flex-direction: column;
  }

  .client-row {
    grid-template-columns: 1fr;
    gap: 6px;
    padding: 14px 0;
  }

  .client-row--head {
    display: none;
  }
}
</style>
