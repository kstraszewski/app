# Design QA — użytkownicy i dostępy administracyjne

## Materiał porównawczy

- Wzorzec: `/Users/konradstraszewski/.codex/generated_images/019faa76-ebd6-7303-b8ed-0944026bdd14/call_qJfYTDICdNDRCwr0tJBaqlEW.png`
- Zgłoszenie — duplikat profilu: `/var/folders/m6/ync19sd96gz4pg73zt0mq_6m0000gn/T/codex-clipboard-2cf30453-d3f8-4f5e-b2a0-8e8c2cd8e753.png`
- Zgłoszenie — avatar w podsumowaniu dostępu: `/var/folders/m6/ync19sd96gz4pg73zt0mq_6m0000gn/T/codex-clipboard-8ed1b548-edfd-4991-97c7-86d83ba6ef0b.png`
- Implementacja: `apps/crm/design-qa-users-detail.png`
- Widok listy: `apps/crm/design-qa-users-list.png`
- Porównanie pełnego kadru: `apps/crm/design-qa-users-comparison.png`
- Porównanie formularza: `apps/crm/design-qa-users-comparison-focused.png`
- Porównanie avataru i usunięcia duplikatu: `apps/crm/design-qa-users-avatar-comparison.png`
- Finalne podsumowanie: `apps/crm/design-qa-users-overview-avatar.png`
- Finalny dostęp administracyjny: `apps/crm/design-qa-users-admin-avatar.png`
- Sekcja anonimizacji: `apps/crm/design-qa-users-anonymization.png`
- Formularz grantu anonimizacji: `apps/crm/design-qa-users-anonymization-modal.png`
- Formularz mobilny: `apps/crm/design-qa-users-anonymization-mobile.png`
- Wzorzec: 1487 × 1058 px
- Implementacja: viewport i zrzut 1440 × 1024 px, DPR 1
- Stan: karta „Dostęp administracyjny”, rozwinięta rola zgód, aktywny wyjątek publikowania i widoczny pasek niezapisanych zmian

## Przebieg

### Pass 1

- P1: rola administratora organizacji obejmowała zgody. Rozdzielono ogólną administrację, rolę `Administrator zgód` oraz bezpośredni wyjątek publikowania.
- P1: edycja i publikacja zgód były pokazane jako jedno prawo. W efektywnym dostępie są teraz dwiema niezależnymi pozycjami w obszarze „Zgody i compliance”.
- P1: dane demonstracyjne wyglądały jak zapisane w IAM. Dodano trwałe oznaczenie „Prototyp UI” oraz komunikację, że zapis jest lokalny.
- P1: formularz wyjątku zwiększał wysokość głównej tabeli i odbiegał od wzorca. Przeniesiono uzasadnienie i datę do działającego modala, pozostawiając kompaktowe podsumowanie.
- P2: brakowało nagłówków kolumn. Dodano „Rola / Przypisanie / Pochodzenie”.
- P2: brakowało ochrony przy zamykaniu lub przeładowaniu karty. Dodano `beforeunload` i guard routingu.

### Pass 2

- Układ 58/42, kolejność treści, płaskie powierzchnie, obramowania, hierarchia tytułów i ostrzegawcze akcenty odpowiadają wzorcowi.
- Zagęszczono wiersze ról oraz kartę zgód, dzięki czemu wszystkie pięć ról mieści się w kadrze 1440 × 1024.
- Zachowano istniejący shell, tokeny, typografię, sidebar i komponenty Nuxt UI produktu.
- Sprawdzono viewporty 1440 × 1024, 1024 × 900 i 390 × 844. Nie występują kolizje ani poziomy overflow; na mniejszych ekranach podsumowanie i obszary dostępu przechodzą do jednej kolumny.

### Pass 3 — avatar i anonimizacja

