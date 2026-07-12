<script setup lang="ts">
useHead({ title: 'OpenExpert — Modułowa platforma dla ekspertów' })

const router = useRouter()
const email = ref('')
const waitlistError = ref<string | null>(null)
const waitlistLoading = ref(false)

async function submitWaitlist() {
  const val = email.value.trim()
  if (!val || !val.includes('@')) return
  waitlistLoading.value = true
  waitlistError.value = null

  try {
    const result = await $fetch<{ surveyToken: string }>('/api/waitlist', {
      method: 'POST',
      body: { email: val },
    })

    localStorage.setItem('oe-waitlist', JSON.stringify({
      step: 1,
      email: val,
      answers: {},
      emailSaved: true,
      surveyToken: result.surveyToken,
    }))
    await router.push('/waitlist')
  } catch {
    waitlistError.value = 'Coś poszło nie tak — spróbuj jeszcze raz.'
  } finally {
    waitlistLoading.value = false
  }
}

const marqueeItems = [
  'Ekspert kredytowy', 'Ekspert nieruchomości', 'Ekspert ubezpieczeniowy',
  'REST API', 'MCP tools', 'Naturalne budowanie modułów',
  'AGPL-3.0', 'Vue 3 / Nuxt 4', 'Agentic Economy',
  'Ekspert kredytowy', 'Ekspert nieruchomości', 'Ekspert ubezpieczeniowy',
  'REST API', 'MCP tools', 'Naturalne budowanie modułów',
  'AGPL-3.0', 'Vue 3 / Nuxt 4', 'Agentic Economy',
]

const cases = [
  {
    index: '01', title: 'Ekspert kredytowy',
    body: 'Analiza zdolności kredytowej, scoring, porównywanie ofert, generowanie raportów dla klientów i\u00A0banków. OpenExpert obsługuje zarówno analityka przy pulpicie, jak i\u00A0agenta AI, który sam pobiera dane i\u00A0generuje\u00A0rekomendacje.',
    tags: ['moduł.scoring', 'moduł.raporty', 'moduł.api-bankowe', 'moduł.kalkulatory'],
  },
  {
    index: '02', title: 'Ekspert nieruchomości',
    body: 'Wyceny, analiza rynku, zarządzanie ofertami i\u00A0klientami, automatyczne przygotowanie dokumentacji transakcyjnej. Agent AI może samodzielnie monitorować rynek i\u00A0powiadamiać o\u00A0okazjach\u00A0inwestycyjnych.',
    tags: ['moduł.wyceny', 'moduł.crm', 'moduł.umowy', 'moduł.analiza-rynku'],
  },
  {
    index: '03', title: 'Ekspert ubezpieczeniowy',
    body: 'Porównywanie polis, analiza ryzyka, obsługa roszczeń i\u00A0generowanie ofert dopasowanych do profilu klienta. Platforma może działać jako silnik dla aplikacji zewnętrznych — agentowych lub\u00A0tradycyjnych.',
    tags: ['moduł.polisy', 'moduł.ryzyko', 'moduł.roszczenia', 'moduł.ofertowanie'],
  },
]

const modules = [
  { tag: '@openexpert/scoring', official: true, name: 'Scoring kredytowy', desc: 'Ocena zdolności kredytowej z integracją z bazami BIK / BIG.' },
  { tag: '@openexpert/wyceny', official: true, name: 'Wycena nieruchomości', desc: 'Automatyczna wycena na podstawie danych transakcyjnych i lokalizacji.' },
  { tag: '@community/polisy', official: false, name: 'Porównywarka polis', desc: 'Pobieranie i porównywanie ofert ubezpieczeniowych w czasie rzeczywistym.' },
  { tag: '@community/prawo', official: false, name: 'Analiza dokumentów prawnych', desc: 'Ekstrakcja kluczowych klauzul i flag ryzyka z umów i aktów.' },
  { tag: '@community/podatki', official: false, name: 'Optymalizacja podatkowa', desc: 'Analiza możliwości odliczeń i generowanie rekomendacji podatkowych.' },
]

