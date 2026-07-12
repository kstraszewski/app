# OpenExpert — Seed Application Design

**Date:** 2026-04-19
**Status:** Approved

## Vision

OpenExpert to modułowa platforma dla ekspertów rozwijana w modelu **open core** (AGPL rdzeń + komercyjne moduły premium). Projektowana od początku pod **agentic economy** — każdy moduł eksponuje trzy równorzędne interfejsy: UI (dla ludzi), REST API (dla developerów), MCP tools (dla agentów AI).

Głównym użytkownikiem są eksperci (np. kredytowi) pracujący w ramach jednej firmy. Jedna instancja aplikacji obsługuje wiele ekspertów jednej organizacji.

## Scope — Ten design doc

Ten dokument opisuje **seed aplikacji** — szkielet, na którym będą budowane moduły funkcjonalne. **Nie** zawiera implementacji CRM ani rezerwacji.

Po seedzie:
1. Podpięcie domeny
2. Landing page

## Architectural Principles

### Triple Interface Pattern
Każdy moduł implementuje trzy warstwy nad tym samym źródłem prawdy:
- **UI** — komponenty Vue + strony Nuxt
- **API** — REST endpoints (Nuxt H3 server)
- **MCP tools** — definicje narzędzi dla agentów AI

Pojedynczy endpoint `/mcp` agreguje narzędzia ze wszystkich modułów.

### Moduły jako Nuxt Modules
Każdy moduł funkcjonalny to standardowy Nuxt Module (`defineNuxtModule`) — lokalny w `modules/` lub zewnętrzny pakiet npm (dla wersji premium). **Nie używamy Nuxt Layers.**

### Multi-tenancy
- Jedna instancja = jedna organizacja (firma) z wieloma ekspertami
- Scopowanie per `organization_id`
- **Row-Level Security** w Supabase na każdej tabeli — krytyczne

## Stack

| Warstwa | Technologia |
|---------|-------------|
| Frontend | Nuxt 4, Vue 3, TypeScript |
| Backend | Nuxt server (H3) |
| DB + Auth + Storage | Supabase (lock-in świadomy) |
| Auth agentów | OAuth 2.1 (MCP), delegowane do Supabase |
| Hosting | Vercel |
| Język UI | Polski (domyślny) |
| Licencja | AGPL-3.0 |

## Repository Structure

```
app/
  modules/                  # (puste — miejsce na crm/, bookings/)
  core/
    components/
    pages/
      index.vue             # landing
      dashboard.vue         # dashboard eksperta
      login.vue             # logowanie
    server/
      api/                  # REST (szkielet)
      mcp/
        index.post.ts       # MCP endpoint — agreguje tools z modułów
      utils/
        supabase.ts         # klient Supabase
        auth.ts
  supabase/
    migrations/
      0001_init.sql         # organizations, users, RLS policies
  nuxt.config.ts
  package.json
  LICENSE                   # AGPL-3.0
  README.md
```

## Data Model (initial)

```sql
organizations (id, name, slug, created_at)
users (id, organization_id, email, role, created_at)

-- RLS: users mogą czytać/pisać tylko wiersze gdzie organization_id = current org
```

## GitHub Organization

- `OpenExpertApp` — publiczna organizacja
- `OpenExpertApp/OpenExpert` — główne repo (public, AGPL-3.0)

## Out of Scope (świadomie pominięte)

- Implementacja modułów CRM i Bookings
- Audit log / observability
- Integracje komunikacyjne (email/chat)
- JSON-LD / agent discovery na publicznych profilach
- OSS governance (CONTRIBUTING, CLA, CoC)
- Database abstraction — świadomy Supabase lock-in
- SaaS hosting — self-hosted first
- i18n framework — polski hardcoded na start

## Deferred Decisions

- Managed SaaS hosting (po seedzie)
- Premium moduł płatności
- Agent discovery (JSON-LD)
- Multi-language support