- P1: tożsamość użytkownika była powtórzona w nagłówku i dużej karcie. Avatar przeniesiono obok H1, metadane wyrównano do imienia, a kartę profilu usunięto z „Podsumowania”.
- P1: avatar w kaflu statusu dostępu powtarzał informację bez wartości decyzyjnej. Kafelek pokazuje teraz wyłącznie status, datę utworzenia i dane potrzebne do przeglądu dostępu.
- P1: anonimizacji nie dodano jako stałej roli ani zwykłego przełącznika. Powstał osobny, jednorazowy grant związany ze zweryfikowanym żądaniem i klientem.
- P1: grant wymaga uzasadnienia, ważności do 24 godzin oraz zatwierdzającej osoby; wysłanie tworzy stan „Oczekuje na zatwierdzenie”, a nie aktywny dostęp.
- P2: grant jest widoczny równolegle w „Efektywnym dostępie”, „Dostępach bezpośrednich” i historii zmian. Oczekiwanie ma odrębny status od aktywnego prawa.
- P2: modal jasno komunikuje nieodwracalność, jednorazowość i zasadę dwóch par oczu. Sprawdzono stan pusty, walidację, poprawne wysłanie oraz cofnięcie.
- Ponownie sprawdzono viewporty 1440 × 1024 i 390 × 844. Nagłówek, poziome zakładki, sekcja wysokiego ryzyka i modal zachowują czytelność bez poziomego overflow.

## Funkcjonalność i dostępność

- Lista: wyszukiwanie, reset filtrów, filtr roli `Administrator zgód`, otwarcie i anulowanie formularza dodania użytkownika.
- Szczegóły: przełączanie zakładek, nadawanie roli, stan dirty, odrzucanie, zapis demonstracyjny, modal uzasadnienia wyjątku.
- Anonimizacja: wybór wyłącznie zweryfikowanego żądania, automatyczne powiązanie klienta, uzasadnienie minimum 20 znaków, limit 24 godzin, wybór zatwierdzającego, stan oczekujący, edycja i cofnięcie wniosku.
- Pola, checkboxy, switch, linki i przyciski mają etykiety dostępności; wiersz użytkownika przekazuje czytnikowi nazwę, email, zespół, role, zakres i status.
- Kolory statusów mają dodatkowe etykiety tekstowe; aktywne zakładki korzystają z `aria-current`.
- Brak błędów w konsoli dla nowych widoków. Pozostało wcześniejsze, niezwiązane ostrzeżenie o ikonie `lucide:wallet-cards` w istniejącym shellu.
- `pnpm typecheck` przechodzi.

## Pozostałe różnice P3

- Istniejący sidebar CRM jest bogatszy niż sidebar z wygenerowanego wzorca.
- Implementacja używa prawdziwych avatarów i danych demonstracyjnych projektu zamiast inicjałów oraz copy 1:1 ze wzorca.
- Zapis pozostaje celowo lokalnym prototypem do czasu wdrożenia modelu IAM, endpointów i polityk bazodanowych.

final result: passed

---

## 2026-07-29 — repozytorium plików bankowych

### Materiał porównawczy

- Wzorzec: `/Users/konradstraszewski/.codex/generated_images/019faa76-ebd6-7303-b8ed-0944026bdd14/call_XzFACECNq5NzNJLDQSmUV2W0.png`
- Implementacja: `/private/tmp/openexpert-bank-files-implementation.png`
- Wspólne porównanie: `/private/tmp/openexpert-bank-files-comparison.png`
- Oba kadry: 1487 × 1058 px.
- Stan: Bank Pekao, zakładka „Pliki z banku”, trzy aktualne dokumenty i otwarty podgląd pierwszej strony PDF.

### Porównanie i korekty