const features = [
  {
    title: 'Podłącz dowolne API',
    desc: 'REST, GraphQL, WebSocket — konfigurujesz połączenie raz, platforma udostępnia je jako narzędzie MCP dla agentów i\u00A0endpoint dla\u00A0aplikacji.',
    icon: '<path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>',
  },
  {
    title: 'UI generowany automatycznie',
    desc: 'Każdy moduł ma interfejs dla człowieka — formularze, widoki, raporty — gotowy bez pisania\u00A0frontendu.',
    icon: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/>',
  },
  {
    title: 'Natywna obsługa agentów AI',
    desc: 'Każdy moduł jest automatycznie eksponowany jako narzędzie MCP — agent może z\u00A0niego korzystać bez żadnej\u00A0integracji.',
    icon: '<circle cx="12" cy="12" r="3"/><path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"/>',
  },
]

const interfaces = [
  { label: 'Tryb 01', title: 'UI dla eksperta', desc: 'Gotowy interfejs Vue\u00A03\u00A0/\u00A0Nuxt\u00A04 dla specjalistów pracujących przy pulpicie. Formularze, dashboardy, raporty — wszystko bez pisania\u00A0frontendu.', badge: 'Vue 3 · Nuxt 4' },
  { label: 'Tryb 02', title: 'REST API', desc: 'Platforma jako headless backend. Własne aplikacje, mobilne interfejsy, zewnętrzne systemy — podłączasz się przez API i\u00A0masz dostęp do całej logiki\u00A0eksperckiej.', badge: 'OpenAPI · H3' },
  { label: 'Tryb 03', title: 'Silnik MCP', desc: 'Każdy moduł dostępny jako narzędzie dla agenta AI. Claude, GPT, własny agent — podłączają się przez protokół MCP i\u00A0korzystają z\u00A0wiedzy eksperckiej bez\u00A0pośrednika.', badge: 'MCP · Agentic' },
]
</script>

