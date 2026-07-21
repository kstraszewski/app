# OpenExpert

Modułowa platforma open source dla ekspertów — projektowana pod agentic economy.

Każdy moduł eksponuje trzy interfejsy: **UI** (dla ludzi), **REST API** (dla developerów), **MCP tools** (dla agentów AI).

## Stack

- Nuxt 4 + TypeScript
- Rive (`.riv`) animations
- Supabase (PostgreSQL + Auth + RLS)
- Vercel
- AGPL-3.0

## Development

```bash
pnpm install
cp .env.example .env              # uzupełnij klucze swojego dev Supabase
cp .mcp.json.example .mcp.json    # wstaw swój project_ref
pnpm dev
```

Potem w osobnym terminalu uruchom `claude /mcp` i autoryzuj serwer `supabase`.

Aplikacja startuje na http://localhost:3000.

## Animacje Rive

Pliki `.riv` umieszczaj w `public/rive/` i renderuj przez globalnie dostępny komponent:

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
2. Import w Vercelu — podłącz GitHub repo.
3. Ustaw zmienne środowiskowe w Vercel project settings:
   - `SUPABASE_URL`
   - `SUPABASE_KEY`
4. Deploy.

## License

AGPL-3.0 — zobacz [LICENSE](LICENSE).
