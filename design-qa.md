# Design QA — kompaktowy katalog forum

## Wynik

`passed`

Strona główna forum pokazuje wątki bezpośrednio pod kompaktowym wyszukiwaniem i filtrami. Nie pozostały znane problemy P0, P1 ani P2 w sprawdzonym stanie.

## Materiał porównawczy

- Źródło wizualne i opis problemu: `/var/folders/m6/ync19sd96gz4pg73zt0mq_6m0000gn/T/codex-clipboard-2d3d0870-2d7a-4bbb-a817-5176a5285319.png`, 2184 × 1316 px. Źródło pokazuje zbyt wysoki hero wyszukiwarki i karty kategorii zasłaniające listę postów.
- Implementacja desktop: `/private/tmp/forum-compact-desktop-2048x1280.png`, 2048 × 1184 px; CSS viewport 2048 × 1280, DPR 1.
- Implementacja mobile: `/private/tmp/forum-compact-mobile-390x844.png`, 390 × 844 px; CSS viewport 390 × 844, DPR 1.
- Wspólny obraz porównawczy: `/private/tmp/forum-compact-before-after.png`, źródło po lewej i implementacja po prawej; oba widoki znormalizowane do 1024 px szerokości i wspólnej wysokości 620 px.

Stan: ciemny motyw OpenExpert, organizacja `openexpert-local`, administrator organizacji, brak aktywnego zapytania i sześć demonstracyjnych wątków.

## Pełny widok i hierarchia

- W źródle wątki nie mieszczą się w pierwszym ekranie. W implementacji kompaktowe narzędzia zajmują 122 px, a pierwszy wątek zaczyna się na 412 px desktopu i na 614 px mobile po dodaniu jednoznacznych etykiet filtrów.
- Duży blok marketingowy, osobny przycisk „Szukaj” i siatka kart kategorii zostały zastąpione jednym inputem, dwoma małymi filtrami oraz jednorzędowymi chipami kategorii.
- Kategorie pozostały kanonicznymi linkami do osobnych podstron, ale zachowują aktywne `q`, `type` i `status`, więc zachowują się jak filtr listy.
- Na mobile chipy przewijają się poziomo bez poszerzania strony, a gradient na prawej krawędzi sygnalizuje dalsze kategorie. Filtry mają widoczne etykiety „Typ” i „Status”. Administracyjny badge i powielony przycisk moderacji są ukryte; dostęp do moderacji pozostaje w zakładce.

## Ocena wymaganych powierzchni

- **Typografia:** zachowano istniejącą rodzinę, mono-eyebrow, wagi i hierarchię CRM. Input, chipy i metadane są zwarte, ale nadal czytelne; nazwy kategorii nie łamią się w chipach.
- **Spacing i rytm:** usunięto padding 22–34 px oraz duże odstępy dwóch sekcji. Narzędzia mają odstępy 6–8 px, lista zaczyna się po 14 px, a na 390 px pierwszy pełny post mieści się nad foldem.
- **Kolory i tokeny:** użyto wyłącznie istniejących tokenów `--ui-*` i `--oe-*`. Aktywny filtr ma subtelne tło primary, bez nowej palety i bez ciężkiego panelu.
- **Ikony i zasoby:** ikony pochodzą z używanego w produkcie zestawu Lucide. Ekran nie wymaga ilustracji ani obrazów; nie dodano atrap, własnych SVG ani CSS-art.
- **Copy i treść:** placeholder jasno mówi, że input szuka w pytaniach i odpowiedziach. Informacja o wektorach/słowach kluczowych i realtime pozostała jako kompaktowy status z tooltipem oraz opisem dla czytników ekranu.
- **Responsywność:** brak poziomego overflow przy 2048 px i 390 px. Desktop mieści wyszukiwanie i selecty w jednym rzędzie; mobile używa pełnej szerokości inputa, dwóch równych i podpisanych selectów oraz przewijanego paska kategorii z wizualnym sygnałem dalszej zawartości.
- **Dostępność:** zachowano `role="search"`, etykiety kontrolek, `aria-describedby`, komunikat walidacji, live region wyników, `aria-current` aktywnej kategorii, focus-visible i obsługę Enter.

## Interakcje sprawdzone w przeglądarce

- Live-search po wpisaniu `klient` zaktualizował URL do `?q=klient` i zwrócił trzy wątki po debounce.
- Link kategorii „Obsługa klienta” zachował `?q=klient`, oznaczył aktywny chip i ograniczył wyniki do jednego wątku.
- „Wyczyść filtry” wróciło do bazowej strony forum i usunęło zapytanie oraz kategorię.
- Status realtime i komunikat trybu wyszukiwania pozostały widoczne; konsola nie zawiera błędów.

## Historia poprawek QA

- **P1 — posty poza pierwszym ekranem:** usunięto wysoki hero i siatkę kart; pierwszy wątek jest teraz widoczny od razu na desktopie i mobile.
- **P2 — kategorie wyglądały jak osobna sekcja nawigacyjna:** zmieniono je w kompaktowe, aktywne chipy-filtry dostępne także na podstronie kategorii.
- **P2 — osobny przycisk wyszukiwania dublował zachowanie inputa:** usunięto przycisk; istniejący debounce 360 ms i Enter nadal uruchamiają wyszukiwanie hybrydowe/leksykalne.
- **P2 — zbyt wysoki nagłówek mobile dla administratora:** ukryto powielony badge i przycisk moderacji, pozostawiając „Nowy temat” i zakładkę moderacji.

## Walidacja techniczna

- `pnpm --filter @openexpert/crm typecheck`
- `git diff --check`
- Kontrola przeglądarkowa desktop 2048 × 1280 i mobile 390 × 844.
- Brak błędów konsoli i brak poziomego overflow.

## Final result

`passed`