<template>
  <div class="oe-root">
    <!-- NAV -->
    <nav class="oe-nav">
      <a href="#" class="nav-logo">
        <picture>
          <source srcset="/assets/logo-dark.svg" media="(prefers-color-scheme: dark)">
          <img src="/assets/logo-light.svg" alt="OpenExpert" class="nav-logo-img">
        </picture>
        <span class="nav-logo-name">OpenExpert</span>
      </a>
      <ul class="nav-links">
        <li><a href="#usecases">Przykłady</a></li>
        <li><a href="#marketplace">Marketplace</a></li>
        <li><a href="#moduly">Architektura</a></li>
        <li><a href="#interfejsy">Interfejsy</a></li>
        <li><a href="https://github.com/OpenExpertApp/OpenExpert" target="_blank" rel="noopener">GitHub</a></li>
      </ul>
      <div class="nav-cta">
        <a href="https://github.com/OpenExpertApp/OpenExpert" target="_blank" rel="noopener" class="btn-ghost">GitHub</a>
        <NuxtLink to="/waitlist" class="btn-primary">Dołącz do waitlisty</NuxtLink>
      </div>
    </nav>

    <!-- HERO -->
    <div class="hero" id="hero-waitlist">
      <div class="hero-label">
        <span class="hero-wip-dot" />
        W budowie — dołącz wcześnie
      </div>
      <h1>Ostatnie narzędzie<br>dla&nbsp;<em>każdego eksperta.</em></h1>
      <p class="hero-sub">Dobieraj moduły, łącz je dowolnie i&nbsp;buduj własne. Platforma obsługuje człowieka i&nbsp;agenta AI jednocześnie — przez UI, REST API i&nbsp;protokół&nbsp;MCP.</p>

      <div class="hero-waitlist">
        <input v-model="email" type="email" class="waitlist-input" placeholder="twoj@email.pl" :disabled="waitlistLoading" @keyup.enter="submitWaitlist">
        <button class="btn-primary waitlist-btn" :disabled="waitlistLoading" @click="submitWaitlist">
          {{ waitlistLoading ? 'Zapisuję…' : 'Zapisz się na waitlistę' }}
        </button>
      </div>
      <p v-if="waitlistError" class="waitlist-error">{{ waitlistError }}</p>

      <p class="hero-or">
        lub <a href="https://github.com/OpenExpertApp/OpenExpert" target="_blank" rel="noopener" class="hero-gh-link">rozwijaj projekt na GitHub</a>
      </p>
    </div>

    <!-- MARQUEE STRIP -->
    <div class="strip">
      <div class="strip-inner">
        <span v-for="item in marqueeItems" :key="item" class="strip-item">
          <span class="strip-dot" />{{ item }}
        </span>
      </div>
    </div>

    <!-- USE CASES -->
    <section class="usecases" id="usecases">
      <div class="section-inner">
        <div class="section-label">Przykładowe zastosowania</div>
        <h2>Jeden silnik.<br><em>Dowolna dziedzina.</em><br>Nieskończone kombinacje.</h2>
        <p class="usecases-note">To tylko trzy z&nbsp;dziesiątek możliwych zastosowań. Moduły łączysz dowolnie — platforma nie narzuca branży ani&nbsp;specjalizacji.</p>
        <div class="cases-grid">
          <div v-for="c in cases" :key="c.index" class="case-card">
            <div class="case-index">{{ c.index }}</div>
            <div class="case-title">{{ c.title }}</div>
            <p class="case-body">{{ c.body }}</p>
            <div class="case-modules">
              <span v-for="tag in c.tags" :key="tag" class="case-tag">{{ tag }}</span>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- MARKETPLACE -->
    <section class="marketplace" id="marketplace">
      <div class="section-inner">
        <div class="section-label">Marketplace modułów</div>
        <div class="marketplace-header">
          <div>
            <h2 class="marketplace-h2">Gotowe moduły.<br><em>Własna logika.</em></h2>
            <p class="marketplace-desc">Pobieraj moduły z&nbsp;marketplace, konfiguruj je do własnych potrzeb lub buduj od zera — językiem naturalnym. Każdy moduł jest od razu dostępny w&nbsp;UI, przez API i&nbsp;jako narzędzie&nbsp;MCP.</p>
          </div>
          <div class="marketplace-actions">
            <span class="marketplace-soon">Wkrótce dostępne</span>
          </div>
        </div>
        <div class="mkt-grid">
          <div v-for="mod in modules" :key="mod.tag" class="mkt-card">
            <div class="mkt-card-top">
              <span class="mkt-tag">{{ mod.tag }}</span>
              <span v-if="mod.official" class="mkt-verified">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                oficjalny
              </span>
              <span v-else class="mkt-community">community</span>
            </div>
            <p class="mkt-name">{{ mod.name }}</p>
            <p class="mkt-desc">{{ mod.desc }}</p>
          </div>
          <div class="mkt-card mkt-card--build">
            <div class="mkt-build-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
            </div>
            <p class="mkt-name">Zbuduj własny moduł</p>
            <p class="mkt-desc">Opisz, co ma robić — platforma wygeneruje moduł gotowy do użycia i publikacji.</p>
          </div>
        </div>
      </div>
    </section>

    <!-- MODULAR -->
    <section class="modular" id="moduly">
      <div class="section-inner">
        <div class="section-label">Architektura modułowa</div>
        <div class="modular-grid">
          <div>
            <h2>Budujesz moduły<br><em>językiem naturalnym.</em></h2>
            <p class="modular-desc">Opisz, co ma robić moduł — platforma generuje interfejs, endpointy i&nbsp;narzędzia MCP. Możesz podłączyć własne API, bazę danych, webhook lub zewnętrzny model&nbsp;AI. Każdy moduł jest natychmiast dostępny dla&nbsp;agentów.</p>
            <ul class="feature-list">
              <li v-for="f in features" :key="f.title" class="feature-item">
                <div class="feature-icon">
                  <!-- eslint-disable-next-line vue/no-v-html -->
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" v-html="f.icon" />
                </div>
                <div class="feature-text">
                  <h4>{{ f.title }}</h4>
                  <p>{{ f.desc }}</p>
                </div>
              </li>
            </ul>
          </div>
          <div class="terminal-card">
            <div class="terminal-bar">
              <div class="terminal-dot" /><div class="terminal-dot" /><div class="terminal-dot" />
              <span class="terminal-title">openexpert — mcp tools</span>
            </div>
            <div class="terminal-body">
              <span class="t-comment"># Narzędzia MCP dostępne dla agenta</span><br>
              <span class="t-dim">─────────────────────────────────────</span><br>
              <br>
              <span class="t-prompt">tool</span> <span class="t-string">kredyt.sprawdz_zdolnosc</span><br>
              <span class="t-key">  input:</span>  dochod, zobowiazania, okres<br>
              <span class="t-key">  output:</span> zdolnosc_kredytowa, scoring<br>
              <br>
              <span class="t-prompt">tool</span> <span class="t-string">kredyt.generuj_raport</span><br>
              <span class="t-key">  input:</span>  klient_id, format<br>
              <span class="t-key">  output:</span> pdf_url, dane_json<br>
              <br>
              <span class="t-prompt">tool</span> <span class="t-string">nieruchomosci.wycen</span><br>
              <span class="t-key">  input:</span>  adres, metraz, standard<br>
              <span class="t-key">  output:</span> wycena, przedział_ufnosci<br>
              <br>
              <span class="t-prompt">tool</span> <span class="t-string">ubezpieczenia.porownaj_polisy</span><br>
              <span class="t-key">  input:</span>  profil_klienta, zakres<br>
              <span class="t-key">  output:</span> ranking_ofert[]<br>
              <br>
              <span class="t-dim">─────────────────────────────────────</span><br>
              <span class="t-comment"># Każdy moduł = zestaw narzędzi MCP</span>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- INTERFACES -->
    <section class="interfaces" id="interfejsy">
      <div class="section-inner">
        <div class="section-label">Tryby interfejsu</div>
        <h2>Interfejs dla ludzi<br>i <em>silnik dla agentów.</em></h2>
        <div class="interface-grid">
          <div v-for="iface in interfaces" :key="iface.label" class="interface-card">
            <div class="interface-card-label">{{ iface.label }}</div>
            <h3>{{ iface.title }}</h3>
            <p>{{ iface.desc }}</p>
            <span class="interface-badge">{{ iface.badge }}</span>
          </div>
        </div>
      </div>
    </section>

    <!-- OPEN SOURCE STRIP -->
    <div class="open-strip">
      <h2>Open-source.<br><em>Rozwijany razem.</em></h2>
      <p>Projekt na wczesnym etapie. Szukamy współtwórców, testerów i&nbsp;pierwszych ekspertów, którzy chcą kształtować&nbsp;platformę.</p>
      <div class="open-actions">
        <a href="https://github.com/OpenExpertApp/OpenExpert" target="_blank" rel="noopener" class="btn-primary">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" /></svg>
          Rozwijaj na GitHub
        </a>
        <NuxtLink to="/waitlist" class="btn-ghost open-waitlist-btn">Zapisz się na waitlistę</NuxtLink>
      </div>
      <div class="github-stars">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="#404040"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" /></svg>
        <span>AGPL-3.0 · open-source · self-hosted</span>
      </div>
    </div>

    <!-- FOOTER -->
    <footer class="oe-footer">
      <div class="footer-left">
        <div class="footer-logo">
          <picture>
            <source srcset="/assets/logo-dark.svg" media="(prefers-color-scheme: dark)">
            <img src="/assets/logo-light.svg" alt="OpenExpert">
          </picture>
          <span>OpenExpert</span>
        </div>
        <span class="footer-copy">© 2026 OpenExpert. Licencja AGPL-3.0.</span>
      </div>
      <ul class="footer-links">
        <li><a href="#">Dokumentacja</a></li>
        <li><a href="https://github.com/OpenExpertApp/OpenExpert" target="_blank" rel="noopener">GitHub</a></li>
        <li><a href="https://github.com/OpenExpertApp/OpenExpert/blob/main/LICENSE" target="_blank" rel="noopener">Licencja</a></li>
        <li><a href="mailto:hello@openexpert.app">Kontakt</a></li>
      </ul>
    </footer>
  </div>
