# OpenExpert Seed Application Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Scaffold a Nuxt 4 + Supabase + MCP seed application for OpenExpert, deployable to Vercel, ready to host feature modules (CRM, Bookings).

**Architecture:** Single Nuxt 4 monolith with modules registered via `defineNuxtModule` (NOT Nuxt Layers). Triple-interface pattern prepared: UI (Vue pages), REST API (H3 server), MCP endpoint (`/mcp`) aggregating tools from modules. Multi-tenant via Supabase RLS — one instance = one organization with many experts.

**Tech Stack:** Nuxt 4, Vue 3, TypeScript, Supabase (DB + Auth), `@nuxtjs/supabase`, Vercel, AGPL-3.0.

**Design:** [docs/plans/2026-04-19-openexpert-seed-design.md](2026-04-19-openexpert-seed-design.md)

---

## Prerequisites (manual, user actions)

Before starting tasks below, user must complete:

1. ✅ **GitHub organization `OpenExpertApp`** utworzona.
2. **Create Supabase project** (free tier) at https://supabase.com/dashboard — note `SUPABASE_URL` and `SUPABASE_ANON_KEY`.
3. **Vercel account** connected to GitHub — https://vercel.com.
4. Confirm `gh` CLI is authenticated: `gh auth status`.

---

## Task 1: Initialize Nuxt 4 project

**Files:**
- Create: `package.json`, `nuxt.config.ts`, `tsconfig.json`, `app.vue`, `.gitignore`, `.npmrc`

**Step 1: Scaffold Nuxt 4**

Run from `/Users/michal/Openexpert`:

```bash
npx nuxi@latest init . --packageManager pnpm --gitInit false --no-install
```

Expected: creates `nuxt.config.ts`, `app.vue`, `package.json` pinned to Nuxt 4.x, `tsconfig.json`.

**Step 2: Install dependencies**

```bash
pnpm install
```

Expected: `node_modules/` populated, `pnpm-lock.yaml` created.

**Step 3: Verify dev server starts**

```bash
pnpm dev
```

Expected: server starts on http://localhost:3000, default Nuxt welcome page renders. Kill with Ctrl-C.

**Step 4: Initialize git + first commit**

```bash
git init
git add .
git commit -m "chore: initialize Nuxt 4 project"
```

---

## Task 2: Add LICENSE (AGPL-3.0) and README

**Files:**
- Create: `LICENSE`, `README.md`

**Step 1: Fetch AGPL-3.0 license text**

```bash
curl -sL https://www.gnu.org/licenses/agpl-3.0.txt -o LICENSE
```

Expected: `LICENSE` file ~34KB with AGPL-3.0 full text.

**Step 2: Write README**

Create `README.md`:

```markdown
# OpenExpert

Modułowa platforma open source dla ekspertów — projektowana pod agentic economy.

Każdy moduł eksponuje trzy interfejsy: **UI** (dla ludzi), **REST API** (dla developerów), **MCP tools** (dla agentów AI).

## Stack

- Nuxt 4 + TypeScript
- Supabase (PostgreSQL + Auth + RLS)
- Vercel
- AGPL-3.0

## Development

```bash
pnpm install
cp .env.example .env   # uzupełnij klucze Supabase
pnpm dev
```

## License

AGPL-3.0 — see [LICENSE](LICENSE).
```

**Step 3: Commit**

```bash
git add LICENSE README.md
git commit -m "docs: add AGPL-3.0 license and README"
```

---

## Task 3: Add Supabase module

**Files:**
- Modify: `package.json`, `nuxt.config.ts`
- Create: `.env.example`

**Step 1: Install `@nuxtjs/supabase`**

```bash
pnpm add @nuxtjs/supabase
```

Expected: added to `dependencies`.

**Step 2: Register module in `nuxt.config.ts`**

Replace contents of `nuxt.config.ts`:

```ts
export default defineNuxtConfig({
  compatibilityDate: '2025-01-01',
  devtools: { enabled: true },
  modules: ['@nuxtjs/supabase'],
  supabase: {
    redirectOptions: {
      login: '/login',
      callback: '/confirm',
      exclude: ['/', '/api/mcp'],
    },
  },
  app: {
    head: {
      htmlAttrs: { lang: 'pl' },
      title: 'OpenExpert',
    },
  },
})
```

**Step 3: Create `.env.example`**

```bash
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_KEY=your-anon-key
SUPABASE_SERVICE_KEY=your-service-role-key
```

**Step 4: Add `.env` to `.gitignore`**

Append to `.gitignore`:

```
.env
.env.*
!.env.example
```

**Step 5: Verify Nuxt still builds**

```bash
pnpm dev
```

Expected: server starts without errors (warnings about missing SUPABASE_URL are OK at this stage). Stop server.

**Step 6: Commit**

```bash
git add package.json pnpm-lock.yaml nuxt.config.ts .env.example .gitignore
git commit -m "feat: add Supabase module"
```

---

