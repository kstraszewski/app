# Design QA — Organization Design System

final result: passed

## Scope

- Route: `/org/openexpert-local-04b35ead/settings/design`
- Source visual: `/Users/konradstraszewski/.codex/generated_images/019f8b0a-ee22-78c1-a094-5991403e41c6/exec-5571f5ad-1547-4fd9-aa01-a1807dc1afcc.png`
- Implementation: `app/pages/org/[organizationSlug]/settings/design.vue`
- Source and comparison viewport: `1487 × 1058`, device pixel ratio `1`
- Final browser handoff viewport: browser default (`1280 × 720` during verification)

## Evidence

- Source + first implementation comparison: `/private/tmp/openexpert-design-qa/comparison-pass-1.png`
- First implementation screenshot: `/private/tmp/openexpert-design-qa/implementation-pass-1.png`
- Source + corrected implementation comparison: `/private/tmp/openexpert-design-qa/comparison-pass-2.png`
- Source + matched dirty-state comparison: `/private/tmp/openexpert-design-qa/comparison-matched-state.png`
- Corrected implementation screenshot: `/private/tmp/openexpert-design-qa/implementation-pass-2.png`
- Responsive screenshot at `768 × 900`: `/private/tmp/openexpert-design-qa/responsive-768x900.png`
- Final clean-state screenshot: `/private/tmp/openexpert-design-qa/implementation-final-default-viewport.png`

## Focused comparison

| Area | Source intent | Verified implementation |
| --- | --- | --- |
| Page hierarchy | Title and compact actions above one continuous workspace | Preserved, with the product's existing organization settings switcher retained above the workspace |
| Section navigation | Horizontal, low-noise tabs with an underline | Horizontal Nuxt UI tabs use a two-pixel active underline and truthful section progress |
| Workspace | Form and live preview share one bordered surface | Full-bleed surface starts at the content edge and uses a `45/55` form/preview split |
| Brand form | Identity fields followed by a separate navigation group | `Tożsamość produktu` and `Nawigacja` are visually separated with consistent field rhythm |
| Preview | Prominent application preview with an alternate brand state | Authentic CRM mini-dashboard and a working `Aplikacja / Marka` switch |
| Density | Compact controls and restrained action hierarchy | One solid primary action, compact utility actions, consistent control sizing |
| Responsive behavior | Desktop-first composition that degrades cleanly | No horizontal overflow at `768 × 900` or `390 × 844`; workspace stacks below the desktop breakpoint |

## Iteration history

### Pass 1

- P1: preview column was too narrow relative to the selected visual.
- P1: the workspace was inset from the product sidebar instead of reading as one continuous design surface.
- P2: the active section rendered as a large filled pill rather than the selected visual's understated underline.

Corrections:

- Changed the desktop split from form-heavy to preview-heavy (`0.9fr / 1.1fr`).
- Extended the workspace to the content edges while preserving responsive gutters.
- Restyled only the editor's section indicator as an underline; preview-state tabs remain segmented controls.

### Pass 2

- No remaining P0, P1, or P2 visual issues.
- Accepted product-context differences: the existing organization settings switcher remains visible, and the preview uses a real task list instead of introducing a new chart dependency.

### Implementation review

- Disabled the complete editor fieldset when the organization is read-only.
- Added an explicit fetch-error status and alert instead of silently presenting default settings.
- Updated Nuxt UI card selectors to the v4 `data-slot` contract.
- Clarified that the progress bar represents section position, not form completion.

## Interaction and runtime checks

- `Marka → Kolory → Marka` switches sections; the `Kolory` heading and `40%` section progress were observed.
- Editing the product name exposes `Niezapisane zmiany` and enables `Zapisz zmiany`.
- Discard restores `OpenExpert`, returns the clean status, and disables save.
- `Aplikacja → Marka → Aplikacja` switches between the mini CRM and both logo surfaces.
- Browser console after desktop and responsive checks: `0` warnings, `0` errors.
- Nuxt typecheck: passed; only the pre-existing duplicated `caseUuidPattern` import warning was emitted.

---

# Design QA — lista zgód

## Comparison target

