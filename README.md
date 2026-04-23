# OpenExpert

Modułowa platforma open source dla ekspertów — projektowana pod agentic economy.

Każdy moduł eksponuje trzy interfejsy: **UI** (dla ludzi), **REST API** (dla developerów), **MCP tools** (dla agentów AI).

## Stack

- Nuxt 4 + TypeScript
- Turborepo + pnpm workspaces
- Supabase (PostgreSQL + Auth + RLS)
- Vercel
- AGPL-3.0

## Apps

- `apps/landing` — publiczny landing, waitlista i publiczne API MCP.
- `apps/crm` — aplikacja CRM z logowaniem i dashboardem.

## Development

```bash
pnpm install
cp .env.example .env              # uzupełnij klucze swojego dev Supabase
cp .mcp.json.example .mcp.json    # wstaw swój project_ref
pnpm dev
```

Potem w osobnym terminalu uruchom `claude /mcp` i autoryzuj serwer `supabase`.

Landing startuje na http://localhost:3003, a CRM na http://localhost:3004.

Możesz też uruchomić tylko jedną aplikację:

```bash
pnpm dev:landing
pnpm dev:crm
```

Build wszystkich aplikacji:

```bash
pnpm build
```

## Deployment (Vercel)

1. Push repo do `OpenExpertApp/OpenExpert`.
2. Import w Vercelu — utwórz osobne projekty dla `apps/landing` i `apps/crm`.
3. Ustaw zmienne środowiskowe w Vercel project settings:
   - `NUXT_PUBLIC_SUPABASE_URL`
   - `NUXT_PUBLIC_SUPABASE_KEY`
   - `SUPABASE_SERVICE_KEY`
4. Deploy.

## License

AGPL-3.0 — zobacz [LICENSE](LICENSE).
