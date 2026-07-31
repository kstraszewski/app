# OpenExpert

Modułowa platforma open source dla ekspertów, projektowana pod agentic economy.
Każdy moduł eksponuje UI dla ludzi, REST API dla integracji i narzędzia dla
agentów AI.

## Architektura

- Nuxt 4 + TypeScript
- Turborepo + pnpm workspaces
- PostgreSQL 17, RLS i pgvector
- Better Auth
- PostgREST-compatible Data API
- Vercel Blob / lokalne MinIO
- Resend / lokalny Mailpit
- Trigger.dev dla trwałych zadań w tle
- Vercel
- opcjonalnie LiveKit

Środowisko produkcyjne jest Vercel-first, ale nie Vercel-only:

- aplikacje Nuxt działają na Vercelu;
- PostgreSQL zapewnia Neon podłączony przez Vercel Marketplace;
- Neon Data API zachowuje dotychczasowy model zapytań, RPC i RLS;
- pliki trafiają do osobnych publicznych i prywatnych magazynów Vercel Blob;
- Better Auth działa wewnątrz serwera Nuxt i zapisuje sesje w PostgreSQL;
- Resend wysyła wiadomości transakcyjne;
- integracja Trigger.dev z Vercel i GitHub wdraża taski razem z aplikacją;
- LiveKit Cloud obsługuje spotkania WebRTC.

Lokalnie te granice mają zamienniki: PostgreSQL + PostgREST, Better Auth,
MinIO, Mailpit, proces `trigger dev` oraz opcjonalny self-hosted LiveKit. Kod
domenowy nie zależy od konkretnego dostawcy storage ani od hostowanego API
bazy.

## Aplikacje

- `apps/landing` — publiczny landing, katalog, waitlista i publiczne API.
- `apps/crm` — CRM, portal klienta, agent Eve i zaplecze eksperta.
- `apps/meetings` — samodzielna aplikacja spotkań LiveKit.

## Development

### Wymagania

- Node.js 24.11+
- pnpm 10
- Docker API i Docker Compose v2, np. Docker Desktop, Colima lub OrbStack

Na macOS można użyć lekkiego runtime:

```bash
brew install colima docker
colima start --cpu 4 --memory 6
```

### Pierwsze uruchomienie

```bash
pnpm install
pnpm db:setup
pnpm dev
```

`pnpm db:setup`:

1. tworzy ignorowany `.env.local-stack` i synchronizuje zarządzane bloki
   `apps/*/.env`;
2. uruchamia PostgreSQL 17 + pgvector, PostgREST, MinIO i Mailpit;
3. generuje lokalny klucz Ed25519 dla krótkich tokenów Data API;
4. stosuje migracje z kontrolą checksum;
5. tworzy konto Better Auth oraz organizację przez ten sam RPC i RLS, których
   używa aplikacja;
6. uruchamia test izolacji RLS i autoryzowanego zapytania HTTP.

Lokalne konto:

```text
email:        admin@openexpert.local
hasło:        OpenExpert123!
rola:         SuperAdmin + administrator organizacji
organizacja:  openexpert-local
```

Adresy:

- landing: http://127.0.0.1:3003
- CRM: http://127.0.0.1:3004/login
- Data API: http://127.0.0.1:55321
- PostgreSQL: `127.0.0.1:55322`
- Mailpit: http://127.0.0.1:55324
- MinIO API: http://127.0.0.1:55326
- MinIO console: http://127.0.0.1:55327

Pierwsze uruchomienie pobiera obrazy kontenerów. Kolejne korzystają z
lokalnego cache i zachowanych wolumenów.

### Codzienna praca

```bash
pnpm db:start
pnpm dev
```

Przydatne komendy:

```bash
pnpm dev:landing
pnpm dev:crm
pnpm db:status
pnpm db:verify
pnpm db:seed-demo
pnpm db:reset
pnpm db:stop
pnpm mortgage:sync
pnpm trigger:dev
```

`db:reset` usuwa wyłącznie nazwany wolumen lokalnego PostgreSQL i wymaga
potwierdzenia; zachowuje obiekty MinIO. Dokładny opis ról, portów, kluczy i
mechanizmu migracji znajduje się w
[`docs/local-postgres-stack.md`](docs/local-postgres-stack.md).

### LiveKit i Trigger.dev lokalnie

LiveKit jest opcjonalnym profilem lokalnego Compose:

```bash
pnpm db:setup -- --livekit
```

Taski w tle znajdują się w `packages/tasks`. Po jednorazowym połączeniu CLI z
projektem Trigger.dev i uzupełnieniu `packages/tasks/.env.local` uruchom je w
osobnym terminalu:

```bash
cp packages/tasks/.env.example packages/tasks/.env.local
pnpm trigger:login
pnpm trigger:dev
```

`trigger dev` wykonuje taski na lokalnej maszynie. Domyślnie korzysta z
control plane Trigger.dev Cloud; pełny control plane można również uruchomić
lokalnie przez oficjalny stack Docker. Szczegóły, integracja z Vercel i różnice
między tymi trybami są opisane w [`docs/trigger-dev.md`](docs/trigger-dev.md).

### Logowanie i RLS

Better Auth obsługuje hasło, weryfikację email, magic link i reset hasła.
Wiadomości lokalne trafiają do Mailpit. Główny magic link nie tworzy
nieistniejących kont, natomiast portal klienta może utworzyć konto w swoim
dedykowanym flow.

Po zweryfikowaniu sesji serwer wystawia 60-sekundowy JWT Ed25519 z `sub`
użytkownika i rolą `authenticated`. Neon Data API oraz lokalny PostgREST
sprawdzają ten sam publiczny JWK, dlatego istniejące polityki RLS i funkcje
`auth.user_id()` zachowują izolację organizacji. Prywatny klucz nie trafia do
przeglądarki ani do bazy.

### Email

Lokalnie nie jest potrzebny klucz Resend: Better Auth i aplikacja wysyłają
przez SMTP do Mailpit. Produkcyjnie ustaw:

```text
NUXT_RESEND_API_KEY=re_...
NUXT_AUTH_EMAIL_FROM=OpenExpert <no-reply@auth.openexpert.app>
NUXT_RESEND_FROM=OpenExpert <hello@updates.openexpert.app>
NUXT_RESEND_REPLY_TO=hello@openexpert.app
```

Zweryfikuj w Resend osobne subdomeny nadawcze dla auth i komunikacji
produktowej. `NUXT_RESEND_API_KEY` jest wyłącznie serwerowy.

### Pozostałe moduły

Porównywarka hipotek używa testowanego pakietu `@openexpert/mortgage`; źródła
i pliki bankowe przechodzą przez wspólny adapter storage. `pnpm mortgage:sync`
pobiera i wersjonuje oficjalny katalog. Wyniki mają charakter orientacyjny i
nie są ofertą banku, ESIS, oceną zdolności ani decyzją kredytową.

Agent Eve korzysta z Vercel AI Gateway. Lokalnie dodaj do `apps/crm/.env`:

```text
AI_GATEWAY_API_KEY=vck_...
```

Bez klucza UI i autoryzacja działają, ale agent nie wywoła modelu.

Pliki Rive umieszczaj w `apps/landing/public/rive/` i renderuj przez globalny
komponent `RiveAnimation`.

### Kontrola jakości

```bash
pnpm typecheck
pnpm build
```

Repo zawiera projektowe skille w `.agents/skills`; ich źródła i wersje
utrzymuje `skills-lock.json`.

## Deployment na Vercel

Utwórz osobne projekty Vercel dla `apps/landing`, `apps/crm` i opcjonalnie
`apps/meetings`.

1. Dodaj Neon z Vercel Marketplace, włącz Data API z zewnętrznym JWKS i
   zastosuj w kolejności migracje `packages/database/postgres/migrations`
   (w tym przenośny bootstrap `0000`).
2. Utwórz logowalną rolę `openexpert_auth` z osobnym hasłem. Data API używa
   ról `anonymous`, `authenticated` i serwerowej `openexpert_service`; jej dostęp
   uprzywilejowany jest zapisany w jawnych politykach RLS, bez wymagania
   `BYPASSRLS`.
3. Utwórz osobny publiczny i prywatny magazyn Vercel Blob.
4. Ustaw Better Auth, Data API, Blob, Resend i integracje według
   [`.env.example`](.env.example).
5. Ustaw `BETTER_AUTH_URL` osobno dla każdego środowiska. Preview nie powinien
   wysyłać linków wskazujących przypadkiem na produkcję.
6. Dla współdzielenia sesji między subdomenami ustaw wspólny
   `BETTER_AUTH_SECRET`, `BETTER_AUTH_COOKIE_PREFIX` i
   `NUXT_AUTH_COOKIE_DOMAIN`.
7. Wdróż canary i sprawdź logowanie, RLS, upload/download oraz wiadomości.

Sekretów nie wolno oznaczać prefiksem `NUXT_PUBLIC_`. Aplikacja meetings może
działać na Vercelu, ale produkcyjny serwer LiveKit/TURN musi działać w LiveKit
Cloud albo na osobnej maszynie — nie w funkcji Vercel.

## License

AGPL-3.0 — zobacz [LICENSE](LICENSE).
