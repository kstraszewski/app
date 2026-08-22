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
- Vercel Blob
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

Lokalnie PostgreSQL + PostgREST, Better Auth, Mailpit, proces `trigger dev`
oraz opcjonalny self-hosted LiveKit zastępują usługi hostowane. Pliki we
wszystkich środowiskach trafiają do Vercel Blob, więc aplikacja nie utrzymuje
drugiego systemu object storage.

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
pnpm storage:env:pull
pnpm db:setup
pnpm dev
```

`storage:env:pull` pobiera konfigurację Development z podłączonego projektu CRM,
zapisuje do ignorowanego `.env.blob.local` wyłącznie osobne tokeny read-write
i identyfikatory obu magazynów Blob, a pozostałe sekrety odrzuca.
Publiczny i prywatny store są współdzielone przez lokalne procesy aplikacji.

`pnpm db:setup`:

1. tworzy ignorowany `.env.local-stack` i synchronizuje zarządzane bloki
   `apps/*/.env`;
2. uruchamia PostgreSQL 17 + pgvector, PostgREST i Mailpit;
3. generuje lokalny klucz Ed25519 dla krótkich tokenów Data API;
4. stosuje migracje z kontrolą checksum;
5. tworzy konto Better Auth oraz organizację przez ten sam RPC i RLS, których
   używa aplikacja;
6. ładuje systemowe katalogi CRM, deterministyczny katalog hipotek oraz
   idempotentny fixture demonstracyjny (9 klientów i 8 spraw);
7. uruchamia test izolacji RLS i autoryzowanego zapytania HTTP.

Lokalne konto:

```text
email:        admin@openexpert.local
hasło:        OpenExpert123!
rola:         SuperAdmin + administrator organizacji
organizacja:  openexpert-local
```

Lokalne konto panelu klienta:

```text
email:        jan.kowalski@example.local
hasło:        OpenExpert123!
sprawa:       Zakup mieszkania — Warszewo
```

To konto jest celowo oddzielone od personelu. Seed łączy je wyłącznie z osobą
Jana w CRM i nadaje dostęp do jednej prawdziwej sprawy wraz z Multiwnioskiem.
Tworzy też powiązaną placówkę, usługę i najbliższe spotkanie w kolejnym dniu
roboczym, więc panel klienta nie korzysta w tym widoku z danych mockowych.

Adresy:

- landing: http://127.0.0.1:3003
- CRM: http://127.0.0.1:3004/login
- panel klienta: http://127.0.0.1:3006/login
- Data API: http://127.0.0.1:55321
- PostgreSQL: `127.0.0.1:55322`
- Mailpit: http://127.0.0.1:55324

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
pnpm storage:env:pull
pnpm mortgage:sync
pnpm trigger:dev
```

`db:reset` usuwa wyłącznie nazwany wolumen lokalnego PostgreSQL i wymaga
potwierdzenia; nie dotyka obiektów Vercel Blob. Dokładny opis ról, portów,
kluczy i mechanizmu migracji znajduje się w
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
NUXT_AUTH_EMAIL_FROM=OpenExpert <security@openexpert.app>
NUXT_AUTH_EMAIL_REPLY_TO=hello@openexpert.app
NUXT_RESEND_FROM=OpenExpert <hello@openexpert.app>
NUXT_RESEND_REPLY_TO=hello@openexpert.app
NUXT_MOCK_BANK_ENABLED=true
NUXT_MOCK_BANK_ORGANIZATION_IDS=<uuid-organizacji-demo>
NUXT_MOCK_BANK_EMAIL_FROM=OpenExpert Bank <dokumenty@openexpert.app>
NUXT_MOCK_BANK_EMAIL_REPLY_TO=demo@openexpert.app
```

Zweryfikuj w Resend domenę `openexpert.app` i skonfiguruj dla niej SPF, DKIM
oraz DMARC. Wiadomości uwierzytelniające, komunikacja produktowa i symulator
banku używają osobnych nazw skrzynek w tej samej domenie; dla wiadomości
uwierzytelniających wyłącz śledzenie kliknięć i otwarć. Wszystkie serwisy
korzystają z jednego serwerowego `NUXT_RESEND_API_KEY`, a adres `Reply-To` musi
wskazywać rzeczywiście monitorowaną skrzynkę.

Symulator OpenExpert Banku jest domyślnie włączony lokalnie i wyłączony w
produkcji. Produkcyjne uruchomienie wymaga jednocześnie
`NUXT_MOCK_BANK_ENABLED=true` i jawnego allowlistu UUID tenantów w
`NUXT_MOCK_BANK_ORGANIZATION_IDS`; bank testowy nie pojawi się w pozostałych
organizacjach. Lokalnie korzysta z tego samego Mailpita co pozostałe
wiadomości; produkcyjnie wymaga zweryfikowanej domeny nadawczej i korzysta ze
wspólnego klucza Resend poprzez odseparowany serwis symulatora.

Przepływ demonstracyjny zachowuje rzeczywiste reguły procesu hipotecznego:

1. Podłącz skrzynkę doradcy i uzupełnij PESEL głównego wnioskodawcy.
2. W kalkulatorze zapisz ofertę „Hipoteka Demo” OpenExpert Banku. Zapis oferty
   automatycznie tworzy roboczy wniosek i nadaje numer `OEB-YYYYMMDD-######`.
3. Na karcie wniosku wybierz „Wyślij do banku”. Do skrzynki trafi aktualny ESIS
   jako PDF w archiwum AES-256 ZIP; hasłem jest PESEL głównego wnioskodawcy.
4. Pobierz PDF z wiadomości, dodaj go jako ESIS do wniosku i zapisz przekazanie
   dokumentu wszystkim wnioskodawcom.
5. Wybierz „Złóż wniosek”. Symulator zapisze kanoniczne potwierdzenie odbioru i
   kompletności, po czym wyśle pozytywną decyzję w takim samym archiwum ZIP.
6. Dodaj decyzję przez istniejącą akcję dokumentową. PDF przechodzi tę samą
   kontrolę AI i reguły zgodności co dokument rzeczywistego banku.

Workspace poczty obecnie pokazuje metadane załączników, ale nie pobiera ich z
Gmaila, Microsoft Graph ani IMAP do CRM. Dlatego krok pobrania i dodania PDF
jest dziś ręczny; symulator celowo nie omija kanonicznego pipeline'u dokumentów.

Status „przyjęty do wysyłki” oznacza potwierdzenie dostawcy poczty, a nie
doręczenie do skrzynki. Po niejednoznacznym błędzie transportu przed ponowieniem
sprawdź skrzynkę odbiorczą. Dokładne zaszyfrowane bajty są utrwalane na czas
bezpiecznego retry, usuwane po przyjęciu wiadomości, a porzucone lub nieudane
payloady trafiają do trwałej kolejki usunięcia po 7 dniach.

Transport Resend waliduje nadawcę, odbiorców i nagłówki, wymaga wersji HTML
oraz plain text, a każde żądanie ma 10-sekundowy timeout. Błędy `429` i `5xx`
są ponawiane maksymalnie dwa razy z wykładniczym backoffem i jitterem. Wszystkie
próby tej samej generacji używają identycznego payloadu i klucza idempotency,
co pozwala Resend deduplikować je w jego oknie idempotencji. Ponawiane są także
timeouty i błędy sieciowe bez statusu HTTP; po wyczerpaniu prób wynik pozostaje
niejednoznaczny i wymaga sprawdzenia skrzynki. Błędy `4xx` (poza `429`) nie są
ponawiane.
Lokalny fallback SMTP ma te same limity czasu i wyłączony dostęp do plików oraz
zdalnych URL-i; nie należy konfigurować go jako produkcyjnego fallbacku dla
Resend.

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
   (w tym przenośny bootstrap `0000`). Po każdej migracji zmieniającej tabele,
   widoki lub RPC odśwież zarządzany cache Neon Data API przed promocją deployu:

   ```bash
   pnpm dlx neonctl@latest data-api refresh-schema \
     --project-id <project-id> \
     --branch <branch-id> \
     --database <database>
   ```

   Samo postgresowe `NOTIFY pgrst` nie odświeża zarządzanego cache'u Neon.
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