- Source visual truth: `/Users/konradstraszewski/.codex/generated_images/019f9504-a44e-7a70-bbf6-95de66c894ab/call_yZW56CEWos80n3Jpe8VMuwhg.png`
- Implementation screenshot: `/Users/konradstraszewski/Documents/GitHub/app/apps/crm/design-qa-consents-list-dark.png`
- Full-view comparison: `/Users/konradstraszewski/Documents/GitHub/app/apps/crm/design-qa-consents-comparison.png`
- Focused header/register comparison: `/Users/konradstraszewski/Documents/GitHub/app/apps/crm/design-qa-consents-focused.png`
- Detail-page evidence: `/Users/konradstraszewski/Documents/GitHub/app/apps/crm/design-qa-consent-detail-dark.png`
- Responsive evidence: `/Users/konradstraszewski/Documents/GitHub/app/apps/crm/design-qa-consents-list-mobile.png`
- State: dark theme, `Definicje` active, three published definitions, no hover.
- Browser viewport and CSS size: `1440 × 1024`.
- Source pixels: `1487 × 1058`, normalized to `1440 × 1024` for comparison.
- Implementation pixels: `1440 × 1024`, `devicePixelRatio: 1`.

## Findings

- No actionable P0, P1, or P2 mismatch remains.
- The implementation preserves the selected direction: a list-first registry, one primary action, compact legal notice, operational filters, semantic status badges, and a separate route for consent details.
- The tabs are centered inside the reusable page header rather than placed below the title. This is an intentional adjustment that follows the requested `title → optional tabs → actions` CRM pattern.
- Existing CRM navigation, typography, control height, and spacing tokens are retained. The resulting register is slightly denser than the generated concept but remains legible and consistent with the rest of the product.

## Required fidelity surfaces

- Fonts and typography: DM Sans and the existing mono metadata font are used consistently. Hierarchy, weights, line height, wrapping, and uppercase metadata match the product system and remain readable at both tested viewports.
- Spacing and layout rhythm: header columns, divider, legal notice, filters, row grid, 84 px row rhythm, and responsive stacking align cleanly. No horizontal overflow at `1440 × 1024` or `390 × 844`.
- Colors and visual tokens: near-black surfaces, neutral dividers, white primary action, restrained green published status, and amber legal warning use the existing design tokens and match the selected direction.
- Image quality and asset fidelity: the target contains no raster content that needs reproduction. Existing product branding is preserved, and all UI symbols use the installed icon library.
- Copy and content: Polish labels, consent codes, channels, statuses, version numbers, helper text, and back-navigation copy are present and correct.

## Interaction and browser checks

- Search reduced the register from three rows to the matching telephone consent.
- `Historia zmian` updated the URL, active tab, and rendered version history; clearing search restored all three versions.
- Clicking a consent navigated to its separate detail route.
- `Wróć do zgód` returned from the detail route to the registry.
- `/consents/new` rendered an editable creation form with the same back action.
- Desktop and mobile layouts were checked for overflow and responsive reflow.
- No application runtime errors were found. The local preview reported only Vite HMR WebSocket connection errors specific to the browser sandbox; page loading and interactions remained functional.

## Comparison history

1. Initial comparison found a P2 copy issue in the count label: `3 zgód`.
2. The Polish pluralization was corrected to `3 zgody` and the desktop implementation was recaptured.
3. The post-fix full and focused comparisons show no remaining actionable P0/P1/P2 issue.

## Follow-up polish

- P3: a dedicated hover-state screenshot could be added later; the row hover and chevron motion are already implemented and functional.

## Implementation checklist

- [x] Reusable CRM page header with title, optional description, optional tabs, optional back link, meta, and actions.
- [x] List-first consent register.
- [x] Separate consent detail and creation routes.
- [x] Working search, filters, history tab, row navigation, and back navigation.
- [x] Responsive desktop and mobile layout.
- [x] Typecheck and visual QA.

final result: passed

---

# Design QA — rejestr instytucji

## Comparison target

