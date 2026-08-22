# Klient pocztowy — bezpieczeństwo i eksploatacja

## Zakres wersji

Klient obsługuje wiele prywatnych kont jednego użytkownika:

- Gmail przez Google OAuth i Gmail API,
- Outlook.com, Hotmail, Live oraz Microsoft 365 przez Microsoft OAuth i Graph,
- pozostałych dostawców przez szyfrowane IMAP + SMTP.

Nie ma wspólnej skrzynki wszystkich ekspertów, IMAP IDLE ani watcherów. Lista
jest pobierana na żądanie oraz odświeżana wyłącznie w widocznej karcie. Główny
agent EVE może na wyraźne polecenie eksperta przeszukiwać zwykłą korespondencję,
wiadomości klienta lub sprawy, odczytywać ograniczone fragmenty wątków oraz
tekst ze wskazanych załączników.

## Granice dostępu i prywatność

- Każde połączenie należy do konkretnego użytkownika i organizacji. Rola
  administratora nie daje dostępu do skrzynek innych ekspertów.
- Każde API skrzynki wymaga należącego do bieżącego użytkownika `connectionId`.
  Przełączenie konta czyści wątek, wyszukiwanie i stronicowanie.
- Treść wiadomości, odebrane załączniki, odbiorcy, tematy i wyszukiwane frazy nie
  są zapisywane w tabelach ani storage CRM. Odpowiedzi API mają `private,
  no-store`. Gdy ekspert użyje integracji EVE, metadane wyszukiwania, ograniczone
  fragmenty treści wiadomości oraz wybrane fragmenty dokumentu stają się częścią
  trwałej historii tej sesji EVE; nie należy więc używać narzędzia do
  korespondencji ani plików, których treść nie powinna trafić do rozmowy z
  Agentem AI.
- Wyszukiwanie EVE może użyć dokładnego adresu uczestnika albo zakresu klienta
  lub sprawy. Zakres sprawy łączy adresy jej klientów z wątkami przypiętymi
  ręcznie, wysłanymi z kontekstu CRM lub powiązanymi przez agenta bankowego.
  Skrzynka nadal zawsze należy do aktualnego użytkownika. Dla wątku znalezionego
  wyłącznie po uczestniku do modelu trafiają tylko wiadomości odebrane od albo
  wysłane do tego dokładnego adresu; pełny mieszany wątek jest dostępny przy
  trwałym powiązaniu lub zwykłym wyszukiwaniu własnej skrzynki.
- Wyszukiwanie i odczyt są stronicowane i ograniczone. Tryb `all` używa
  provider-wide Gmail/Graph, dlatego obejmuje także pocztę zarchiwizowaną lub
  przeniesioną poza Odebrane/Wysłane. Ogólny IMAP nie gwarantuje folderu All
  Mail: wtedy zakres obejmuje INBOX+SENT i odpowiedź jawnie zwraca ograniczenie;
  wyszukiwanie IMAP sygnalizuje również obcięcie bezpiecznego okna UID.
- Microsoft Graph zwraca najwyżej 1000 wiadomości dla jednego `$search`. EVE
  przenosi licznik przez zaszyfrowany kursor i po dojściu do tej granicy ustawia
  `microsoft_search_result_limit`, zamiast błędnie oznaczyć wynik jako pełny.
- EVE wyklucza szkice już w wyszukiwaniu providerowym i ponownie przy odczycie,
  więc draft nie może zostać opisany jako wysłana korespondencja. BCC uczestniczy
  w dokładnym dopasowaniu klienta, ale lista ukrytych odbiorców nie jest
  serializowana do podsumowań ani historii Agenta.
- EVE otrzymuje informację o dalszej stronie, częściowych awariach, trwałych
  ograniczeniach providera oraz liczbie pominiętych wyników. Odczyt wątku działa
  w stałych oknach do 12 wiadomości i zwraca zaszyfrowaną `nextReference` do
  starszego okna, zachowując pierwotny zakres uczestników i czas wygaśnięcia.
  Agent nie powinien przedstawiać ograniczonego okna jako kompletnej historii.
- Rekord wysyłki zawiera jedynie hash żądania, stabilny `Message-ID`, status oraz
  identyfikatory techniczne dostawcy.