- P1: panel podglądu zaczynał się dopiero pod wyszukiwarką i filtrami. Został wyciągnięty do prawej kolumny całego komponentu, dzięki czemu zaczyna się bezpośrednio pod nawigacją zakładek jak we wzorcu.
- P1: tabela miała wymuszoną szerokość 650 px, przez co ostatnie kolumny były ukryte pod panelem. W trybie podglądu tabela dopasowuje się teraz do dostępnej kolumny bez poziomego przewijania.
- P1: wyszukiwanie pełnotekstowe nie zwracało odmiany „wypłatę” dla zapytania „wypłata”. Dodano serwerowy fallback tolerujący polskie znaki, jedną zmianę znaku i typowe odmiany tytułów.
- P2: podgląd PDF był zbyt wysoki i spychał metadane poza pierwszy kadr. Powierzchnię ustawiono na 416 px, a odstęp pod akcjami zmniejszono.
- P2: dynamiczne ikony kategorii oraz nowe ikony repozytorium nie należały do jawnego bundle. Dodano je do listy klienta Nuxt Icon.
- P2: prawa kolumna była węższa od wzorca. Ustawiono ją na 40% szerokości komponentu z bezpiecznym minimum 420 px; granica kolumn pokrywa się z kadrem referencyjnym.

### Funkcjonalność i dostępność

- Sprawdzono stan globalny: 15 plików i filtr instytucji.
- Sprawdzono filtr Bank Pekao: wynik ogranicza się do 3 plików.
- Sprawdzono wyszukiwanie „wypłata transzy”: zwraca jeden właściwy dokument mimo odmiany w tytule.
- Sprawdzono podgląd stron 1/2 i 2/2, krótko ważny podpisany URL oraz zapis `file.previewed` z użytkownikiem `admin@openexpert.local`.
- Wyszukiwarka, filtry, kategorie, tabela, pobranie i nawigacja podglądu mają nazwy dostępności widoczne w drzewie semantycznym.
- Pozostałe ostrzeżenia ikon pochodziły z procesu uruchomionego przed zmianą jawnego bundle; wymagają restartu serwera deweloperskiego, który jest częścią finalnej weryfikacji.

final result: passed

---

## 2026-07-29 — dostęp wrażliwy i wysokiego ryzyka

### Materiał porównawczy

- Źródło prawdy: `/var/folders/m6/ync19sd96gz4pg73zt0mq_6m0000gn/T/codex-clipboard-ce0ae5b4-0294-46df-8477-da2f7343cd17.png`
- Implementacja — pełny układ: `/var/folders/m6/ync19sd96gz4pg73zt0mq_6m0000gn/T/openexpert-users-access-tiers-focused-clean.png`
- Implementacja — operacje wysokiego ryzyka: `/var/folders/m6/ync19sd96gz4pg73zt0mq_6m0000gn/T/openexpert-users-risk-rows-bottom-final.png`
- Porównanie źródła i implementacji: `/var/folders/m6/ync19sd96gz4pg73zt0mq_6m0000gn/T/openexpert-users-access-comparison.png`
- Źródło: 2128 × 1492 px; do porównania znormalizowane do 1064 × 746 px przy DPR 2.
- Implementacja: viewport 1159 × 785 oraz 873 × 785 CSS px, DPR 2; zrzuty mają rozmiar viewportu w CSS px.
- Stan: karta „Dostęp administracyjny”, bez lokalnych niezapisanych zmian.

### Porównanie i korekty

- P1: publikowanie zgód było zagnieżdżone w żółtym obszarze roli wrażliwej. Zostało przeniesione do osobnej, czerwonej sekcji „Dostęp wysokiego ryzyka”.
- P1: anonimizacja nie miała wspólnej hierarchii z pozostałymi prawami. Jest teraz drugim, jednoznacznie opisanym wierszem operacji kontrolowanej.
- P2: „Dostępy bezpośrednie” powtarzały informacje widoczne w rolach i efektywnym dostępie. Zduplikowany panel usunięto.
- P2: zagnieżdżone karty oraz wiele równorzędnych opisów utrudniały skanowanie. Uprawnienia są teraz podzielone na trzy płaskie poziomy: role standardowe, dostęp wrażliwy i dostęp wysokiego ryzyka.
- P2: anulowanie formularza publikowania mogło pozostawić wizualnie aktywny przełącznik. Dodano przywracanie poprzedniego stanu przy anulowaniu i zamknięciu modala.
- P2: mobilne nagłówki paneli mogły ściskać licznik i status. Przy szerokości do 520 px przechodzą w układ pionowy, a wiersze zachowują niezależną kolumnę sterowania.
- P3: globalny przycisk „Agent AI” może zasłaniać fragment prawego dolnego rogu przy niskim viewporcie; to istniejąca nakładka aplikacji poza zakresem tej karty.