- Source visual truth: `/Users/konradstraszewski/Documents/GitHub/app/apps/crm/design-qa-consents-list-dark.png` — zaakceptowany i wdrożony wariant 1 wzorca CRM „lista → szczegóły”.
- Implementation screenshot: `/Users/konradstraszewski/Documents/GitHub/app/apps/crm/design-qa-institutions-list-dark.png`.
- Settings-page evidence: `/Users/konradstraszewski/Documents/GitHub/app/apps/crm/design-qa-institutions-settings-dark.png`.
- Full-view comparison: `/Users/konradstraszewski/Documents/GitHub/app/apps/crm/design-qa-institutions-comparison.png`.
- State: dark theme, `Instytucje` active, five institutions, no search filter, no hover.
- Source pixels: `1440 × 1024`; implementation pixels: `1280 × 816`; both captures use `devicePixelRatio: 1`.
- Comparison normalization: both captures scaled proportionally to `640 px` width and composited side by side on a `1280 × 455` canvas. The comparison judges the shared CRM pattern rather than identical domain content.

## Findings

- No actionable P0, P1, or P2 mismatch remains.
- The implementation follows the accepted pattern: reusable page header, centered section tabs, utility actions on the right, compact contextual notice, operational filter bar, continuous register rows, and a separate institution route.
- Editing no longer competes with the list. It lives under `Ustawienia i historia` inside the institution profile, with a visible `Wróć do instytucji` action.
- The institution register intentionally adds real bank logos and a website column. These are domain-specific improvements and do not change the hierarchy of the reference pattern.

## Required fidelity surfaces

- Fonts and typography: the existing CRM display, body, and mono metadata styles are preserved. Header hierarchy, uppercase eyebrow/column labels, row weights, wrapping, and truncation are consistent with the consent register.
- Spacing and layout rhythm: header columns, divider, notice, toolbar, row grid, 76 px row rhythm, and logo alignment form one continuous scan path. The table collapses to identity, status, and chevron below `820 px`.
- Colors and visual tokens: near-black surfaces, neutral borders, restrained green visibility states, primary active underline, and muted supporting copy all use the existing product tokens.
- Image quality and asset fidelity: actual institution logos from the API are used with `object-fit: contain`, preserved background colors, clear masks, and text initials only when the source has no logo. All interface symbols come from the installed Lucide icon set.
- Copy and content: Polish labels clearly distinguish visibility, organization overrides, source data, products, profile navigation, and destructive reset behavior.

## Interaction and runtime checks

- Search for `ING` reduced the register from five institutions to one matching result.
- Clicking the ING row opened its separate profile route.
- `Ustawienia i historia` updated the URL to `?view=settings` and rendered the existing visibility, name, website, notes, logo, reset, save, and audit controls.
- `Wróć do instytucji` returned to the registry.
- The `Produkty` page-header tab navigated to `/settings/products`.
- Desktop source/implementation comparison and the full settings view were visually inspected. Responsive breakpoints were reviewed in both updated pages; a separate mobile capture was not produced because the active in-app browser window did not expose viewport resizing in this QA session.
- No institution-page runtime error appeared in the local server log. The preview emitted only pre-existing warnings about a duplicated `caseUuidPattern` import, a missing `wallet-cards` icon elsewhere in the app, and an occupied HMR WebSocket port.
- `pnpm --dir apps/crm typecheck`: passed.
- `pnpm --dir apps/crm build`: passed with the existing engine, sourcemap, duplicated-import, and chunk-size warnings.

## Comparison history

1. The first full-view comparison found no actionable P0/P1/P2 visual issue.
2. No visual fix was required after comparison; the list and settings captures are the final evidence.

## Follow-up polish

- P3: add a dedicated `390 × 844` mobile screenshot when viewport resizing is available in the selected in-app browser. The implemented breakpoints already reduce the register and settings form to single-column mobile layouts.

## Implementation checklist

- [x] List-first institution register.
- [x] Working search and organization-specific filters.
- [x] Separate institution profile.
- [x] Reusable page header tabs and `Wróć do instytucji`.
- [x] Existing edit, logo, reset, history, and product actions preserved.
- [x] Typecheck, production build, interaction checks, and visual comparison.

final result: passed

---

# Design QA — Sprawy i wspólny PageHeader

## Comparison target

