#!/usr/bin/env node

import assert from 'node:assert/strict'

const DEFAULT_BASE_URL = 'http://127.0.0.1:3004'
const DEFAULT_ORGANIZATION = 'openexpert-local'

const demoDocuments = [
  {
    institutionSlugs: ['pko-bp'],
    body: {
      kind: 'text',
      title: 'PKO BP — checklista dokumentów do wstępnej analizy',
      textContent: `# PKO BP — checklista dokumentów do wstępnej analizy

> Materiał demonstracyjny do pracy doradcy. Nie jest aktualną instrukcją ani ofertą banku. Przed przekazaniem klientowi zweryfikuj wymagania w bieżących materiałach PKO Banku Polskiego lub PKO Banku Hipotecznego.

## Dane klienta

- dokument tożsamości i podstawowe dane kontaktowe,
- stan cywilny oraz ustrój majątkowy,
- liczba osób w gospodarstwie domowym,
- deklarowany cel, kwota i preferowany okres finansowania,
- informacje o bieżących zobowiązaniach, limitach i kartach.

## Dochody i zatrudnienie

- źródło dochodu oraz okres jego uzyskiwania,
- umowa lub inny dokument potwierdzający podstawę zatrudnienia,
- historia wpływów wynagrodzenia za okres wymagany w aktualnej procedurze,
- informacje o premiach, dodatkach i innych regularnych składnikach,
- zgoda klienta na uzupełnienie braków po analizie wstępnej.

## Nieruchomość i transakcja

- adres, typ i aktualny status prawny nieruchomości,
- cena, wkład własny i harmonogram płatności,
- dokument stanowiący podstawę transakcji,
- numer księgi wieczystej, jeżeli jest już dostępny,
- informacja, czy zakup jest z rynku pierwotnego czy wtórnego.

## Kontrola przed wysłaniem

1. Potwierdź aktualność każdego dokumentu.
2. Sprawdź zgodność danych osobowych i kwot między dokumentami.
3. Oznacz braki oraz właściciela kolejnego kroku.
4. Zweryfikuj listę wymagań banku w dniu złożenia wniosku.`,
    },
  },
  {
    institutionSlugs: ['ing'],
    body: {
      kind: 'text',
      title: 'ING — źródła dochodu: pakiet roboczy',
      textContent: `# ING — źródła dochodu: pakiet roboczy

> Materiał demonstracyjny. Zakres dokumentów może się zmieniać i zależy od sytuacji klienta. Zawsze potwierdź go w aktualnej procedurze ING Banku Śląskiego.

## Umowa o pracę

Zbierz podstawowe informacje o pracodawcy, rodzaju umowy, stażu i wynagrodzeniu. Ustal, które składniki są stałe, a które zmienne. Przygotuj potwierdzenia wpływów oraz dokument zatrudnienia w formie wymaganej na dzień składania wniosku.

## Działalność gospodarcza

Ustal formę opodatkowania, okres prowadzenia działalności, branżę i sezonowość. Przygotuj dokumenty rozliczeniowe, informacje o zobowiązaniach publicznoprawnych oraz wyciągi z rachunku firmowego. Nietypowe lub jednorazowe zdarzenia opisz w notatce doradcy.

## Umowy cywilnoprawne i pozostałe źródła

Sprawdź ciągłość, liczbę zleceniodawców i powtarzalność wpływów. Oddziel dochód regularny od jednorazowego. Jeżeli klient łączy źródła dochodu, przygotuj jedno zestawienie okresów i kwot.

## Pytania kontrolne

- Czy dane na dokumentach są spójne z deklaracją klienta?
- Czy okres historii obejmuje aktualnie wymagane miesiące?
- Czy w dochodzie występują potrącenia, przerwy lub duża zmienność?
- Czy załączniki są kompletne, czytelne i aktualne?
- Które elementy wymagają potwierdzenia przez analityka banku?`,
    },
  },
  {
    institutionSlugs: ['mbank'],
    body: {
      kind: 'text',
      title: 'mBank — dokumentacja nieruchomości: checklista',
      textContent: `# mBank — dokumentacja nieruchomości: checklista

> Materiał demonstracyjny, a nie oficjalna lista mBanku. Przed użyciem operacyjnym sprawdź aktualne wymagania banku dla konkretnego celu i rodzaju nieruchomości.

## Rynek wtórny

- dokument stanowiący podstawę nabycia,
- numer księgi wieczystej i identyfikacja nieruchomości,
- cena, harmonogram i źródło wkładu własnego,
- informacje o sprzedającym oraz ewentualnych obciążeniach,
- dokumenty dodatkowe wynikające ze stanu prawnego lokalu lub domu.

## Rynek pierwotny

- umowa rezerwacyjna albo deweloperska,
- prospekt i dane przedsięwzięcia, jeżeli dotyczą transakcji,
- harmonogram płatności i planowany termin przeniesienia własności,
- informacje o rachunku powierniczym i inwestycji,
- dokumenty wymagane dla miejsca postojowego, komórki lub udziałów.

## Budowa albo remont

- tytuł prawny do nieruchomości,
- zakres, kosztorys i harmonogram prac,
- pozwolenia lub zgłoszenia właściwe dla inwestycji,
- informacja o już poniesionych nakładach,
- plan transz i sposób dokumentowania postępu.

## Walidacja pakietu

Sprawdź zgodność adresu, powierzchni, właścicieli i kwot we wszystkich źródłach. Oznacz dokumenty wygasające oraz warunki, które trzeba spełnić przed uruchomieniem finansowania. Każdą niejasność prawną skieruj do weryfikacji przed złożeniem kompletnego wniosku.`,
    },
  },
  {
    institutionSlugs: ['ing', 'mbank'],
    body: {
      kind: 'dynamic_html',
      title: 'ING i mBank — interaktywny plan kompletowania dokumentów',
      htmlContent: `<main class="oe-page">
  <header class="oe-hero">
    <div><span class="oe-kicker">OpenExpert · materiał demonstracyjny</span><h1>Plan kompletowania dokumentów</h1></div>
    <span class="oe-count" id="progress">0 / 6</span>
  </header>
  <p class="oe-note">To robocza pomoc powiązana z ING i mBankiem, nie oficjalna lista wymagań. Przed złożeniem wniosku potwierdź aktualną procedurę wybranej instytucji.</p>
  <nav class="oe-tabs" aria-label="Etapy procesu">
    <button class="is-active" data-stage="client">Klient</button>
    <button data-stage="property">Nieruchomość</button>
    <button data-stage="review">Weryfikacja</button>
  </nav>
  <section class="oe-list" data-panel="client">
    <label><input type="checkbox"><span><strong>Profil i zobowiązania</strong><small>Dane gospodarstwa, limity, kredyty i oczekiwany wariant finansowania.</small></span></label>
    <label><input type="checkbox"><span><strong>Źródło dochodu</strong><small>Historia, stabilność i dokumenty dopasowane do formy zatrudnienia.</small></span></label>
  </section>
  <section class="oe-list" data-panel="property" hidden>
    <label><input type="checkbox"><span><strong>Podstawa transakcji</strong><small>Umowa, cena, harmonogram oraz źródło wkładu własnego.</small></span></label>
    <label><input type="checkbox"><span><strong>Stan prawny</strong><small>Księga wieczysta, właściciele, obciążenia i elementy dodatkowe.</small></span></label>
  </section>
  <section class="oe-list" data-panel="review" hidden>
    <label><input type="checkbox"><span><strong>Spójność danych</strong><small>Nazwiska, adresy, daty i kwoty są zgodne w całym pakiecie.</small></span></label>
    <label><input type="checkbox"><span><strong>Aktualne wymagania</strong><small>Lista została potwierdzona dla wybranego banku i sytuacji klienta.</small></span></label>
  </section>
  <footer><span id="status">Zacznij od profilu klienta</span><button id="reset">Wyczyść postęp</button></footer>
</main>`,
      cssContent: `:root{font-family:Inter,ui-sans-serif,system-ui,sans-serif;color:#171a18;background:#f2f4f1}.oe-page{max-width:820px;margin:32px auto;padding:28px;background:#fff;border:1px solid #dfe3de;border-radius:20px;box-shadow:0 22px 60px rgba(29,35,30,.09)}.oe-hero{display:flex;align-items:flex-start;justify-content:space-between;gap:24px}.oe-kicker{color:#6e756f;font-size:11px;font-weight:750;letter-spacing:.08em;text-transform:uppercase}h1{margin:8px 0 0;font-size:34px;line-height:1.05;letter-spacing:-.04em}.oe-count{border-radius:999px;background:#e9f5ed;padding:8px 12px;color:#22653b;font-size:12px;font-weight:750}.oe-note{margin:22px 0;color:#626963;font-size:13px;line-height:1.55}.oe-tabs{display:flex;gap:5px;border-bottom:1px solid #e4e7e3}.oe-tabs button{border:0;border-bottom:2px solid transparent;background:transparent;padding:11px 14px;color:#747b75;font-weight:700;cursor:pointer}.oe-tabs button.is-active{border-color:#2f7d4b;color:#1d572f}.oe-list{display:grid;gap:10px;padding:18px 0}.oe-list label{display:flex;gap:12px;border:1px solid #e3e7e2;border-radius:14px;padding:15px;cursor:pointer}.oe-list label:has(input:checked){border-color:#9bc9aa;background:#f0f8f2}.oe-list input{width:18px;height:18px;accent-color:#2f7d4b}.oe-list span{display:flex;flex-direction:column;gap:4px}.oe-list strong{font-size:14px}.oe-list small{color:#727973;line-height:1.45}footer{display:flex;align-items:center;justify-content:space-between;gap:12px;border-top:1px solid #e4e7e3;padding-top:17px;color:#646b65;font-size:12px}footer button{border:1px solid #dfe3de;border-radius:10px;background:#fff;padding:8px 11px;font-weight:700;cursor:pointer}@media(max-width:620px){.oe-page{margin:0;border-radius:0;padding:20px}.oe-hero{align-items:center}h1{font-size:27px}}`,
      javascriptContent: `const tabs=[...document.querySelectorAll('[data-stage]')];const panels=[...document.querySelectorAll('[data-panel]')];const boxes=[...document.querySelectorAll('input[type="checkbox"]')];const progress=document.querySelector('#progress');const status=document.querySelector('#status');function update(){const done=boxes.filter(box=>box.checked).length;progress.textContent=done+' / '+boxes.length;status.textContent=done===boxes.length?'Pakiet gotowy do końcowej weryfikacji':done?'Uzupełniono '+done+' z '+boxes.length+' kroków':'Zacznij od profilu klienta'}tabs.forEach(tab=>tab.addEventListener('click',()=>{tabs.forEach(item=>item.classList.toggle('is-active',item===tab));panels.forEach(panel=>panel.hidden=panel.dataset.panel!==tab.dataset.stage)}));boxes.forEach(box=>box.addEventListener('change',update));document.querySelector('#reset').addEventListener('click',()=>{boxes.forEach(box=>box.checked=false);update()});update();`,
    },
  },
]