</template>

<style scoped>
.oe-root {
  font-family: var(--font-sans);
  background: var(--bg-default);
  color: var(--fg-primary);
  overflow-x: hidden;
}

/* NAV */
.oe-nav {
  position: fixed;
  top: 0; left: 0; right: 0;
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 48px;
  height: 60px;
  background: var(--bg-default);
  border-bottom: 1px solid var(--border-default);
}
.nav-logo { display: flex; align-items: center; gap: 10px; text-decoration: none; }
.nav-logo-img { height: 22px; display: block; }
.nav-logo-name { font-size: var(--text-base); font-weight: var(--weight-medium); letter-spacing: -0.01em; color: var(--fg-primary); }
.nav-links { display: flex; align-items: center; gap: 32px; list-style: none; }
.nav-links a { font-size: var(--text-sm); color: var(--fg-secondary); text-decoration: none; transition: color var(--transition-fast); }
.nav-links a:hover { color: var(--fg-primary); }
.nav-cta { display: flex; align-items: center; gap: 12px; }

/* BUTTONS */
.btn-primary {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 8px 18px;
  background: var(--fg-primary); color: var(--bg-default);
  border: 1px solid var(--fg-primary); border-radius: 4px;
  font-family: var(--font-sans); font-size: var(--text-sm); font-weight: var(--weight-medium);
  cursor: pointer; text-decoration: none;
  transition: opacity var(--transition-fast);
}
.btn-primary:hover { opacity: 0.75; }

