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

---

# Design QA — karta tożsamości metod logowania

## Wynik

`passed`

Badge potwierdzonego e-maila ponownie mieści się w obramowaniu karty i zachowuje prawidłowy układ na desktopie oraz mobile. Nie pozostały znane problemy P0, P1 ani P2 w sprawdzonych stanach.

## Materiał porównawczy

- Źródło wizualne i stan błędu: `/var/folders/m6/ync19sd96gz4pg73zt0mq_6m0000gn/T/codex-clipboard-929155c5-e08b-4a5f-83b1-e0ab63ec3e86.png`, 2016 × 217 px, ciemny motyw, zrzut 2×.
- Implementacja desktop — pełny widok: `/private/tmp/openexpert-login-methods-dark-wide-full.png`, 1440 × 900 px; CSS viewport 1440 × 900, DPR 1.
- Implementacja desktop — detal karty: `/private/tmp/openexpert-login-methods-dark-wide-card.png`, 1128 × 98 px; CSS 1128 × 98, DPR 1.
- Implementacja mobile: `/private/tmp/openexpert-login-methods-dark-mobile-page.png`, 390 × 1852 px; CSS viewport 390 × 844, DPR 1, pełna wysokość strony.
- Wspólny obraz porównawczy: `/private/tmp/openexpert-identity-before-after.png`, stan błędny u góry i poprawiona implementacja u dołu. Źródło 2× znormalizowano do 1008 × 91 px, a implementację do 1008 × 88 px.

Stan implementacji: ciemny motyw OpenExpert, organizacja `openexpert-local`, konto `admin@openexpert.local` z potwierdzonym e-mailem. Inny adres e-mail niż w źródle jest oczekiwaną różnicą danych; porównanie ocenia geometrię i styl karty.

## Pełny widok i ocena wymaganych powierzchni

- **Typografia i copy:** etykieta „E-mail potwierdzony”, hierarchia tekstu i mono-eyebrow pozostały bez zmian. Badge zachowuje jeden wiersz i nie jest już ograniczony do kwadratu 42 × 42 px.
- **Spacing i rytm:** na desktopie badge ma 178,8 × 28 px i mieści się między x=1208,2 a x=1387 wewnątrz karty kończącej się na x=1408. Lewa ikona zachowuje 42 × 42 px. Na mobile badge przechodzi do drugiego wiersza i pozostaje wewnątrz karty.
- **Kolory i tokeny:** po usunięciu kolizji selektora `UBadge` odzyskał semantyczny wariant `success`; nie dodano nowych kolorów ani tokenów.
- **Ikony i zasoby:** zachowano istniejące ikony Lucide `shield-check` i `badge-check`. Ekran nie wymaga nowych obrazów, ilustracji, SVG ani atrap.
- **Copy i treść:** treść karty nie została zmieniona. Lokalny seed używa innego adresu e-mail niż źródło, ale odwzorowuje stan potwierdzonego konta.
- **Responsywność:** przy 1440 px dokument ma `clientWidth = scrollWidth = 1440`; przy 390 px ma `clientWidth = scrollWidth = 390`. Badge jest zawarty w karcie w obu punktach widoku i nie tworzy poziomego overflow.
- **Dostępność i zachowanie:** semantyczny tekst statusu oraz ikona pozostały czytelne. Zmiana dotyczy wyłącznie selektora wrappera ikony i nie zmienia interakcji ani kolejności treści.

## Historia porównania i poprawki

- **P2 — status wypływał poza prawą krawędź karty:** selektor `.identity-summary > span` obejmował również root `<span>` renderowany przez `UBadge`, nadpisując mu `display: flex` przez `grid` oraz wymuszając 42 × 42 px. Wrapper lewej ikony otrzymał klasę `.identity-summary__icon`, a selektor zawężono do tej klasy.
- **Weryfikacja po poprawce:** desktop pokazuje badge jako `display: flex`, 178,8 × 28 px, w całości wewnątrz karty. Mobile ustawia go w kolumnie 2, od x=93 do x=271,8, również wewnątrz karty. W obu przypadkach brak poziomego overflow.

## Walidacja techniczna i przeglądarkowa

- `pnpm --filter @openexpert/crm typecheck` — zakończone kodem 0.
- `git diff --check` — bez błędów przed raportem.
- Kontrola przeglądarkowa: jasny i ciemny motyw na desktopie 1440 × 900 oraz ciemny motyw na mobile 390 × 844.
- Sprawdzono przełącznik motywu, geometrię karty, badge i dokumentu. Konsola przeglądarki nie zawiera błędów ani ostrzeżeń.
- Nie wykonywano żadnych akcji zmieniających metody logowania.

## Final result

`passed`

---

# Design QA — bezpieczeństwo konta

## Wynik

`passed`

Status hasła jest kompaktowy, a akcja wylogowania pozostałych urządzeń nie łamie tekstu. Nie pozostały znane problemy P0, P1 ani P2 w sprawdzonych stanach.

