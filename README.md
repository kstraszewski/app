# OpenExpert

Modułowa platforma open source dla ekspertów — projektowana pod agentic economy.

Każdy moduł eksponuje trzy interfejsy: **UI** (dla ludzi), **REST API** (dla developerów), **MCP tools** (dla agentów AI).

## Stack

- Nuxt 4 + TypeScript
- Turborepo + pnpm workspaces
- Rive (`.riv`) animations
- Supabase (PostgreSQL + Auth + RLS)
- Resend (maile transakcyjne i produkcyjny SMTP Auth)
- Vercel
- AGPL-3.0

## Apps

- `apps/landing` — publiczny landing, waitlista i publiczne API MCP.
- `apps/crm` — aplikacja CRM z logowaniem i dashboardem.

## Development

### Wymagania

- Node.js 20+ (repo jest sprawdzone na Node 22)
- pnpm 10
- runtime zgodny z Docker API: Docker Desktop, Colima, OrbStack lub Rancher Desktop

Na macOS można uruchomić lekki runtime bez GUI:

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

`pnpm db:setup` uruchamia lokalny Supabase, odtwarza bazę z migracji, generuje
ignorowane pliki `apps/*/.env`, tworzy konto developerskie i sprawdza prawdziwe
logowanie hasłem oraz izolację RLS.

Konto lokalne:

```text
email:    admin@openexpert.local
hasło:    OpenExpert123!
```

Usługi:

- landing: http://127.0.0.1:3003
- CRM: http://127.0.0.1:3004/login
- Supabase API: http://127.0.0.1:55321
- Supabase Studio: http://127.0.0.1:55323
- Mailpit: http://127.0.0.1:55324

Pierwsze uruchomienie pobiera obrazy kontenerów. Kolejne starty korzystają już z
lokalnego cache.

### Codzienna praca

```bash
pnpm db:start
pnpm dev
```

Możesz też uruchomić tylko jedną aplikację:

```bash
pnpm dev:landing
pnpm dev:crm
```

Przydatne komendy bazodanowe:

```bash
pnpm db:status   # stan i lokalne adresy
pnpm db:verify   # test hasła, profilu, organizacji i RLS
pnpm db:types    # regeneruje packages/database/database.types.ts
pnpm db:reset    # kasuje dane lokalne, migruje i odtwarza konto developerskie
pnpm db:stop     # zatrzymuje kontenery, zachowując lokalny wolumen
pnpm mortgage:sync # ponownie pobiera i wersjonuje katalog 5 banków
```

### Porównywarka hipotek

Po `pnpm db:setup` katalog pięciu banków jest automatycznie importowany do
PostgreSQL, a oficjalne strony/PDF-y trafiają do prywatnego bucketu Supabase
Storage. Lokalna kopia źródeł znajduje się w ignorowanym katalogu
`.data/mortgage-sources`. Ekran jest dostępny pod
`/org/<organizationSlug>/mortgages`.

Administrator organizacji może otworzyć
`/org/<organizationSlug>/mortgages/admin`, aby nadpisać parametry wyłącznie dla
swojej organizacji, ukryć produkt z rankingu albo przywrócić dane źródłowe.
Zmiany nie modyfikują wspólnego katalogu bankowego i są zapisywane w historii
audytowej.

Porównywarka używa osobnego, testowanego silnika `@openexpert/mortgage` do rat
równych i malejących, przejścia ze stopy stałej na referencyjną, nadpłat,
kosztów i harmonogramu. Wyniki są orientacyjne: nie są ofertą banku, ESIS,
oceną zdolności ani decyzją kredytową. Opublikowane RRSO jest opisane jako RRSO
przykładu bankowego, a nie wynik bieżącego scenariusza.

Pełna analiza funkcji FinCRM, pokrycia MVP i braków znajduje się w
`docs/research/2026-07-12-fincrm-mortgage-mvp-analysis.md`.

Build wszystkich aplikacji:

```bash
pnpm build
```

### Project skills

Repo zawiera aktualne, projektowe skille dla Supabase, PostgreSQL, Turborepo,
Nuxt, Nuxt UI, Resend i dobrych praktyk email. Są zapisane w `.agents/skills`,
a ich źródła i wersje utrzymuje `skills-lock.json`.

