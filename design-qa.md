# Design QA — wybór załączników w paczce Multiwniosku

## Wynik

`passed`

Lista dokumentów w aktywnym wniosku ma teraz niezależny checkbox przy każdym pliku, wszystkie pozycje są domyślnie zaznaczone, a ekspert może wyłączyć pojedynczy załącznik lub użyć akcji „Odznacz wszystkie”. Nie pozostały znane problemy P0, P1 ani P2 w sprawdzonym stanie.

## Materiał i normalizacja

- Źródło wizualne: `/var/folders/m6/ync19sd96gz4pg73zt0mq_6m0000gn/T/codex-clipboard-863ea76a-d337-4e21-a134-3d1cdb96c14a.png`, 2060 × 1492 px.
- Implementacja: `/private/tmp/multiform-package-checkboxes-final.png`, 1280 × 720 px; CSS viewport 1280 × 720, DPR 2. Przeglądarka zwróciła znormalizowany screenshot w pikselach CSS (1280 × 720).
- Stan: ciemny motyw OpenExpert, krok „Paczka ZIP”, aktywny Erste Bank Polska, dwa wnioski oraz siedem widocznych załączników wspólnych.
- Źródło i implementację otwarto razem w jednym wejściu porównawczym. Źródło ma większy viewport i pokazuje dłuższy fragment listy, dlatego ocenę dopasowano do wspólnego regionu: rail wniosków, nagłówek banku, formularz i początek listy załączników.
- Osobny crop nie był potrzebny: checkboxy, licznik `7/7`, akcja zbiorcza, nazwy plików i badge są czytelne w pełnym widoku implementacji.

## Ocena wymaganych powierzchni

- **Typografia:** zachowano istniejącą rodzinę, wagi i rozmiary; nowy licznik oraz akcja zbiorcza mają hierarchię pomocniczą i nie konkurują z nazwą sekcji.
- **Spacing i rytm:** checkbox zajmuje osobną, stałą kolumnę przed ikoną pliku. Wiersze zachowują dotychczasową wysokość, odstępy i wyrównanie akcji pobierania.
- **Kolory i tokeny:** zaznaczenie używa istniejącego `--ui-primary`; wyłączony wiersz korzysta z tokenów tła i kontrolowanego obniżenia opacity, bez nowej palety.
- **Jakość obrazów i zasoby:** logotypy banków pozostają źródłowymi assetami z danych ofert. Ikony akcji pochodzą z dostępnego zestawu Lucide; brak atrap, własnych SVG i CSS-art.
- **Copy i treść:** „Zaznacz pliki, które mają trafić do ZIP-a”, `7/7`, „Odznacz wszystkie” oraz badge „Poza paczką” jednoznacznie opisują stan i skutek wyboru.
- **Dostępność:** każdy checkbox ma nazwę `Dodaj [nazwa pliku] do paczki ZIP`, ma natywny stan checked i pozostaje niezależny od przycisku „Pobierz”.

## Interakcje sprawdzone w przeglądarce

- Po świeżym otwarciu wszystkie siedem dokumentów było zaznaczonych, licznik sekcji pokazywał `7/7`, a pełna paczka `9` dokumentów.
- Odznaczenie `operat-szacunkowy.pdf` pozostawiło plik na liście, pokazało badge „Poza paczką” i zaktualizowało liczniki do `6/7` oraz `Pobierz całość ZIP (8)`.
- Ponowne zaznaczenie przywróciło `7/7` i `Pobierz całość ZIP (9)`.
- Akcja „Zaznacz wszystkie” przywróciła domyślny komplet po odznaczeniu pliku.
- Checkbox mBanku nadal działa niezależnie: stan zmienił się na `1/2 wybrane`, a ponowne zaznaczenie przywróciło `2/2 wybrane`.
- Finalny odczyt konsoli po świeżym otwarciu nie zawierał ostrzeżeń ani błędów.

## Historia porównania i poprawki