## Materiał porównawczy

- Źródło wizualne: `/var/folders/m6/ync19sd96gz4pg73zt0mq_6m0000gn/T/codex-clipboard-60e3df44-42e6-45fe-b758-e920ee241993.png`, 2504 × 1148 px, jasny motyw, dwie sesje.
- Implementacja desktop — górna część: `/private/tmp/openexpert-security-light-wide-final.jpg`, 1966 × 937 px; CSS viewport 2048 × 937, DPR 1.
- Implementacja desktop — stopka sesji: `/private/tmp/openexpert-security-footer-final.jpg`, 1966 × 937 px; CSS viewport 2048 × 937, DPR 1.
- Implementacja mobile — status: `/private/tmp/openexpert-security-mobile-top-final.jpg`, 390 × 844 px; CSS viewport 390 × 844, DPR 1.
- Implementacja mobile — stopka sesji: `/private/tmp/openexpert-security-mobile-footer-final.jpg`, 390 × 844 px; CSS viewport 390 × 844, DPR 1.
- Porównanie pełnego widoku: `/private/tmp/openexpert-security-design-qa-full.jpg`, 2400 × 600 px; źródło po lewej, implementacja po prawej, oba widoki dopasowane proporcjonalnie do pola 1200 × 600 px.
- Porównanie detali: `/private/tmp/openexpert-security-design-qa-focus.jpg`, 2300 × 440 px; źródło po lewej i implementacja po prawej, status w pierwszym rzędzie i stopka sesji w drugim.

Stan implementacji: jasny motyw OpenExpert, organizacja `openexpert-local`, konto z aktywnym hasłem, dziewięć lokalnych sesji. Źródło ma dwie sesje i inny adres e-mail, dlatego liczba wierszy oraz treść danych są oczekiwaną różnicą stanu; porównanie ocenia nagłówek i stopkę w odpowiadających sobie stanach wizualnych.

## Pełny widok i ocena wymaganych powierzchni

- **Typografia:** zachowano istniejącą rodzinę, rozmiary, wagi i mono-eyebrow ekranu. Status ma 10 px i 20 px wysokości; etykieta akcji zachowuje jeden wiersz na desktopie i mobile.
- **Spacing i rytm:** status nie dziedziczy już kwadratu 40 × 40 przeznaczonego dla ikon nagłówka. Ma 69,7 × 20 px w stanie „Aktywne”, jest wyrównany do prawej i nie zmienia wysokości nagłówka. Stopka zachowuje istniejący padding oraz odstęp między opisem i akcją.
- **Kolory i tokeny:** użyto semantycznego `success` w wariancie `soft` i istniejącego `error` w wariancie `soft`; nie dodano surowych kolorów ani nowej palety.
- **Ikony i zasoby:** status używa `i-lucide-circle-check`, stan nieaktywny `i-lucide-circle-minus`, a akcja zachowuje `i-lucide-log-out`. Ekran nie wymaga obrazów ani ilustracji; nie dodano własnych SVG, placeholderów ani CSS-art.
- **Copy i treść:** pozostawiono zgodne znaczeniowo etykiety „Aktywne” i „Wyloguj pozostałe urządzenia”. Akcja nadal jednoznacznie wyklucza bieżącą sesję.
- **Responsywność:** przy 2048 px przycisk ma 264,8 px szerokości, etykieta 218,8 px i `white-space: nowrap`. Przy 390 px przycisk ma pełne 316 px, etykieta nadal 218,8 px i jeden wiersz. Brak poziomego overflow w obu viewportach.
- **Dostępność i zachowanie:** status zachowuje czytelny tekst i ikonę, a przycisk ma poprawną nazwę dostępną oraz pozostaje aktywny. Nie wykonywano destrukcyjnego wylogowania sesji podczas QA.

## Historia porównań i poprawek

- **P2 — status wyglądał jak wysoki kafelek:** ogólny selektor `.security-panel__header > span` obejmował również korzeń `UBadge` i wymuszał 40 × 40 px. Pierwszy wariant ze zmniejszonym `UBadge` nadal dziedziczył ten kwadrat. Nadano klasę wyłącznie wrapperom ikon (`.security-panel__icon`) i zawężono selektor. W finalnym porównaniu status ma 69,7 × 20 px, ikonę potwierdzenia i subtelne tło.
- **P2 — tekst akcji łamał się na dwa wiersze:** przycisk mógł kurczyć się w stopce flex. Ustawiono `shrink-0`, przekazano tekst przez `label` i ustawiono slot etykiety na `whitespace-nowrap`. Finalne porównanie desktop oraz mobile pokazuje pełny tekst w jednym wierszu.

## Walidacja techniczna i przeglądarkowa

- `pnpm --filter @openexpert/crm typecheck` — zakończone kodem 0.
- `git diff --check` — bez błędów.
- Przeglądarka: desktop 2048 × 937 i mobile 390 × 844, jasny motyw, brak poziomego overflow.
- Konsola przeglądarki: brak błędów.
- Sprawdzono stan po załadowaniu danych, dostępność przycisku, geometrię statusu i etykiety oraz oba punkty widoku. Nie klikano akcji wylogowania, aby nie kończyć istniejących sesji.

