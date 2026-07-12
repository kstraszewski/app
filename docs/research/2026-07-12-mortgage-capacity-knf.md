# Kalkulator zdolności hipotecznej — analiza KNF i model MVP

Stan analizy: 12 lipca 2026 r.

## Konkluzja

Rekomendacja S KNF nie opisuje jednego, kompletnego algorytmu „zdolności kredytowej”. Wyznacza ramy zarządzania ryzykiem, a szczegółową politykę i limity ma opracować bank. Dlatego narzędzie powinno być opisane jako **szacunkowy kalkulator zdolności hipotecznej**, a nie kalkulator „zgodny z KNF” ani substytut decyzji banku.

MVP łączy cztery ilościowe ograniczenia, które da się wiarygodnie policzyć bez pełnej dokumentacji kredytowej:

1. maksymalną ratę wynikającą z modelowego DStI,
2. maksymalną ratę pozostawiającą gospodarstwu co najmniej koszty życia na poziomie IPiSS,
3. ratę i kwotę kredytu przy stopie powiększonej o bufor stopy procentowej,
4. maksymalną kwotę wynikającą z wkładu własnego i LTV.

Wynik jest minimum z ograniczenia dochodowego i ograniczenia LTV, zaokrąglonym w dół do 1 000 zł.

## Najważniejsze ustalenia regulacyjne

### 1. DStI 40% i 50% nie są automatycznym limitem odmowy

Rekomendacja 9.3 wskazuje sytuacje wymagające szczególnej uwagi: DStI powyżej 40% dla klientów o dochodach nieprzekraczających przeciętnego wynagrodzenia w regionie i powyżej 50% dla pozostałych klientów. KNF wprost dopuszcza przekroczenie tych wartości jako świadomą akceptację podwyższonego ryzyka przez bank i klienta.

W MVP przyjęto konserwatywny **modelowy próg 40%**, ale pozostawiono go jako wersjonowaną politykę organizacji. Interfejs nie przedstawia go jako twardego wymogu KNF.

### 2. Okres kredytu: 25 lat do oceny, najwyżej 35 lat umowy

Bank powinien rekomendować okres nie dłuższy niż 25 lat i nie powinien udzielić kredytu na okres dłuższy niż 35 lat. Jeśli klient wybiera okres ponad 25 lat, zdolność nadal powinna być oceniana przy okresie maksymalnie 25-letnim.

Te wartości są zablokowane w silniku: obecny prosty interfejs pozwala symulować umowę 5–35 lat, lecz dla 26–35 lat maksymalna kwota jest wyliczana przy 25-letnim okresie oceny.

### 3. Bufor stopy procentowej

Dla zmiennej stopy minimalny bufor wynosi:

`MAX(5 p.p. - SBC; 2,5 p.p.) + sigma`

gdzie dla kredytu w PLN `SBC` to stopa referencyjna NBP, a `sigma` wynosi 1,5 p.p. tylko wtedy, gdy odchylenie standardowe stopy z ostatnich 100 dni roboczych wynosi co najmniej 0,5 p.p. i bieżąca stopa jest wyższa od średniej; w pozostałych przypadkach `sigma = 0`.

Dla okresowo stałej stopy o tenorze `x` miesięcy:

`Bx = 2,5 p.p. × (T - x) / (T - 60)`

gdzie `T` oznacza okres kredytu w miesiącach, a `x` mieści się od 60 do `T`. Dla stopy stałej do końca umowy bufor z tego wzoru wynosi 0.

Na dzień analizy stopa referencyjna NBP wynosi 3,75%, więc przy `sigma = 0` minimalny bufor dla stopy zmiennej wynosi 2,5 p.p. Administrator może aktualizować stopę NBP, datę jej aktualności i składnik `sigma`; sama formuła pozostaje zablokowana w kodzie.

### 4. Koszty utrzymania i minimum socjalne

Rekomendacja 8.10–8.12 wymaga realistycznych kosztów gospodarstwa, zaleca poziom nie niższy od minimum socjalnego oraz wskazuje, że po racie gospodarstwu nie powinna pozostać kwota niższa niż minimum socjalne IPiSS.

MVP przyjmuje większą z dwóch wartości: koszt zadeklarowany przez użytkownika albo koszyk IPiSS za IV kwartał 2025 r. Dla gospodarstwa trzyosobowego celowo użyto bardziej konserwatywnego wariantu z dzieckiem starszym.

| Liczba osób | Minimum miesięczne |
| ---: | ---: |
| 1 | 1 966,23 zł |
| 2 | 3 304,19 zł |
| 3 | 5 177,28 zł |
| 4 | 6 280,84 zł |
| 5 | 7 758,30 zł |
| każda następna | +1 551,66 zł |

Kwoty, data tabeli i stawka dla kolejnej osoby są edytowalne oraz audytowane w panelu administratora.

### 5. LTV i wkład własny

Dla nieruchomości mieszkalnych standardowy limit to 80% LTV. Poziom do 90% jest możliwy tylko przy dodatkowym zabezpieczeniu części ekspozycji ponad 80%.

Prosty MVP nie modeluje ubezpieczenia ani innych zabezpieczeń dodatkowych, dlatego przyjmuje maksymalnie 80% LTV. Administrator może ustawić wartość niższą, ale walidacja nie pozwala przekroczyć 80%.

### 6. Pełna decyzja banku jest szersza