- Odebrane załączniki są standardowo pokazywane jako metadane. Dopiero jawny
  odczyt przez EVE pobiera pojedynczy plik przez serwer CRM do pamięci, z limitem
  8 MiB. Surowe bajty nie są zapisywane; do modelu i historii EVE trafiają tylko
  ograniczone fragmenty wyodrębnionego tekstu. Odczyt obsługuje PDF, DOCX, XLSX
  i bezpieczne formaty tekstowe; skany, obrazy, archiwa, zaszyfrowane dokumenty i
  stare formaty Office są odrzucane bez OCR ani rozpakowywania.

## OAuth i poświadczenia

- Gmail używa `gmail.readonly` i `gmail.send`.
- Microsoft używa delegowanych `offline_access`, `User.Read`, `Mail.ReadWrite`
  i `Mail.Send`. `Mail.ReadWrite` nie obejmuje wysyłki.
- Oba przepływy używają losowego `state`, PKCE S256, szyfrowanego ciasteczka
  `HttpOnly`, krótkiej ważności oraz ścisłego powiązania z użytkownikiem,
  organizacją i — przy reconnect — konkretnym kontem. Osobne ciasteczko związane
  AAD ze `state` pozwala bezpiecznie prowadzić do czterech równoległych flow
  Google/Microsoft bez nadpisywania innej karty.
- Tokeny i hasła aplikacji są szyfrowane AES-256-GCM z AAD zawierającym
  organizację, właściciela, połączenie i przeznaczenie sekretu. Nie są zwracane
  do przeglądarki ani logowane.
- Rotowany refresh token Microsoft zastępuje poprzedni. `invalid_grant`, 401 i
  403 oznaczają konieczność ponownego połączenia.
- Odłączenie Gmaila próbuje unieważnić token w Google. Microsoft i IMAP/SMTP są
  odłączane przez bezpieczne usunięcie lokalnych sekretów; nie używamy szerokiego
  Microsoft `revokeSignInSessions`.

## IMAP i SMTP

- Serwer wykonuje krótkie operacje connect → read/send → logout. Nie utrzymuje
  połączeń ani IMAP IDLE w pamięci funkcji serverless.
- Dozwolone są wyłącznie IMAP 993/TLS lub 143/wymagany STARTTLS oraz SMTP
  465/TLS lub 587/wymagany STARTTLS. Port 25, plaintext, self-signed certyfikaty
  i własne CA są odrzucane; minimalna wersja to TLS 1.2.
- Host musi być publiczną nazwą DNS. Wszystkie odpowiedzi A/AAAA są sprawdzane;
  jeśli którakolwiek wskazuje adres lokalny, prywatny, dokumentacyjny lub
  specjalnego przeznaczenia, całe połączenie jest odrzucane. Transport łączy się
  z zatwierdzonym adresem IP, zachowując oryginalną nazwę do SNI i weryfikacji
  certyfikatu, co ogranicza SSRF i DNS rebinding.
- Logowanie protokołu i surowych wiadomości jest wyłączone. Połączenia mają
  ograniczone timeouty, rozmiary źródeł MIME i okna wyszukiwania.
- Gmail i prywatne domeny Microsoft są kierowane do OAuth. Dla innych dostawców
  należy używać osobnego hasła aplikacji, jeśli jest dostępne.

## Bezpieczny podgląd

- Wiadomości HTML są czyszczone po stronie serwera ścisłą allowlistą elementów,
  atrybutów i deklaracji CSS. Zachowywane są typowe tabele, formatowanie i
  bezpieczne style inline; usuwane są skrypty, handlery zdarzeń, formularze,
  iframe, obiekty, SVG, aktywne linki oraz style mogące wykonać żądanie sieciowe.
- Oczyszczony fragment jest renderowany w osobnym `srcdoc` iframe z sandboxem
  bez skryptów, formularzy, popupów, pobierania i nawigacji. CSP zaczyna od
  `default-src 'none'`; dokument ma również `no-referrer`. Gdy dostawca zwraca
  HTML, aplikacja renderuje go bez dodatkowego przełącznika. Wersja tekstowa
  pozostaje fallbackiem wyłącznie dla wiadomości bez bezpiecznego HTML.
- Adresy zdalnych obrazów są na serwerze przenoszone do inertnego atrybutu.
  Podczas wyświetlania HTML aplikacja automatycznie zamienia je na adresy
  stałego proxy OpenExpert: proxy rozwiązuje DNS, przypina publiczny
  adres IP, sprawdza każde przekierowanie, nie przekazuje cookies ani referera,
  ogranicza rozmiar i dopuszcza tylko obrazy rastrowe rozpoznane po sygnaturze
  pliku. Samo pobranie nadal może ujawnić nadawcy otwarcie wiadomości, mimo że
  proxy ukrywa adres IP użytkownika, cookies i referer. Linki w treści pozostają
  nieaktywne; do pełnej interakcji służy „Otwórz u dostawcy”.