## Final result

`passed`

---

# Design QA — walidacja hasła w czasie rzeczywistym

## Wynik

`passed`

Techniczny limit bajtów nie jest już eksponowany użytkownikowi. Formularz pokazuje cztery zrozumiałe wymagania i aktualizuje ich stan podczas pisania; osobno potwierdza zgodność obu haseł. Nie pozostały znane problemy P0, P1 ani P2 w sprawdzonych stanach.

## Materiał porównawczy

- Źródło wizualne: `/var/folders/m6/ync19sd96gz4pg73zt0mq_6m0000gn/T/codex-clipboard-2993f6b2-f976-4ae7-8c59-62b823769a27.png`, 742 × 160 px. Źródło pokazuje techniczny opis „10–72 bajty” nad polem hasła.
- Implementacja desktop: `/private/tmp/openexpert-password-realtime-desktop-final.jpg`, 1440 × 1000 px; CSS viewport 1440 × 1000, DPR 1.
- Implementacja mobile: `/private/tmp/openexpert-password-realtime-mobile-final.jpg`, 390 × 844 px; CSS viewport 390 × 844, DPR 1.
- Wspólny obraz porównawczy: `/private/tmp/openexpert-password-realtime-comparison.png`, 1420 × 220 px; źródło po lewej, wdrożona lista wymagań po prawej.

Stan implementacji: jasny motyw OpenExpert, organizacja `openexpert-local`, aktywne hasło. Widok desktop pokazuje kompletne hasło i zgodne potwierdzenie, a widok mobile hasło spełniające trzy z czterech reguł, aby uwidocznić aktualizację stanu w czasie rzeczywistym.

## Pełny widok i ocena wymaganych powierzchni

- **Typografia i copy:** opis bajtów zastąpiono krótkimi zasadami: co najmniej 10 znaków, mała litera, wielka litera i cyfra. Dłuższe hasło otrzymuje komunikat napisany prostym językiem, bez ujawniania technicznej jednostki.
- **Spacing i rytm:** wymagania tworzą zwartą siatkę dwóch kolumn bez zwiększania szerokości formularza. Odstęp 9 px od pola i 6 px pomiędzy wierszami zachowują hierarchię istniejącego formularza.
- **Kolory i tokeny:** niespełnione zasady korzystają z koloru tekstu pomocniczego, spełnione z semantycznego `--ui-success`, a błędy z `--ui-error`.
- **Ikony i zasoby:** użyto istniejących ikon Lucide `circle`, `circle-check`, `circle-x` i `circle-alert`. Nie dodano własnych SVG, atrap ani CSS-art.
- **Responsywność:** lista pozostaje dwukolumnowa na 390 px, mieści się w 316 px szerokości karty i nie powoduje poziomego overflow. Na desktopie formularz zachowuje dotychczasowe proporcje.
- **Dostępność:** lista ma nazwę dostępną, pole hasła wskazuje ją przez `aria-describedby`, a informacja o zgodności potwierdzenia używa `aria-live="polite"`. Stan każdej reguły jest przekazywany także tekstem i kolorem, nie samą ikoną.

## Interakcje sprawdzone w przeglądarce

- `abc` spełniało wyłącznie regułę małej litery.
- `Bezpieczne1` spełniało wszystkie cztery reguły.
- `InneHaslo1` w polu potwierdzenia pokazywało „Hasła nie są takie same.”, a `Bezpieczne1` — „Hasła są takie same.”.
- Bardzo długie hasło z polskimi znakami pokazywało prosty komunikat „Hasło jest za długie…” bez słowa „bajt”.
- Na viewportach 1440 × 1000 i 390 × 844 nie wystąpił poziomy overflow. Konsola przeglądarki nie zawierała błędów.
- Nie wysyłano formularza i nie zmieniano hasła podczas QA.

## Historia porównań i poprawek

- **P2 — niezrozumiała jednostka „bajty”:** techniczny limit pozostaje respektowany we wspólnej walidacji, ale komunikat został przepisany na zrozumiały język użytkownika.
- **P2 — brak informacji podczas pisania:** dodano cztery niezależne stany wymagań i natychmiastową informację o zgodności potwierdzenia.
- **P2 — ryzyko rozjechania na mobile:** siatkę zmierzono na 390 px; ma 316 px szerokości, dwie kolumny po 152 px i nie poszerza dokumentu.

## Walidacja techniczna

- `node --test --experimental-strip-types test/password-validation.test.ts` — 3/3 testy zakończone powodzeniem.
- `pnpm --filter @openexpert/crm typecheck` — zakończone kodem 0.
- `git diff --check` — bez błędów.
- Kontrola przeglądarkowa desktop 1440 × 1000 i mobile 390 × 844; brak błędów konsoli.

## Final result

`passed`