.btn-ghost {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 8px 18px;
  background: transparent; color: var(--fg-primary);
  border: 1px solid var(--border-default); border-radius: 4px;
  font-family: var(--font-sans); font-size: var(--text-sm); font-weight: var(--weight-medium);
  cursor: pointer; text-decoration: none;
  transition: background var(--transition-fast), border-color var(--transition-fast);
}
.btn-ghost:hover { background: var(--bg-muted); border-color: var(--border-strong); }

/* HERO */
.hero {
  padding: 160px 48px 120px;
  max-width: 1200px;
  margin: 0 auto;
}
.hero-label {
  display: inline-flex; align-items: center; gap: 8px;
  font-size: var(--text-xs); font-weight: var(--weight-medium);
  letter-spacing: var(--tracking-widest); text-transform: uppercase;
  color: var(--fg-secondary); margin-bottom: 40px;
}
.hero-wip-dot {
  width: 6px; height: 6px; border-radius: 50%;
  background: var(--gray-400);
  animation: pulse-dot 2s ease-in-out infinite;
  flex-shrink: 0;
}
@keyframes pulse-dot { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
.hero h1 {
  font-size: clamp(52px, 7vw, 96px);
  font-weight: 300; line-height: 1.05;
  letter-spacing: -0.03em;
  font-variation-settings: 'opsz' 72, 'wght' 300;
  max-width: 900px; margin-bottom: 40px;
}
.hero h1 em { font-family: var(--font-serif); font-style: italic; font-variation-settings: 'opsz' 72, 'wght' 300; }
.hero-sub { font-size: var(--text-md); color: var(--fg-secondary); line-height: var(--leading-relaxed); max-width: 560px; margin-bottom: 48px; }
.hero-waitlist { display: flex; gap: 8px; margin-bottom: 16px; }
.waitlist-input {
  padding: 11px 16px; font-family: var(--font-sans); font-size: var(--text-base);
  border: 1px solid var(--border-strong); border-radius: 4px;
  background: var(--bg-default); color: var(--fg-primary);
  width: 280px; outline: none; transition: border-color var(--transition-fast);
}
.waitlist-input::placeholder { color: var(--fg-tertiary); }
.waitlist-input:focus { border-color: var(--black); }
.waitlist-btn { padding: 11px 24px; font-size: var(--text-base); white-space: nowrap; }
.waitlist-success { font-size: var(--text-base); color: var(--fg-secondary); padding: 12px 0; margin-bottom: 16px; }
.waitlist-error { font-size: var(--text-sm); color: #c00; margin-top: 8px; margin-bottom: 8px; }
.waitlist-btn:disabled { opacity: 0.6; cursor: not-allowed; }
.waitlist-input:disabled { opacity: 0.6; cursor: not-allowed; }

@media (prefers-color-scheme: dark) {
  .waitlist-input {
    background: var(--bg-muted);
    border-color: var(--border-strong);
  }
}
.hero-or { font-size: var(--text-sm); color: var(--fg-tertiary); }
.hero-gh-link { color: var(--fg-secondary); text-decoration: underline; text-underline-offset: 3px; transition: color var(--transition-fast); }
.hero-gh-link:hover { color: var(--fg-primary); }

/* STRIP */
.strip { border-top: 1px solid var(--border-default); border-bottom: 1px solid var(--border-default); overflow: hidden; padding: 16px 0; background: var(--bg-subtle); }
.strip-inner { display: flex; gap: 64px; animation: marquee 30s linear infinite; white-space: nowrap; }
.strip-item { display: flex; align-items: center; gap: 12px; font-size: var(--text-sm); color: var(--fg-secondary); flex-shrink: 0; }
.strip-dot { width: 4px; height: 4px; background: var(--gray-400); border-radius: 50%; flex-shrink: 0; }
@keyframes marquee { from { transform: translateX(0); } to { transform: translateX(-50%); } }

/* SECTIONS */
section { padding: 96px 48px; }
.section-inner { max-width: 1200px; margin: 0 auto; }
.section-label {
  font-size: var(--text-xs); font-weight: var(--weight-medium);
  letter-spacing: var(--tracking-widest); text-transform: uppercase;
  color: var(--fg-tertiary); margin-bottom: 16px;
  display: flex; align-items: center; gap: 8px;
}
.section-label::before { content: ''; display: block; width: 16px; height: 1px; background: currentColor; }

/* USE CASES */
.usecases { background: var(--gray-950); color: var(--white); }
.usecases .section-label { color: var(--gray-600); }
.usecases h2 { font-size: clamp(32px, 4vw, 52px); font-weight: 300; letter-spacing: -0.03em; font-variation-settings: 'opsz' 48, 'wght' 300; color: var(--white); max-width: 640px; margin-bottom: 24px; line-height: 1.1; }
.usecases h2 em { font-family: var(--font-serif); font-style: italic; }
.usecases-note { font-size: var(--text-base); color: var(--gray-300); margin-bottom: 40px; max-width: 560px; line-height: var(--leading-relaxed); }
.cases-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1px; background: var(--gray-800); border: 1px solid var(--gray-800); border-radius: 4px; overflow: hidden; }
.case-card { background: var(--gray-950); padding: 40px 36px; display: flex; flex-direction: column; gap: 24px; transition: background var(--transition-fast); cursor: default; }
.case-card:hover { background: var(--gray-900); }
.case-index { font-family: var(--font-mono); font-size: var(--text-xs); color: var(--gray-500); }
.case-title { font-size: var(--text-xl); font-weight: var(--weight-medium); letter-spacing: -0.01em; color: var(--white); line-height: 1.25; }
.case-body { font-size: var(--text-base); color: var(--gray-300); line-height: var(--leading-relaxed); flex: 1; }
.case-modules { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.case-tag { font-family: var(--font-mono); font-size: 11px; color: var(--gray-500); border: 1px solid var(--gray-800); border-radius: 2px; padding: 2px 8px; }

/* MARKETPLACE */
.marketplace { background: var(--bg-default); border-top: 1px solid var(--border-default); }
.marketplace-header { display: flex; align-items: flex-end; justify-content: space-between; gap: 32px; margin-bottom: 48px; }
.marketplace-h2 { font-size: clamp(28px, 3.5vw, 44px); font-weight: 300; letter-spacing: -0.03em; font-variation-settings: 'opsz' 44, 'wght' 300; line-height: 1.1; margin-bottom: 16px; }
.marketplace-h2 em { font-family: var(--font-serif); font-style: italic; }
.marketplace-desc { font-size: var(--text-md); color: var(--fg-secondary); line-height: var(--leading-relaxed); max-width: 480px; }
.marketplace-actions { flex-shrink: 0; display: flex; align-items: center; }
.marketplace-soon { font-size: var(--text-sm); color: var(--fg-tertiary); font-style: italic; }
.mkt-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1px; background: var(--border-default); border: 1px solid var(--border-default); border-radius: 4px; overflow: hidden; }
.mkt-card { background: var(--bg-default); padding: 28px 28px 32px; display: flex; flex-direction: column; gap: 10px; transition: background var(--transition-fast); cursor: default; }
.mkt-card:hover { background: var(--bg-subtle); }
.mkt-card--build { background: var(--bg-subtle); justify-content: center; align-items: flex-start; cursor: pointer; }
.mkt-card--build:hover { background: var(--bg-muted); }
.mkt-build-icon { width: 36px; height: 36px; border: 1px solid var(--border-default); border-radius: 4px; display: flex; align-items: center; justify-content: center; margin-bottom: 4px; }
.mkt-card-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.mkt-tag { font-family: var(--font-mono); font-size: 11px; color: var(--fg-tertiary); }
.mkt-verified { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; color: var(--fg-secondary); font-weight: var(--weight-medium); }
.mkt-community { font-size: 11px; color: var(--fg-tertiary); border: 1px solid var(--border-default); border-radius: 2px; padding: 1px 6px; font-family: var(--font-mono); }
.mkt-name { font-size: var(--text-base); font-weight: var(--weight-medium); letter-spacing: -0.01em; color: var(--fg-primary); }
.mkt-desc { font-size: var(--text-base); color: var(--fg-secondary); line-height: var(--leading-relaxed); }

/* MODULAR */
.modular { background: var(--bg-default); }
.modular-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 80px; align-items: start; margin-top: 64px; }
.modular h2 { font-size: clamp(30px, 3.5vw, 48px); font-weight: 300; letter-spacing: -0.03em; font-variation-settings: 'opsz' 48, 'wght' 300; line-height: 1.1; margin-bottom: 24px; }
.modular h2 em { font-family: var(--font-serif); font-style: italic; }
.modular-desc { font-size: var(--text-md); color: var(--fg-secondary); line-height: var(--leading-relaxed); margin-bottom: 40px; }
.feature-list { list-style: none; display: flex; flex-direction: column; }
.feature-item { display: flex; align-items: flex-start; gap: 16px; padding: 20px 0; border-bottom: 1px solid var(--border-default); }
.feature-item:first-child { border-top: 1px solid var(--border-default); }
.feature-icon { width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; margin-top: 2px; }
.feature-icon svg { width: 16px; height: 16px; stroke: var(--fg-primary); stroke-width: 1.5; }
.feature-text h4 { font-size: var(--text-base); font-weight: var(--weight-medium); margin-bottom: 4px; }
.feature-text p { font-size: var(--text-base); color: var(--fg-secondary); line-height: var(--leading-relaxed); }
.terminal-card { background: var(--gray-950); border: 1px solid var(--gray-800); border-radius: 4px; overflow: hidden; }
.terminal-bar { display: flex; align-items: center; gap: 6px; padding: 12px 16px; border-bottom: 1px solid var(--gray-800); }
.terminal-dot { width: 10px; height: 10px; border-radius: 50%; background: var(--gray-700); }
.terminal-title { font-family: var(--font-mono); font-size: var(--text-xs); color: var(--gray-600); margin-left: 6px; }
.terminal-body { padding: 24px; font-family: var(--font-mono); font-size: 13px; line-height: 1.8; color: var(--gray-300); }
.t-comment { color: var(--gray-700); }
.t-key { color: var(--gray-400); }
.t-string { color: var(--white); }
.t-dim { color: var(--gray-600); }
.t-prompt { color: var(--gray-500); }