## Task 4: Create Supabase migration — organizations + users + RLS

**Files:**
- Create: `supabase/migrations/0001_init.sql`

**Step 1: Write migration**

Create `supabase/migrations/0001_init.sql`:

```sql
-- organizations: jedna instancja = jedna organizacja z wieloma ekspertami
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique not null,
  created_at timestamptz not null default now()
);

-- users: profil eksperta powiązany z auth.users
create table public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email text not null,
  role text not null default 'expert' check (role in ('expert', 'admin')),
  created_at timestamptz not null default now()
);

create index users_organization_id_idx on public.users(organization_id);

-- RLS
alter table public.organizations enable row level security;
alter table public.users enable row level security;

-- helper: zwraca organization_id aktualnego użytkownika
create or replace function public.current_organization_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select organization_id from public.users where id = auth.uid() limit 1;
$$;

-- policies: widzisz tylko swoją organizację
create policy "users see own org" on public.organizations
  for select using (id = public.current_organization_id());

create policy "users see own profile and org members" on public.users
  for select using (organization_id = public.current_organization_id());
```

**Step 2: Apply migration to Supabase**

User applies via Supabase dashboard SQL editor, or via CLI if installed:

```bash
# option A: paste SQL into Supabase dashboard → SQL Editor → Run
# option B: with supabase CLI linked:
supabase db push
```

Expected: tables `organizations`, `users` created, RLS enabled. Verify in Supabase Table Editor.

**Step 3: Commit**

```bash
git add supabase/migrations/0001_init.sql
git commit -m "feat: add organizations + users schema with RLS"
```

---

## Task 5: Create core pages (landing, login, dashboard)

**Files:**
- Create: `pages/index.vue`, `pages/login.vue`, `pages/dashboard.vue`, `pages/confirm.vue`
- Create: `middleware/auth.ts`

**Step 1: Create `pages/index.vue` (placeholder landing)**

```vue
<script setup lang="ts">
useHead({ title: 'OpenExpert' })
</script>

<template>
  <main>
    <h1>OpenExpert</h1>
    <p>Modułowa platforma dla ekspertów.</p>
    <NuxtLink to="/login">Zaloguj się</NuxtLink>
  </main>
</template>
```

**Step 2: Create `pages/login.vue`**

```vue
<script setup lang="ts">
const supabase = useSupabaseClient()
const email = ref('')
const sent = ref(false)
const error = ref<string | null>(null)

async function signIn() {
  error.value = null
  const { error: err } = await supabase.auth.signInWithOtp({ email: email.value })
  if (err) {
    error.value = err.message
    return
  }
  sent.value = true
}
</script>

<template>
  <main>
    <h1>Zaloguj się</h1>
    <form v-if="!sent" @submit.prevent="signIn">
      <label>
        Email
        <input v-model="email" type="email" required>
      </label>
      <button type="submit">Wyślij link</button>
      <p v-if="error" role="alert">{{ error }}</p>
    </form>
    <p v-else>Sprawdź skrzynkę — wysłaliśmy link logowania.</p>
  </main>
</template>
```

**Step 3: Create `pages/confirm.vue` (magic link callback)**

```vue
<script setup lang="ts">
const user = useSupabaseUser()
watch(user, (val) => {
  if (val) navigateTo('/dashboard')
}, { immediate: true })
</script>

<template>
  <main>
    <p>Logowanie…</p>
  </main>
</template>
```

**Step 4: Create `middleware/auth.ts`**

```ts
export default defineNuxtRouteMiddleware(() => {
  const user = useSupabaseUser()
  if (!user.value) return navigateTo('/login')
})
```

**Step 5: Create `pages/dashboard.vue`**

```vue
<script setup lang="ts">
definePageMeta({ middleware: 'auth' })
const user = useSupabaseUser()
const supabase = useSupabaseClient()

async function signOut() {
  await supabase.auth.signOut()
  await navigateTo('/login')
}
</script>

<template>
  <main>
    <h1>Dashboard</h1>
    <p>Zalogowany: {{ user?.email }}</p>
    <button @click="signOut">Wyloguj</button>
  </main>
</template>
```

**Step 6: Verify manually**

Start dev server, visit http://localhost:3000, click login, attempt magic link (requires Supabase creds in `.env`). Skip if Supabase not yet configured locally.

**Step 7: Commit**

```bash
git add pages/ middleware/
git commit -m "feat: add core pages (landing, login, dashboard) and auth middleware"
```

---

## Task 6: Create MCP endpoint scaffold

**Files:**
- Create: `server/api/mcp/index.post.ts`, `server/utils/mcp.ts`

**Step 1: Create tool registry utility**

Create `server/utils/mcp.ts`:

```ts
export interface McpTool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  handler: (input: unknown) => Promise<unknown>
}

const registry: McpTool[] = []

export function registerMcpTool(tool: McpTool) {
  registry.push(tool)
}

export function listMcpTools(): McpTool[] {
  return registry
}
```