- Rozmiar wejściowego i zwracanego HTML oraz łączny budżet HTML wątku są
  ograniczone, podobnie jak liczba elementów i zdalnych obrazów pojedynczej
  wiadomości. Po przekroczeniu budżetu starsza wiadomość wraca do bezpiecznej
  wersji tekstowej zamiast zwracać częściowo ucięty znacznik.
- Znaki sterujące i znaczniki zmiany kierunku tekstu są usuwane z nagłówków oraz
  nazw plików.
- Klient pokazuje wynik SPF/DKIM/DMARC tylko, gdy pochodzi z zaufanego źródła
  dostawcy, i ostrzega przy różnej domenie `Reply-To`. Gmail akceptuje wyłącznie
  `Authentication-Results` z dokładnym `authserv-id` `mx.google.com`; obcy lub
  podobny identyfikator jest ignorowany. Graph udostępnia nagłówki RFC 5322 bez
  wiarygodnej informacji, który egzemplarz został dodany na zaufanej granicy
  Microsoft, dlatego dla Outlooka wynik pozostaje `unknown` zamiast ufać
  potencjalnie wstrzykniętemu `pass`. Pozytywny wynik nie jest gwarancją
  uczciwości treści.
- Identyfikatory wątków IMAP i Microsoft oraz kursory stron są nieprzezroczyste,
  uwierzytelnione i związane z konkretnym połączeniem. Referencje EVE są ponadto
  szyfrowane, godzinne i związane z użytkownikiem, organizacją, trybem dostępu
  oraz dokładnym zakresem uczestników. Model nie może podsunąć serwerowi
  dowolnego Graph `nextLink` ani surowej nazwy folderu.
- Detail wątku Microsoft wykonuje jedno zapytanie Graph newest-first z
  `$top=20`, ograniczonym `$select` i dokładnym `$count`, a następnie zwraca
  wybrane wiadomości chronologicznie. Nie pobiera najpierw setek pełnych body i
  nagłówków. Lista grupuje `conversationId` w obrębie bieżącej strony Graph;
  bardzo długi wątek przecinający granicę stron może więc pojawić się ponownie
  na kolejnej stronie. Detail wątku jest źródłem autorytatywnym.
- Odczyt EVE używa mniejszego `$top=12` i podpisanej kontynuacji Graph, aby
  cztery wątki mieściły się w jednym limicie 48 wiadomości bez lokalnego
  pomijania. Referencja załącznika wskazuje konkretną wiadomość; jej odczyt nie
  wraca do najnowszego okna wątku, więc plik ze starszej strony pozostaje
  dostępny po przejściu kontynuacji.

## Wysyłka i niezawodność

- Odbiorcy, temat, identyfikatory odpowiedzi, nagłówki, MIME i nazwy plików są
  walidowane po stronie serwera. CR/LF/NUL w nagłówkach są odrzucane, a Bcc dla
  SMTP istnieje tylko w envelope i nie trafia do kopii MIME w Wysłanych.
- Każda wysyłka ma idempotency key i deterministyczny `Message-ID` związany z
  konkretnym połączeniem. Zapisane wcześniej wartości pozostają źródłem prawdy. Po
  niejednoznacznym błędzie nie wolno automatycznie wysłać wiadomości ponownie;
  najpierw sprawdzany jest folder Wysłane.
- Microsoft wysyła przez create draft → utrwalenie immutable ID → załączniki →
  send. Załączniki od 3 MiB używają upload session. `Prefer: IdType="ImmutableId"`
  jest stosowane do identyfikatorów Graph.
- SMTP zapisuje tę samą wiadomość MIME w folderze Wysłane przez IMAP, jeśli
  serwer go udostępnia. Brak kopii nie zmienia zaakceptowanej dostawy w błąd i
  nie powoduje duplikatu.
- Bezpieczne odczyty Microsoft mogą być ponowione po 429/5xx z ograniczonym
  backoff i `Retry-After`. Operacje wysyłki nie są automatycznie powtarzane.
