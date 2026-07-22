# Silnik ofert hipotecznych V2 — model decyzyjny

Stan analizy: 21 lipca 2026 r.

## Cel

Oferta hipoteczna nie jest pojedynczym zestawem wartości `marża + prowizja`.
Jest wersjonowanym zbiorem reguł, który po wybraniu wariantu i podaniu scenariusza
klienta kompiluje się do deterministycznego planu oraz jednego ledgeru cash-flow.
Ten sam ledger zasila ratę, saldo, koszt pięciu lat, koszt całkowity, gotówkę
potrzebną na start, klasyfikację kosztów kwalifikowanych do przyszłego wyliczenia
RRSO oraz snapshot zapisywany w sprawie. V2 nie prezentuje tej klasyfikacji jako
ustawowego RRSO bez pełnego kalendarza przepływów i obsługi day-count.

## Rozdzielenie kwot

Kalkulator musi utrzymywać osobno:

- kwotę netto potrzebną klientowi;
- kredytowane koszty;
- początkowe saldo brutto;
- koszty kredytu uwzględniane w całkowitym koszcie i RRSO;
- koszty transakcyjne poza ustawowym kosztem kredytu, np. sąd i notariusz;
- czasowe obciążenia podlegające zwrotowi;
- dobrowolne nadpłaty i koszty zdarzeń wykonywanych na żądanie klienta.

