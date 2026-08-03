# OpenExpert Meet

Osobna aplikacja Nuxt 4 do testowania spotkań LiveKit. Interfejs jest napisany
bezpośrednio w Vue i korzysta z `livekit-client`, dlatego LiveKit nie narzuca
wyglądu poczekalni, siatki uczestników ani paska sterowania.

## Uruchomienie lokalne

LiveKit można uruchomić razem z pozostałymi usługami OpenExpert:

```bash
pnpm db:setup -- --livekit
pnpm --filter @openexpert/meetings dev
```

Setup zapisuje lokalny URL i developerskie klucze LiveKit w zarządzanym bloku
`apps/meetings/.env`. Uzupełnij poza tym blokiem ustawienia pokoju:

```dotenv
NUXT_MEETINGS_ROOM_NAME=demo-room
NUXT_MEETINGS_ACCESS_CODE=very-long-random-demo-passphrase
NUXT_MEETINGS_EMBED_ORIGIN=http://127.0.0.1:3004
```

Następnie otwórz `http://127.0.0.1:3005/room/demo-room` w dwóch różnych
przeglądarkach albo w zwykłym i prywatnym oknie.

## Testowanie widoków eksperta i klienta

Na stronie startowej wybierz rolę przed przejściem do poczekalni. Wejście ze
strony startowej dodaje tryb testowy, dzięki któremu można przełączyć widok
**Ekspert / Klient** również w poczekalni. Wariant jest zapisany jawnie w
adresie:

```text
http://127.0.0.1:3005/room/demo-room?role=expert&test=1
http://127.0.0.1:3005/room/demo-room?role=client&test=1
```

Najwygodniejszy test rozmowy to otwarcie pierwszego adresu w zwykłym oknie,
a drugiego w oknie prywatnym. Aplikacja zapamiętuje osobną nazwę uczestnika dla
każdego wariantu. Link kopiowany z panelu eksperta zawsze prowadzi do widoku
klienta i nie zawiera parametrów testowych. W trakcie spotkania przełącznik roli
jest widoczny wyłącznie w trybie demo.

Widok eksperta ma dodatkowy przełącznik układu **50/50 / Mini podgląd**. Drugi
wariant powiększa obraz klienta i przenosi własny obraz eksperta do małego kafla.
Wybrany układ jest zapamiętywany lokalnie w przeglądarce.

Parametr `role` steruje obecnie wyłącznie układem interfejsu na potrzeby testów.
Nie jest mechanizmem autoryzacji i nie przyznaje uprawnień administracyjnych.
Docelowa rola eksperta powinna wynikać z uwierzytelnionej sesji CRM, a rola
klienta — z podpisanego zaproszenia.

Do samego testowania kompletnego UI, bez uruchamiania LiveKit i bez kodu
dostępu, służą przyciski **Demo eksperta** i **Demo klienta** na stronie
startowej. Odpowiadają im adresy:

```text
http://127.0.0.1:3005/room/demo-room?role=expert&preview=1
http://127.0.0.1:3005/room/demo-room?role=client&preview=1
```

Tryb demo nie przechwytuje kamery, mikrofonu ani ekranu i nie łączy się z
serwerem. Normalne spotkanie nadal zawsze przechodzi przez endpoint tokenu i
LiveKit.

Alternatywnie możesz od razu użyć LiveKit Cloud: skopiuj
`apps/meetings/.env.example`, wpisz URL i klucze projektu, a następnie uruchom
tę samą komendę aplikacji.

Kod dostępu jest wymagany również lokalnie i musi mieć co najmniej 20 znaków.
Możesz wygenerować go np. poleceniem `openssl rand -base64 24`.

## Najprostsza publikacja

Najmniej operacyjny wariant to:

- **LiveKit Cloud** dla WebRTC, SFU i TURN,
- **Vercel** dla aplikacji Nuxt i serwerowego endpointu tokenów.

W Vercel utwórz nowy Project z tego samego repozytorium i ustaw:

- Root Directory: `apps/meetings`,
- Framework Preset: Nuxt.js (wykrywany automatycznie),
- Node.js: 24,
- pięć wymaganych zmiennych z przykładu `.env`,
- dodatkowo `NUXT_MEETINGS_EMBED_ORIGIN`, jeżeli CRM ma inną domenę.

Nie trzeba dodawać `vercel.json`. Sekretne zmienne ustaw jako Sensitive i dodaj
rate limit Vercel Firewall dla `POST /api/livekit/token`, np. 10–20 żądań na
minutę na adres IP. Tę regułę należy włączyć przed udostępnieniem publicznego
linku — limit w pamięci pojedynczej funkcji serverless nie byłby wiarygodny.

Do demo warto utworzyć osobny projekt i osobne klucze LiveKit Cloud, a następnie
ustawić limity, alerty kosztowe i okresową rotację kluczy.

Samego serwera LiveKit nie należy uruchamiać na Vercel. Wariant self-hosted
wymaga maszyny z publicznym IP, otwartymi portami UDP/TCP, TLS i konfiguracją
TURN, więc nie jest najłatwiejszy do pierwszego testu.

## Osadzenie w CRM

Najprostszy test iframe:

```html
<iframe
  src="https://meet.example.com/room/demo-room?embed=1"
  allow="camera; microphone; display-capture; fullscreen"
  allowfullscreen
  style="width: 100%; min-height: 720px; border: 0"
></iframe>
```

Jeżeli CRM działa na innej domenie niż aplikacja Meet, ustaw dokładnie jej origin
w `NUXT_MEETINGS_EMBED_ORIGIN`, np. `https://crm.example.com`. Bez tej zmiennej
nagłówek CSP pozwala osadzić aplikację wyłącznie na jej własnej domenie.

Kod dostępu nie może znaleźć się w adresie. Użytkownik wpisuje go w poczekalni,
a aplikacja używa `sessionStorage` tylko do przejścia między stroną startową
i poczekalnią. Po udanym dołączeniu kod jest usuwany.

Docelowo w CRM wspólny kod należy zastąpić:

- sesją zalogowanego doradcy,
- rekordem zaproszenia klienta z datą wygaśnięcia i limitem użyć,
- pokojem wyliczanym po stronie serwera z identyfikatora spotkania.

Można też przenieść komponenty `MeetingRoom` i `ParticipantTile` bezpośrednio do
CRM. Iframe jest szybszy i lepiej izoluje media, natomiast integracja natywna
daje wspólny routing i stan aplikacji.

## Kontrola jakości

```bash
pnpm --filter @openexpert/meetings test
pnpm --filter @openexpert/meetings typecheck
pnpm --filter @openexpert/meetings build
```

Token ma 10-minutowy TTL i pozwala wyłącznie na wejście do jednego
skonfigurowanego pokoju, publikowanie kamery/mikrofonu/ekranu oraz subskrypcję.
API secret nigdy nie trafia do przeglądarki.