Aktualizacja wszystkich skillsów:

```bash
npx skills update -p -y
```

### Flow konta

- `/register` tworzy użytkownika i osobną organizację; trigger bazy zawsze nadaje
  pierwszemu użytkownikowi rolę `admin`.
- Potwierdzenia konta, magic linki i reset hasła trafiają lokalnie do Mailpit.
- Linki email używają `token_hash`, więc działają także po otwarciu w innym
  urządzeniu lub profilu przeglądarki.
- Chronione strony zapamiętują cel i wracają do niego po zalogowaniu.
- `/forgot-password` i `/reset-password` obsługują pełny reset hasła.

Lokalnych kluczy i hasła developerskiego nie wolno używać w produkcji. Supabase
CLI może wystawiać porty na interfejsie sieciowym, dlatego po pracy warto wykonać
`pnpm db:stop`.

### Email i Resend

Lokalnie klucz Resend nie jest potrzebny:

- wiadomości Supabase Auth trafiają do Mailpit,
- zapis na waitlistę działa normalnie,
- potwierdzenie waitlisty ma status `skipped`, dopóki Resend nie jest skonfigurowany.

W środowisku wdrożeniowym aplikacji landing ustaw:

```text
NUXT_RESEND_API_KEY=re_...
NUXT_RESEND_FROM=OpenExpert <hello@updates.openexpert.app>
NUXT_RESEND_REPLY_TO=hello@openexpert.app
```

`NUXT_RESEND_API_KEY` jest konfiguracją serwerową i nie może mieć prefiksu
`NUXT_PUBLIC_`. Endpoint waitlisty wysyła przez `@openexpert/email` wiadomość
tekstową i HTML, używa idempotency key oraz nie cofa zapisu do bazy, gdy dostawca
email ma chwilową awarię.

Przed produkcją dodaj i zweryfikuj w Resend subdomenę nadawczą, np.
`updates.openexpert.app`. Dla wiadomości Supabase Auth skonfiguruj w dashboardzie
Supabase osobną subdomenę, np. `auth.openexpert.app`, i Custom SMTP:

```text
host:        smtp.resend.com
port:        587
username:    resend
password:    <RESEND_API_KEY>
sender:      no-reply@auth.openexpert.app
sender name: OpenExpert
```

Konfiguracja SMTP w `supabase/config.toml` pozostaje wyłączona lokalnie, dzięki
czemu testy rejestracji i resetu hasła nadal są bezpiecznie przechwytywane przez
Mailpit.

## Animacje Rive

Pliki `.riv` umieszczaj w `apps/landing/public/rive/` i renderuj przez
globalnie dostępny w aplikacji landing komponent:

```vue
<RiveAnimation
  src="/rive/hero.riv"
  state-machines="Main State Machine"
  label="Animowane logo OpenExpert"
/>
```

Kontener komponentu musi mieć określoną wysokość. Komponent obsługuje też właściwości
`artboard`, `animations`, `autoplay`, `auto-bind`, `fit` i `alignment` oraz zdarzenia
`load`, `error` i `state-change`. Metody `play`, `pause`, `stop`, `reset` i
`stateMachineInputs` są dostępne przez template ref.

Globalny loader aplikacji używa `openexpert-loader-lightmode.riv` lub
`openexpert-loader-darkmode.riv`, automatycznie dopasowując wariant do ustawień systemu.

## Deployment (Vercel)

1. Push repo do `OpenExpertApp/app`.
2. Import w Vercelu — utwórz osobne projekty dla `apps/landing` i `apps/crm`.
3. Ustaw zmienne środowiskowe w Vercel project settings:
   - `NUXT_PUBLIC_SUPABASE_URL`
   - `NUXT_PUBLIC_SUPABASE_KEY`
   - `NUXT_SUPABASE_SECRET_KEY` — tylko w projekcie landing, nigdy jako zmienna publiczna
   - `NUXT_RESEND_API_KEY` — tylko w projekcie landing, nigdy jako zmienna publiczna
   - `NUXT_RESEND_FROM`
   - `NUXT_RESEND_REPLY_TO`
4. Deploy.

## License

AGPL-3.0 — zobacz [LICENSE](LICENSE).