- Source visual truth: `/Users/konradstraszewski/Documents/GitHub/app/apps/crm/design-qa-consents-list-dark.png` — zaakceptowany wariant 1 wzorca CRM „rejestr → karta szczegółów”.
- Implementation screenshot: `/Users/konradstraszewski/Documents/GitHub/app/apps/crm/design-qa-cases-list-dark.png`.
- Detail-page evidence: `/Users/konradstraszewski/Documents/GitHub/app/apps/crm/design-qa-case-detail-dark.png`.
- Responsive evidence: `/Users/konradstraszewski/Documents/GitHub/app/apps/crm/design-qa-cases-list-mobile.png` oraz `/Users/konradstraszewski/Documents/GitHub/app/apps/crm/design-qa-case-detail-mobile.png`.
- Full-view comparison: `/Users/konradstraszewski/Documents/GitHub/app/apps/crm/design-qa-cases-comparison.png`.
- State: dark theme, lista bez filtrów z jedną sprawą oraz karta sprawy z aktywnym `Podsumowaniem`.
- Browser viewport i CSS size: `1440 × 1024`; mobile: `390 × 844`.
- Source pixels: `1440 × 1024`.
- Implementation pixels: `1440 × 1024` po znormalizowaniu surowego zrzutu `2880 × 2048` do rozmiaru CSS; przeglądarka raportowała `devicePixelRatio: 1`.
- Full-view comparison: źródło i implementacja zostały złożone obok siebie na jednym obrazie `1440 × 512`.
- Focused comparison: osobny zrzut karty sprawy pokazuje czytelnie nagłówek, akcję `Wróć do spraw`, metadane, cztery zakładki z licznikami oraz główne akcje. Dodatkowe wycinanie regionu nie było potrzebne.

## Findings

- Nie pozostała żadna możliwa do działania rozbieżność P0, P1 ani P2.
- Rejestr Spraw zachowuje zaakceptowaną hierarchię: wspólny PageHeader, jedna główna akcja, narzędzia filtrowania, ciągły rejestr i przejście w oddzielną kartę sprawy.
- Karta sprawy używa tego samego nagłówka z akcją powrotu, opisem, metadanymi, zakładkami i akcjami po prawej. Przy czterech zakładkach nagłówek przechodzi w kontrolowany drugi wiersz zamiast ściskać lub ucinać nawigację.
- Przekazanie PageHeader przez `CrmShell` obejmuje wszystkie właściwe widoki CRM. Trzy strony bez `CrmShell` są wyłącznie przekierowaniami i nie renderują własnego interfejsu.

## Required fidelity surfaces

- Fonts and typography: istniejące style display, body i mono metadata są zachowane. Nagłówki, opisy, etykiety kolumn, liczniki i metadane mają spójną wagę, interlinię i hierarchię; długi tytuł sprawy poprawnie zawija się mobilnie.
- Spacing and layout rhythm: divider nagłówka, łączony toolbar z tabelą, wiersze rejestru i dwuwierszowy wariant wielu zakładek tworzą spójny rytm. Nie ma poziomego overflow całej strony przy `1440 × 1024` ani `390 × 844`.
- Colors and visual tokens: czarne powierzchnie, neutralne obramowania, biała akcja główna, zielony stan i bursztynowe blokery korzystają z istniejących tokenów CRM i zachowują kontrast.
- Image quality and asset fidelity: wzorzec nie wymaga obrazów rastrowych. Branding pochodzi z istniejących assetów produktu, a symbole interfejsu z zainstalowanej biblioteki ikon; nie dodano zastępczych rysunków CSS ani SVG.
- Copy and content: polskie opisy rejestru, filtrów, metadanych, zakładek, pustego wyniku, tworzenia sprawy i akcji powrotu są spójne i zrozumiałe poza kontekstem projektu.
- Icons and controls: ikony mają wspólną rodzinę, rozmiar i optyczne wyrównanie. Akcje nagłówka, filtry, liczniki zakładek i chevrony pozostają semantycznymi kontrolkami z nazwami dostępnymi.

## Interaction, accessibility and runtime checks

- Kliknięcie wiersza rejestru otworzyło osobną kartę sprawy.
- `Historia` zaktualizowała query do `?view=history` oraz aktywną zakładkę.
- `Wróć do spraw` poprawnie wróciło do rejestru.
- Wyszukiwanie `Remont` zachowało jedną pasującą sprawę i zsynchronizowało `?q=Remont`; niepasujące hasło pokazało stan pusty, a wyczyszczenie filtrów przywróciło rejestr.
- `Nowa sprawa` otworzyła opisany semantycznie dialog; `Anuluj` zamknęło go bez zapisu danych.
- Desktop i mobile sprawdzono pod kątem overflow. Mobilny rejestr układa filtry pionowo, a zakładki karty mają lokalny przewijany obszar zamiast rozszerzać viewport.
- Kontrola konsoli nie wykazała błędu aplikacji. Pojawiły się jedynie błędy połączenia Vite HMR WebSocket właściwe dla sandboxu przeglądarki; routing, dane i interakcje działały poprawnie.
- `pnpm --dir apps/crm typecheck`: passed.
- `pnpm --dir apps/crm build`: passed z istniejącymi ostrzeżeniami o wersji Node, sourcemapach i zduplikowanym imporcie `caseUuidPattern`.