- Limit CRM to 10 prób na minutę i 100 na godzinę na użytkownika. Atomowe buckety
  PostgreSQL są rezerwowane przed utworzeniem rekordu wysyłki; replay istniejącego
  klucza nadal może odzyskać wynik bez zużywania nowej próby. Formularz wysyłki
  ma limit 4 MiB całego requestu, aby pozostać poniżej limitu Vercel Functions.
  Można dodać maks. 10 załączników; pojedynczy plik i wszystkie pliki łącznie
  mogą mieć najwyżej 3 MiB. Zostawia to zapas na treść do 200 000 znaków UTF-8,
  odbiorców, nazwy plików i narzut multipart. Dostawca może zastosować niższy
  limit.
- Załączniki, UDW lub wielu odbiorców wymagają dodatkowego potwierdzenia. Edytor
  chroni niezapisaną wiadomość przed przypadkowym zamknięciem.

## Konfiguracja środowiska

Wymagane dla wszystkich sekretów:

```text
NUXT_MAIL_OAUTH_ENCRYPTION_KEY=<losowy sekret o wysokiej entropii, min. 32 bajty UTF-8>
NUXT_MAIL_OAUTH_LEGACY_ENCRYPTION_KEY=<opcjonalny poprzedni klucz tylko do odszyfrowania podczas rotacji>
```

Nowe sekrety i identyfikatory referencyjne zawsze używają wyłącznie bieżącego
klucza. `LEGACY_ENCRYPTION_KEY` może być historycznie krótszy, ale służy tylko
do odczytu istniejących kopert v1/v2. Po odświeżeniu lub ponownym połączeniu
wszystkich skrzynek należy go usunąć.

Google:

```text
NUXT_MAIL_OAUTH_GOOGLE_CLIENT_ID=
NUXT_MAIL_OAUTH_GOOGLE_CLIENT_SECRET=
NUXT_MAIL_OAUTH_GOOGLE_REDIRECT_URI=https://openexpert-crm.vercel.app/api/mail/oauth/google/callback
```

Microsoft (rejestracja wspierająca konta w dowolnym katalogu i konta osobiste):

```text
NUXT_MAIL_OAUTH_MICROSOFT_CLIENT_ID=
NUXT_MAIL_OAUTH_MICROSOFT_CLIENT_SECRET=
NUXT_MAIL_OAUTH_MICROSOFT_REDIRECT_URI=https://openexpert-crm.vercel.app/api/mail/oauth/microsoft/callback
NUXT_MAIL_OAUTH_MICROSOFT_TENANT=common
```

Po zmianie sekretów trzeba wykonać nowy deployment. Klucza szyfrowania nie wolno
rotować przez proste nadpisanie, bo istniejące tokeny i poświadczenia przestaną
być odszyfrowywalne. Podczas rotacji poprzedni klucz należy zachować w
`NUXT_MAIL_OAUTH_LEGACY_ENCRYPTION_KEY`, dopóki wszystkie stare rekordy nie zostaną
ponownie zaszyfrowane przy odświeżeniu lub ponownym połączeniu konta. Dopiero po
zweryfikowaniu braku starych szyfrogramów można usunąć klucz legacy.

## Kontrola przed wdrożeniem

1. Uruchomić migrację `0052_multi_provider_mail_connections.sql` przed kodem.
2. Uruchomić `pnpm --filter @openexpert/crm test:mail` i produkcyjny build Nuxt.
3. Sprawdzić osobno OAuth Google, osobiste konto Microsoft, konto Microsoft 365
   oraz IMAP/SMTP z hasłem aplikacji.
4. Zweryfikować dwa konta tego samego dostawcy, reconnect dokładnego konta,
   odłączenie, zmianę konta przy szkicu i odrzucenie obcego `connectionId`.
5. Sprawdzić listę, wyszukiwanie, paging, detail, reply, nową wiadomość,
   załączniki, Bcc, 429 oraz recovery niejednoznacznej wysyłki.

## Świadomie odłożone

Watchery Gmail/Graph, webhooki, Microsoft subscriptions, IMAP IDLE oraz ciągła
automatyczna analiza całej skrzynki nie należą do tej wersji. Odczyt przez
głównego agenta odbywa się na żądanie eksperta. Przyszłe automatyzacje mają
jedynie tworzyć propozycje z jawnym zatwierdzeniem; treść e-maila pozostaje
danymi niezaufanymi i nie może wydawać agentowi poleceń ani samodzielnie
zapisywać czegokolwiek do sprawy.