### Funkcjonalność i dostępność

- Sprawdzono otwarcie i anulowanie modala publikowania; po anulowaniu przełącznik wraca do stanu wyłączonego, a pasek niezapisanych zmian nie pozostaje widoczny.
- Sprawdzono otwarcie grantu anonimizacji i listę zweryfikowanych żądań klienta.
- Statusy żółte i czerwone mają tekstowe etykiety; znaczenie nie zależy wyłącznie od koloru.
- Kluczowe działania wysokiego ryzyka pozostają bezpośrednie, niedziedziczne i opisane regułami kontroli.
- Pełny kadr i skupione fragmenty porównano wizualnie; nie pozostały różnice P0, P1 ani P2.

final result: passed

---

## 2026-07-29 — dopracowanie grantu anonimizacji

### Materiał porównawczy

- Źródło prawdy: `/var/folders/m6/ync19sd96gz4pg73zt0mq_6m0000gn/T/codex-clipboard-60c8364b-ee99-4501-b319-03eacb7cd388.png`
- Implementacja — pełny kontekst: `/var/folders/m6/ync19sd96gz4pg73zt0mq_6m0000gn/T/openexpert-users-grant-polished-final.png`
- Implementacja — detal: `/var/folders/m6/ync19sd96gz4pg73zt0mq_6m0000gn/T/openexpert-users-grant-row-final.png`
- Wspólne porównanie: `/var/folders/m6/ync19sd96gz4pg73zt0mq_6m0000gn/T/openexpert-users-grant-comparison.png`
- Źródło: 2232 × 266 px, gęstość 144 dpi; istotny fragment 2035 × 210 px został znormalizowany do 998 × 103 px.
- Implementacja: viewport 873 × 785 CSS px, DPR 2; detal komponentu 839 × 103 px.
- Stan: brak grantu, użytkownik może otworzyć formularz nadania.

### Porównanie i historia korekt

- P2: pełnoszeroki przycisk wyglądał jak pole formularza i nadmiernie dominował prawą część wiersza. Zastąpiono go małym przyciskiem `error/soft` „Nadaj grant”.
- P2: prawa kolumna była zbyt szeroka, a status i akcja tworzyły dwa luźne bloki. Kolumnę ograniczono do 280–320 px i połączono status z CTA w jednym zwartym rzędzie.
- P2: badge „Nieodwracalne” był wypychany na przeciwległy koniec kolumny. Został ustawiony bezpośrednio przy nazwie operacji.
- P2: pionowy separator był zbyt ciężki. Zachowano czerwony kod kategorii, ale obniżono intensywność separatora w wierszu anonimizacji.
- Porównanie po korekcie nie wykazało pozostałych problemów P0, P1 ani P2.

### Powierzchnie jakości

- Typografia: zachowano rodzinę, rozmiary i ciężary istniejącego panelu; krótszy status i CTA nie łamią się w badanym viewporcie.
- Rytm i układ: wiersz ma tę samą wysokość co sąsiednia operacja, a status i akcja są wyrównane pionowo bez dodatkowej ramki.
- Kolory: czerwony pozostaje kodem wysokiego ryzyka, natomiast pusty status jest neutralny i nie sugeruje błędu.
- Obrazy i ikony: komponent nie korzysta z obrazów rastrowych; pozostawiono systemowe ikony Nuxt UI bez zamienników CSS.
- Copy: „Nadaj grant do żądania” skrócono do „Nadaj grant”; kontekst zatwierdzonego żądania pozostaje w opisie operacji.

### Funkcjonalność

- Przycisk otwiera modal „Grant do anonimizacji danych klienta”.
- Anulowanie zamyka modal bez zmiany danych.
- Sprawdzono brak poziomego overflow oraz konsolę przeglądarki; brak nowych ostrzeżeń i błędów.

