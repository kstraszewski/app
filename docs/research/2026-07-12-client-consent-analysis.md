# Zgody w procesie dodawania klienta

Stan analizy: 12 lipca 2026 r. Dokument opisuje założenia produktu i implementacji, a nie zastępuje opinii prawnej. Finalne treści, cele, marki i zakres kanałów muszą zatwierdzić prawnicy lub IOD przed użyciem produkcyjnym.

## Najważniejszy wniosek

Samo dodanie klienta do CRM nie wymaga ogólnej „zgody RODO”. Zgoda jest tylko jedną z podstaw przetwarzania. Użycie jej tam, gdzie właściwa jest umowa, obowiązek prawny lub prawnie uzasadniony interes, jest mylące i może podważać dobrowolność oświadczenia.

| Proces | Typowa podstawa | Osobna zgoda w formularzu |
| --- | --- | --- |
| Działania przed zawarciem i wykonanie umowy z osobą fizyczną | art. 6 ust. 1 lit. b RODO | Nie |
| Obowiązki podatkowe, księgowe i regulacyjne | art. 6 ust. 1 lit. c RODO | Nie |
| Bezpieczeństwo, dochodzenie roszczeń i część relacji B2B po teście równowagi | art. 6 ust. 1 lit. f RODO | Nie |
| Przekazanie klauzuli informacyjnej | art. 13 lub 14 RODO | Nie — to obowiązek informacyjny, nie zgoda |
| Marketing e-mail | art. 398 PKE; dla danych osobowych także właściwa podstawa z art. 6 RODO | Tak, uprzednia i kanałowa |
| Marketing SMS/MMS | art. 398 PKE; dla danych osobowych także właściwa podstawa z art. 6 RODO | Tak, uprzednia i kanałowa |
| Marketing przez połączenia głosowe | art. 398 PKE; dla danych osobowych także właściwa podstawa z art. 6 RODO | Tak, uprzednia i kanałowa |

Uzasadniony interes na gruncie RODO nie zastępuje zgody wymaganej przez art. 398 PKE. Komunikaty ściśle operacyjne dotyczące żądania klienta, terminu, realizacji usługi lub faktury nie są marketingiem, o ile nie dokleja się do nich promocji.

## Zestaw startowy

Każda organizacja otrzymuje trzy odrębne, opublikowane definicje:

1. `marketing_email` — informacje handlowe i marketing bezpośredni na adres e-mail.
2. `marketing_sms` — informacje handlowe i marketing bezpośredni przez SMS/MMS.
3. `marketing_phone` — informacje handlowe i marketing bezpośredni przez połączenia głosowe.

Wszystkie są opcjonalne, domyślnie odznaczone i nie blokują utworzenia klienta. Zgody na marketing partnerów, profilowanie, dane szczególne, nagrywanie rozmów lub komunikatory nie są seedowane bez opisu konkretnego procesu i beneficjentów.

## Wymagania dla ważnego oświadczenia

- jasny, konkretny cel, kanał i podmiot korzystający ze zgody;
- oddzielne decyzje dla e-maila, SMS/MMS i telefonu;
- brak domyślnego zaznaczenia i brak negatywnych konsekwencji odmowy;
- treść wyświetlona przy checkboxie, bez ukrywania jej wyłącznie pod linkiem;
- możliwość wykazania osoby, endpointu, dokładnej wersji treści, decyzji, czasu, źródła i pracownika/procesu;
- zmiana celu, kanału lub beneficjenta tworzy nową wersję i nie przenosi automatycznie wcześniejszych zgód;
- wycofanie musi być równie łatwe jak udzielenie i natychmiast blokować marketing danym kanałem;
- bezpośredni sprzeciw marketingowy z art. 21 ust. 2–3 RODO powinien mieć pierwszeństwo przed zgodami kanałowymi.

IP, identyfikator urządzenia i nagranie rozmowy nie są zbierane domyślnie. Mogą być dodatkowym dowodem tylko po analizie proporcjonalności i retencji.

## Model wdrożony w CRM

- `crm_consent_definitions` przechowuje stabilną tożsamość zgody i wskaźnik bieżącej wersji;
- `crm_consent_definition_versions` przechowuje niezmienny tekst, cel, kanał, podstawę, status, datę, autora i SHA-256;
- każda edycja w panelu tworzy kolejną wersję zamiast nadpisywać wersję historyczną;
- `crm_client_consent_events` przechowuje append-only decyzje `granted`, `declined` lub w przyszłości `withdrawn`, przypięte do osoby klienta i konkretnej wersji;
- utworzenie klienta, osoby, trzech decyzji i aktywności odbywa się atomowo w jednej transakcji;
- członkowie organizacji mogą odczytywać definicje i rejestrować decyzje, ale definicje może zmieniać tylko administrator organizacji;
- tabele mają jawne granty, RLS per organizacja i klucze złożone zapobiegające powiązaniom między tenantami.

## Następny zakres

Ta iteracja obejmuje decyzje podczas dodawania klienta. Przed uruchomieniem wysyłek marketingowych trzeba domknąć:

1. akcję wycofania zgody na karcie klienta, zapisującą nowe zdarzenie bez modyfikacji historii;
2. globalny sprzeciw wobec marketingu i listę suppression nadrzędną wobec zgód;
3. synchronizację wycofań z narzędziami e-mail/SMS/telefonicznymi;
4. wersjonowaną ewidencję przekazania klauzuli informacyjnej z art. 13/14 RODO — bez checkboxa „akceptuję politykę prywatności”;
5. politykę retencji i kontrolowany proces usuwania lub anonimizacji dowodów.

## Źródła urzędowe

- [RODO — EUR-Lex](https://eur-lex.europa.eu/legal-content/PL/TXT/?uri=CELEX:32016R0679), w szczególności art. 5–7, 13–14 i 21 oraz motyw 47.
- [Prawo komunikacji elektronicznej — tekst ujednolicony na 7 lipca 2026 r.](https://eli.gov.pl/api/acts/DU/2024/1221/text/U/D20241221Lj.pdf), w szczególności art. 398 i 400.
- [Wytyczne EROD 05/2020 dotyczące zgody](https://www.edpb.europa.eu/system/files/documents/files/file1/edpb_guidelines_202005_consent_pl.pdf).
- [UODO: zgoda nie zawsze jest właściwą podstawą](https://uodo.gov.pl/pl/701/4467).
- [UODO: obowiązek informacyjny z art. 14 RODO](https://uodo.gov.pl/decyzje/ZSPR.421.3.2018).