- **P1 — brak kontroli wyboru przy załącznikach:** źródło pozwalało wybierać wyłącznie wnioski bankowe. Dodano checkbox per plik, stan „Poza paczką”, licznik wybranych i akcję zaznacz/odznacz wszystkie; liczba plików w ZIP-ie reaguje natychmiast.
- **P2 — trzy ikony akcji nie były dostępne w lokalnym bundlu:** `package-down`, `scan-search` i `file-down` powodowały ostrzeżenia oraz puste miejsca. Zastąpiono je dostępnymi ikonami `download` i `eye`; świeży finalny widok nie raportuje ostrzeżeń ani błędów.

## Walidacja techniczna

- `pnpm --filter @openexpert/crm typecheck` — zakończone kodem 0.
- `git diff --check` — zakończone kodem 0.

## Final result

`passed`

---

# Design QA — wysyłka paczek Multiwniosku do klientów

## Wynik

`passed`

Akcja „Wyślij do klientów” została dodana do istniejącego nagłówka paczki wariantu 2. Modal potwierdzenia pokazuje zakres wysyłki i odbiorców, ale nie ujawnia numerów PESEL. Nie pozostały znane problemy P0, P1 ani P2 w sprawdzonym stanie.

## Materiał i porównanie

- Źródło produktu: `/var/folders/m6/ync19sd96gz4pg73zt0mq_6m0000gn/T/codex-clipboard-4712791d-0c6f-4b7d-8471-c5d9c13297da.png`, 2048 × 1126 px.
- Implementacja: lokalny widok sprawy `E2E Multiwniosek 2026-08-07`, krok „Paczka ZIP”, modal „Wyślij paczki do klientów”, viewport 1280 × 720 px.
- Źródło i finalny modal otwarto razem w jednym wejściu porównawczym. Modal zachowuje ciemny motyw, promienie, obramowania, rytm i typografię istniejącego widoku; dodana akcja nie zmienia hierarchii banków ani dokumentów.

## Ocena

- **Hierarchia:** zabezpieczenie PESEL jest pierwszą informacją w modalu, potem widoczny jest zakres `2 wnioski / 8 załączników / 2 odbiorcy`, lista klientów i jednoznaczna akcja końcowa.
- **Prywatność:** interfejs pokazuje wyłącznie nazwę i adres e-mail. Copy jasno mówi, że PESEL jest hasłem, ale numer nie trafi do wiadomości ani widoku.
- **Stany:** każdy odbiorca ma status `Oczekuje`, a odpowiedź serwera może zmienić go na `Wysłano` albo `Nie wysłano`; częściowa wysyłka udostępnia retry bez ponownego wysyłania zakończonych pozycji.
- **Kompletność:** modal powtarza ostrzeżenie o mBanku bez szablonu przed ostatecznym przyciskiem wysyłki, więc ekspert nie musi pamiętać komunikatu widocznego pod listą dokumentów.
- **Responsywność:** modal mieści pełną listę dwóch klientów przy 1280 × 720 px, przyciski i podsumowanie korzystają z zawijania, a dane klienta mają kontrolowane skracanie.
- **Dostępność:** modal ma nazwę i opis, lista ma etykietę, komunikaty bezpieczeństwa i błędów są tekstowe, a przyciski zachowują jednoznaczne nazwy.

## Interakcje sprawdzone w przeglądarce

- Przycisk „Wyślij do klientów” jest widoczny obok pobrania pełnej paczki.
- Otwarcie modalu nie uruchamia wysyłki i pokazuje Jana oraz Annę wraz z ich adresami e-mail.
- Zamknięcie przez „Anuluj” usuwa modal i stan żądania.
- Nie klikano końcowego potwierdzenia, aby nie wysyłać wiadomości podczas kontroli UI.
- Konsola przeglądarki nie zawierała błędów.

## Walidacja techniczna

- `pnpm --filter @openexpert/email test` — 8/8 testów zakończonych powodzeniem.
- `node --test --experimental-strip-types apps/crm/test/multiform-package-email.test.ts` — 4/4 testy zakończone powodzeniem.
- `pnpm --filter @openexpert/crm typecheck` — zakończone kodem 0.
- `pnpm --filter @openexpert/landing test` — 46/46 testów zakończonych powodzeniem, w tym ZIP zabezpieczony 11-cyfrowym hasłem.

## Final result

`passed`

---

# Design QA — kompaktowy katalog forum

## Wynik

