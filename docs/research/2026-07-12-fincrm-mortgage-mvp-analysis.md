# Analiza kalkulatora hipotecznego FinCRM i zakres MVP

Stan analizy: 12 lipca 2026 r.  Analizowany kod: `finpack/fincrm-frontend`,
commit `d64cd9fc24a9f110bf3447f0bd6589adec0e8c81` z 9 lipca 2026 r. Repozytorium
zostało pobrane do osobnego, czystego katalogu. Nie kopiowano kodu ani wyglądu;
odtworzono model informacji i najważniejsze interakcje we własnej architekturze.

## 1. Jak FinCRM dzieli proces

FinCRM nie jest pojedynczym formularzem. To zestaw czterech warstw:

1. dane nieruchomości i oczekiwanego kredytu;
2. gospodarstwa domowe, kredytobiorcy, dochody i zobowiązania;
3. silnik dostępności oraz wariantów produktów bankowych;
4. tabela porównawcza, szczegóły produktu, harmonogram i wydruk.

Najważniejsze punkty wejścia to:

- `MortgageSimulationForm*.vue` — wieloetapowy formularz hipoteczny;
- `MortgageSimulationResults.vue` i `SimulationResults.vue` — wyniki;
- `MortgageTableElements.ts` — katalog pól porównania;
- `OfferSorting.ts` oraz `SimulationToolbarSort.vue` — sortowanie;
- `OfferDetails.vue` i katalog `offers/table/` — rozwinięcie oferty;
- katalog `schedule/` — harmonogram, transze, nadpłaty i dodatkowe koszty;
- katalog `printout/` — dobór kolumn i dokument wynikowy.

## 2. Pełny model wejścia znaleziony w FinCRM

### Nieruchomość i kredyt

- cel kredytu;
- rodzaj i wartość zabezpieczenia;
- rynek pierwotny lub wtórny;
- województwo/region;
- kwota netto i brutto kredytu;
- wkład własny jako kwota i procent, utrzymywane w synchronizacji;
- LTV wraz z ostrzeżeniem dla wysokiego LTV;
- okres kredytu w miesiącach oraz suwak lat;
- waluta;
- raty równe lub malejące;
- okres pomostowy, transze i karencja.

### Klient i zdolność

- jedno lub wiele gospodarstw domowych;
- jeden lub wielu kredytobiorców;
- źródła i historia dochodu;
- zobowiązania, limity i koszty życia;
- DTI oraz zdolność przypisana do produktu;
- przyczyny wykluczenia produktu, w tym LTV/DTI.

Druga grupa nie jest częścią pierwszej wersji OpenExpert. Publiczne strony banków nie
pozwalają jej wiarygodnie policzyć. MVP nie obiecuje zdolności ani akceptacji.

## 3. Pola wyniku i rankingu

FinCRM udostępnia m.in.:

- ratę kapitałowo-odsetkową;
- ratę przejściową z ubezpieczeniem pomostowym;
- ratę docelową i po zakończeniu okresu stałej stopy;
- pierwszą i ostatnią ratę;
- całkowitą kwotę do spłaty;
- koszt całkowity, odsetki, prowizję i koszty początkowe;
- opłaty za konto i kartę;
- ubezpieczenie życia, nieruchomości i spłaty;
- wycenę;
- marżę, stopę referencyjną i oprocentowanie łączne;
- RRSO;
- LTV i DTI;
- cross-sell, wariant eko i programy specjalne;
- warunki wcześniejszej spłaty;
- ważność, opis i odnośnik do panelu produktu.

Sortowanie obejmuje m.in. kwotę do spłaty, RRSO, koszty początkowe, pierwszą i
ostatnią ratę oraz marżę. Tabela rozróżnia produkty dostępne i odrzucone, pokazuje
przyczyny odrzucenia, ma wybór widocznych wierszy i wariant listy/tabeli.

## 4. Harmonogram FinCRM

Harmonogram rozdziela dla każdego miesiąca:

- saldo początkowe i końcowe;
- kapitał;
- odsetki;
- opłaty miesięczne;
- dodatkowe koszty;
- transze i karencję;
- własne i cykliczne nadpłaty;
- wariant rat równych/malejących.