## Comparison history

1. Pierwsza kontrola karty sprawy wykazała P2: cztery zakładki pozostawały w trzykolumnowym wariancie nagłówka, przez co ich obszar miał `552 px` szerokości i `610 px` zawartości.
2. `CrmPageHeader` otrzymał wariant `crm-page-header--many-tabs`, który przenosi nawigację do pełnego drugiego wiersza.
3. Po poprawce obszar zakładek ma `1128 px` szerokości, `scrollWidth` równy `clientWidth`, a cała strona nie przekracza viewportu. Zrzuty desktopowe i mobilne są końcowym dowodem.

## Follow-up polish

- P3: przy większej liczbie spraw warto dodać osobny zrzut QA dla paginacji; istniejący rejestr zachowuje już jej dotychczasową logikę.

## Implementation checklist

- [x] List-first rejestr Spraw.
- [x] Oddzielna karta sprawy.
- [x] Wspólny PageHeader z opisem, metadanymi, opcjonalnymi zakładkami, akcjami i `Wróć`.
- [x] Zakładki z licznikami oraz bezpieczny wariant dla wielu zakładek.
- [x] PageHeader rozprowadzony przez `CrmShell` po głównych modułach CRM.
- [x] Akcje powrotu na kartach klientów, zespołów, placówek, ofert hipotecznych i administracji zdolności.
- [x] Testy wyszukiwania, zakładek, dialogu, nawigacji, desktopu i mobile.
- [x] Typecheck, build i wizualne QA.

final result: passed

---

# Design QA — globalny odstęp zakładek PageHeader

## Comparison target

- Source visual truth: `/var/folders/m6/ync19sd96gz4pg73zt0mq_6m0000gn/T/codex-clipboard-b7d70ccf-ccb2-4059-a002-aed6d20ce63e.png` — wskazany przez użytkownika stan z nadmiernym odstępem.
- Browser-rendered implementation: `/Users/konradstraszewski/Documents/GitHub/app/apps/crm/design-qa-page-header-full.png`.
- Focused implementation crop: `/Users/konradstraszewski/Documents/GitHub/app/apps/crm/design-qa-page-header-spacing-after.png`.
- Side-by-side comparison: `/Users/konradstraszewski/Documents/GitHub/app/apps/crm/design-qa-page-header-spacing-comparison.png`.
- State: dark theme, karta sprawy, aktywna zakładka `Kredyt i oferty`.
- Browser viewport: `1280 × 720` CSS px, `devicePixelRatio: 2`.
- Source pixels: `1784 × 166`; focused implementation pixels: `1784 × 168` po normalizacji kadru do wspólnego rozmiaru.

## Findings

- Nie pozostała żadna możliwa do działania rozbieżność P0, P1 ani P2.
- Odstęp etykiety aktywnej zakładki od dolnego separatora zmniejszył się do `16.5 px` w wariancie z czterema zakładkami i `13 px` w standardowym wariancie z dwiema zakładkami.
- Cała strona zachowuje `scrollWidth` równy szerokości viewportu; poprawka nie wprowadza poziomego overflow.

## Required fidelity surfaces

- Fonts and typography: rodzina, rozmiar, waga, line-height i optyczna hierarchia zakładek pozostały bez zmian.
- Spacing and layout rhythm: usunięto `18 px` dolnego paddingu nagłówka z zakładkami, aktywną linię ustawiono `1 px` nad separatorem, a wysokość zakładki zmniejszono z `42 px` do `36 px`.
- Colors and visual tokens: kolory tekstu, tła, separatora, liczników i aktywnej linii nadal korzystają z istniejących tokenów.
- Image quality and asset fidelity: zmiana nie dodaje ani nie modyfikuje assetów; ikony pozostają z istniejącej biblioteki.
- Copy and content: etykiety, liczniki i adresy zakładek pozostały bez zmian.