`passed`

---

# Design QA — paczka Multiwniosku według banków (wariant 2)

## Wynik

`passed`

Wybrany wariant 2 został przeniesiony do istniejącego kroku „Paczka ZIP”: lista wniosków jest po lewej, aktywny bank ma własny obszar roboczy, dokumenty nieuzupełnione są odcięte na dole, a akcje pobierania działają per bank i zbiorczo. Nie pozostały znane problemy P0, P1 ani P2 w sprawdzonym stanie.

## Materiał porównawczy

- Źródło wizualne: `/Users/konradstraszewski/.codex/generated_images/019fdc7f-1127-7272-bb65-2f38c021d165/exec-1596a06d-9b16-4001-947f-572b00043ce8.png`, 1672 × 941 px.
- Implementacja — obszar kroku ZIP: `/Users/konradstraszewski/Documents/GitHub/app/tmp/design-qa-multiform-v2.png`, 1320 × 1201 px; CSS viewport 1672 × 941, DPR 1.
- Wspólny obraz porównawczy: `/Users/konradstraszewski/Documents/GitHub/app/tmp/design-qa-multiform-v2-comparison.png`, 2640 × 1201 px; źródło po lewej, implementacja po prawej.
- Stan przed poprawką przewijania: `/Users/konradstraszewski/Documents/GitHub/app/tmp/design-qa-multiform-v2-before-scroll-fix.png`, 1672 × 941 px.
- Stan modalu jednorazowego hasła: `/Users/konradstraszewski/Documents/GitHub/app/tmp/design-qa-multiform-password-modal.png`, 1672 × 941 px.

Źródło 1672 × 941 px znormalizowano proporcjonalnie do pola 1320 × 1201 px bez zwiększania gęstości; implementację porównano jako rzeczywisty obszar komponentu przy viewporcie 1672 × 941 i DPR 1. Źródło pokazuje osobny ekran, a implementacja pozostaje krokiem istniejącej karty sprawy, dlatego porównanie pełnego widoku obejmuje odpowiadający mu region paczki, bez otaczającego nagłówka sprawy i steppera.

Stan: ciemny motyw OpenExpert, sprawa `E2E Multiwniosek 2026-08-07`, dwa wnioski domyślnie zaznaczone, aktywny Erste Bank Polska, jeden formularz automatyczny, osiem załączników oraz mBank oznaczony do obsługi ręcznej z powodu braku szablonu.

## Pełny widok i ocena wymaganych powierzchni

- **Typografia:** zachowano istniejącą rodzinę, wagi i hierarchię CRM. Nazwy banków, produktu, sekcji i plików mają czytelny kontrast oraz kontrolowane skracanie; małe statusy pozostają pomocnicze względem nazw wniosków i akcji.
- **Spacing i rytm:** układ ma rail 270 px i elastyczny panel banku, zgodnie z wybranym wariantem. Sekcje formularzy, dokumentów oraz braków mają wspólny rytm, promienie i obramowania. W finalnej iteracji usunięto zagnieżdżone przewijanie kroku ZIP, dzięki czemu nagłówek paczki i zawartość zachowują naturalny przepływ strony.
- **Kolory i tokeny:** użyto wyłącznie istniejących tokenów `--ui-*`, semantycznych kolorów `success`/`warning` i konfiguracji organizacji. Aktywny wniosek ma subtelny znacznik primary; brak szablonu jest żółty, a gotowość zielona.
- **Jakość obrazów i zasoby:** logotypy Erste i mBank pochodzą z danych ofert i są wyświetlane z zachowaniem proporcji oraz tła banku. Pozostałe ikony pochodzą z używanej kolekcji Lucide; nie dodano własnych SVG, CSS-art ani atrap.
- **Copy i treść:** widok mówi językiem eksperta: „Wnioski”, „Formularze bankowe”, „Dokumenty do wniosku”, „Do uzupełnienia ręcznie”, „Pobierz ZIP banku” i „Pobierz całość ZIP (9)”. Dokumenty sprawy są jawnie oznaczone jako „Wspólne”.
- **Responsywność:** desktop używa raila i panelu obok siebie; poniżej 760 px przechodzi do jednego toru, a drzewo archiwum jest ukrywane, żeby nie dublować informacji. Kontrolki pobierania i hasła układają się pionowo bez poziomego overflow.
- **Dostępność:** checkboxy mają nazwy banków, lista banków nie zagnieżdża już interaktywnych kontrolek w przyciskach, aktywne akcje są przyciskami, bank bez szablonu ma zablokowane pobranie ZIP, a statusy są przekazywane także tekstem.

