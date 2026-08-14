# Klient Gmail — bezpieczeństwo i eksploatacja

## Granice dostępu

- Każde połączenie Gmail należy do konkretnego użytkownika i organizacji. Rola administratora nie daje dostępu do skrzynek innych ekspertów.
- Aplikacja używa wyłącznie `gmail.readonly` i `gmail.send`. Nie może usuwać wiadomości, zmieniać etykiet ani zarządzać ustawieniami Gmaila.
- Treść wiadomości i odebrane załączniki nie są utrwalane w bazie CRM. Lista i podgląd są pobierane na żądanie z Gmaila, a odpowiedzi API mają `private, no-store`.
- Wysłane treści, adresaci i nazwy załączników nie trafiają do tabeli idempotencji. Przechowywany jest wyłącznie jednokierunkowy hash żądania i identyfikatory techniczne Gmaila.

## OAuth i tokeny

- Logowanie Google i zgoda Gmail są oddzielnymi przepływami OAuth.
- Przepływ Gmail używa losowego `state`, PKCE S256, szyfrowanego ciasteczka `HttpOnly`, krótkiego terminu ważności i ścisłego powiązania z użytkownikiem.
- Tokeny są szyfrowane AES-256-GCM przed zapisem i nigdy nie są zwracane do przeglądarki.
- Odłączenie usuwa token lokalnie i próbuje unieważnić zgodę w Google. Token pozyskany dla odrzuconego konta lub niepełnego zakresu jest również unieważniany.
- Błędy `invalid_grant`, 401 i 403 oznaczają połączenie jako wymagające ponownej zgody.

## Odczyt i prezentacja

- HTML jest zamieniany na zwykły tekst. Skrypty, style, aktywne linki, iframe i zdalne obrazy nie są wykonywane, co ogranicza XSS i piksele śledzące.
- Niebezpieczne znaki sterujące i znaczniki zmiany kierunku tekstu są usuwane z nagłówków oraz nazw plików.
- Klient pokazuje wynik SPF/DKIM/DMARC przekazany przez Gmaila i ostrzega, gdy domena `Reply-To` różni się od domeny nadawcy. Pozytywny wynik uwierzytelnienia domeny nie jest gwarancją uczciwości treści.
- Odebrane załączniki są prezentowane wyłącznie jako metadane. Pobranie pozostaje w Gmailu, aby pliki nie przechodziły przez serwery CRM.
- Zapytania wyszukiwania pozostają w pamięci karty i nie są zapisywane w adresie URL ani historii przeglądarki.

## Wysyłka

- Adresaci, temat, identyfikatory wątku, nagłówki odpowiedzi, typy MIME i nazwy plików są walidowane po stronie serwera. Znaki CR/LF/NUL w nagłówkach są odrzucane.
- Wysyłka ma idempotency key, deterministyczny `Message-ID`, wykrywanie wcześniejszej wiadomości w folderze Wysłane i osobny stan „wynik nieznany”. Nie wolno automatycznie ponawiać niejednoznacznej wysyłki.
- Własne limity CRM ograniczają wysyłkę do 10 prób na minutę i 100 prób na godzinę dla użytkownika; obowiązują również limity Gmaila.
- Maksymalnie 10 załączników, 10 MB na plik, 16 MB łącznie i 24 MB całego żądania. Rozszerzenia blokowane przez Gmail są odrzucane przed wysłaniem; Gmail pozostaje końcowym skanerem antywirusowym.
- Wiadomości z załącznikami, UDW lub wieloma odbiorcami wymagają dodatkowego potwierdzenia. Niezapisana treść chroni się przed przypadkowym zamknięciem karty.
- Wiadomości są tekstowe, dzięki czemu pozostają czytelne dla technologii asystujących i odporniejsze na różnice między klientami pocztowymi.

## Niezawodność

- Bezpieczne operacje odczytu są ponawiane maksymalnie dwa razy z ograniczonym exponential backoff i obsługą `Retry-After`. Wysyłka nie jest automatycznie ponawiana, ponieważ wynik żądania może być niejednoznaczny.
- Lista wątków ma ograniczoną współbieżność i może zwrócić częściowy wynik z czytelnym ostrzeżeniem. Jeśli nie uda się pobrać żadnego wątku, całe żądanie kończy się błędem.
- Aktywna karta odświeża się co pięć minut i po odzyskaniu fokusu, jeśli dane są starsze niż minutę. Ręczne odświeżenie jest zawsze dostępne.

## Wymagania przed publicznym uruchomieniem

- Przejść weryfikację aplikacji OAuth Google dla `gmail.readonly` (zakres restricted) i `gmail.send` (zakres sensitive), opublikować politykę prywatności i spełnić Google API Services User Data Policy.
- Jeżeli dane z zakresu restricted będą przechowywane lub przekazywane poza chwilowy podgląd użytkownika, przeprowadzić wymaganą przez Google ocenę bezpieczeństwa przed uruchomieniem dla klientów.
- Włączyć alertowanie błędów OAuth/Gmail bez logowania tokenów, treści, adresatów i zapytań wyszukiwania.
- Ustalić i udokumentować okres retencji technicznych rekordów idempotencji.
- Dla zdarzeń w czasie zbliżonym do rzeczywistego skonfigurować Gmail `watch` + Google Cloud Pub/Sub, odnawiać `watch` codziennie i okresowo uzgadniać `history.list`. Powiadomienie ma uruchamiać pobranie z Gmaila; nie powinno zawierać ani utrwalać treści wiadomości.

## AI i dynamiczne akcje

- Analiza AI powinna działać dopiero po zdarzeniu Gmail i na minimalnym fragmencie potrzebnym do klasyfikacji.
- Model może tworzyć wyłącznie propozycję akcji, np. „Dodaj decyzję kredytową do sprawy”. Zapis do sprawy, wysłanie odpowiedzi lub udostępnienie dokumentu wymaga jawnego zatwierdzenia eksperta.
- Dopasowanie sprawy musi pokazywać źródło, poziom pewności i alternatywy. Przy niskiej pewności system nie wykonuje automatycznego powiązania.
- Treść maila i załączniki są danymi niezaufanymi. Instrukcje zawarte w wiadomości nie mogą zmieniać zasad agenta ani wywoływać narzędzi bez autoryzacji użytkownika.
