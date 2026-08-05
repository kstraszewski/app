# Trigger.dev tasks

OpenExpert keeps durable background tasks in the dedicated
`@openexpert/tasks` workspace package. This follows Trigger.dev's recommended
Turborepo layout and keeps task implementations out of Nuxt server bundles.

## Local development

The repository is connected to the `OpenExpert-CRM` Trigger.dev project. Copy
the example file, then add that project's development secret key to the ignored
local file:

```sh
cp packages/tasks/.env.example packages/tasks/.env.local
pnpm trigger:login
pnpm trigger:dev
```

`pnpm trigger:dev` starts `trigger dev` from `packages/tasks`. Task code runs
on the local machine in separate Node processes and is watched for changes.
The safe `openexpert-platform-healthcheck` task can be run from the Trigger.dev
dashboard to verify the connection.

The CLI automatically loads `packages/tasks/.env.local`. Server routes that
trigger tasks must receive the same environment's `TRIGGER_SECRET_KEY`; never
expose that key through Nuxt public runtime configuration or browser code.

## Cloud control plane versus full self-hosting

The local `trigger dev` worker uses Trigger.dev Cloud by default. This is the
lightweight daily-development mode: execution is local, while scheduling,
run state, and the dashboard use the managed control plane.

A fully local control plane is also supported, but it is a separate and much
heavier stack than OpenExpert's database Compose file. Trigger.dev's official
combined Docker setup includes its webapp, PostgreSQL, Redis, registry, object
storage, supervisor, and task runners. Follow the official
[Docker self-hosting guide](https://trigger.dev/docs/self-hosting/docker), then
connect the CLI with a separate profile:

```sh
pnpm --filter @openexpert/tasks exec trigger login \
  --api-url http://127.0.0.1:8030 \
  --profile self-hosted
pnpm --filter @openexpert/tasks exec trigger dev \
  --skip-update-check \
  --profile self-hosted
```

Set `TRIGGER_API_URL=http://127.0.0.1:8030` in
`packages/tasks/.env.local` when application code should trigger that local
instance. Trigger.dev documents at least 3 vCPU/6 GB RAM for the webapp side
and 4 vCPU/8 GB RAM for the worker side, so the full control plane is not
started automatically with `pnpm db:setup`.

## Vercel deployments

For production, connect the Trigger.dev project to both the Vercel project and
the GitHub repository. The official Vercel integration deploys task versions,
syncs the managed Trigger.dev variables to Vercel, and can gate production on
an atomic task deployment. Configure its Trigger config path as
`packages/tasks/trigger.config.ts`; Trigger.dev builds from the repository
root.

The manual `pnpm trigger:deploy` command deliberately uses
`--skip-sync-env-vars`, preventing local PostgreSQL, MinIO, or development
secrets from being uploaded accidentally. Prefer the
[Vercel integration](https://trigger.dev/docs/vercel-integration) for normal
production deployments.

## Adding tasks and triggering them

Add implementations under `packages/tasks/src/trigger`. Nuxt server code may
import the SDK client from `@openexpert/tasks/client` and task definitions only
as TypeScript types from `@openexpert/tasks`:

```ts
import type { platformHealthcheck } from '@openexpert/tasks'
import { tasks } from '@openexpert/tasks/client'

const handle = await tasks.trigger<typeof platformHealthcheck>(
  'openexpert-platform-healthcheck',
  { source: 'crm' },
)
```

Use Trigger.dev queues and concurrency limits for serialized workloads. For
email, payments, webhooks, and outbox delivery, also pass a stable idempotency
key so retries cannot duplicate side effects.

References:

- [manual monorepo setup](https://trigger.dev/docs/manual-setup)
- [`trigger dev` CLI](https://trigger.dev/docs/cli-dev-commands)
- [triggering tasks](https://trigger.dev/docs/triggering)
- [self-hosting overview](https://trigger.dev/docs/self-hosting/overview)