## Porównanie detali

- Wspólny obraz porównawczy pozwala ocenić rail banków, aktywny bank, prawdziwe logotypy, formularz i początek listy dokumentów w jednym wejściu.
- Osobny screenshot modalu potwierdza stan nieuwzględniony w źródle: jednoznaczny kod hasła, akcję „Kopiuj hasło” oraz ostrzeżenie, że po zamknięciu hasła nie można odzyskać.
- Nie wykonywano kolejnego cropu pojedynczego wiersza, ponieważ nazwy, ikony, badge „Wspólne” i akcje są czytelne w obrazie implementacji przy DPR 1.

## Interakcje sprawdzone w przeglądarce

- Po świeżym załadowaniu oba wnioski były zaznaczone, a aktywny był pierwszy bank z gotowym szablonem — Erste.
- Odznaczenie mBanku zmieniło etykietę akcji z `Pobierz całość ZIP (9)` na `Pobierz całość ZIP (8)`.
- Pobranie osobnej paczki Erste działało przy wyłączonej ochronie i nie otworzyło modalu hasła.
- Chronione pobranie pełnej paczki zakończyło się powodzeniem i otworzyło modal z hasłem w formacie `XXXX-XXXX-XXXX-XXXX`.
- „Kopiuj hasło” zmieniło stan na „Skopiowano”. Po zamknięciu i ponownym pobraniu system wygenerował inne hasło (`Z23N-Q83U-XJ5A-PYGD` → `VJEX-Z69X-5J6D-99KC`).
- mBank bez szablonu pozostał widoczny i domyślnie zaznaczony, ale jego akcja „Pobierz ZIP banku” była zablokowana; dokumenty wspólne nadal były dostępne w jego widoku.
- Konsola przeglądarki nie zawierała błędów.

## Historia porównania i poprawki

- **P2 — zagnieżdżone przewijanie ograniczało widok wariantu 2:** pierwszy przebieg utrzymywał maksymalną wysokość body karty także w kroku ZIP, przez co nagłówek i lista dokumentów były rozdzielone wewnętrznym scrollem. Dla kroku paczki body otrzymało naturalną wysokość i przewijanie dokumentu. Finalny screenshot pokazuje ciągły obszar paczki bez dodatkowego scrolla wewnątrz.
- **P2 — checkbox był pierwotnie zagnieżdżony w przycisku banku:** rail został rozdzielony na niezależny checkbox wyboru paczki i przycisk otwierający bank. Finalny DOM zachowuje tę samą kompozycję bez nieprawidłowego zagnieżdżenia interaktywnych elementów.

## Walidacja techniczna

- `pnpm --filter @openexpert/crm typecheck` — zakończone kodem 0.
- `pnpm --filter @openexpert/landing typecheck` — zakończone kodem 0.
- `pnpm --filter @openexpert/landing test -- multiform-pdf.test.ts` — 46/46 testów zakończonych powodzeniem, w tym test folderów banku i szyfrowania każdego wpisu ZIP.
- `pnpm --filter @openexpert/crm test:multiform-template-editor` — 21/21 testów zakończonych powodzeniem.
- Przeglądarka: viewport 1672 × 941, DPR 1; sprawdzono wybór wniosków, licznik dokumentów, pobranie per bank, pełny ZIP, modal hasła, kopiowanie i rotację hasła.

## Final result

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

# Design QA — pełnoekranowy widok wiadomości klienta

## Wynik

`passed`

Widok wiadomości zaczyna się bezpośrednio pod główną nawigacją i zajmuje całą pozostałą wysokość ekranu. Nie pozostały znane problemy P0, P1 ani P2 w sprawdzonych stanach.

## Materiał porównawczy

