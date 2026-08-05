# Local PostgreSQL stack

This is the primary OpenExpert development stack: PostgreSQL 17 + pgvector,
Better Auth, the native PostgREST Data API, MinIO, and Mailpit.

## Start in one command

Prerequisites:

- Node.js 24
- pnpm 10
- Docker with the Compose v2 plugin

From the repository root:

```sh
pnpm --filter @openexpert/database db:local:setup
```

The stack uses the established local API, database, and Mailpit ports. Stop
anything already bound to those ports, or override the `OPENEXPERT_*_PORT`
values in `.env.local-stack`.

The command:

1. creates the git-ignored `.env.local-stack` with mode `0600`;
2. generates an Ed25519 keypair for local Data API JWTs;
3. safely replaces a marked, generated block in `apps/crm/.env`,
   `apps/landing/.env`, and `apps/meetings/.env`, preserving all user-managed
   AI/OAuth values outside the block;
4. starts PostgreSQL 17 + pgvector, Mailpit, and MinIO;
5. applies checksum-tracked SQL migrations;
6. starts PostgREST with the public JWKS;
7. creates the verified Better Auth development account and its organization;
8. seeds the portable CRM reference catalogue, an offline mortgage catalogue,
   three delegated-task experts, nine clients, and eight complete CRM cases;
9. verifies transaction-local RLS and an authenticated HTTP query.

Nuxt reads the synchronized app `.env` files automatically. Source
`.env.local-stack` only for other processes started directly from the
repository root.

Do not commit `.env.local-stack`. The private key is a base64-encoded PKCS8
PEM in `NUXT_DATA_API_JWT_PRIVATE_KEY`; PostgREST receives only
`OPENEXPERT_DATA_API_JWKS`, which contains public key material.

## Endpoints

| Service | Default local endpoint |
| --- | --- |
| PostgREST Data API | `http://127.0.0.1:55321` |
| PostgreSQL | `127.0.0.1:55322` |
| Mailpit UI | `http://127.0.0.1:55324` |
| Mailpit SMTP | `127.0.0.1:55325` |
| MinIO API | `http://127.0.0.1:55326` |
| MinIO console | `http://127.0.0.1:55327` |

All published ports bind to loopback. Override them and the local-only
passwords in `.env.local-stack`; the full documented set is in
`infrastructure/local/env.example`.

## Lifecycle

```sh
pnpm --filter @openexpert/database db:local:start
pnpm --filter @openexpert/database db:local:status
pnpm --filter @openexpert/database db:local:migrate
pnpm --filter @openexpert/database db:local:seed-demo
pnpm --filter @openexpert/database db:local:verify
pnpm --filter @openexpert/database db:local:stop
```

`stop` preserves every named volume. `reset` is intentionally explicit:

```sh
pnpm --filter @openexpert/database db:local:reset
```

It requires typing `openexpert-local-postgres-data`. CI may use `--yes`.
Before deletion the script validates both Docker Compose labels, removes only
that exact PostgreSQL volume, and preserves MinIO data. It never uses
`docker compose down --volumes`, globs, or an unresolved variable.

Schema migrations not yet recorded locally are applied in filename order.
Their SHA-256 checksums are stored in
`app_migrations.schema_migrations`; changing an applied migration fails with
an instruction to add a new migration or perform the explicit local reset.

`setup`, and `reset` after deleting the PostgreSQL volume, idempotently create
this local-only login:

```text
Email:    admin@openexpert.local
Password: OpenExpert123!
Org:      OpenExpert Local (openexpert-local)
```

The same seed also creates a case-scoped client portal login:

```text
Portal:   http://127.0.0.1:3006/login
Email:    jan.kowalski@example.local
Password: OpenExpert123!
Case:     Zakup mieszkania — Warszewo
```

This identity exists in Better Auth and `profiles`, but deliberately has no
row in `users` or `organization_memberships`. Its access comes only from a
verified `client_account_links` row and one active
`client_portal_case_grants` row with Multiwniosek enabled.
It also seeds the scheduling records required for Jan's next confirmed meeting:
a facility, service, expert assignment, and appointment on the next business
day. These are ordinary database records loaded by the client portal API.

The account is stored in Better Auth's `identity.users` and `identity.accounts`
tables, with verified email and a bcrypt credential. Organization onboarding
still goes through `create_organization_with_admin` with an authenticated
end-user Data API JWT, so the same RPC and RLS boundary as the application is
exercised. Re-run `db:local:seed-demo` to create or repair the account and
organization, reference catalogues, mortgage fixtures, delegate accounts,
client portal access, its next appointment, and CRM demo records without
resetting PostgreSQL. The seed is idempotent and only updates records carrying
its stable demo keys; it does not delete user-created data.

The CRM fixture contains nine clients and eight cases with people, consent
history, products, properties, saved mortgage offers, applications, tasks,
documents, activities, and a Multiwniosek draft. Mortgage source documents are
deterministic local fixtures stored through the same MinIO adapter as the app,
so seeding never downloads live bank files.

## Optional LiveKit profile

LiveKit is useful for the meetings app but is not started by default:

```sh
pnpm --filter @openexpert/database db:local:setup -- --livekit
```

LiveKit uses its documented development credentials (`devkey` / `secret`) and
must never be exposed outside local development. Background work is handled
by the separate Trigger.dev process described in
[`trigger-dev.md`](./trigger-dev.md), not by a database-stack profile.

## Database roles and RLS

| Role | Purpose |
| --- | --- |
| `openexpert_owner` | NOLOGIN owner of application objects |
| `openexpert_admin` | Migration login; explicitly assumes the owner role |
| `openexpert_auth` | Better Auth login, limited to the five `identity` tables |
| `openexpert_runtime` | Trusted server connection inheriting `authenticated` |
| `authenticator` | PostgREST login allowed to switch to JWT roles |
| `anonymous` | Public, unauthenticated Data API role |
| `authenticated` | End-user RLS role |
| `openexpert_service` | Server-only Data API role with explicit RLS policies |

PostgREST places JWT claims in `request.jwt.claims`. Locally,
`auth.user_id()` reads the JWT subject through the same boundary used by Neon.
The transaction-scoped fallback exists only for owner-level database smoke
tests:

```sql
begin;
select app.set_request_context('00000000-0000-4000-8000-000000000001');
-- domain queries protected by the existing RLS policies
commit;
```

The setter uses transaction-local `set_config(..., true)`. The smoke test
proves that the value cannot leak through the connection pool after commit.
Application users cannot execute the setter.

## Database schema

`0001_portable_schema.sql` is the PostgreSQL 17.6 baseline of the current
`public` and `private` application schemas.

The initial container bootstrap supplies the runtime surface the schema needs:

- `auth.user_id()` as the Data API identity boundary;
- the Better Auth core tables in the `identity` schema;
- `app.storage_folder_segments(text)`;
- `pgcrypto`, `pg_trgm`, `unaccent`, `vector`, and `btree_gist`;
- explicit ACLs for `anonymous`, `authenticated`, and `openexpert_service`.

MinIO is the local object-store target for the shared storage adapter. Its API
CORS allowlist is restricted to the CRM and client portal origins on
`127.0.0.1`/`localhost` ports `3004` and `3006`, so those applications can use
signed direct `PUT` uploads without enabling arbitrary browser origins.

To inspect the fully interpolated Compose configuration manually:

```sh
docker compose \
  --env-file .env.local-stack \
  --project-name openexpert-local \
  --file compose.local.yml \
  config
```
