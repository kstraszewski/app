# Design QA — Forum ekspertów

## Wynik

`passed`

Forum przeszło końcową kontrolę wizualną, responsywną, interakcyjną i dostępnościową. Nie pozostały znane problemy P0 ani P1.

## Materiał porównawczy

- Źródło: `/var/folders/m6/ync19sd96gz4pg73zt0mq_6m0000gn/T/codex-clipboard-2d9dac2d-6268-47a8-a13e-b1719d4cae64.png`, 2174 × 1552 px.
- Źródło znormalizowane do wspólnego kadru: `/private/tmp/openexpert-forum-source-normalized.png`, 1916 × 1364 px.
- Implementacja końcowa: `/private/tmp/openexpert-forum-final-wide.png`, 1916 × 1364 px, DPR 1.
- Wspólny obraz porównawczy: `/private/tmp/openexpert-forum-design-comparison-final.png`, źródło po lewej i implementacja po prawej.
- Widoki podstron: `/private/tmp/openexpert-forum-category.png`, `/private/tmp/openexpert-forum-thread-page.png`, `/private/tmp/openexpert-forum-moderation.png`.
- Widoki mobilne 390 × 844 px: `/private/tmp/openexpert-forum-mobile-home-viewport.png`, `/private/tmp/openexpert-forum-mobile-thread-viewport.png`, `/private/tmp/openexpert-forum-mobile-thread-bottom.png`, `/private/tmp/openexpert-forum-mobile-moderation.png`.

Stan testowy: ciemny motyw OpenExpert, organizacja `openexpert-local`, użytkownik z rolą administratora organizacji, dane demonstracyjne forum.

## Ocena powierzchni

- **Układ i hierarchia:** zachowano nagłówek, ciemne powierzchnie, cienkie obramowania, zwarte kontrolki i hierarchię wzorca. Jednookienkowy split view został celowo zastąpiony katalogiem oraz osobnymi podstronami kategorii, wątku i moderacji, zgodnie z celem przebudowy.
- **Typografia i odstępy:** skala nagłówków, mono-eyebrow, rytm pionowy, gęstość list oraz szerokości tekstu są spójne z istniejącym systemem CRM. Pełna szerokość treści jest włączona wyłącznie dla stron forum.
- **Kolory i powierzchnie:** użyto istniejących tokenów `--ui-*` i promieni `--oe-*`; zielony sygnalizuje odpowiedzi/rozwiązanie, bursztynowy uprawnienia administracyjne, a neutralne powierzchnie organizują treść bez dodatkowej palety.
- **Ikony i zasoby:** wszystkie ikony pochodzą z jednego zestawu Lucide używanego w produkcie. Forum nie wymaga obrazów ilustracyjnych; nie dodano atrap, własnych SVG ani CSS-art.
- **Treść:** etykiety wyjaśniają wyszukiwanie wektorowe, stan realtime, zakres kategorii i uprawnienia moderatora. Poprawiono odmianę liczebników oraz tytuły dokumentów dla kategorii.
- **Interakcje:** działają kanoniczne linki do kategorii i wątków, stary `?thread=` przekierowuje z zachowaniem pozostałych filtrów, wyszukiwarka synchronizuje URL, a bezpośrednie linki do zakładek panelu moderacji otwierają właściwą sekcję.
- **Realtime:** katalog, wątek i moderacja aktualizują dane bez F5; fallback polling jest komunikowany użytkownikowi. Niedostępny po zmianie uprawnień wątek przechodzi do bezpiecznego stanu błędu zamiast pozostawiać starą treść.
- **Responsywność:** przy 390 px szerokości nie występuje poziomy overflow na stronie głównej, wątku ani moderacji. Kategorie, filtry, kontekst wątku i karty administracyjne przechodzą do jednej kolumny.
- **Dostępność:** główne regiony, formularz wyszukiwania, etykiety pól, komunikaty live, semantyczne linki i przyciski są obecne. Pomoc o trybie wyszukiwania jest dostępna z klawiatury, kontrolki mają focus-visible, a animacje respektują `prefers-reduced-motion`.

## Historia poprawek QA

- **P1 — bezpośredni link moderacji:** panel `?tab=categories|hidden` mógł pozostać w stanie ładowania. Inicjalizacja respektuje teraz aktywną sekcję i od razu pobiera właściwe dane.
- **P1 — zmiana dostępności wątku:** odpowiedź 403/404 podczas synchronizacji mogła pozostawić widoczną starą treść. Wątek jest teraz czyszczony i pokazuje stan błędu bez pętli retry.
- **P2 — błędy kategorii:** awaria pobierania nie jest już mylona z nieistniejącą kategorią, a ponowienie wykonuje pełną inicjalizację katalogu.
- **P2 — realtime kategorii:** po wyłączeniu kategorii stan `categoryNotFound` jest ponownie wyliczany przed pobraniem wątków.
- **P2 — formularz nowego tematu:** ręczny wybór kategorii nie jest nadpisywany przez odświeżenie listy, a podobne wątki są przeliczane również po zmianie kategorii.
- **P2 — dostępność i sticky:** tooltip wyszukiwarki ma klawiaturowy trigger, a baner nowych odpowiedzi nie jest blokowany przez scroll container.
- **P2 — szerokość i mobile:** usunięto zbędne ograniczenie szerokości forum i potwierdzono brak poziomego overflow na 390 px.

## Walidacja techniczna

- `pnpm --filter @openexpert/crm typecheck`
- 20/20 testów: Omni Search, forum, moderacja, wektoryzacja i worker embeddingów.
- Kontrola przeglądarkowa: katalog, kategoria, pełny wątek, panel moderacji, semantyczne wyszukiwanie, stary deep-link oraz widoki mobilne.
- Konsola bez błędów aplikacji; widoczna wyłącznie informacja deweloperska Vue o eksperymentalnym `Suspense`.

## Final result

`passed`