- Źródło produktu przed zmianą: `/var/folders/m6/ync19sd96gz4pg73zt0mq_6m0000gn/T/codex-clipboard-6b0ece48-caed-4e31-882b-acc088b535eb.png`, 3024 × 1658 px. Źródło definiuje typografię, kolory, globalny nagłówek i styl wiadomości OpenExpert.
- Referencja układu Messenger: `/var/folders/m6/ync19sd96gz4pg73zt0mq_6m0000gn/T/codex-clipboard-c3003fae-e2ba-4f4e-90c6-36a3fcfa2c6c.png`, 2288 × 1650 px. Referencja definiuje pełnowysokościowy podział na listę rozmów i aktywny czat, wyszukiwarkę oraz kompozytor przy dolnej krawędzi.
- Implementacja desktop: `/private/tmp/openexpert-messages-desktop-final.png`, 1600 × 900 px; CSS viewport 1600 × 900, DPR 1.
- Implementacja mobile — lista: `/private/tmp/openexpert-messages-mobile-list.png`, 390 × 844 px; CSS viewport 390 × 844, DPR 1.
- Implementacja mobile — aktywny czat: `/private/tmp/openexpert-messages-mobile-chat.png`, 390 × 844 px; CSS viewport 390 × 844, DPR 1.
- Pełny widok źródła produktu, referencji Messenger i implementacji otwarto razem w jednym wejściu porównawczym. Gęstość pikseli nie była normalizowana 1:1, ponieważ drugi screenshot jest referencją kompozycji, a nie źródłem do klonowania; oceniano proporcje regionów i zachowanie layoutu.

Stan implementacji: jasny motyw, bezpieczny podgląd portalu klienta, dwie demonstracyjne sprawy, pierwsza rozmowa aktywna na desktopie; na mobile sprawdzono osobno listę i aktywny czat.

## Pełny widok i ocena wymaganych powierzchni

- **Typografia:** zachowano DM Sans, optyczne wagi OpenExpert, uppercase tytułu sprawy, istniejące rozmiary wiadomości i metadanych. Tytuł „Wiadomości” przeniesiono do panelu listy, zgodnie z hierarchią Messengera, bez dodawania nowego stylu display.
- **Spacing i rytm:** usunięto duży nagłówek strony, zewnętrzne marginesy, zaokrągloną kartę i cień. Globalny nagłówek ma 82 px, a inbox dokładnie 818 px przy viewporcie 900 px. Sidebar ma 380 px, a rozmowa 1220 px; historia i kompozytor nie powodują przewijania dokumentu.
- **Kolory i tokeny:** zachowano jasną paletę OpenExpert, `--portal-warm-surface`, `--portal-line` i semantyczne tokeny `--ui-*`. Aktywna rozmowa oraz własne wiadomości pozostają czarne, bez kopiowania ciemnego motywu Messengera.
- **Ikony i zasoby:** wszystkie nowe ikony pochodzą z istniejącej kolekcji Lucide (`search`, `search-x`, `arrow-left`, `arrow-up-right`). Widok nie wymaga nowych obrazów ani ilustracji; nie dodano własnych SVG, atrap ani CSS-art.
- **Copy i treść:** zachowano nazwy spraw, ekspertów, status synchronizacji, metadane dostarczenia i treść rozmowy. Dodano jedynie użytkowe copy wyszukiwania oraz jego stan pusty.
- **Responsywność:** przy 390 px lista i czat są osobnymi stanami. Powrót mieści się w nagłówku rozmowy, dokument ma `clientWidth = scrollWidth = 390`, a kompozytor kończy się na y=764, tuż nad dolną nawigacją zaczynającą się na y=770.
- **Dostępność:** panel listy i aktywna rozmowa zachowują nazwy regionów; wyszukiwarka ma label, aktywny wątek `aria-current`, a mobilny powrót jednoznaczną nazwę dostępną. Istniejące live regiony, focus-visible i stany disabled pozostały bez zmian.

## Interakcje sprawdzone w przeglądarce

