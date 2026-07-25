# OpenExpert Meet

Osobna aplikacja Nuxt 4 do testowania spotkań LiveKit. Interfejs jest napisany
bezpośrednio w Vue i korzysta z `livekit-client`, dlatego LiveKit nie narzuca
wyglądu poczekalni, siatki uczestników ani paska sterowania.

## Uruchomienie lokalne

1. Utwórz projekt w [LiveKit Cloud](https://cloud.livekit.io/).
2. Skopiuj konfigurację:

   ```bash
   cp apps/meetings/.env.example apps/meetings/.env
   ```

3. Uzupełnij w `apps/meetings/.env`:

   ```dotenv
   NUXT_PUBLIC_LIVEKIT_URL=wss://your-project.livekit.cloud
   NUXT_LIVEKIT_API_KEY=...
   NUXT_LIVEKIT_API_SECRET=...
   NUXT_MEETINGS_ROOM_NAME=demo-room
   NUXT_MEETINGS_ACCESS_CODE=very-long-random-demo-passphrase
   NUXT_MEETINGS_EMBED_ORIGIN=https://crm.example.com
   ```

4. Uruchom aplikację:

   ```bash
   pnpm --filter @openexpert/meetings dev
   ```

5. Otwórz `http://127.0.0.1:3005/room/demo-room` w dwóch różnych
   przeglądarkach lub w zwykłym i prywatnym oknie.

Kod dostępu jest wymagany także lokalnie i musi mieć co najmniej 20 znaków.
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