/* INTERFACES */
.interfaces { background: var(--bg-subtle); border-top: 1px solid var(--border-default); border-bottom: 1px solid var(--border-default); }
.interfaces h2 { font-size: clamp(28px, 3vw, 44px); font-weight: 300; letter-spacing: -0.03em; font-variation-settings: 'opsz' 44, 'wght' 300; line-height: 1.1; max-width: 520px; margin-bottom: 56px; }
.interfaces h2 em { font-family: var(--font-serif); font-style: italic; }
.interface-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1px; background: var(--border-default); border: 1px solid var(--border-default); border-radius: 4px; overflow: hidden; }
.interface-card { background: var(--bg-subtle); padding: 36px 32px 40px; display: flex; flex-direction: column; gap: 16px; transition: background var(--transition-fast); }
.interface-card:hover { background: var(--bg-default); }
.interface-card-label { font-family: var(--font-mono); font-size: var(--text-xs); color: var(--fg-tertiary); letter-spacing: var(--tracking-wide); }
.interface-card h3 { font-size: var(--text-xl); font-weight: var(--weight-medium); letter-spacing: -0.01em; }
.interface-card p { font-size: var(--text-base); color: var(--fg-secondary); line-height: var(--leading-relaxed); }
.interface-badge { font-family: var(--font-mono); font-size: 11px; color: var(--fg-secondary); border: 1px solid var(--border-default); border-radius: 2px; padding: 3px 8px; display: inline-block; margin-top: auto; }