## Interaction and runtime checks

- Aktywna zakładka `Kredyt i oferty` nadal jest poprawnie oznaczona i zachowuje właściwy URL.
- Standardowy PageHeader na stronie Zgód oraz wariant `many-tabs` na karcie Spraw mają ten sam skrócony rytm pionowy.
- Konsola przeglądarki: brak ostrzeżeń i błędów po poprawce.
- `pnpm --dir apps/crm typecheck`: passed z istniejącym ostrzeżeniem o zduplikowanym imporcie `caseUuidPattern`.

## Comparison history

1. Stan wejściowy miał P2: aktywna linia była wizualnie odsunięta od treści zakładki przez połączenie `18 px` paddingu nagłówka i pozycji pseudo-elementu `bottom: -19px`.
2. Wspólny `CrmPageHeader` otrzymał wariant `with-tabs`, zerowy dolny padding, kompaktową wysokość `36 px` oraz linię przy `bottom: -1px`.
3. Końcowy zrzut i pomiary potwierdzają spójny, skrócony odstęp we wszystkich wariantach komponentu.

## Implementation checklist

- [x] Globalna poprawka w jednym współdzielonym komponencie.
- [x] Wariant standardowy i `many-tabs`.
- [x] Zachowane ikony, liczniki, typografia, routing i stany aktywne.
- [x] Kontrola overflow, konsoli i typecheck.

final result: passed

---

# Design QA — układ zakładek i akcji PageHeader

## Comparison target

- Source visual truth: `/var/folders/m6/ync19sd96gz4pg73zt0mq_6m0000gn/T/codex-clipboard-a7e740dd-6940-4c55-b1bd-0ff81f25c245.png` — wskazany przez użytkownika stan z zakładkami w środku nagłówka i akcjami rozbitymi na dwa poziomy.
- Browser-rendered implementation: `/Users/konradstraszewski/Documents/GitHub/app/apps/crm/design-qa-widget-page-header-after.png`.
- Focused side-by-side comparison: `/Users/konradstraszewski/Documents/GitHub/app/apps/crm/design-qa-widget-page-header-comparison.png`.
- State: dark theme, karta aktywnego widgetu, aktywna zakładka `Personalizacja`, akcja zapisu w stanie disabled.
- Implementation viewport: `1280 × 720` CSS px, `devicePixelRatio: 2`.
- Source pixels: `2174 × 744` przy gęstości `144 dpi`; implementation pixels: `1280 × 720`.
- Normalizacja: źródłowy kadr nagłówka `2174 × 600` i implementacyjny kadr `1032 × 300` zostały dopasowane z zachowaniem proporcji do dwóch paneli `1000 × 300`. Różna szerokość oryginalnych viewportów została zachowana jako znane ograniczenie i nie była traktowana jako błąd.

## Findings

- Nie pozostała żadna możliwa do działania rozbieżność P0, P1 ani P2.
- Zakładki tworzą teraz osobny, pełnoszeroki dolny wiersz nagłówka. Ich początek jest wyrównany do lewej krawędzi treści, a aktywna linia dotyka separatora.
- Wszystkie trzy akcje widgetu mają wspólny poziom `y: 163.43 px`, wysokość `40 px` i nie zawijają się. Akcja główna jest pełna, akcja otwierająca obrysowana, a dezaktywacja ma wariant ghost.
- Nagłówek i dokument zachowują szerokość viewportu: `scrollWidth: 1280`, `clientWidth: 1280`.

## Required fidelity surfaces

- Fonts and typography: rodzina, skala, wagi, line-height i hierarchia tytułu, opisu, metadanych oraz zakładek pozostały spójne z CRM. Etykiety akcji nie zawijają się ani nie są ucinane.
- Spacing and layout rhythm: copy i akcje tworzą pierwszy wiersz z tym samym dołem `203.43 px`; zakładki zaczynają się niżej przy `221.43 px` i kończą na separatorze przy `257.43 px`. Układ nie miesza już metadanych, zakładek i akcji w jednym paśmie.
- Colors and visual tokens: zachowano istniejące neutralne tło, separator, tekst muted/highlighted oraz primary dla akcji głównej i aktywnej zakładki.
- Image quality and asset fidelity: ekran nie wymaga obrazów rastrowych. Ikony pozostają z istniejącej biblioteki Nuxt Icon; nie dodano zastępczych SVG, CSS-art ani symboli tekstowych.
- Copy and content: tytuł, opis, metadane, etykiety zakładek, powrót i nazwy akcji pozostały bez zmian.