- Wyszukanie `Refinansowanie` ograniczyło listę do właściwej rozmowy, a wyczyszczenie pola przywróciło oba wątki.
- Wybór drugiego wątku zaktualizował URL do `?case=case-preview-refinance` i przełączył kontekst rozmowy.
- Mobilny przycisk powrotu usunął parametr sprawy i przywrócił pełnoekranową listę.
- Pole wiadomości, przycisk wysyłki, akcja załącznika i dolna nawigacja pozostały widoczne w aktywnym czacie.
- Konsola nie zawierała błędów ani ostrzeżeń w stanach desktop, mobile-list i mobile-chat.

## Historia porównania i poprawki

- **P1 — główna część ekranu była zajęta przez tytuł i zewnętrzne odstępy:** usunięto blok „Twoje rozmowy / Wiadomości”, wrapper 1240 px, padding i kartę. Finalny inbox dochodzi od y=82 do y=900 i zajmuje pełną szerokość 1600 px.
- **P2 — aktywny czat miał dwa kolejne nagłówki:** tytuł sprawy, ekspert, status i akcję „Otwórz sprawę” połączono w jeden pasek o wysokości 78 px.
- **P2 — pierwszy wariant mobilny miał 508 px szerokości w viewporcie 390 px:** źródłem był min-content linku „Otwórz sprawę”. Panel otrzymał `min-width: 0`, szerokość 100%, elastyczny blok eksperta i ikonowy wariant akcji. Po poprawce nagłówek, historia i kompozytor mają dokładnie 390 px szerokości, a poziomy overflow nie występuje.
- **P2 — pole pisania mogło wejść pod dolną nawigację:** panel rozmowy otrzymał siatkę z elastycznym regionem historii oraz mobilny odstęp pod kompozytorem. Finalne pomiary pokazują 6 px przerwy między kompozytorem a dolną nawigacją.

## Walidacja techniczna

- `pnpm --filter @openexpert/client typecheck` — zakończone kodem 0.
- `pnpm --filter @openexpert/client test:conversation-inbox` — 4/4 testy zakończone powodzeniem.
- `git diff --check` — bez błędów.
- Kontrola przeglądarkowa desktop 1600 × 900 oraz mobile 390 × 844; sprawdzono wyszukiwanie, wybór rozmowy, mobilny powrót, geometrię regionów, brak poziomego overflow i logi konsoli.
- Próba dodatkowego `nuxt build` nie została uruchomiona, ponieważ w tym samym katalogu działał już inny proces buildu (PID 24123). Nie zatrzymywano procesu użytkownika; typecheck i testy zakończyły się powodzeniem.

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

---

# Design QA — widoki wiadomości CRM

## Wynik

`passed`

Globalna skrzynka CRM i zakładka Wiadomości na karcie sprawy korzystają teraz z pełnowysokościowego układu rozmowy. Nie pozostały znane problemy P0, P1 ani P2 w sprawdzonym stanie desktopowym i głównych interakcjach.

## Materiał porównawczy

- Referencja docelowego układu klienta: `/private/tmp/openexpert-client-messages-reference.png`, 1280 × 720 px.
- Poprzedni widok CRM: `/private/tmp/openexpert-crm-messages-before.png`, 1280 × 720 px.
- Finalna globalna skrzynka CRM: `/private/tmp/openexpert-crm-messages-final.png`, 1280 × 720 px.
- Finalna zakładka wiadomości sprawy: `/private/tmp/openexpert-crm-case-messages-final.png`, 1280 × 720 px.

Porównanie wykonano w tym samym wywołaniu przeglądarkowym i w tym samym viewporcie. Lewa nawigacja CRM oraz ciemny motyw są oczekiwanymi różnicami produktu; oceniano strukturę lista–rozmowa, rytm, hierarchię i zachowanie.

## Pełny widok i ocena wymaganych powierzchni