function readArguments(argv) {
  const result = {
    apply: false,
    baseUrl: DEFAULT_BASE_URL,
    organization: DEFAULT_ORGANIZATION,
    confirm: '',
  }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--apply') result.apply = true
    else if (argument === '--base-url') result.baseUrl = argv[++index] ?? ''
    else if (argument === '--organization') result.organization = argv[++index] ?? ''
    else if (argument === '--confirm') result.confirm = argv[++index] ?? ''
    else if (argument === '--help') {
      console.log('Usage: pnpm --filter @openexpert/crm seed:knowledge-demo [--apply --organization openexpert-local --confirm openexpert-local]')
      process.exit(0)
    }
    else throw new Error(`Unknown argument: ${argument}`)
  }
  return result
}

function isLocalBaseUrl(value) {
  const url = new URL(value)
  return url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname)
}

function responseCookies(response) {
  const values = response.headers.getSetCookie?.() ?? []
  assert.ok(values.length, 'Better Auth did not return a session cookie')
  return values.map(value => value.split(';', 1)[0]).join('; ')
}

async function loginCookie(baseUrl) {
  const response = await fetch(`${baseUrl}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      origin: new URL(baseUrl).origin,
    },
    body: JSON.stringify({
      email: process.env.OPENEXPERT_DEV_EMAIL ?? 'admin@openexpert.local',
      password: process.env.OPENEXPERT_DEV_PASSWORD ?? 'OpenExpert123!',
    }),
    redirect: 'error',
  })
  const detail = await response.text()
  assert.equal(response.ok, true, `Better Auth login failed: HTTP ${response.status} ${detail}`)
  return responseCookies(response)
}

async function api(baseUrl, path, cookie, init = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      accept: 'application/json',
      cookie,
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...init.headers,
    },
    redirect: 'error',
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`HTTP ${response.status} ${text}`)
  return text ? JSON.parse(text) : null
}

function sameDocument(existing, desiredBody, institutionIds) {
  const fields = desiredBody.kind === 'text'
    ? ['kind', 'title', 'textContent']
    : ['kind', 'title', 'htmlContent', 'cssContent', 'javascriptContent']
  const sameContent = fields.every(field => (existing[field] ?? '') === (desiredBody[field] ?? ''))
  const existingIds = (existing.institutions ?? []).map(institution => institution.id).sort()
  return sameContent && JSON.stringify(existingIds) === JSON.stringify([...institutionIds].sort())
}

async function main() {
  const options = readArguments(process.argv.slice(2))
  if (!options.organization) throw new Error('Organization slug is required')
  if (!isLocalBaseUrl(options.baseUrl)) throw new Error('This demo seed is restricted to a local CRM URL')

  console.log(`Knowledge demo seed: ${demoDocuments.length} documents for ${options.organization}`)
  for (const document of demoDocuments) {
    console.log(`- ${document.body.title} [${document.institutionSlugs.join(', ')}]`)
  }
  if (!options.apply) {
    console.log('\nDry run only. Add --apply --confirm <organization> to write through the Knowledge API.')
    return
  }
  if (options.confirm !== options.organization) {
    throw new Error(`Confirmation must exactly match organization slug: --confirm ${options.organization}`)
  }

  const cookie = await loginCookie(options.baseUrl)
  const apiBase = `/api/org/${encodeURIComponent(options.organization)}/experiments/knowledge`
  try {
    const listResponse = await api(options.baseUrl, apiBase, cookie)
    const institutionsBySlug = new Map(
      (listResponse.meta.institutions ?? []).map(institution => [institution.slug, institution]),
    )
    const existingByTitle = new Map(listResponse.data.map(document => [document.title, document]))

    for (const seedDocument of demoDocuments) {
      const institutions = seedDocument.institutionSlugs.map((slug) => {
        const institution = institutionsBySlug.get(slug)
        if (!institution) throw new Error(`Financial institution is missing from the catalog: ${slug}`)
        return institution
      })
      const institutionIds = institutions.map(institution => institution.id)
      const existingListItem = existingByTitle.get(seedDocument.body.title)

      if (!existingListItem) {
        const response = await api(options.baseUrl, apiBase, cookie, {
          method: 'POST',
          body: JSON.stringify({ ...seedDocument.body, institutionIds }),
        })
        console.log(`created  ${response.data.title} (${response.data.indexingStatus})`)
        continue
      }

      const detailResponse = await api(
        options.baseUrl,
        `${apiBase}/${encodeURIComponent(existingListItem.id)}`,
        cookie,
      )
      if (sameDocument(detailResponse.data, seedDocument.body, institutionIds)) {
        console.log(`unchanged ${detailResponse.data.title}`)
        continue
      }
      const response = await api(
        options.baseUrl,
        `${apiBase}/${encodeURIComponent(existingListItem.id)}`,
        cookie,
        {
          method: 'PUT',
          body: JSON.stringify({
            ...seedDocument.body,
            institutionIds,
            expectedRevision: detailResponse.data.revision,
          }),
        },
      )
      console.log(`updated  ${response.data.title} (${response.data.indexingStatus})`)
    }
  }
  finally {
    await fetch(`${options.baseUrl}/api/auth/sign-out`, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        cookie,
        origin: new URL(options.baseUrl).origin,
      },
      body: '{}',
    }).catch(() => {})
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