## Interaction and runtime checks

- Kliknięcie `Podgląd i publikacja` ustawiło URL `?view=publish` i przeniosło klasę aktywną na właściwą zakładkę.
- Ten sam dolny wiersz zakładek sprawdzono na globalnym PageHeader strony Zgód; copy, akcje i zakładki zachowują tę samą kolejność i nie powodują overflow.
- Konsola nie wykazała błędów aplikacji. Pozostaje wcześniejsze ostrzeżenie o brakującej ikonie `lucide:minus`, niezwiązane z PageHeader ani zmienionymi akcjami widgetu.
- `pnpm --dir apps/crm typecheck`: passed z istniejącym ostrzeżeniem o zduplikowanym imporcie `caseUuidPattern`.

## Comparison history

1. Stan wejściowy miał P2: zakładki znajdowały się pomiędzy metadanymi i akcjami, a `Zapisz zmiany` trafiało do osobnego górnego rzędu względem `Otwórz publicznie` i `Wyłącz`.
2. Wspólny `CrmPageHeader` otrzymał stały dwuwierszowy układ: copy i akcje w pierwszym rzędzie, zakładki na pełnej szerokości w drugim. Akcje nie zawijają się na desktopie, a na węższych ekranach przechodzą nad zakładki.
3. Hierarchię akcji widgetu doprecyzowano wariantami primary solid, neutral outline i neutral ghost oraz wspólnym rozmiarem.
4. Końcowe porównanie i pomiary potwierdzają dolne położenie zakładek, jeden rząd akcji oraz brak poziomego overflow.

## Implementation checklist

- [x] Zakładki globalnie przy dolnej krawędzi PageHeader.
- [x] Akcje widgetu w jednym, czytelnym rzędzie.
- [x] Spójna hierarchia primary / secondary / tertiary.
- [x] Weryfikacja PageHeader widgetu i Zgód.
- [x] Test routingu zakładki, overflow, konsoli i typecheck.

final result: passed

---

# Design QA — edycja widgetu z podglądem na żywo

## Comparison target

- Source visual truth: `/var/folders/m6/ync19sd96gz4pg73zt0mq_6m0000gn/T/codex-clipboard-73951692-84ce-4c21-b33e-467cb7cc9dc8.png` — wskazany przez użytkownika stan, w którym formularz zajmuje cały viewport, a podgląd znajduje się poza kadrem.
- Browser-rendered narrow implementation: `/Users/konradstraszewski/Documents/GitHub/app/apps/crm/design-qa-widget-editor-narrow-after.png`.
- Browser-rendered desktop implementation: `/Users/konradstraszewski/Documents/GitHub/app/apps/crm/design-qa-widget-editor-desktop-after.png`.
- Browser-rendered editing state: `/Users/konradstraszewski/Documents/GitHub/app/apps/crm/design-qa-widget-editor-scrolled-after.png`.
- Full side-by-side comparison: `/Users/konradstraszewski/Documents/GitHub/app/apps/crm/design-qa-widget-editor-comparison.png`.
- State: dark CRM, aktywna zakładka `Personalizacja`, formularz i podgląd z zapisanymi danymi widgetu.
- Source pixels: `2116 × 1534`, `144 dpi`, odpowiada około `1058 × 767` CSS px przy gęstości `2`.
- Narrow implementation: `919 × 785` CSS px, `devicePixelRatio: 2`; desktop implementation: `1280 × 720` CSS px, `devicePixelRatio: 2`.
- Normalizacja: oba pełne kadry zostały dopasowane z zachowaniem proporcji do paneli `920 × 670`. Źródło jest dowodem stanu problemowego, a nie docelowym mockiem; różnica jest oceniana na poziomie widoczności i hierarchii workspace.

## Findings