**Step 2: Create MCP endpoint**

Create `server/api/mcp/index.post.ts`:

```ts
import { listMcpTools } from '~/server/utils/mcp'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ method: string; params?: Record<string, unknown> }>(event)

  if (body.method === 'tools/list') {
    return {
      tools: listMcpTools().map(({ name, description, inputSchema }) => ({
        name,
        description,
        inputSchema,
      })),
    }
  }

  if (body.method === 'tools/call') {
    const { name, arguments: args } = (body.params ?? {}) as {
      name: string
      arguments: unknown
    }
    const tool = listMcpTools().find((t) => t.name === name)
    if (!tool) throw createError({ statusCode: 404, statusMessage: `tool ${name} not found` })
    return await tool.handler(args)
  }

  throw createError({ statusCode: 400, statusMessage: `unknown method: ${body.method}` })
})
```

**Step 3: Verify endpoint returns empty tools list**

Start dev server:

```bash
pnpm dev
```

In another terminal:

```bash
curl -X POST http://localhost:3000/api/mcp \
  -H 'Content-Type: application/json' \
  -d '{"method":"tools/list"}'
```

Expected: `{"tools":[]}`

Stop server.

**Step 4: Commit**

```bash
git add server/
git commit -m "feat: add MCP endpoint scaffold with tool registry"
```

---

## Task 7: Add empty `modules/` directory + module template README

**Files:**
- Create: `modules/.gitkeep`, `modules/README.md`

**Step 1: Create `modules/.gitkeep`** (empty file)

```bash
touch modules/.gitkeep
```

**Step 2: Create `modules/README.md`**

```markdown
# Modules

Each feature module is a Nuxt module (`defineNuxtModule`) that exposes three interfaces:

- **UI** — Vue components and pages under `components/` and `pages/`
- **API** — REST endpoints under `server/api/`
- **MCP tools** — tool definitions registered via `registerMcpTool()` from `~/server/utils/mcp`

## Adding a module

1. Create `modules/<name>/index.ts` that exports `defineNuxtModule(...)`.
2. Register in `nuxt.config.ts` under `modules: []`.
3. Expose UI + API + MCP tools per the triple-interface pattern.

Premium modules live in separate repos, published as `@openexpert/<name>` npm packages.
```

**Step 3: Commit**

```bash
git add modules/
git commit -m "chore: add modules directory placeholder"
```

---

## Task 8: Configure Vercel deployment

**Files:**
- Create: `vercel.json` (only if custom config needed — Nuxt auto-detects)

**Step 1: Check Nuxt Vercel preset**

Nuxt 4 auto-detects Vercel via `NITRO_PRESET=vercel` at build time. No config file required for a basic deploy.

**Step 2: Add Vercel env var reminders to README**

Append to `README.md`:

```markdown
## Deployment (Vercel)

1. Push repo to `OpenExpertApp/OpenExpert`.
2. Import in Vercel → connect GitHub repo.
3. Set environment variables in Vercel project settings:
   - `SUPABASE_URL`
   - `SUPABASE_KEY`
4. Deploy.
```

**Step 3: Commit**

```bash
git add README.md
git commit -m "docs: add Vercel deployment instructions"
```

---

## Task 9: Create GitHub repo and push

**Files:** (none — remote operation)

**Step 1: Verify org exists**

```bash
gh api orgs/OpenExpertApp
```

Expected: JSON with org metadata.

**Step 2: Create public repo under org**

```bash
gh repo create OpenExpertApp/OpenExpert --public \
  --description "Modular open-source platform for experts — designed for the agentic economy" \
  --source . --push
```

Expected: repo created at https://github.com/OpenExpertApp/OpenExpert, current branch pushed.

**Step 3: Verify on GitHub**

```bash
gh repo view OpenExpertApp/OpenExpert --web
```

Expected: browser opens to repo page.

---

## Task 10: Connect Vercel project

**Step 1: User action — via Vercel dashboard**

1. Go to https://vercel.com/new
2. Import `OpenExpertApp/OpenExpert`
3. Set env vars: `SUPABASE_URL`, `SUPABASE_KEY`
4. Deploy

Expected: deployment succeeds, default Nuxt welcome replaced by landing page.

**Step 2: Verify**

Visit Vercel-generated URL. Landing page shows "OpenExpert" heading.

---

## Done criteria

- [ ] `pnpm dev` starts cleanly, landing page at `/`, login at `/login`
- [ ] `POST /api/mcp` with `{"method":"tools/list"}` returns `{"tools":[]}`
- [ ] `supabase/migrations/0001_init.sql` applied to Supabase project, RLS enabled
- [ ] Repo pushed to `github.com/OpenExpertApp/OpenExpert`
- [ ] Deployed on Vercel, landing page reachable via public URL

## Next phases (not in this plan)

1. Domain connection (Vercel → custom domain)
2. Proper landing page (content, styling, CTA)
3. First feature module: CRM