/* OPEN STRIP */
.open-strip { background: var(--black); color: var(--white); padding: 80px 48px; text-align: center; }
.open-strip h2 { font-size: clamp(32px, 4vw, 56px); font-weight: 300; letter-spacing: -0.03em; font-variation-settings: 'opsz' 56, 'wght' 300; color: var(--white); max-width: 700px; margin: 0 auto 24px; line-height: 1.1; }
.open-strip h2 em { font-family: var(--font-serif); font-style: italic; color: var(--gray-400); }
.open-strip p { font-size: var(--text-md); color: var(--gray-400); margin-bottom: 40px; max-width: 480px; margin-left: auto; margin-right: auto; }
.open-strip .btn-primary { background: var(--white); color: var(--black); border-color: var(--white); padding: 12px 28px; font-size: var(--text-base); }
.open-strip .btn-primary:hover { opacity: 0.85; }
.open-strip .btn-ghost { border-color: var(--gray-700); color: var(--gray-400); padding: 12px 28px; font-size: var(--text-base); }
.open-strip .btn-ghost:hover { background: var(--gray-900); border-color: var(--gray-600); color: var(--white); }
.open-actions { display: flex; align-items: center; justify-content: center; gap: 12px; }
.github-stars { display: flex; align-items: center; gap: 8px; margin-top: 40px; justify-content: center; }
.github-stars span { font-family: var(--font-mono); font-size: var(--text-xs); color: var(--gray-500); }

