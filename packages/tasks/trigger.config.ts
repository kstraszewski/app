import { defineConfig } from '@trigger.dev/sdk'

const project = process.env.TRIGGER_PROJECT_REF?.trim()

if (!project || project === 'proj_your_project_ref') {
  throw new Error(
    'Set TRIGGER_PROJECT_REF in packages/tasks/.env.local before running Trigger.dev.',
  )
}

export default defineConfig({
  project,
  dirs: ['./src/trigger'],
  maxDuration: 3600,
  retries: {
    enabledInDev: true,
    default: {
      factor: 2,
      maxAttempts: 3,
      maxTimeoutInMs: 10_000,
      minTimeoutInMs: 1_000,
      randomize: true,
    },
  },
  runtime: 'node-24',
})