- Nie pozostała żadna możliwa do działania rozbieżność P0, P1 ani P2.
- Przy szerokości `919 px` formularz ma `300 px`, podgląd `465 px`, a jego właściwa scena `431 px`. Obie części są widoczne równocześnie, bez poziomego overflow (`scrollWidth: 919`, `clientWidth: 919`).
- Przy szerokości `1280 px` formularz rośnie maksymalnie do `380 px`, podgląd ma `746 px`, a scena podglądu `680 px`.
- Po przewinięciu formularza podgląd pozostaje przy `top: 16 px`; użytkownik widzi efekt zmian podczas pracy nad dalszymi parametrami.

## Required fidelity surfaces

- Fonts and typography: zachowano istniejące rodziny, optyczne wagi, rozmiary, line-height i hierarchię CRM. W węższym panelu etykiety i opisy zawijają się naturalnie bez obcinania.
- Spacing and layout rhythm: parametry tworzą kompaktową pionową kolumnę, a podgląd otrzymał dominującą przestrzeń. Pola mają rytm `12–18 px`, opcje typu są pionowe, a dwukolumnowy workspace zachowuje `18 px` odstępu.
- Colors and visual tokens: powierzchnie, obramowania, tekst, stany selected i primary korzystają wyłącznie z istniejących tokenów. Kolor akcentu pozostaje pokazany jako czytelny swatch.
- Image quality and asset fidelity: podgląd nadal korzysta z istniejących assetów logo i biblioteki ikon. Nie dodano zastępczych SVG, CSS-art, emoji ani obrazów przybliżających produkt.
- Copy and content: nazwy pól, opisy typów, status zapisu i treść podglądu pozostały bez zmian; skrócenie workspace nie usunęło informacji potrzebnych do konfiguracji.

## Interaction, accessibility and runtime checks

- Zmiana pola `Nagłówek dla klienta` na `Zobacz zmianę od razu` natychmiast zmieniła nagłówek podglądu na tę samą wartość; po teście przywrócono zapisane dane i stan clean.
- Przycisk `Wybierz kolor akcentu` ma jednoznaczną nazwę dostępną, otwiera dialog z `UColorPicker` i poprawnie go zamyka. Duży picker nie zajmuje już stałego miejsca w formularzu.
- Przewijanie strony utrzymało podgląd sticky, a cały dokument zachował brak overflow.
- Wariant węższy (`919 × 785`) oraz desktop (`1280 × 720`) zostały sprawdzone w zalogowanej aplikacji. Poniżej `900 px` CSS komponent przechodzi w bezpieczny układ pionowy.
- Pierwsza kontrola konsoli ujawniła mismatch hydratacji trybu kolorystycznego w `WidgetAppearancePreview`. Po dodaniu stanu hydratacji ponowne przeładowanie nie wygenerowało nowych ostrzeżeń ani błędów.
- `pnpm --dir apps/crm typecheck`: passed z istniejącym ostrzeżeniem o zduplikowanym imporcie `caseUuidPattern`.

## Comparison history

1. Stan wejściowy miał P2: breakpoint `1160 px` składał edytor do jednego wiersza już przy około `1058 px`, więc formularz zajmował cały ekran, a podgląd znajdował się poza kadrem.
2. Stan wejściowy miał P2: stale widoczny `UColorPicker` zajmował dużą część pionowej przestrzeni i pogarszał skanowanie formularza.
3. Workspace otrzymał kolumnę parametrów `300–380 px`, elastyczny obszar podglądu, breakpoint `900 px`, sticky z limitem wysokości oraz pionowe, kompaktowe opcje.
4. Picker koloru został przeniesiony do dostępnego popovera uruchamianego przez swatch, przy zachowaniu edytowalnego pola HEX.
5. QA runtime wykryło P2 w postaci mismatchu hydratacji trybu `auto`; komponent otrzymał jawny stan `isHydrated`, po czym świeże przeładowanie było wolne od nowych wpisów warn/error.
6. Końcowe porównanie potwierdza równoczesną widoczność formularza i podglądu, a test interakcji potwierdza aktualizację podglądu na żywo.

## Implementation checklist

- [x] Wąski panel parametrów po lewej.
- [x] Większy sticky podgląd po prawej.
- [x] Kompaktowy picker koloru w popoverze.
- [x] Live update nagłówka i przywrócenie danych po teście.
- [x] Brak overflow przy `919 px` i `1280 px`.
- [x] Czysta hydratacja, konsola i typecheck.

final result: passed