/* FOOTER */
.oe-footer { padding: 40px 48px; border-top: 1px solid var(--border-default); display: flex; align-items: center; justify-content: space-between; }
.footer-left { display: flex; align-items: center; gap: 24px; }
.footer-logo { display: flex; align-items: center; gap: 10px; opacity: 0.5; }
.footer-logo img { height: 18px; }
.footer-logo span { font-size: var(--text-sm); font-weight: var(--weight-medium); }
.footer-copy { font-size: var(--text-xs); color: var(--fg-tertiary); }
.footer-links { display: flex; gap: 24px; list-style: none; }
.footer-links a { font-size: var(--text-xs); color: var(--fg-tertiary); text-decoration: none; transition: color var(--transition-fast); }
.footer-links a:hover { color: var(--fg-secondary); }

/* ── RESPONSIVE ─────────────────────────────────────────────────────────── */

/* Tablet + mobile: collapse nav links */
@media (max-width: 900px) {
  .oe-nav { padding: 0 24px; }
  .nav-links { display: none; }
}
@media (max-width: 640px) {
  .oe-nav { padding: 0 20px; }
  .nav-cta .btn-ghost { display: none; }
}

/* Hero */
@media (max-width: 768px) {
  .hero { padding: 100px 20px 72px; }
  .hero-waitlist { flex-direction: column; }
  .waitlist-input { width: 100%; }
  .waitlist-btn   { width: 100%; justify-content: center; }
}
@media (max-width: 480px) {
  .hero { padding: 88px 20px 60px; }
}

/* Sections base padding */
@media (max-width: 768px) {
  section { padding: 64px 20px; }
}
@media (max-width: 480px) {
  section { padding: 52px 16px; }
}

/* Use cases grid */
@media (max-width: 768px) {
  .cases-grid { grid-template-columns: 1fr; }
  .case-card  { padding: 28px 24px; }
}
@media (min-width: 769px) and (max-width: 1024px) {
  .cases-grid { grid-template-columns: 1fr 1fr; }
}

/* Marketplace */
@media (max-width: 768px) {
  .marketplace-header { flex-direction: column; align-items: flex-start; gap: 16px; }
  .mkt-grid { grid-template-columns: 1fr; }
}
@media (min-width: 769px) and (max-width: 1024px) {
  .mkt-grid { grid-template-columns: 1fr 1fr; }
}

/* Modular */
@media (max-width: 1024px) {
  .modular-grid { grid-template-columns: 1fr; gap: 48px; margin-top: 40px; }
}

/* Interface grid */
@media (max-width: 768px) {
  .interface-grid { grid-template-columns: 1fr; }
}
@media (min-width: 769px) and (max-width: 1024px) {
  .interface-grid { grid-template-columns: 1fr 1fr; }
}

/* Open strip */
@media (max-width: 768px) {
  .open-strip { padding: 64px 20px; }
  .open-actions { flex-direction: column; align-items: center; }
  .open-strip .btn-primary,
  .open-strip .btn-ghost { width: 100%; justify-content: center; max-width: 320px; }
}

/* Footer */
@media (max-width: 768px) {
  .oe-footer { flex-direction: column; gap: 24px; align-items: flex-start; padding: 40px 20px; }
  .footer-left { flex-direction: column; align-items: flex-start; gap: 10px; }
  .footer-links { flex-wrap: wrap; gap: 16px; }
}
</style>