- **Layout i spacing:** usunięto duży hero oraz kartę ograniczającą inbox. Globalny widok ma rail 300–360 px i elastyczny panel rozmowy. Na sprawie kompaktowy nagłówek i zakładki pozostają nad panelem, a historia zajmuje całą pozostałą wysokość.
- **Typografia i copy:** zachowano fonty i hierarchię CRM. Tytuł listy, nazwa klienta, nazwa sprawy, status synchronizacji, czas oraz podgląd wiadomości są skanowalne i odpowiednio skracane.
- **Kolory i powierzchnie:** użyto istniejących tokenów CRM. Aktywny wątek korzysta z podwyższonej powierzchni oraz znacznika `--ui-primary`, zgodnie z istniejącym wzorcem skrzynki pocztowej CRM.
- **Ikony i zasoby:** wszystkie akcje używają istniejących ikon Lucide. Nie dodano obrazów, własnych SVG, CSS-art ani atrap zasobów.
- **Stany:** zachowano loading, błąd, pustą listę, brak wyników, wszystko przeczytane, limit 100 rozmów, unread, disabled composer, realtime/polling, typing, receipts, załączniki i panel plików klienta.
- **Responsywność:** przy `max-width: 1100px` globalny widok przechodzi na list-or-detail, dzięki czemu sidebar CRM nie ściska rozmowy na małych laptopach i tabletach. Przycisk powrotu przywraca listę; composer respektuje safe area, a historia pozostaje jedynym pionowym obszarem przewijania.
- **Dostępność:** lista, panel rozmowy, wyszukiwarka, filtry, aktywny wątek, composer i akcje mają nazwy dostępne. Zachowano `aria-current`, live regiony, focus-visible, stan disabled i praktyczne rozmiary kontrolek.

## Interakcje sprawdzone w przeglądarce

- Wyszukiwanie pokazało stan „Brak wyników”, a „Wyczyść filtry” przywróciło rozmowę.
- Filtr „Nieprzeczytane” pokazał stan „Wszystko przeczytane”; powrót do „Wszystkie” przywrócił listę.
- Kliknięcie wątku ustawiło URL `?case=…&person=…` i zachowało właściwy kontekst rozmowy.
- Panel „Pliki od klienta” otworzył się z poprawną nazwą klienta i zamknął bez błędu.
- Wpisanie szkicu aktywowało przycisk wysyłki, a wyczyszczenie pola ponownie go dezaktywowało. Nie wysłano wiadomości testowej.
- Świeże załadowanie globalnego widoku oraz karty sprawy zakończyło się bez błędów i ostrzeżeń konsoli.

## Historia porównania i poprawki

- **P1 — globalna skrzynka nie pokazywała rozmowy:** wiersz prowadził do karty sprawy, a większość ekranu pozostawała pusta. Dodano pełnowysokościowy split view z wyborem utrwalonym w URL.
- **P1 — wiadomości sprawy miały limit `62dvh`:** panel otrzymał wariant `pane`, łańcuch `min-height: 0` i elastyczny region historii z composerem przy dolnej krawędzi.
- **P2 — nagłówek sprawy zabierał za dużo wysokości:** wariant compact ukrywa opisowy hero, ogranicza tytuł i odstępy oraz pozostawia zakładki.
- **P2 — Agent AI zasłaniał composer:** launcher na trasach wiadomości został przesunięty nad pole odpowiedzi.
- **P2 — pierwszy przebieg miał ostrzeżenia hydratacji:** panel otrzymał deterministyczny fallback do zakończenia hydratacji. Powtórny test w świeżych kartach zwrócił zero błędów i ostrzeżeń.
- **P2 — ikona pustego stanu nie istniała w zestawie Lucide:** zastąpiono ją dostępną ikoną `message-circle-more`.
- **P1 — polling mógł przełączyć domyślnie otwartą rozmowę:** pierwszy desktopowy wybór jest teraz zapamiętywany, a zmiana wątku zostaje zablokowana podczas aktywnego szkicu lub wysyłania.
- **P2 — sidebar mógł ścisnąć split view przy 768–1100 px:** breakpoint list-or-detail podniesiono do 1100 px; panel rozmowy pokazuje wtedy akcję powrotu.

## Walidacja techniczna

- `pnpm --filter @openexpert/crm typecheck` — zakończone kodem 0.
- `pnpm --filter @openexpert/crm test:message-attachments` — 3/3 testy zakończone powodzeniem.
- `git diff --check` — bez błędów.
- Kontrola przeglądarkowa: globalne `/messages` i `cases/:id?view=messages`, viewport 1280 × 720, ciemny motyw; brak błędów i ostrzeżeń w świeżych kartach.

## Final result

`passed`