Ustawa wyłącza kredytowane koszty z „całkowitej kwoty kredytu”, ale wymagane
usługi dodatkowe, w tym ubezpieczenia potrzebne do uzyskania kredytu albo danych
warunków, zalicza do całkowitego kosztu. Koszty notarialne i sądowe trzeba nadal
pokazać jako gotówkę potrzebną do transakcji, mimo że nie należą do tej ustawowej
sumy. Źródło: [obowiązujący tekst jednolity ustawy o kredycie hipotecznym z 2025 r.](https://eli.gov.pl/eli/DU/2025/720).

## Reguły oferty

Opublikowana wersja oferty zawiera:

1. obowiązywanie, źródła i profil zaokrągleń;
2. kryteria kwoty, okresu, LTV i rodzaju rat;
3. kolejne fazy stopy: stała albo indeks + marża wraz z floor/cap;
4. warianty i cechy cross-sell;
5. jawne modyfikatory stopy i marży oraz warunkowe reguły kosztów, w tym prowizji;
6. generyczne koszty z podstawą, terminem i sposobem rozliczenia;
7. regułę ubezpieczenia pomostowego i zwrotu;
8. zasady transz, karencji i ponownego wyliczenia rat;
9. checklistę dokumentów oraz źródła dowodowe.

Zmiana `0,10` marży oznacza zawsze `-0,10 punktu procentowego`, a nie obniżkę
o 10%. Reguła ma okres aktywności. Opcja może przechowywać częstotliwość kontroli
i opcję po naruszeniu, ale zmiana jest stosowana dopiero przez jawne zdarzenie
scenariusza — silnik nie zgaduje sam, czy klient przestał spełniać warunek. Jedna
cecha może jednocześnie zmienić marżę, przełączyć między dwiema warunkowymi
regułami prowizji i włączyć koszt ubezpieczenia.

To nie jest wyłącznie model teoretyczny. ING wskazuje, że wybór ubezpieczenia
może wpływać na preferencję cenową kredytu, a BNP Paribas publikuje warianty,
w których ubezpieczenie bankowe wiąże się z prowizją 0%, oraz przykłady obejmujące
rachunek, kartę, ubezpieczenie życia i nieruchomości, wycenę i PCC. Dlatego
cross-sell jest zbiorem powiązanych efektów cenowych i kosztowych, a nie jednym
polem `discount=true`. Źródła: [ING — informacje ogólne o kredycie hipotecznym](https://www.ing.pl/indywidualni/kredyty-i-pozyczki/kredyt-hipoteczny/informacje-ogolne-o-kredycie-hipotecznym)
i [BNP Paribas — kredyt hipoteczny z niską marżą](https://www.bnpparibas.pl/klienci-indywidualni/kredyty/kredyt-hipoteczny-z-niska-marza).
Aktualne przykłady reprezentatywne ING z 20 lipca 2026 r. rozdzielają kwotę
udzieloną bez kredytowanych kosztów, prowizję, odsetki, PCC, wycenę,
ubezpieczenie nieruchomości i czasowe ubezpieczenie spłaty, co potwierdza, że
te przepływy nie mogą być spłaszczone do jednego pola „koszty dodatkowe”.

## Koszty

Każdy koszt deklaruje:

- status: znany, nie dotyczy albo nieznany;
- kategorię i klasyfikację;
- formułę: kwota stała, procent albo suma;
- podstawę: netto, brutto, wartość nieruchomości, bieżące saldo, transza itd.;
- moment: raz, cyklicznie albo na każdą transzę;
- rozliczenie: gotówka, kapitalizacja lub potrącenie z wypłaty;
- klasyfikację do RRSO/całkowitego kosztu;
- warunek, okres i źródło.

Zwrot generycznego kosztu i jego odbiorca nie są polami V2. Zwrot jest obecnie
modelowany wyłącznie dla ustawowego kosztu pomostowego; pozostałe zwroty wymagają
osobnej reguły w kolejnej wersji schematu.

Nieznany koszt nigdy nie jest zamieniany na zero. Szkic i kalkulacja robocza
mogą pokazać go jako jawny brak ze statusem `partial`, ale publikacja do katalogu
jest blokowana do czasu potwierdzenia wartości albo oznaczenia „nie dotyczy”.

Przy kredytowanej prowizji liczonej od kwoty netto saldo wynosi
`netto + prowizja(netto)`. Dla prowizji od salda brutto silnik rozwiązuje równanie
`brutto = netto + prowizja(brutto)` i odrzuca konfigurację bez jednoznacznego
rozwiązania.

## Ubezpieczenie pomostowe

Podwyższenie ceny do wpisu hipoteki jest osobnym, oznaczonym komponentem
odsetek. Zdarzenie `mortgage_registered` zamyka okres podwyższenia, a reguła
umowy określa termin oraz sposób zwrotu: przelew albo zaliczenie na kapitał.
Wynik pokazuje kwotę pobraną, refund, koszt netto i przejściowy wpływ na ratę.
Publikowana definicja nie może wyłączyć zwrotu ani zwrócić tylko części oznaczonej
kwoty. Silnik sprawdza też chronologię: zwrot musi przypadać po zamknięciu okresu
podwyższenia i w granicach harmonogramu. Niewykonany albo niepełny zwrot zmienia
wynik na `unsupported`, zamiast pozostawić pozornie kompletną kalkulację.

Art. 29 ust. 5a–5b wymaga zwrotu dodatkowego kosztu oczekiwania na wpis albo
zaliczenia go na kapitał. Termin nie jest globalną stałą — pozostaje parametrem
wersji umowy. Źródła: [obowiązujący tekst jednolity z 2025 r.](https://eli.gov.pl/eli/DU/2025/720)
i [nowelizacja wprowadzająca mechanizm w 2022 r.](https://eli.gov.pl/api/acts/DU/2022/1719/text.html).

## Publikacja i audyt

- Produkt jest trwałą tożsamością oferty przypisaną do instytucji.
- Draft może być niepełny i jest zapisywany z optimistic locking.
- Serwer przed publikacją waliduje schemat, dokumentację i wyczerpującą macierz
  obsługiwanych kombinacji (warianty, sposoby rozliczenia, granice, oba rodzaje rat,
  kwota netto/brutto, transze, karencję i zdarzenia). Następnie jedna transakcja
  tworzy niezmienną wersję i wariant, aktualizuje wskaźnik wersji bieżącej oraz
  dopisuje zdarzenie audytowe.
- Porównywarka czyta wyłącznie opublikowaną wersję.
- Snapshot sprawy zawiera wersję kalkulatora, pełny resolved plan i wynik;
  snapshotu V1 nie przelicza się automatycznie silnikiem V2.
- Wariant wybrany dla konkretnej nieruchomości utrwala osobno cenę, wycenę,
  kwotę netto, kredytowane koszty i saldo brutto. Wniosek oraz formularz bankowy
  czytają ten niezmienny wynik, a nie pierwotny scenariusz shortlisty.
- Zapis scenariusza w sprawie jest operacją serwerową. Snapshot wskazuje dokładną
  niemodyfikowalną wersję produktu, a baza porównuje jej identyfikator, bank,
  `version_key`, `content_sha256` i kanoniczny payload zarówno przy zapisie, jak
  i ponownie przy tworzeniu wniosku. Bezpośredni zapis przez Data API jest
  zabroniony.
- Kompletny snapshot wniosku może utworzyć tylko zaufany RPC po ponownym
  przeliczeniu nieruchomość × zamrożona oferta. Po wyjściu ze szkicu historia
  wniosku nie jest usuwalna; usunięcie roboczego szkicu przechodzi przez
  kontrolowaną ścieżkę serwerową.

Globalne mutacje katalogu są dostępne wyłącznie po weryfikacji roli SuperAdmin
i wykonywane klientem service-role po stronie serwera. Tabele mają RLS, jawne
`REVOKE`/`GRANT`, indeksy kluczy obcych oraz append-only audit.

## Walidacje blokujące publikację

Publikacja jest blokowana m.in. przez brak:

- ciągłej osi faz stopy i zasady po okresie stałym;
- benchmarku, marży, daty obserwacji albo zasad resetu;
- podstawy prowizji i dozwolonego sposobu finansowania;
- formuły wymaganego ubezpieczenia;
- poprawnych odwołań warunku cross-sell do cechy i opcji;
- sposobu zakończenia i refundu pomostowego;
- klasyfikacji kosztu oraz dokumentu źródłowego;
- jednoznacznego wariantu domyślnego.

KNF nadal wskazuje okres co najmniej pięciu lat dla okresowo stałej stopy i
oczekuje wydłużania tego minimum. Źródła: [Rekomendacja S](https://www.knf.gov.pl/knf/pl/komponenty/img/Rekomendacja_S_nowelizacja_czerwiec_2023_82872.pdf)
oraz [stanowisko KNF opublikowane w 2026 r.](https://www.knf.gov.pl/?articleId=98652&p_id=18).

## Jawne ograniczenia V2

- działający profil naliczania to `nominal_monthly_12` z miesięcznym zaokrągleniem
  half-up; `actual_365_fixed` i saldo wysokiej precyzji są blokowane przy publikacji;
- zdarzenie wpisu hipoteki jest w V2 zdarzeniem początku wskazanego miesiąca;
  dzienna data wpisu wymaga przyszłego profilu kalendarzowego zamiast pozornie
  precyzyjnego ustawienia „koniec miesiąca”;
- indeks referencyjny jest snapshotem z datą i opcjonalnym szokiem scenariusza,
  a nie prognozowaną krzywą przyszłych fixingów;
- schema nie definiuje jeszcze generycznego odbiorcy ani refundu każdego kosztu;
- niezależne cechy można łączyć dowolnie. Jeżeli bank dopuszcza tylko zamknięty
  zestaw kombinacji, należy rozdzielić je na osobne oferty; presety są skrótami,
  nie listą wyłączającą inne kombinacje;
- silnik klasyfikuje przepływy kwalifikowane do przyszłego RRSO, ale nie nazywa
  ich ustawowym RRSO bez kalendarza dat i właściwej konwencji day-count.

## Minimalne przypadki testowe

- prowizja 2% od 400 000 zł netto: brutto 408 000 zł;
- prowizja 2% od brutto: brutto 408 163,27 zł;
- prowizja gotówkowa kontra kapitalizowana;
- ubezpieczenie z kosztem miesięcznym i obniżką marży o 0,10 pp;
- utrata warunku i ponowne wyliczenie raty;
- pomostowe do wpisu, zwrot gotówkowy i zaliczenie na kapitał;
- miesięczny, roczny, jednorazowy i naliczany na transzę koszt;
- faza stała, potem indeks + marża, floor i cap;
- jedna oraz wiele transz z karencją;
- raty równe i malejące, nadpłata i wcześniejsza spłata;
- zgodność równania salda oraz sum ledgeru do jednego grosza.