Ustawa o kredycie hipotecznym nakazuje kredytodawcy ocenę zdolności przed zawarciem umowy. Rekomendacja S wymaga oceny ilościowej i jakościowej, obejmującej m.in. źródła i stabilność dochodu, wszystkie zobowiązania, koszty życia, wiek i możliwość uzyskiwania dochodu w całym okresie spłaty, historię kredytową oraz zabezpieczenie.

MVP nie symuluje BIK, form zatrudnienia, okresów uzyskiwania dochodu, wieku emerytalnego, walut obcych, współkredytobiorców o różnych profilach, produktów z dopłatą, zabezpieczenia ponad 80% LTV ani indywidualnych polityk banków. Pole dochodu jest świadomie opisane jako stabilny dochód netto w PLN, bez jednorazowych premii i 800+; to konserwatywne założenie modelu, nie uniwersalny zakaz KNF.

## Model obliczeniowy MVP

Oznaczenia:

- `I` — miesięczny stabilny dochód netto,
- `F` — stałe nieodwołalne obciążenia, np. alimenty,
- `h` — modelowy spadek dochodu,
- `C` — istniejące raty i obciążenie od przyznanych limitów,
- `K` — większa z deklarowanych kosztów życia i minimum IPiSS,
- `d` — modelowy próg DStI.

Obliczenia:

1. dochód rozpoznany po buforze: `(I - F) × (1 - h)`,
2. rata z DStI: `I × d - F - C`,
3. rata z dochodu rezydualnego: `(I - F) × (1 - h) - K - C`,
4. dopuszczalna rata testowa: minimum z punktów 2 i 3, nie mniej niż 0,
5. kwota dochodowa: odwrotność wzoru raty annuitetowej dla stopy nominalnej powiększonej o bufor i okresu oceny do 25 lat,
6. kwota z LTV: `wkład × LTV / (1 - LTV)`,
7. wynik: mniejsza z kwoty dochodowej i kwoty z LTV.

DStI korzysta z nieobniżonego dochodu netto, natomiast osobny test dochodu rezydualnego stosuje bufor spadku dochodu. Dzięki temu próg DStI i konserwatywne założenie dochodowe są widoczne jako odrębne ograniczenia.

## Domyślna polityka OpenExpert

| Parametr | Wartość | Status |
| --- | ---: | --- |
| próg DStI | 40% | założenie modelu, edytowalne |
| spadek dochodu | 10% | założenie modelu, edytowalne |
| miesięczne obciążenie limitu karty/debetu | 5% limitu | założenie modelu, edytowalne |
| maksymalne LTV | 80% | edytowalne tylko w dół |
| domyślna stopa nominalna | 6% | edytowalne |
| domyślny rodzaj stopy | okresowo stała, 5 lat | edytowalne w granicach walidacji |
| stopa referencyjna NBP | 3,75% | edytowalne z datą aktualności |
| `sigma` dla stopy zmiennej | 0 p.p. | edytowalne: 0 lub aktualna wartość po teście |
| okres oceny | maks. 25 lat | zablokowane w kodzie |
| okres umowy | maks. 35 lat | zablokowane w kodzie |
| minimalny tenor stopy okresowo stałej | 60 miesięcy | zablokowane w kodzie |

Każda zmiana ustawień organizacji tworzy rosnącą rewizję z identyfikatorem użytkownika, czasem zmiany i opcjonalną notatką. Zapis i reset stosują kontrolę oczekiwanej rewizji, więc nie nadpisują po cichu zmian z drugiego otwartego panelu. Odczyt przysługuje członkom organizacji, zapis i reset wyłącznie administratorom; reguły są wymuszane również przez RLS w bazie.

## Źródła pierwotne

- [KNF — ujednolicony tekst Rekomendacji S po uchwale 242/2023](https://www.knf.gov.pl/knf/pl/komponenty/img/Rekomendacja_S_nowelizacja_czerwiec_2023_82872.pdf)
- [KNF — komunikat o nowelizacji Rekomendacji S i terminie wdrożenia do 1 lipca 2024 r.](https://www.knf.gov.pl/komunikacja/komunikaty?articleId=82735&p_id=18)
- [IPiSS — minimum socjalne za IV kwartał 2025 r.](https://www.ipiss.com.pl/wp-content/uploads/2026/04/MS-4Q2025.pdf)
- [IPiSS — bieżące i archiwalne poziomy minimum socjalnego](https://www.ipiss.com.pl/pion-badawczy-polityki-spolecznej/wysokosc-minimum-socjalnego/)
- [NBP — informacja po posiedzeniu RPP z 8 lipca 2026 r.](https://nbp.pl/rpp-08-07-2026/)
- [Dziennik Urzędowy NBP — uchwała nr 1/2026, stopa referencyjna 3,75%](https://dzu.nbp.pl/GetActPdf.ashx?book=0&position=4&year=2026)
- [ELI — ustawa o kredycie hipotecznym, w szczególności art. 21–23](https://eli.gov.pl/api/acts/DU/2017/819/text.html)

## Utrzymanie modelu

Przed zmianą parametrów należy sprawdzić co najmniej: najnowszy tekst Rekomendacji S, bieżącą stopę referencyjną NBP, warunek `sigma` na ostatnich 100 dniach roboczych oraz najnowszą tabelę IPiSS. Zmiana wzorów, okresu 25/35 lat albo zasad LTV wymaga aktualizacji silnika i testów; nie powinna być zwykłą opcją administratora.