final result: passed

---

## 2026-07-29 — jednorzędowe podsumowanie dostępu

### Materiał porównawczy

- Źródło prawdy: `/var/folders/m6/ync19sd96gz4pg73zt0mq_6m0000gn/T/codex-clipboard-df5ea646-dea0-44d0-9565-99389076ff6d.png`
- Implementacja — pełny widok: `/var/folders/m6/ync19sd96gz4pg73zt0mq_6m0000gn/T/openexpert-users-summary-one-row-final.png`
- Implementacja — detal: `/var/folders/m6/ync19sd96gz4pg73zt0mq_6m0000gn/T/openexpert-users-summary-one-row-crop.png`
- Porównanie pełnego kontekstu: `/var/folders/m6/ync19sd96gz4pg73zt0mq_6m0000gn/T/openexpert-users-summary-full-comparison.png`
- Porównanie skupione: `/var/folders/m6/ync19sd96gz4pg73zt0mq_6m0000gn/T/openexpert-users-summary-one-row-comparison.png`
- Źródło: 2186 × 544 px przy gęstości 144 dpi; pełny kadr znormalizowano do 873 × 217 px.
- Implementacja: viewport 873 × 785 CSS px, DPR 2; pasek podsumowania 841 × 93 px.
- Stan: karta „Dostęp administracyjny”, cztery statystyki bez niezapisanych zmian.

### Porównanie i historia korekt

- P2: przy bieżącej szerokości podsumowanie przechodziło zbyt wcześnie do układu 2×2. Breakpoint zmniejszono z 1180 do 820 px, dzięki czemu cztery statystyki tworzą jeden poziomy rząd.
- P2: „Przypisania struktury” jako jedyna metryka organizacyjna nie miały wizualnego punktu zaczepienia. Dodano systemową ikonę `network`, wyrównaną tak samo jak tarcza w podsumowaniu ról.
- P2: nierówne proporcje kolumn utrudniały zachowanie czytelności po przejściu do jednego rzędu. Zastosowano cztery równe kolumny `minmax(0, 1fr)`.
- Porównanie po korekcie nie wykazało pozostałych problemów P0, P1 ani P2.

### Powierzchnie jakości

- Typografia: zachowano istniejącą rodzinę, wagi i rozmiary; etykiety oraz wartości mieszczą się bez obcięcia.
- Rytm i układ: cztery równe komórki mają wspólną wysokość, padding i pionowe separatory; pasek nie ma poziomego overflow.
- Kolory: wykorzystano wyłącznie istniejące neutralne i zielone tokeny statusu.
- Obrazy i ikony: brak rasterów; ikona struktury pochodzi z używanego w produkcie zestawu Nuxt UI/Lucide.
- Copy: treść statystyk pozostała bez zmian.
- Responsywność: poniżej 820 px zachowano układ 2×2, a poniżej 520 px układ jednokolumnowy.

final result: passed

---

## 2026-07-29 — kompaktowe metryki podsumowania

### Materiał porównawczy

- Źródło prawdy: `/var/folders/m6/ync19sd96gz4pg73zt0mq_6m0000gn/T/codex-clipboard-0d751f26-91f7-48ba-a075-511eb1907b8e.png`
- Implementacja — pełny widok: `/var/folders/m6/ync19sd96gz4pg73zt0mq_6m0000gn/T/openexpert-users-overview-metrics-final.png`
- Implementacja — detal: `/var/folders/m6/ync19sd96gz4pg73zt0mq_6m0000gn/T/openexpert-users-overview-metrics-crop.png`
- Porównanie przed i po: `/var/folders/m6/ync19sd96gz4pg73zt0mq_6m0000gn/T/openexpert-users-overview-metrics-comparison.png`
- Źródło: 2120 × 428 px przy gęstości 144 dpi; do wspólnego porównania znormalizowane do szerokości 1200 px.
- Implementacja: viewport 873 × 785 CSS px; detal 857 × 126 px, a właściwy pasek metryk 841 × 90 px.
- Stan: karta „Podsumowanie”, trzy metryki administracyjne.