W OpenExpert harmonogram jest częścią osobnego pakietu
`@openexpert/mortgage`. Model językowy nie bierze udziału w obliczeniach.

## 5. Co wdrożono w MVP OpenExpert

| Obszar | Stan | Uwagi |
|---|---|---|
| Wartość nieruchomości, kwota, wkład i LTV | wdrożone | wartości przeliczane na żywo |
| Okres i raty równe/malejące | wdrożone | 5–35 lat w UI, silnik do 600 miesięcy |
| Stała stopa i przejście na referencyjną + marżę | wdrożone | bez zakodowania na stałe jednego wskaźnika |
| Scenariusz zmiany stopy | wdrożone | suwak oraz osobny stress test +2 p.p. |
| Nadpłaty | wdrożone | miesięczne, skrócenie okresu lub obniżenie raty; silnik obsługuje też jednorazowe |
| Szczegóły pierwszej raty | wdrożone | kapitał, odsetki, koszty cykliczne, nadpłata |
| Pełny harmonogram | wdrożone | wszystkie miesiące na żądanie |
| Koszt 5 lat i całkowity | wdrożone | tylko znane, jawnie modelowalne koszty |
| Filtry | wdrożone | bank, stopa, kompletność, miesięczny wydatek, koszt początkowy |
| Sortowanie | wdrożone | 5 lat, rata, koszt całkowity, start, RRSO banku, kompletność |
| Porównanie 3 produktów | wdrożone | jednolite założenia |
| Źródło, data i hash | wdrożone | każda wersja prowadzi do dokumentu bankowego |
| Nieznane pola | wdrożone | prezentowane jako nieznane, nie jako zero |
| Zdolność/DTI | odroczone | wymaga wiarygodnych reguł partnera/banku |
| Transze, karencja, pomostowe | odroczone | silnik i schema przewidują dalsze rozszerzenie |
| Prawidłowe RRSO dla scenariusza | odroczone | UI pokazuje tylko RRSO bankowego przykładu i nie miesza go z wynikiem |
| ESIS, wniosek, decyzja | poza MVP | wymaga uprawnionego partnera lub banku |

## 6. Źródła i model danych

Pierwszy katalog obejmuje PKO BP, ING, Erste Bank Polska (dokument pod historycznym
adresem Santander), mBank oraz Bank Pekao. Manifest znajduje się w
`packages/database/data/mortgages/pl-2026-07-12.json`.

Importer:

1. pobiera wyłącznie wskazane oficjalne URL-e;
2. zachowuje surowy plik w ignorowanym `.data/mortgage-sources/<data>`;
3. liczy SHA-256;
4. kopiuje plik do prywatnego magazynu obiektowego;
5. zapisuje status pobrania, źródło, daty i zrecenzowane fakty;
6. wersjonuje produkt, zamiast nadpisywać jego historię.

HTML/PDF banku nie jest commitowany do repozytorium. Manifest zawiera tylko
ustrukturyzowane fakty, cytowalne adresy, status pewności i znane braki.

## 7. Ograniczenia interpretacyjne

- Wynik OpenExpert jest kalkulacją orientacyjną, nie „ofertą banku”.
- RRSO banku pochodzi z jego przykładu reprezentatywnego i nie jest bezpośrednio
  porównywalne z innym scenariuszem; dlatego nie jest przeliczanym RRSO klienta.
- Brak ceny produktu dodatkowego zwiększa listę braków i obniża kompletność.
- Maksymalne LTV jest filtrem tylko wtedy, gdy bank opublikował wiarygodny próg.
- Nie ma scoringu, prawdopodobieństwa decyzji ani automatycznej rekomendacji.
- Przed monetyzacją, przekazywaniem leadów lub użyciem logotypów potrzebne są
  uzgodnienia prawne i umowy z partnerami.

## 8. Następne rozszerzenia

1. panel operatora do diffu dokumentów i zatwierdzania nowej wersji;
2. dokładne cash-flow i XIRR/RRSO dla znormalizowanego scenariusza;
3. ubezpieczenie pomostowe, transze i karencja;
4. zapis scenariusza w sprawie klienta i eksport PDF;
5. feed od licencjonowanego pośrednika oraz jawne przyczyny dostępności;
6. testy regresyjne na bankowych przykładach reprezentatywnych.