### Porównanie i historia korekt

- P2: pionowy układ `ikona → etykieta → wartość → opis` tworzył zbyt wysoki panel i pozostawiał dużo pustej przestrzeni.
- P2: wartości miały podobną wagę wizualną do opisów, przez co najważniejsze dane były wolniejsze do przeskanowania.
- Zastosowano poziomy układ `ikona | etykieta i opis | wartość` z trzema równymi segmentami oraz wspólnym pionowym wyrównaniem.
- Wartości zostały wyrównane do prawej, powiększone do 24 px i otrzymały cyfry tabelaryczne; ikony pozostały w kompaktowych polach 40 × 40 px.
- Copy ostatniej metryki skrócono do „Ostatni przegląd” oraz „następny za 90 dni”, aby zachować równy rytm bez łamania wierszy.
- Wysokość paska zmniejszyła się ze 160 px do 90 px przy zachowaniu pełnej treści i czytelnych separatorów.
- Po korekcie nie występuje poziomy ani pionowy overflow, a porównanie wizualne nie wykazało pozostałych problemów P0, P1 ani P2.

### Powierzchnie jakości

- Typografia: zachowano rodzinę i neutralną hierarchię produktu; wartości są czytelniejsze, ale nie konkurują z nagłówkiem strony.
- Rytm i układ: trzy segmenty mają wspólną wysokość, padding, rozstaw 12 px i pionowe separatory.
- Kolory: wykorzystano wyłącznie istniejące neutralne tokeny powierzchni, obramowań i tekstu.
- Obrazy i ikony: brak nowych rasterów; pozostawiono systemowe ikony Nuxt UI/Lucide.
- Responsywność: poniżej 760 px pasek nadal przechodzi do jednej kolumny, zachowując poziomy układ wewnątrz każdej metryki.
- Konsola przeglądarki została sprawdzona; brak nowych ostrzeżeń i błędów.

final result: passed
## Bank institution navigation counter and order — 2026-07-29

- Source visual truth: `/var/folders/m6/ync19sd96gz4pg73zt0mq_6m0000gn/T/codex-clipboard-eb27b238-7c61-44a5-820e-6199873fd4bb.png`
- Implementation screenshot: `/private/tmp/openexpert-bank-tab-counter.png`
- Combined comparison: `/private/tmp/openexpert-bank-tabs-comparison.png`
- Source pixels: `2242 × 1162`; implementation pixels and CSS viewport: `1280 × 720` at device scale `1`.
- Normalization: source scaled to `1280px` width; both captures cropped to the top `250px` navigation region and vertically combined.
- State: Bank Pekao, `view=products`, dark theme, authenticated administrator.
- Primary interaction tested: `Pliki z banku 3` navigates to `view=files` and renders the repository heading.
- Focused region: required because the only requested change is the order and counter treatment in the institution tab row.

**Findings**

- No P0/P1/P2 findings.
- Fonts and typography: existing tab font, weight and badge typography are unchanged.
- Spacing and layout rhythm: the added badge uses the same tab count pattern as Produkty, Checklisty and Historia; the full row fits without clipping.
- Colors and visual tokens: existing neutral tab and count tokens are preserved.
- Image quality and asset fidelity: no image assets were changed; existing icon-library assets remain intact.
- Copy and content: `Pliki z banku` shows `3`; `Źródła` is the last tab and retains its `1` counter.

**Comparison history**

- Initial requested state: file tab had no counter and Sources preceded it.
- Fix: added the server-backed non-archived file count and moved Sources after History.
- Post-fix evidence: combined comparison and browser interaction above.

**Implementation Checklist**

- [x] Add bank-file count to the profile metrics API.
- [x] Render the count with the existing tab badge.
- [x] Move Sources to the final position.
- [x] Verify navigation and responsive fit.

**Follow-up Polish**

- None required for this scoped change.

final result: passed
